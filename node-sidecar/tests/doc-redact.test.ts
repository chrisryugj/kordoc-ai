/** 보안·손질·취합 — redact(서식 보존·잔존 재검사·결과에 원문 없음)·redact_batch·seal·patch_document·validate_hwpx·collect·write/read */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { markdownToHwpx, parse, redactMarkdown } from 'kordoc';
import { call, makePng, sample, setupEnv, SAMPLES } from './doc-helpers.js';

vi.mock('../src/infra/progress.js', async (orig) => ({ ...(await orig<typeof import('../src/infra/progress.js')>()), sendProgress: vi.fn(), sendNotification: vi.fn() }));

const CLAIM = sample('3-민원서류_정보공개 청구서.hwpx');
const LETTER_PDF = sample('1-받은공문_도민체육대회 참가 협조 요청.pdf');
const FORMS = ['총무과', '기획예산과', '민원봉사과', '복지정책과', '도시계획과'].map((d) => sample(`취합/교육수요조사서_${d}.hwpx`));
let env: ReturnType<typeof setupEnv>;
/** 원본에 든 개인정보 원문 (검사용 — 결과·파일에 나오면 실패) */
let raw: string[] = [];

beforeAll(async () => {
  env = setupEnv();
  const r = await parse(readFileSync(CLAIM));
  if (!r.success) throw new Error(r.error);
  raw = redactMarkdown(r.markdown).hits.map((h) => r.markdown.slice(h.index, h.index + h.length));
});

describe('redact', () => {
  it('HWPX — 서식 보존 마스킹, 잔존 0, 결과·파일에 원문 없음', async () => {
    expect(raw.length).toBeGreaterThanOrEqual(4);
    const r = await call('redact', { path: CLAIM });
    expect(r.preserved).toBe(true);
    expect(r.residual).toBe(0);
    expect(r.total).toBeGreaterThanOrEqual(raw.length);
    expect(r.hits.map((h: { rule: string }) => h.rule)).toEqual(expect.arrayContaining(['rrn', 'phone']));
    const json = JSON.stringify(r);
    for (const v of raw) expect(json).not.toContain(v);
    expect(r.output_path).toMatch(/_마스킹\.hwpx$/);
    const back = await parse(readFileSync(r.output_path));
    if (!back.success) throw new Error(back.error);
    for (const v of raw) expect(back.markdown).not.toContain(v);
    expect(redactMarkdown(back.markdown).hits).toHaveLength(0);
  });

  it('미리보기(dry_run) — 파일 없음, 마스크 문자', async () => {
    const r = await call('redact', { path: CLAIM, dry_run: true, mask_char: '*' });
    expect(r.output_path).toBeUndefined();
    expect(r.hits.flatMap((h: { samples: string[] }) => h.samples).join('')).toContain('*');
  });

  it('PDF — 원본은 두고 가린 .md', async () => {
    const r = await call('redact', { path: LETTER_PDF });
    expect(r.preserved).toBe(false);
    expect(r.output_path).toMatch(/_마스킹\.md$/);
    expect(r.residual).toBe(0);
  });

  it('잘못된 마스크 문자는 안내', async () => {
    await expect(call('redact', { path: CLAIM, mask_char: 'ab' })).rejects.toThrow();
  });

  it('일괄 — 건수·잔존', async () => {
    const r = await call('redact_batch', { paths: [CLAIM, LETTER_PDF] });
    expect(r.results.every((x: { ok: boolean; residual: number }) => x.ok && x.residual === 0)).toBe(true);
    expect(r.results[0].total).toBeGreaterThanOrEqual(4);
  });
});

describe('seal·patch_document·validate_hwpx', () => {
  it('도장 — 앵커 위에 그림, 결과는 구조 검사 통과', async () => {
    const doc = join(env.work, '신청서.hwpx');
    writeFileSync(doc, Buffer.from(await markdownToHwpx('# 신청서\n\n신청인 홍길동 (인)\n')));
    const img = join(env.work, '도장.png');
    writeFileSync(img, await makePng(200, 200, '印'));
    const r = await call('seal', { path: doc, image_path: img, anchor: '(인)' });
    expect(r.placed).toBe(1);
    expect((await call('validate_hwpx', { path: r.output_path })).ok).toBe(true);
    await expect(call('seal', { path: doc, image_path: img, anchor: '(없는 문구)' })).rejects.toThrow();
  });

  it('고친 글 반영 — 서식 그대로', async () => {
    const src = sample('취합/교육수요조사서_총무과.hwpx');
    const md = (await call('convert', { path: src, keep_layout: true, save: false })).content as string;
    expect(md).toContain('이가람');
    const r = await call('patch_document', { path: src, markdown: md.replace('이가람', '박가온') });
    expect(r.applied).toBe(1);
    const back = await parse(readFileSync(r.output_path));
    expect(back.success && back.markdown).toContain('박가온');
  });

  it('구조 검사 — 깨진 HWPX', async () => {
    const bad = join(env.work, '깨짐.hwpx');
    writeFileSync(bad, 'PK not really');
    const r = await call('validate_hwpx', { path: bad });
    expect(r.ok).toBe(false);
    expect(r.issues[0].severity).toBe('error');
  });
});

describe('collect_fields·collect_run', () => {
  it('다섯 부서 서식 → 칸 후보 → 엑셀 한 장', async () => {
    const f = await call('collect_fields', { paths: FORMS });
    expect(f.fields.find((x: { label: string }) => x.label === '부서명')).toMatchObject({ count: 5 });
    const r = await call('collect_run', { paths: FORMS, fields: ['부서명', '담당자', '희망인원'] });
    expect(r.rows).toBe(5);
    expect(r.failed).toEqual([]);
    const back = await parse(readFileSync(r.output_path));
    if (!back.success) throw new Error(back.error);
    expect(back.markdown).toContain('총무과');
    expect(back.markdown).toContain('이가람');
  });
});

describe('write_file·read_file_b64', () => {
  it('덮어쓰기 거절 기본·허용 확장자·읽기', async () => {
    const p = join(env.work, '내보내기.hwpx');
    const data = readFileSync(sample('1-받은공문_도민체육대회 참가 협조 요청.hwpx'));
    await call('write_file', { path: p, data_b64: data.toString('base64') });
    await expect(call('write_file', { path: p, data_b64: data.toString('base64') })).rejects.toThrow(/덮어쓰기/);
    await call('write_file', { path: p, data_b64: data.toString('base64'), overwrite: true });
    const r = await call('read_file_b64', { path: p });
    expect(r).toMatchObject({ name: '내보내기.hwpx', size: data.length });
    expect(Buffer.from(r.data_b64, 'base64').equals(data)).toBe(true);
    await expect(call('write_file', { path: join(env.work, 'x.exe'), data_b64: 'AA==' })).rejects.toThrow(/저장할 수 없습니다/);
    expect(existsSync(join(SAMPLES, '내보내기.hwpx'))).toBe(false);
  });
});
