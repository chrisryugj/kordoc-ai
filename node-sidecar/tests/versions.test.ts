/** 버전 찾기·최종본 찾기 (core/versions) — 실제 HWPX 판들을 만들어 고친 차례·최종 판정·짚을 것 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { copyFileSync, mkdirSync, utimesSync } from 'node:fs';
import { basename, join } from 'node:path';
import { call, setupEnv } from './doc-helpers.js';
import { splitName } from '../src/core/versions/index.js';
import type { VersionsResult } from '../src/types/rpc-contract.js';

vi.mock('../src/infra/progress.js', async (orig) => ({ ...(await orig<typeof import('../src/infra/progress.js')>()), sendProgress: vi.fn(), sendNotification: vi.fn() }));

let dir: string;
const BASE = ['# 2026년 직원 역량강화 교육 추진계획', '', '## 추진 배경', '', '□ 디지털 전환에 따른 직원 역량 강화 필요', '  ㅇ 생성형 AI 활용 교육 수요 증가', '', '## 추진 계획', '', '□ 교육 기간: 2026. 4. 1.~4. 30.', '  ㅇ 대상: 전 직원 약 300명'];
const at = (h: number) => new Date(2026, 9, 1, h, 0, 0);

async function make(name: string, lines: string[], hour: number) {
  const r = await call('generate_hwpx', { markdown: lines.join('\n'), preset: 'report', output_path: join(dir, name) });
  utimesSync(r.output_path, at(hour), at(hour));
  return r.output_path as string;
}

beforeAll(async () => {
  const env = setupEnv();
  dir = join(env.work, '교육계획');
  mkdirSync(dir, { recursive: true });
  await make('교육계획_초안.hwpx', BASE, 9);
  await make('교육계획_수정.hwpx', [...BASE, '  ㅇ 장소: 본관 대회의실', '□ 소요 예산: 3,000,000원'], 10);
  await make('교육계획_최종.hwpx', [...BASE, '  ㅇ 장소: 본관 대회의실', '□ 소요 예산: 3,000,000원', '  ㅇ 강사료 2,000,000원', '  ㅇ 교재비 1,000,000원'], 11);
  await make('교육계획_최종 (2).hwpx', [...BASE, '  ㅇ 장소: 본관 대회의실', '□ 소요 예산: 3,500,000원', '  ㅇ 강사료 2,000,000원', '  ㅇ 교재비 1,000,000원', '  ㅇ 다과비 500,000원'], 12);
  // 같은 폴더에서 가장 나중에 고친 남의 문서 — 판으로 잡히면 안 된다
  await make('하반기 예산 집행 현황.hwpx', ['# 하반기 예산 집행 현황', '', '□ 집행률 72%', '  ㅇ 인건비 집행 완료', '  ㅇ 시설비 일부 이월'], 13);
}, 120_000);

describe('splitName', () => {
  it('판 표시(진짜최종·v3·(2)·날짜)를 떼고 나머지만', () => {
    const a = splitName('보고서_진짜최종_v3 (2).hwp');
    expect(a.core).toBe('보고서');
    expect(a.markers.join(' ')).toMatch(/최종/);
    expect(splitName('보고서_241103_수정본.hwpx').core).toBe('보고서');
    expect(splitName('2026 교육계획 final.docx').core).toBe('2026교육계획');
  });
});

describe('find_versions', () => {
  it('고친 차례로 잇고, 남의 문서는 빼고, 가장 나중 판을 최종으로', async () => {
    const r: VersionsResult = await call('find_versions', { path: join(dir, '교육계획_최종.hwpx') });
    expect(r.versions.map((v) => basename(v.path))).toEqual(['교육계획_초안.hwpx', '교육계획_수정.hwpx', '교육계획_최종.hwpx', '교육계획_최종 (2).hwpx']);
    expect(basename(r.latest)).toBe('교육계획_최종 (2).hwpx');
    expect(r.versions.find((v) => v.target)?.name).toBe('교육계획_최종.hwpx');
    expect(r.reasons[0]).toMatch(/가장 나중에 고쳤습니다/);
    expect(r.notes.join('\n')).toMatch(/고른 문서보다 나중에 고친 판이 1개/);
    expect(r.versions[1].change?.added).toBeGreaterThan(0);
  }, 60_000);

  it('이름은 "최종"인데 더 나중 판이 있으면 짚는다', async () => {
    const r: VersionsResult = await call('find_versions', { path: join(dir, '교육계획_초안.hwpx') });
    expect(r.notes.join('\n')).toMatch(/"최종"이 붙은 교육계획_최종\.hwpx 보다 더 나중에 고친 판이 있습니다: 교육계획_최종 \(2\)\.hwpx/);
  }, 60_000);

  it('다른 판이 없으면 그렇다고, 지원하지 않는 형식은 할 일까지 알린다', async () => {
    const r: VersionsResult = await call('find_versions', { path: join(dir, '하반기 예산 집행 현황.hwpx') });
    expect(r.versions).toHaveLength(1);
    expect(r.notes).toContain('같은 문서의 다른 판을 찾지 못했습니다.');
    await expect(call('find_versions', { path: join(dir, 'a.png') })).rejects.toThrow(/한글·워드·PDF/);
  }, 60_000);
});

describe('형식만 다른 같은 이름 (판이 아님)', () => {
  // 실측: 받은 공문 HWPX 의 문서 카드가 같은 폴더의 같은 이름 PDF 를 "다른 판 · 최종으로 보이는 것" 으로 짚었다
  it('같은 폴더의 같은 이름 PDF 는 다른 판으로 세지 않는다 (예제 받은 공문 짝)', async () => {
    const sub = join(dir, '..', '받은공문');
    mkdirSync(sub, { recursive: true });
    const src = join(__dirname, '..', 'samples', '1-받은공문_도민체육대회 참가 협조 요청');
    const hwpx = join(sub, '참가 협조 요청.hwpx');
    const pdf = join(sub, '참가 협조 요청.pdf');
    copyFileSync(`${src}.hwpx`, hwpx);
    copyFileSync(`${src}.pdf`, pdf);
    utimesSync(hwpx, at(14), at(14));
    utimesSync(pdf, at(15), at(15));
    const r = (await call('find_versions', { path: hwpx })) as VersionsResult;
    expect(r.versions.map((v) => basename(v.path))).toEqual(['참가 협조 요청.hwpx']);
    expect(r.latest).toBe(hwpx);
  }, 60_000);
});
