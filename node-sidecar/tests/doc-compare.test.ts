/** 비교·표 — compare(+HTML·MD·XLSX)·compare_hwpx(신·구조문대비표)·tables_extract·XLSX 작성기·CSV */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import JSZip from 'jszip';
import { diffBlocks, markdownToHwpx, parse, type IRBlock } from 'kordoc';
import { call, corpus, hasCorpus, sample, setupEnv } from './doc-helpers.js';
import { buildXlsx } from '../src/core/excel/xlsx.js';
import { parseCsv, toCsv } from '../src/core/excel/csv.js';
import { diffBlockLists, wordDiff } from '../src/core/comparator/index.js';

vi.mock('../src/infra/progress.js', async (orig) => ({ ...(await orig<typeof import('../src/infra/progress.js')>()), sendProgress: vi.fn(), sendNotification: vi.fn() }));

const OLD = `# 가온시 주민 복지 조례

제1조(목적) 이 조례는 주민 복지 향상에 필요한 사항을 정한다.

제2조(정의) 이 조례에서 "주민"이란 시에 주소를 둔 사람을 말한다.

제3조(위임) 시행에 필요한 사항은 규칙으로 정한다.`;
const NEW = `# 가온시 주민 복지 조례

제1조(목적) 이 조례는 주민 복지 향상에 필요한 사항을 정한다.

제2조(정의) 이 조례에서 "주민"이란 시에 주민등록을 한 사람을 말한다.

제4조(지원) 시장은 예산의 범위에서 비용을 지원할 수 있다.`;

let env: ReturnType<typeof setupEnv>;
let oldPath: string;
let newPath: string;

beforeAll(async () => {
  env = setupEnv();
  oldPath = join(env.work, '조례_현행.hwpx');
  newPath = join(env.work, '조례_개정안.hwpx');
  writeFileSync(oldPath, Buffer.from(await markdownToHwpx(OLD)));
  writeFileSync(newPath, Buffer.from(await markdownToHwpx(NEW)));
});

describe('compare', () => {
  it('바뀐 곳 위주 행 + 통계', async () => {
    const r = await call('compare', { old_path: oldPath, new_path: newPath });
    expect(r.stats.modified + r.stats.added + r.stats.removed).toBeGreaterThanOrEqual(2);
    const mod = r.rows.find((x: { type: string }) => x.type === 'modified');
    expect(mod.old).toContain('주소를 둔');
    expect(mod.new).toContain('주민등록을 한');
    expect(r.rows.some((x: { type: string; new: string }) => x.new.includes('제4조'))).toBe(true);
    expect(r.output_path).toBeUndefined();
  });

  it('긴 문단에서 한두 글자만 바뀌어도 "변경"으로 잡는다 (금액·기간·있다/없다)', async () => {
    const body = (amount: string, days: string, can: string) => `# 가온시 보조금 관리 조례\n\n제9조(교부) 시장은 보조사업자가 사업계획서와 그 밖에 규칙으로 정하는 서류를 갖추어 신청한 경우 예산의 범위에서 ${amount} 이내의 보조금을 교부할 수 있고, 보조사업자는 교부 결정을 통지받은 날부터 ${days} 이내에 사업에 착수하여야 하며, 정당한 사유가 있으면 시장의 승인을 받아 사업 내용을 변경${can}.\n\n제10조(위임) 시행에 필요한 사항은 규칙으로 정한다.`;
    const a = join(env.work, '보조금_현행.hwpx');
    const b = join(env.work, '보조금_개정안.hwpx');
    // 한 글자만 다르다 (엔진의 닮음 문턱 99% 를 넘는 꼴)
    writeFileSync(a, Buffer.from(await markdownToHwpx(body('1,000만원', '30일', '할 수 있다'))));
    writeFileSync(b, Buffer.from(await markdownToHwpx(body('9,000만원', '30일', '할 수 있다'))));
    const r = await call('compare', { old_path: a, new_path: b });
    expect(r.stats.modified).toBeGreaterThanOrEqual(1);
    const mod = r.rows.find((x: { type: string; old: string }) => x.type === 'modified' && x.old.includes('제9조'));
    expect(mod.old).toContain('1,000만원');
    expect(mod.new).toContain('9,000만원');
    // 대비표도 "두 문서 내용이 같습니다"로 거절하지 않는다
    expect((await call('compare_hwpx', { old_path: a, new_path: b })).output_path).toMatch(/신구조문대비표\.hwpx$/);
  });

  it('못 읽는 쪽을 한국어로 짚는다 ("문서B 파싱 실패" 대신 새 문서)', async () => {
    const broken = join(env.work, '깨진_개정안.hwpx');
    writeFileSync(broken, 'not a zip');
    const err = await call('compare', { old_path: oldPath, new_path: broken }).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/^새 문서를 읽지 못했습니다\./);
    expect((err as Error).message).not.toMatch(/문서B|파싱/);
  });

  it('HTML·MD·XLSX 내보내기', async () => {
    const html = await call('compare', { old_path: oldPath, new_path: newPath, export: 'html' });
    const h = readFileSync(html.output_path, 'utf-8');
    expect(h).toContain('<u>주민등록을 한</u>');
    expect(html.output_path).toMatch(/조례_개정안_신구대조표\.html$/);
    const md = await call('compare', { old_path: oldPath, new_path: newPath, export: 'md' });
    expect(readFileSync(md.output_path, 'utf-8')).toContain('**주민등록을 한**');
    const xlsx = await call('compare', { old_path: oldPath, new_path: newPath, export: 'xlsx' });
    const back = await parse(readFileSync(xlsx.output_path));
    expect(back.success && back.markdown).toContain('주민등록을 한');
  });

  it('어절 차이', () => {
    const d = wordDiff('시에 주소를 둔 사람', '시에 주민등록을 한 사람');
    expect(d.old.filter((s) => s.changed).map((s) => s.text.trim())).toEqual(['주소를 둔']);
    expect(d.new.filter((s) => s.changed).map((s) => s.text.trim())).toEqual(['주민등록을 한']);
  });

  it('블록이 아주 많아도 끼운 문단·고친 문단만 짚는다 (엔진이 차례대로만 짝지어 뒤가 모두 "변경"이 되지 않게)', () => {
    const para = (i: number): IRBlock => ({ type: 'paragraph', text: `제${i}조 가온시장은 ${i}번째 사업의 추진 상황을 분기마다 점검하고 그 결과를 의회에 보고하여야 한다.` });
    const A = Array.from({ length: 4000 }, (_, i) => para(i + 1));
    const B = [...A.slice(0, 10), { type: 'paragraph', text: '제10조의2 새로 넣은 조문이다.' } as IRBlock, ...A.slice(10, 1999),
      { type: 'paragraph', text: `${A[1999].text} 다만, 긴급한 경우에는 그러하지 아니하다.` } as IRBlock, ...A.slice(2000, 3990),
      { type: 'paragraph', text: '제3990조의2 새로 넣은 조문이다.' } as IRBlock, ...A.slice(3990)];
    // 재현: 엔진 혼자 비교하면 끼운 자리 뒤가 줄줄이 "변경"
    expect(diffBlocks(A, B).stats.modified).toBeGreaterThan(1000);
    const d = diffBlockLists(A, B);
    expect(d.stats).toEqual({ added: 2, removed: 0, modified: 1, unchanged: 3999 });
    expect(d.diffs.length).toBe(4002);
    expect(d.diffs.find((x) => x.type === 'modified')?.after?.text).toContain('다만, 긴급한 경우');
    // 블록이 적으면 엔진 비교 그대로
    expect(diffBlockLists(A.slice(0, 20), B.slice(0, 21))).toEqual(diffBlocks(A.slice(0, 20), B.slice(0, 21)));
  });

  it('큰 표(60행 8열)에서 세 칸만 바뀌면 그 세 칸만 짚는다 (표 전체 "변경" 아님)', async () => {
    const grid = (edit: boolean) => [Array.from({ length: 8 }, (_, c) => `항목${c + 1}`), ...Array.from({ length: 60 }, (_, r) => Array.from({ length: 8 }, (_, c) =>
      (edit && ((r === 5 && c === 3) || (r === 30 && c === 7) || (r === 55 && c === 1)) ? `바뀐값 ${r}-${c}` : `가온 ${r + 1}행 ${c + 1}열 사업 내용 설명 글 ${r * 8 + c}`)))];
    const md = (rows: string[][]) => `# 계획\n\n| ${rows[0].join(' | ')} |\n| ${rows[0].map(() => '---').join(' | ')} |\n${rows.slice(1).map((r) => `| ${r.join(' | ')} |`).join('\n')}\n`;
    const a = join(env.work, '큰표_현행.hwpx');
    const b = join(env.work, '큰표_개정안.hwpx');
    writeFileSync(a, Buffer.from(await markdownToHwpx(md(grid(false)))));
    writeFileSync(b, Buffer.from(await markdownToHwpx(md(grid(true)))));
    const r = await call('compare', { old_path: a, new_path: b, export: 'md' });
    const bolds = [...readFileSync(r.output_path, 'utf-8').matchAll(/\*\*([^*]+)\*\*/g)].map((m) => m[1]);
    expect(bolds).toEqual(['가온 6행 4열 사업 내용 설명 글 43', '가온 31행 8열 사업 내용 설명 글 247', '가온 56행 2열 사업 내용 설명 글 441', '바뀐값 5-3', '바뀐값 30-7', '바뀐값 55-1']);
  });

  it('여러 줄 글의 어절 차이는 줄을 넘지 않는다 (줄 끝 칸과 다음 줄 첫 칸이 함께 바뀜)', () => {
    const d = wordDiff('구분 · 금액\n인건비 · 1,000\n운영비 · 2,000', '구분 · 금액\n인건비 · 1,500\n관리비 · 2,000');
    expect(d.old.filter((s) => s.changed).map((s) => s.text)).toEqual(['1,000', '운영비']);
    expect(d.new.filter((s) => s.changed).map((s) => s.text)).toEqual(['1,500', '관리비']);
    expect(d.old.map((s) => s.text).join('')).toBe('구분 · 금액\n인건비 · 1,000\n운영비 · 2,000');
    // 줄이 늘면 늘어난 줄만 통째로
    const e = wordDiff('가 · 1\n나 · 2', '가 · 1\n새 · 9\n나 · 2');
    expect(e.new.filter((s) => s.changed).map((s) => s.text)).toEqual(['새 · 9']);
    expect(e.old.some((s) => s.changed)).toBe(false);
  });
});

describe('compare_hwpx', () => {
  it('신·구조문대비표 — (현행과 같음)·<신 설>·<삭 제>·바뀐 어절 굵게', async () => {
    const r = await call('compare_hwpx', { old_path: oldPath, new_path: newPath, title: '가온시 주민 복지 조례 신·구조문대비표' });
    const back = await parse(readFileSync(r.output_path));
    if (!back.success) throw new Error(back.error);
    expect(back.markdown).toContain('가온시 주민 복지 조례 신·구조문대비표');
    expect(back.markdown).toContain('(현행과 같음)');
    expect(back.markdown).toContain('<신 설>');
    expect(back.markdown).toContain('<삭 제>');
    expect(back.markdown).toContain('**주민등록을 한**');
    expect(r.stats.unchanged).toBeGreaterThanOrEqual(1);
  });

  it('바뀐 표에서 줄 끝 칸과 다음 줄 첫 칸이 함께 바뀌어도 별표가 글자로 남지 않는다', async () => {
    const md = (rows: string[][]) => `# 계획\n\n| 구분 | 금액 |\n| --- | --- |\n${rows.map((r) => `| ${r.join(' | ')} |`).join('\n')}\n`;
    const a = join(env.work, '표칸_현행.hwpx');
    const b = join(env.work, '표칸_개정안.hwpx');
    writeFileSync(a, Buffer.from(await markdownToHwpx(md([['인건비', '1,000'], ['운영비', '2,000'], ['사업비', '3,000']]))));
    writeFileSync(b, Buffer.from(await markdownToHwpx(md([['인건비', '1,500'], ['관리비', '2,000'], ['사업비', '3,000']]))));
    const r = await call('compare_hwpx', { old_path: a, new_path: b });
    const zip = await JSZip.loadAsync(readFileSync(r.output_path));
    expect(await zip.file('Contents/section0.xml')!.async('string')).not.toContain('**');
    const back = await parse(readFileSync(r.output_path));
    if (!back.success) throw new Error(back.error);
    expect(back.markdown).toContain('**1,500**');
    expect(back.markdown).toContain('**관리비**');
  });

  it('같은 문서는 안내', async () => {
    await expect(call('compare_hwpx', { old_path: oldPath, new_path: oldPath })).rejects.toThrow(/두 문서 내용이 같습니다/);
  });

  it.skipIf(!hasCorpus('hwp5/source.hwp', 'hwp5/target.hwp'))('HWP5 실문서끼리', async () => {
    const r = await call('compare_hwpx', { old_path: corpus('hwp5/source.hwp'), new_path: corpus('hwp5/target.hwp') });
    expect(r.stats.modified).toBeGreaterThanOrEqual(1);
  });
});

describe('tables_extract', () => {
  const FORM = sample('취합/교육수요조사서_총무과.hwpx');

  it('XLSX — 분류·미리보기, 다시 읽으면 값 그대로', async () => {
    const r = await call('tables_extract', { path: FORM, format: 'xlsx' });
    expect(r.tables[0]).toMatchObject({ kind: 'data', rows: 8, cols: 2 });
    expect(r.tables[0].preview[1]).toEqual(['부서명', '총무과']);
    const back = await parse(readFileSync(r.output_path));
    expect(back.success && back.markdown).toContain('이가람');
  });

  it('표 없는 문서는 안내 오류, allow_empty(일괄 처리)면 빈 결과', async () => {
    const letter = sample('1-받은공문_도민체육대회 참가 협조 요청.hwpx');
    await expect(call('tables_extract', { path: letter, format: 'xlsx' })).rejects.toThrow(/표를 찾지 못했습니다/);
    expect(await call('tables_extract', { path: letter, format: 'xlsx', allow_empty: true })).toEqual({ tables: [] });
  });

  it('CSV·MD', async () => {
    const csv = await call('tables_extract', { path: FORM, format: 'csv' });
    const rows = parseCsv(readFileSync(csv.output_path, 'utf-8').replace(/^﻿/, ''));
    expect(rows[1]).toEqual(['부서명', '총무과']);
    const md = await call('tables_extract', { path: FORM, format: 'md' });
    expect(readFileSync(md.output_path, 'utf-8')).toMatch(/## 표 1 \(1쪽, 자료표\)/);
  });

  it.skipIf(!hasCorpus('hwp5/10772936_소방현장활동 안전점검표(화재2팀-현장활동).hwpx'))('데이터 표만 (레이아웃 표 제외)', async () => {
    const path = corpus('hwp5/10772936_소방현장활동 안전점검표(화재2팀-현장활동).hwpx');
    const all = await call('tables_extract', { path, format: 'md' });
    const data = await call('tables_extract', { path, format: 'md', only_data: true });
    expect(data.tables.length).toBeLessThan(all.tables.length);
    expect(data.tables.every((t: { kind: string }) => t.kind === 'data')).toBe(true);
  });
});

describe('XLSX 작성기·CSV', () => {
  it('병합·숫자·앞자리 0 보존·시트 이름 정리 — kordoc 으로 다시 읽힘', async () => {
    const buf = await buildXlsx([
      { name: '명부:1/2', header: true, rows: [['이름', '전화', '금액'], ['홍길동', '010-1234-5678', '1,200'], ['김가온', '02-000-0000', '007']], merges: [{ r: 0, c: 0, rs: 1, cs: 2 }, { r: 0, c: 1, rs: 1, cs: 2 }] },
      { name: '명부:1/2', rows: [['a']] },
    ]);
    const p = join(env.work, 't.xlsx');
    writeFileSync(p, buf);
    const back = await parse(readFileSync(p));
    if (!back.success) throw new Error(back.error);
    expect(back.markdown).toContain('010-1234-5678');
    expect(back.markdown).toContain('007');
    expect(back.pageCount).toBe(2);
  });

  it('CSV 왕복 — 쉼표·따옴표·줄바꿈 칸', () => {
    const rows = [['a,b', 'say "hi"'], ['줄1\n줄2', '']];
    expect(parseCsv(toCsv(rows).replace(/^﻿/, ''))).toEqual(rows);
  });
});
