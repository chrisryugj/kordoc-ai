/** 한글로 바꾸기 일괄 — 한 개씩 바꿀 때 나오는 경고("서식 그대로 옮기지 못해 …")를 일괄에서도 잃지 않는다 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('../src/infra/progress.js', async (orig) => ({ ...(await orig<typeof import('../src/infra/progress.js')>()), sendProgress: vi.fn() }));
const fail = vi.hoisted(() => ({ on: false }));
vi.mock('../src/core/render/rhwp.js', async (orig) => {
  const real = await orig<typeof import('../src/core/render/rhwp.js')>();
  return { ...real, rhwpConvert: (...a: Parameters<typeof real.rhwpConvert>) => (fail.on ? Promise.reject(new Error('읽지 못한 조판')) : real.rhwpConvert(...a)) };
});

// 스캔 쪽을 읽었다는 안내(OCR_APPLIED)를 붙여 본다 — 실제 OCR 은 무겁다
const ocr = vi.hoisted(() => ({ on: false }));
vi.mock('../src/core/converter/index.js', async (orig) => {
  const real = await orig<typeof import('../src/core/converter/index.js')>();
  return {
    ...real,
    parseDoc: async (...a: Parameters<typeof real.parseDoc>) => {
      const r = await real.parseDoc(...a);
      return ocr.on ? { ...r, warnings: [...(r.warnings ?? []), { code: 'OCR_APPLIED' as const, message: '2개 페이지에 OCR 적용 (내장 PP-OCRv5)' }] } : r;
    },
  };
});

import { toHwpx, toHwpxBatch } from '../src/core/to-hwpx/index.js';
import { openRhwp } from '../src/core/render/rhwp.js';
import { sample } from './doc-helpers.js';

let dir: string;
let hwp: string;
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'to-hwpx-warn-'));
  const doc = (await openRhwp(new Uint8Array(readFileSync(sample('1-받은공문_도민체육대회 참가 협조 요청.hwpx'))))) as unknown as { exportHwp(): Uint8Array; free?(): void };
  hwp = join(dir, '받은공문.hwp');
  try { writeFileSync(hwp, doc.exportHwp()); } finally { doc.free?.(); }
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('to_hwpx_batch 경고', () => {
  it('서식 그대로 옮기지 못한 파일은 결과 줄에 경고를 싣는다', async () => {
    fail.on = true;
    const signal = new AbortController().signal;
    const one = await toHwpx({ path: hwp, output_dir: join(dir, 'one') }, signal);
    expect(one.warnings.join(' ')).toContain('서식 그대로 옮기지 못해');
    const r = await toHwpxBatch({ paths: [hwp], output_dir: join(dir, 'batch') }, signal);
    expect(r.results[0]).toMatchObject({ ok: true, warnings: one.warnings });
  }, 120_000);

  it('글자 읽기(OCR)를 썼다는 안내만으로는 경고를 싣지 않는다 (한 개씩 바꿀 때는 그대로 보인다)', async () => {
    fail.on = true;
    ocr.on = true;
    try {
      const signal = new AbortController().signal;
      const one = await toHwpx({ path: hwp, output_dir: join(dir, 'ocr-one') }, signal);
      expect(one.warnings.join(' ')).toContain('OCR 적용');
      const r = await toHwpxBatch({ paths: [hwp], output_dir: join(dir, 'ocr-batch') }, signal);
      expect(r.results[0].warnings?.join(' ')).toContain('서식 그대로 옮기지 못해');
      expect(r.results[0].warnings?.join(' ')).not.toContain('OCR 적용');
    } finally {
      ocr.on = false;
    }
  }, 120_000);

  it('경고가 없으면 싣지 않는다', async () => {
    fail.on = false;
    const r = await toHwpxBatch({ paths: [hwp], output_dir: join(dir, 'clean') }, new AbortController().signal);
    expect(r.results[0].ok).toBe(true);
    expect(r.results[0].warnings).toBeUndefined();
  }, 120_000);
});
