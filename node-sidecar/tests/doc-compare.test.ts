/** 비교·표 — compare(+HTML·MD·XLSX)·compare_hwpx(신·구조문대비표)·tables_extract·XLSX 작성기·CSV */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { markdownToHwpx, parse } from 'kordoc';
import { call, corpus, hasCorpus, sample, setupEnv } from './doc-helpers.js';
import { buildXlsx } from '../src/core/excel/xlsx.js';
import { parseCsv, toCsv } from '../src/core/excel/csv.js';
import { wordDiff } from '../src/core/comparator/index.js';

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

  it('같은 문서는 안내', async () => {
    await expect(call('compare_hwpx', { old_path: oldPath, new_path: oldPath })).rejects.toThrow(/바뀐 곳을 찾지 못했습니다/);
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
