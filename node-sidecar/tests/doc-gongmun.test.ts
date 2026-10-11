/** 작성실·서식 — gongmun_meta·generate_hwpx·lint·template_fields/fill·mail_merge·org_autofill·서식함 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { markdownToHwpx, parse } from 'kordoc';
import { call, sample, setupEnv } from './doc-helpers.js';
import { buildXlsx } from '../src/core/excel/xlsx.js';
import { gongmunDate, headTitle } from '../src/core/template/org.js';
import JSZip from 'jszip';
import { generateHwpx } from '../src/core/gongmun/index.js';
import { openRhwp } from '../src/core/render/rhwp.js';

vi.mock('../src/infra/progress.js', async (orig) => ({ ...(await orig<typeof import('../src/infra/progress.js')>()), sendProgress: vi.fn(), sendNotification: vi.fn() }));

const REPORT = sample('4-보고서_디지털 행정 혁신 추진계획.hwpx');
const FORM = sample('취합/교육수요조사서_총무과.hwpx');
const MD = '# 2027년 체육대회 운영 계획\n\n> 시민 화합을 위해 체육대회를 열고자 함\n\n## 추진 배경\n\n- 시민 건강 증진\n- 2026.7.1.까지 접수\n';
let env: ReturnType<typeof setupEnv>;

beforeAll(() => {
  env = setupEnv();
});

describe('gongmun_meta', () => {
  it('프리셋 9종·기관(공통 포함)·내장 서식 누름틀', async () => {
    const m = await call('gongmun_meta');
    expect(m.presets.map((p: { id: string }) => p.id)).toEqual(['official', 'report', 'plan', 'notice', 'minutes', 'gaejosik', 'press', 'ministry', 'bangchim']);
    expect(m.agencies[0]).toBe('공통');
    expect(m.agencies).toContain('국세청');
    const gian = m.templates.find((t: { id: string }) => t.id === 'gian');
    expect(gian.fields).toContain('본문');
    expect(JSON.stringify(m)).not.toMatch(/[—–]/);
  });
});

describe('generate_hwpx', () => {
  it('preview_only — 저장 없이 PNG 미리보기 + 표기 검사, 빠르게', async () => {
    const t = Date.now();
    const r = await call('generate_hwpx', { markdown: MD, preset: '보고서', preview_only: true, preview_pages: 1 });
    expect(r.output_path).toBeUndefined();
    expect(r.preview).toHaveLength(1);
    expect(r.preview[0].data_url).toMatch(/^data:image\/png;base64,/);
    expect(r.lint.some((f: { rule: string }) => f.rule === 'DATE_NO_SPACE')).toBe(true);
    expect(Date.now() - t).toBeLessThan(5000);
  });

  it('preview_hwpx — RPC 로도 화면이 rhwp 로 그릴 HWPX 를 받는다', async () => {
    const r = await call('generate_hwpx', { markdown: MD, preset: 'report', preview_only: true, preview_hwpx: true });
    expect(r.preview).toBeUndefined();
    expect(Buffer.from(r.preview_hwpx_b64, 'base64').subarray(0, 2).toString()).toBe('PK');
  });

  it('저장 — 첫 제목이 파일 이름, 견본 단계 서식·표 서식·기관 서식', async () => {
    const r = await call('generate_hwpx', { markdown: MD, preset: 'report', agency: '국세청', levels_from: REPORT, profile_from: FORM, approval: ['담당', '과장'] });
    expect(r.output_path).toBe(join(env.out, '2027년 체육대회 운영 계획.hwpx'));
    const back = await parse(readFileSync(r.output_path));
    expect(back.success && back.markdown).toContain('시민 건강 증진');
    expect(r.warnings.join('\n')).not.toMatch(/[—–]/);
  });

  it('모르는 문서 종류·기관은 안내', async () => {
    await expect(call('generate_hwpx', { markdown: MD, preset: '연애편지' })).rejects.toThrow(/모르는 문서 종류/);
    await expect(call('generate_hwpx', { markdown: MD, agency: '없는청' })).rejects.toThrow(/기관 서식 목록에 없는/);
    await expect(call('generate_hwpx', { markdown: '  ' })).rejects.toThrow(/비어 있습니다/);
  });
});

// RPC 등록(methods/documents-work.ts)이 preview_hwpx 를 넘기기 전이라 코어를 바로 부른다
describe('generate_hwpx preview_hwpx', () => {
  const opts = { markdown: MD, preset: '개조식', cover: { org: '가온시' }, toc: true };
  const section = async (bytes: Uint8Array | Buffer) => (await JSZip.loadAsync(bytes)).file('Contents/section0.xml')!.async('string');

  it('preview_only 와 함께 — 쪽 그림 대신 저장본과 같은 HWPX(rhwpCompat 적용), 저장 없음', async () => {
    const t = Date.now();
    const r = await generateHwpx({ ...opts, preview_only: true, preview_hwpx: true });
    expect(Date.now() - t).toBeLessThan(5000);
    expect(r.output_path).toBeUndefined();
    expect(r.preview).toBeUndefined();
    expect(r.lint.some((f) => f.rule === 'DATE_NO_SPACE')).toBe(true);
    const bytes = Buffer.from(r.preview_hwpx_b64!, 'base64');
    expect(Object.keys((await JSZip.loadAsync(bytes)).files)[0]).toBe('mimetype');
    const xml = await section(bytes);
    const at = xml.indexOf('추진 배경');
    expect(xml.slice(xml.lastIndexOf('<hp:tbl ', at), at)).toContain('pageBreak="NONE"'); // 목차 틀 보정
    const saved = await generateHwpx(opts);
    expect(xml).toBe(await section(readFileSync(saved.output_path!)));
    const doc = (await openRhwp(new Uint8Array(bytes))) as unknown as { pageCount(): number; free?(): void };
    expect(doc.pageCount()).toBeGreaterThan(1);
    doc.free?.();
  });

  it('preview_only 없이는 그대로 저장', async () => {
    const r = await generateHwpx({ markdown: MD, preview_hwpx: true });
    expect(r.output_path).toBeTruthy();
    expect(r.preview_hwpx_b64).toBeUndefined();
  });
});

describe('lint', () => {
  it('글 — 표기 규칙 + 개수', async () => {
    const r = await call('lint', { text: '2026.7.1.까지 제출\n금 1000원' });
    expect(r.counts.error).toBeGreaterThanOrEqual(1);
    expect(r.findings[0]).toMatchObject({ rule: 'DATE_NO_SPACE', line: 1, excerpt: '2026.7.1.' });
  });

  it('파일 + 수치 대조·단계 서식 편차 (kordoc CLI)', async () => {
    const r = await call('lint', { path: REPORT, numbers: true, styles: true });
    expect(Array.isArray(r.findings)).toBe(true);
    expect(r.counts.error + r.counts.warning + r.counts.info).toBe(r.findings.length);
  });

  it('개조식 문체(munche) — 켜면 서술형 끝맺음을 짚고, 끄면 안 본다. 파일 + CLI 경로와도 같이', async () => {
    const text = '# 보고\n\n□ 추진 배경\n  ○ 민원이 늘어 대책을 마련하였습니다.';
    const off = await call('lint', { text });
    const on = await call('lint', { text, munche: true });
    expect(on.findings.length).toBeGreaterThan(off.findings.length);
    const file = await call('lint', { path: REPORT, numbers: true, styles: true, munche: true });
    expect(file.counts.error + file.counts.warning + file.counts.info).toBe(file.findings.length);
  });

  it('lint_fix — 바꿀 말이 정해진 지적(쉬운 말·순화어·날짜 띄어쓰기)만 고칠 거리로, 고른 것만 서식 그대로 사본에 반영', async () => {
    const path = join(env.work, '고칠문서.hwpx');
    writeFileSync(path, Buffer.from(await markdownToHwpx('# 회의 개최 알림\n\n1. 금일 회의를 2026.3.5.에 개최함.\n2. 장애자 편의 시설을 점검함.')));
    const r = await call('lint', { path });
    const fixes = r.findings.filter((f: { fix?: unknown }) => f.fix).map((f: { fix: { from: string; to: string } }) => f.fix);
    expect(fixes).toEqual(expect.arrayContaining([{ from: '금일', to: '오늘' }, { from: '2026.3.5.', to: '2026. 3. 5.' }, { from: '장애자', to: '장애인' }]));
    // 고른 둘만 (장애자는 그대로)
    const out = await call('lint_fix', { path, fixes: fixes.filter((f: { from: string }) => f.from !== '장애자') });
    expect(out.replaced).toBe(2);
    expect(out.output_path).toMatch(/_수정\.hwpx$/);
    const md = (await parse(readFileSync(out.output_path))).markdown;
    expect(md).toContain('오늘 회의를 2026. 3. 5.에 개최함');
    expect(md).toContain('장애자');
    await expect(call('lint_fix', { path, fixes: [{ from: '없는말', to: '바꿈' }] })).rejects.toThrow(/찾지 못했습니다/);
  });

  it('글 + 수치 대조 — 표에 없는 본문 수치를 확인 목록으로', async () => {
    const text = '## 예산\n\n총 예산은 9,999만 원.\n\n| 구분 | 금액 |\n| --- | --- |\n| 가 | 1,000만 원 |\n| 나 | 2,000만 원 |\n| 다 | 3,000만 원 |\n| 라 | 4,000만 원 |\n| 마 | 5,000만 원 |\n';
    const r = await call('lint', { text, numbers: true });
    expect(r.findings.some((f: { rule: string; excerpt?: string }) => f.rule === 'NUMBER_CHECK')).toBe(true);
  });
});

describe('template_fields·template_fill', () => {
  it('내장 기안문 — 누름틀 칸·안내문·여러 줄', async () => {
    const r = await call('template_fields', { template: 'gian' });
    expect(r.fields.find((f: { name: string }) => f.name === '본문')).toMatchObject({ multiline: true, label: '내용을 입력하세요' });
  });

  it('누름틀 없는 사용자 서식은 표 라벨 칸', async () => {
    const r = await call('template_fields', { path: FORM });
    expect(r.fields.map((f: { name: string }) => f.name)).toContain('담당자');
  });

  it('채우기 — 제목이 파일 이름, 원본 서식 유지', async () => {
    const r = await call('template_fill', { template: 'gian-simple', values: { 제목: '시험 보고', 작성일: '2026. 10. 10.', 결재직위1: '' } });
    expect(r.output_path).toBe(join(env.out, '시험 보고.hwpx'));
    expect(r.filled.sort()).toEqual(['작성일', '제목']);
    const back = await parse(readFileSync(r.output_path));
    expect(back.success && back.markdown).toContain('시험 보고');
  });

  it('HWP 서식은 안내', async () => {
    const hwp = join(env.work, '서식.hwp');
    writeFileSync(hwp, 'x');
    await expect(call('template_fill', { path: hwp, values: { a: 'b' } })).rejects.toThrow(/HWPX로 저장/);
  });
});

describe('mail_merge', () => {
  it('CSV 명부 — 한 줄 = 한 장, 파일 이름 열, 빈 줄 건너뜀', async () => {
    const csv = join(env.work, '명부.csv');
    writeFileSync(csv, '﻿제목,본문,파일명\n체육대회 협조,"1. 참가 요청\n2. 명단 제출",첫째\n\n교육 안내,안내 본문,둘째\n');
    const r = await call('mail_merge', { template: 'gian', data_path: csv, name_column: '파일명' });
    expect(r.failed).toEqual([]);
    expect(r.outputs.map((p: string) => p.split(/[\\/]/).pop())).toEqual(['첫째.hwpx', '둘째.hwpx']);
    const back = await parse(readFileSync(r.outputs[0]));
    expect(back.success && back.markdown).toContain('체육대회 협조');
  });

  it('CP949 CSV 명부 (한국어 윈도우 엑셀 "CSV(쉼표로 분리)" 저장본, 확장 한글 똠 포함)', async () => {
    const csv = join(env.work, '명부-cp949.csv');
    // '제목,본문,파일명\n똠양꿍 행사 협조,안내 본문,셋째\n' 의 CP949 바이트 (똠 = 0x8C63, EUC-KR 2350자 밖)
    writeFileSync(csv, Buffer.from('c1a6b8f12cbabbb9ae2cc6c4c0cfb8ed0a8c63bee7b2e120c7e0bbe720c7f9c1b62cbec8b3bb20babbb9ae2cbcc2c2b00a', 'hex'));
    const r = await call('mail_merge', { template: 'gian', data_path: csv, name_column: '파일명' });
    expect(r.failed).toEqual([]);
    expect(r.outputs.map((p: string) => p.split(/[\\/]/).pop())).toEqual(['셋째.hwpx']);
    const back = await parse(readFileSync(r.outputs[0]));
    expect(back.success && back.markdown).toContain('똠양꿍 행사 협조');
  });

  it('XLSX 명부 (작성기로 만든 엑셀) + 맞는 칸이 없는 줄은 실패 목록', async () => {
    const xlsx = join(env.work, '명부.xlsx');
    writeFileSync(xlsx, await buildXlsx([{ name: '명부', header: true, rows: [['제목', '시행일'], ['첫 공문', '2026. 10. 1.'], ['둘째 공문', '2026. 10. 2.']] }]));
    const r = await call('mail_merge', { template: 'gian', data_path: xlsx });
    expect(r.outputs).toHaveLength(2);
    const bad = join(env.work, '안맞음.csv');
    writeFileSync(bad, '없는칸\n값\n');
    const r2 = await call('mail_merge', { template: 'gian', data_path: bad });
    expect(r2.failed[0]).toMatchObject({ row: 2 });
    expect(r2.failed[0].error).toMatch(/칸 이름/);
  });
});

describe('org_autofill', () => {
  it('동의어·괄호·오늘 날짜·결재직위N', async () => {
    const r = await call('org_autofill', { fields: ['행정기관명', '기안자', '전화번호(담당자)', '시행일', '결재직위3', '전자 우편', '수신자'] });
    expect(r.values).toEqual({
      행정기관명: '가온시', 기안자: '주무관 김가온', '전화번호(담당자)': '031-000-0000', 시행일: gongmunDate(), 결재직위3: '과장', '전자 우편': 'gaon@example.go.kr',
    });
    expect(r.matched).not.toContain('수신자');
    expect(gongmunDate(new Date(2026, 9, 10))).toBe('2026. 10. 10.');
  });
});

describe('발신명의', () => {
  it('기관 종류마다 기관장 직함', () => {
    const cases: Array<[string, string]> = [
      ['서울특별시 광진구', '서울특별시 광진구청장'], ['가온시', '가온시장'], ['서울특별시', '서울특별시장'], ['양평군', '양평군수'],
      ['경기도', '경기도지사'], ['제주특별자치도', '제주특별자치도지사'], ['서울특별시교육청', '서울특별시교육감'], ['행정안전부', '행정안전부장관'],
      ['국세청', '국세청장'], ['법제처', '법제처장'], ['광진소방서', '광진소방서장'], ['중곡1동', '중곡1동장'], ['광진구청장', '광진구청장'], ['', ''],
      // 청사 이름으로 적은 경우·특수 기관
      ['수원시청', '수원시장'], ['가평군청', '가평군수'], ['광진구청', '광진구청장'], ['경기도청', '경기도지사'],
      ['서울특별시동부교육지원청', '서울특별시동부교육지원청교육장'], ['가온대학교', '가온대학교총장'], ['경기도소방재난본부', '경기도소방재난본부장'], ['개인정보보호위원회', '개인정보보호위원장'],
    ];
    for (const [name, head] of cases) expect(headTitle(name)).toBe(head);
  });
});

describe('서식함', () => {
  it('목록 — 내장 2 + 시작 서식 9', async () => {
    const r = await call('template_library');
    expect(r.templates.filter((t: { source: string }) => t.source === 'builtin')).toHaveLength(2);
    expect(r.templates.filter((t: { source: string }) => t.source === 'starter')).toHaveLength(9);
  });

  it('분석 → 등록 → 목록 → 지우기', async () => {
    const a = await call('template_analyze', { path: sample('3-민원서류_정보공개 청구서.hwpx') });
    expect(a.format).toBe('hwpx');
    expect(a.label_fields.map((f: { label: string }) => f.label)).toContain('주민등록번호');
    const added = await call('template_add', { path: FORM, name: '교육 수요조사서' });
    expect(added.id).toMatch(/^user:/);
    expect(added.path.startsWith(env.data)).toBe(true);
    expect(added.category).toBe('서식');
    const list = await call('template_library');
    expect(list.templates.some((t: { id: string }) => t.id === added.id)).toBe(true);
    expect(await call('template_remove', { id: added.id })).toBe(true);
    expect(existsSync(added.path)).toBe(false);
    await expect(call('template_remove', { id: 'builtin:gian' })).rejects.toThrow(/내장 서식/);
  });

  it('시작 서식 — 내 기관 정보로 머리·끝', async () => {
    const r = await call('template_starter', { preset: 'official' });
    const back = await parse(readFileSync(r.output_path));
    if (!back.success) throw new Error(back.error);
    expect(back.markdown).toContain('가온시');
    expect(back.markdown).toContain('031-000-0000');
    const press = await call('template_starter', { preset: '보도자료' });
    const pb = await parse(readFileSync(press.output_path));
    expect(pb.success && pb.markdown).toContain('김가온');
  });
});
