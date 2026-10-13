/** 우리 서식으로 맞추기 — 견본 서식 읽기·내용 다시 짜기·서식 입혀 만들기·저장
 *
 * 견본은 kordoc markdownToHwpx 로 기본값이 아닌 옵션을 줘서 만든 가상의 문서(가온시)다. 실문서 충실도는 scripts/style-fidelity.ts.
 */

import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { markdownToHwpx } from 'kordoc';
import { beforeAll, describe, expect, it } from 'vitest';
import { call, setupEnv } from './doc-helpers.js';
import { DepthStack, readMarker } from '../src/core/style/markers.js';
import { normalizeContent } from '../src/core/style/normalize.js';
import { extractStyle } from '../src/core/style/extract.js';
import { compareFormats } from '../src/core/style/compare.js';
import { depthOffset, gongmunOptions, markdownTables, renderPreset } from '../src/core/style/apply.js';
import type { StyleEntry, StyleFormat } from '../src/types/rpc-contract.js';

let env: ReturnType<typeof setupEnv>;

const OFFICIAL_MD = '1. 관련: 가온시 총무과-100(2026. 3. 2.)\n  - 나무 심기 행사 협조\n  - 행사장 안전 관리\n2. 위와 관련하여 아래와 같이 알립니다.\n  - 일시: 2026. 4. 5.(일) 10:00\n  - 장소: 가온시 시민공원\n3. 참석자는 편한 복장으로 와 주시기 바랍니다.\n';
const REPORT_MD = '# 2026년 가온시 도서관 운영 계획\n\n- 추진 배경\n  - 도서관 이용자가 3년 사이 20% 늘어 열람석이 모자람\n    - 주말 오후 대기 시간 평균 40분\n  - 어린이 자료실 확충 요구\n- 추진 계획\n  - 열람석 60석 늘림\n  - 주말 운영 시간 2시간 늘림\n\n| 구분 | 현재 | 계획 |\n| --- | --- | --- |\n| 열람석 | 120석 | 180석 |\n| 운영 시간 | 18시 | 20시 |\n';

async function writeSample(name: string, md: string, gongmun: Parameters<typeof markdownToHwpx>[1]): Promise<string> {
  const p = join(env.work, name);
  writeFileSync(p, Buffer.from(await markdownToHwpx(md, { ...gongmun, warnings: [] })));
  return p;
}

let officialPath: string;
let reportPath: string;

beforeAll(async () => {
  env = setupEnv();
  officialPath = await writeSample('견본_기안문.hwpx', OFFICIAL_MD, {
    gongmun: {
      preset: 'official', bodyPt: 13, lineSpacing: 170, fonts: { body: '휴먼명조' },
      margins: { top: 25, bottom: 12, left: 22, right: 18 },
      levels: { 0: { font: '휴먼명조', pt: 13 }, 1: { font: '휴먼명조', pt: 13, bold: true } },
      docHead: { org: '가온시', to: '내부결재', title: '나무 심기 행사 알림' },
    },
  });
  reportPath = await writeSample('견본_보고서.hwpx', REPORT_MD, {
    gongmun: {
      preset: 'report', bodyPt: 14, lineSpacing: 150, bullet2: '◦', pageNumbers: true,
      levels: { 0: { font: 'HY견고딕', pt: 16, bold: true }, 1: { font: '휴먼명조', pt: 14, bold: false }, 2: { font: '휴먼명조', pt: 13 } },
    },
  });
}, 30_000);

describe('항목 기호 읽기', () => {
  it('기호 갈래와 내용을 나눈다', () => {
    expect(readMarker('□ 추진 배경')).toMatchObject({ key: '□', family: 'report', rest: '추진 배경' });
    expect(readMarker('  ㅇ 둘째')).toMatchObject({ key: '○', glyph: 'ㅇ' });
    expect(readMarker('가. 기간')).toMatchObject({ key: '가.', family: 'legal' });
    expect(readMarker('1) 셋째')).toMatchObject({ key: '1)', family: 'legal' });
    expect(readMarker('※ 참고')).toMatchObject({ family: 'ref' });
    expect(readMarker('Ⅱ. 추진 계획')).toMatchObject({ family: 'chapter' });
  });

  it('날짜·금액·낱말 첫 글자는 기호가 아니다', () => {
    expect(readMarker('2026. 6. 1. 시행')).toBeNull();
    expect(readMarker('1.5배 늘어남')).toBeNull();
    expect(readMarker('다만 예외로 한다')).toBeNull();
    expect(readMarker('□ 예  ■ 아니오')).toBeNull();
  });

  it('나온 차례로 단계를 정한다', () => {
    const s = new DepthStack();
    expect(['1.', '가.', '○', '가.', '1.', '가.'].map((k) => s.depthOf(k))).toEqual([0, 1, 2, 1, 0, 1]);
  });
});

describe('내용 다시 짜기', () => {
  it('기안문 두문·결문을 걷어 내고 수신·제목만 건진다', () => {
    const md = [
      '1. 관련 근거', '가온시 표어 한 줄', '가 온 시', '수신 내부결재', '(경유)', '제목 공원 정비 결과 보고',
      '가. 가온시 공원과-12(2026. 1. 2.)', '나. 공원 관리 지침', '2. 정비 결과를 아래와 같이 보고합니다.',
      '붙임 정비 사진 1부. 끝.', '주무관 김가온 팀장 박가온', '협조자', '시행 공원과-30 ( 2026. 2. 1. ) 접수 ( )',
      '우 12345 가온시 시청로 1 / www.gaon.example', '전화 031-000-0000 /전송 031-000-0001 / 공개',
    ].join('\n\n');
    const r = normalizeContent(md);
    expect(r.title).toBe('공원 정비 결과 보고');
    expect(r.to).toBe('내부결재');
    expect(r.hadEndMark).toBe(true);
    expect(r.markdown).not.toMatch(/수신|경유|표어|시행|전화|김가온/);
    expect(r.markdown).toContain('- 관련 근거\n  - 가온시 공원과-12(2026. 1. 2.)\n  - 공원 관리 지침\n- 정비 결과를 아래와 같이 보고합니다.');
    expect(r.markdown).toMatch(/\n붙임  정비 사진 1부\.\n$/);
    expect(r.sourceMarkers).toEqual(['1.', '가.']);
  });

  it('기안문 서식: 끝 표시는 마지막 줄 끝에 두 칸 띄고 (없으면 붙이고, 표로 끝나면 다음 줄)', () => {
    expect(normalizeContent('제목 알림\n\n1. 알립니다.\n\n붙임 자료 1부. 끝.', { keepEndMark: true }).markdown).toMatch(/\n붙임  자료 1부\.  끝\.\n$/);
    expect(normalizeContent('제목 알림\n\n1. 첫째입니다.\n\n2. 둘째입니다.', { keepEndMark: true }).markdown).toMatch(/- 둘째입니다\.  끝\.\n$/);
    expect(normalizeContent('제목 알림\n\n1. 아래와 같습니다.\n\n| 가 | 나 |\n| --- | --- |\n| 1 | 2 |\n\n끝.', { keepEndMark: true }).markdown).toMatch(/\| 1 \| 2 \|\n\n끝\.\n$/);
    // 기안문 서식이 아니면 끝 표시를 쓰지 않는다
    expect(normalizeContent('제목 알림\n\n1. 알립니다.  끝.').markdown).not.toContain('끝');
  });

  it('여러 줄 붙임은 한 붙임으로 (붙임  1. … / 2. … 줄 맞춤, 끝 표시는 마지막 줄 끝)', () => {
    const md = '수신 내부결재\n\n제목 점검 결과 보고\n\n1. 점검 결과를 보고합니다.\n\n2. 조치는 아래와 같습니다.\n\n붙임 1. 특수장소 점검확인서 1부.\n\n2. 조치사진 1부. 끝.\n\n시행 안전과-1 접수\n\n전화 031-000-0000 /전송 / 공개';
    const r = normalizeContent(md, { keepEndMark: true });
    expect(r.markdown).toBe('# 점검 결과 보고\n\n- 점검 결과를 보고합니다.\n- 조치는 아래와 같습니다.\n\n붙임  1. 특수장소 점검확인서 1부.\n      2. 조치사진 1부.  끝.\n');
    // PDF 글처럼 목록 표시가 붙은 붙임·번호도 같게
    const r2 = normalizeContent('# 보고\n\n1. 보고합니다.\n\n- 붙임 1. 계획 1부.\n- 2. 명단 1부.\n- 3. 사진 1부.', {});
    expect(r2.markdown).toBe('# 보고\n\n- 보고합니다.\n\n붙임  1. 계획 1부.\n      2. 명단 1부.\n      3. 사진 1부.\n');
  });

  it('PDF 글의 "- 가." 목록 표시는 안쪽 기호로 읽고, 줄을 끊은 짧은 꼬리는 앞 항목에 잇는다', () => {
    const r = normalizeContent('# 계획\n\n1. 개최 계획을 수립하고\n\n보고합니다.\n\n- 가. 행사명: 심포지엄\n  - 나. 일시: 11월\n- 붙임 계획 1부.');
    expect(r.markdown).toBe('# 계획\n\n- 개최 계획을 수립하고 보고합니다.\n  - 행사명: 심포지엄\n  - 일시: 11월\n\n붙임  계획 1부.\n');
  });

  it('장이 없는 서식이면 장 제목을 첫 단계 항목으로, ○ 로 시작하는 서식이면 한 단계 깊게', () => {
    const md = '# 보고\n\nⅠ. 배경\n\n□ 첫째\n\nㅇ 둘째\n\nⅡ. 계획\n\n□ 셋째';
    expect(normalizeContent(md).markdown).toBe('# 보고\n\n## 배경\n\n- 첫째\n  - 둘째\n\n## 계획\n\n- 셋째\n');
    expect(normalizeContent(md, { headingsAsItems: true, depthOffset: 1 }).markdown).toBe('# 보고\n\n  - 배경\n    - 첫째\n      - 둘째\n  - 계획\n    - 셋째\n');
  });

  it('마크다운 원문 목록은 들여쓰기가 단계다', () => {
    const r = normalizeContent('# 회의\n\n- 안건\n  - 첫 안건\n  - 둘째 안건\n- 결정', { textSource: true });
    expect(r.markdown).toBe('# 회의\n\n- 안건\n  - 첫 안건\n  - 둘째 안건\n- 결정\n');
  });

  it('표의 줄·칸 수는 합친 칸과 칸 안의 표까지 센다', () => {
    const html = '<table><tr><th colspan="2">가</th><th>나</th></tr><tr><td rowspan="2">다</td><td>라<table><tr><td>안</td></tr><tr><td>안</td></tr></table></td><td>마</td></tr><tr><td>바</td><td>사</td></tr></table>';
    expect(markdownTables(`${html}\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n`)).toEqual([{ rows: 3, cols: 3 }, { rows: 2, cols: 2 }]);
  });
});

describe('견본 서식 읽기', () => {
  it('기안문: 여백·본문·줄 간격·법정 기호·두문 기관명', async () => {
    const { format: f } = await extractStyle(officialPath);
    expect(f.preset).toBe('official');
    expect(f.paper).toMatchObject({ size: 'A4', landscape: false });
    expect(f.margins).toMatchObject({ top: 25, bottom: 12, left: 22, right: 18 });
    expect(f.body).toMatchObject({ font: '휴먼명조', pt: 13, line_spacing: 170, gothic: false });
    expect(f.numbering).toMatchObject({ scheme: 'standard', markers: ['1.', '가.'] });
    expect(f.levels.map((l) => [l.marker, l.font, l.pt, l.bold])).toEqual([['1.', '휴먼명조', 13, false], ['가.', '휴먼명조', 13, true]]);
    expect(f.title.kind).toBe('head');
    expect(f.head?.org).toBe('가온시');
    expect(f.summary).toContain('여백 위 25 아래 12 왼쪽 22 오른쪽 18 mm');
    expect(f.summary).toContain('본문 휴먼명조 13pt');
    expect(f.summary).not.toMatch(/[—–]/);
  });

  it('보고서: 기호 □ ◦ -·단계별 글꼴·제목 상자·쪽 번호·표 모양', async () => {
    const { format: f } = await extractStyle(reportPath);
    expect(['report', 'plan']).toContain(f.preset);
    expect(f.numbering).toMatchObject({ scheme: 'report', markers: ['□', '○', '-'], bullet2: '◦' });
    expect(f.levels[0]).toMatchObject({ font: 'HY견고딕', pt: 16, bold: true });
    expect(f.levels[2]).toMatchObject({ font: '휴먼명조', pt: 13 });
    expect(f.body.line_spacing).toBe(150);
    expect(f.title.kind).toBe('box');
    expect(f.page_numbers).toBe(true);
    expect(f.table?.header.font).toBeTruthy();
  });

  it('한글 문서가 아니면 고칠 일을 알려 준다', async () => {
    const p = join(env.work, '메모.txt');
    writeFileSync(p, '메모');
    await expect(extractStyle(p)).rejects.toThrow(/HWPX·HWP/);
  });
});

describe('서식 입혀 만들기', () => {
  it('보고서 서식 → 기안문 내용: 다시 읽은 서식이 견본과 같다', async () => {
    const { format: want } = await extractStyle(reportPath);
    const src = await writeSample('내용_기안문.hwpx', OFFICIAL_MD, { gongmun: { preset: 'official', docHead: { org: '가온시', to: '내부결재', title: '나무 심기 행사 알림' } } });
    const r = await call<{ results: Array<{ ok: boolean; output_path?: string; error?: string }> }>('style_apply', { source_paths: [src], sample_path: reportPath });
    expect(r.results[0].error).toBeUndefined();
    const out = r.results[0].output_path!;
    expect(out).toMatch(/내용_기안문_우리서식\.hwpx$/);
    const { format: got } = await extractStyle(out);
    const bad = compareFormats(want, got).filter((c) => !c.ok);
    expect(bad).toEqual([]);
  }, 30_000);

  it('기안문 서식 → 마크다운 내용: 두문에 기관명·제목, 기호는 1. 가. 로', async () => {
    const { format: want } = await extractStyle(officialPath);
    const md = join(env.work, '회의 결과.md');
    writeFileSync(md, '# 가온시 체육대회 회의 결과\n\n□ 회의 개요\n\nㅇ 일시: 2026. 5. 1.\n\nㅇ 장소: 시청 회의실\n\n□ 결정 사항\n\nㅇ 종목은 6개로 정함\n');
    const r = await call<{ results: Array<{ ok: boolean; output_path?: string }> }>('style_apply', { source_paths: [md], sample_path: officialPath });
    const { format: got } = await extractStyle(r.results[0].output_path!);
    expect(compareFormats(want, got).filter((c) => !c.ok)).toEqual([]);
    expect(got.head?.org).toBe('가온시');
  }, 30_000);

  it('기안문 서식으로 만든 결과: 붙임 두 줄이 붙임 모양으로 이어지고 끝 표시는 마지막 붙임 줄 끝', async () => {
    const src = join(env.work, '점검 결과.md');
    writeFileSync(src, '수신 내부결재\n\n제목 점검 결과 보고\n\n1. 점검 결과를 보고합니다.\n\n붙임 1. 점검확인서 1부.\n\n2. 조치사진 1부. 끝.\n');
    const r = await call('style_apply', { source_paths: [src], sample_path: officialPath });
    const { readHwpx } = await import('../src/core/style/hwpx-read.js');
    const { readFileSync } = await import('node:fs');
    const doc = await readHwpx(readFileSync(r.results[0].output_path));
    const texts = doc.paras.filter((p) => p.tableDepth === 0 && p.text.trim()).map((p) => p.text);
    const at = texts.findIndex((t) => t.startsWith('붙임'));
    expect(texts[at]).toBe('붙임  1. 점검확인서 1부.');
    expect(texts[at + 1]).toBe('      2. 조치사진 1부.  끝.');
    expect(texts.filter((t) => /끝\.\s*$/.test(t))).toHaveLength(1);
    // 둘째 붙임 줄은 본문 항목(3.)이 아니라 붙임 문단 모양
    const att = doc.paras.filter((p) => p.tableDepth === 0 && p.text.trim()).slice(at, at + 2);
    expect(att[1].paraPr).toEqual(att[0].paraPr);
  }, 30_000);

  it('같은 이름이 있으면 덮어쓰지 않고 (2) 를 붙인다', async () => {
    const src = join(env.work, '안내.txt');
    writeFileSync(src, '안내\n\n1. 첫째 안내입니다.\n\n2. 둘째 안내입니다.');
    const a = await call('style_apply', { source_paths: [src], sample_path: officialPath });
    const b = await call('style_apply', { source_paths: [src], sample_path: officialPath });
    expect(a.results[0].output_path).not.toBe(b.results[0].output_path);
    expect(b.results[0].output_path).toMatch(/안내_우리서식 \(2\)\.hwpx$/);
    expect(existsSync(src)).toBe(true);
  }, 30_000);

  it('서식 → 생성기 옵션: 머리말 여백을 뺀 위 여백·단계 차례 맞춤', () => {
    const f = { version: 1, preset: 'report', paper: { size: 'A4', width_mm: 210, height_mm: 297, landscape: false },
      margins: { top: 15, bottom: 15, left: 20, right: 20, header: 10, footer: 10 }, body: { font: '휴먼명조', pt: 15, line_spacing: 160, gothic: false },
      numbering: { scheme: 'report', markers: ['○', '-'], bullet2: 'ㅇ' },
      levels: [{ depth: 0, marker: '○', font: '휴먼명조', pt: 15, bold: true, count: 3 }, { depth: 1, marker: '-', font: '휴먼명조', pt: 14, bold: false, count: 3 }],
      title: { kind: 'center' }, page_numbers: true, summary: '', stats: { paragraphs: 6, chars: 100 } } as StyleFormat;
    expect(renderPreset(f)).toBe('notice');
    expect(depthOffset(f)).toBe(1);
    const g = gongmunOptions(f);
    expect(g.margins).toEqual({ top: 15, bottom: 15, left: 20, right: 20 });
    expect(g.levels?.[1]).toMatchObject({ font: '휴먼명조', pt: 15, bold: true });
    expect(g.levels?.[2]).toMatchObject({ pt: 14 });
    expect(g.bullet2).toBe('ㅇ');
  });
});

describe('서식 저장', () => {
  it('저장·목록·미리보기·지우기', async () => {
    const { format } = await call<{ format: StyleFormat }>('style_extract', { path: officialPath });
    const saved = await call<StyleEntry>('style_save', { name: '가온시 기안문', format });
    expect(saved.summary).toContain('기안문 서식');
    const again = await call<StyleEntry>('style_save', { name: '가온시 기안문', format });
    const list = await call<{ styles: StyleEntry[] }>('style_list');
    expect(list.styles.filter((s) => s.name === '가온시 기안문').map((s) => s.id)).toEqual([again.id]);
    const prev = await call<{ preview_hwpx_b64: string }>('style_preview', { style_id: again.id });
    expect(Buffer.from(prev.preview_hwpx_b64, 'base64').subarray(0, 2).toString()).toBe('PK');
    expect(await call('style_delete', { id: again.id })).toBe(true);
    expect((await call<{ styles: StyleEntry[] }>('style_list')).styles).toHaveLength(0);
  }, 30_000);

  it('이름 없이·모양이 틀린 서식은 저장하지 않는다', async () => {
    await expect(call('style_save', { name: ' ', format: {} })).rejects.toThrow(/이름/);
    await expect(call('style_save', { name: '빈 서식', format: { version: 1 } })).rejects.toThrow(/견본 문서를 다시/);
    await expect(call('style_apply', { source_paths: [officialPath], style_id: 'nope' })).rejects.toThrow(/찾지 못했습니다/);
  });
});
