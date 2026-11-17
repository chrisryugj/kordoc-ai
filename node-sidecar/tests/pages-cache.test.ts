/** 쪽 글 캐시 (find_pages·결재 전 점검) — 실패·취소로 끝난 결과를 붙잡지 않는다 */

import { describe, it, expect, vi } from 'vitest';
import { join } from 'node:path';
import { SAMPLES } from './doc-helpers.js';

const state = { fail: false };
vi.mock('../src/core/render/rhwp.js', async (orig) => {
  const real = await orig<typeof import('../src/core/render/rhwp.js')>();
  return {
    ...real,
    // 큰 문서(작업자 스레드)처럼: 실패하면 던지고, 취소되면 쪽을 다 내기 전에 멈춘다
    rhwpPages: async function* (bytes: Uint8Array, password?: string, signal?: AbortSignal) {
      if (state.fail) throw new Error('작업자가 멈췄습니다');
      for await (const p of real.rhwpPages(bytes, password)) {
        if (signal?.aborted) return;
        yield p;
      }
    },
  };
});

const { pageTexts } = await import('../src/core/gongmun/pages.js');

describe('쪽 글 캐시', () => {
  it('실패한 결과는 다음 읽기에 남지 않는다', async () => {
    const doc = join(SAMPLES, '4-보고서_디지털 행정 혁신 추진계획.hwpx');
    state.fail = true;
    expect(await pageTexts(doc)).toBeNull();
    state.fail = false;
    const again = await pageTexts(doc);
    expect(again?.length).toBeGreaterThan(0);
  }, 30_000);

  it('취소한 점검의 (덜 뽑은) 결과는 다음 읽기에 남지 않는다', async () => {
    const doc = join(SAMPLES, '1-받은공문_도민체육대회 참가 협조 요청.hwpx');
    const ac = new AbortController();
    ac.abort();
    expect(await pageTexts(doc, ac.signal)).toEqual([]);
    const again = await pageTexts(doc);
    expect(again?.length).toBeGreaterThan(0);
  }, 30_000);
});
