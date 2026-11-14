/** HWP/HWPX → PDF 가 대체 렌더로 떨어졌을 때 — 조판이 원본과 다를 수 있으니 성공에 묻지 않고 알린다 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('../src/infra/progress.js', async (orig) => ({ ...(await orig<typeof import('../src/infra/progress.js')>()), sendProgress: vi.fn(), sendNotification: vi.fn() }));
const fail = vi.hoisted(() => ({ on: true }));
vi.mock('../src/core/export/chromium.js', async (orig) => {
  const real = await orig<typeof import('../src/core/export/chromium.js')>();
  return { ...real, pagesToPdf: (...a: Parameters<typeof real.pagesToPdf>) => (fail.on ? Promise.reject(new Error('쪽을 그리지 못했습니다')) : real.pagesToPdf(...a)) };
});

import { exportPdf } from '../src/core/export/index.js';
import { sample } from './doc-helpers.js';

let dir: string;
beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'export-fallback-')); });
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('PDF 로 저장 — 대체 렌더', () => {
  const src = sample('4-보고서_디지털 행정 혁신 추진계획.hwpx');

  it('쪽 그리기가 실패해 대체 렌더로 만들면 조판이 다를 수 있다고 알린다', async () => {
    fail.on = true;
    const r = await exportPdf({ path: src, output_path: join(dir, '대체.pdf') }, new AbortController().signal);
    expect(existsSync(r.output_path)).toBe(true);
    expect(r.warnings?.join(' ')).toContain('원본과 다를 수 있습니다');
  }, 120_000);

  it('평소 경로로 만들면 알림이 없다', async () => {
    fail.on = false;
    const r = await exportPdf({ path: src, output_path: join(dir, '평소.pdf') }, new AbortController().signal);
    expect(r.warnings).toBeUndefined();
  }, 120_000);

  it('대체 렌더 앞에서 멈추면 파일을 만들지 않는다', async () => {
    fail.on = true;
    const ac = new AbortController();
    const { logger } = await import('../src/infra/logger.js');
    const spy = vi.spyOn(logger, 'warn').mockImplementation(() => { ac.abort(); });
    await expect(exportPdf({ path: src, output_path: join(dir, '멈춤.pdf') }, ac.signal)).rejects.toThrow();
    spy.mockRestore();
    expect(existsSync(join(dir, '멈춤.pdf'))).toBe(false);
  }, 120_000);
});
