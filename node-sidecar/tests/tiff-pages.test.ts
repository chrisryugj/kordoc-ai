/** 여러 장짜리 TIFF(스캐너·팩스) — 문서 정보·쪽 미리보기·PDF 내보내기·가리기·글 읽기가 모든 장을 다룬다 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { call, makePng, setupEnv } from './doc-helpers.js';

vi.mock('../src/infra/progress.js', async (orig) => ({ ...(await orig<typeof import('../src/infra/progress.js')>()), sendProgress: vi.fn(), sendNotification: vi.fn() }));

let env: ReturnType<typeof setupEnv>;
let tiff: string;

/** 장마다 글 한 줄인 TIFF: 세로로 쌓은 그림을 pageHeight 로 나눠 쓴다 */
async function makeTiff(lines: string[], w = 1200, h = 300): Promise<Buffer> {
  const sharp = (await import('sharp')).default;
  const parts = await Promise.all(lines.map((t) => makePng(w, h, t)));
  const tall = await sharp({ create: { width: w, height: h * lines.length, channels: 3, background: '#ffffff' } })
    .composite(parts.map((input, i) => ({ input, top: h * i, left: 0 })))
    .raw()
    .toBuffer({ resolveWithObject: true });
  return sharp(tall.data, { raw: { width: w, height: h * lines.length, channels: tall.info.channels, pageHeight: h } }).tiff({ compression: 'lzw' }).toBuffer();
}

beforeAll(async () => {
  env = setupEnv();
  tiff = join(env.work, '팩스 두 장.tif');
  writeFileSync(tiff, await makeTiff(['first page of the fax', 'mail hong@gaon.example']));
});

describe('여러 장 TIFF', () => {
  it('문서 정보·쪽 미리보기는 장 수만큼', async () => {
    const info = await call('doc_info', { path: tiff });
    expect(info.format).toBe('image');
    expect(info.page_count).toBe(2);
    const r = await call('render_pages', { path: tiff, max_width: 600 });
    expect(r.page_count).toBe(2);
    expect(r.pages.map((p: { page: number }) => p.page)).toEqual([1, 2]);
    const second = await call('render_pages', { path: tiff, pages: '2', max_width: 600 });
    expect(second.pages).toHaveLength(1);
    await expect(call('render_pages', { path: tiff, pages: '5' })).rejects.toThrow(/2장/);
  });

  it('PDF 로 내면 장마다 한 쪽', async () => {
    const r = await call('export_pdf', { path: tiff });
    const pdf = await PDFDocument.load(readFileSync(r.output_path));
    expect(pdf.getPageCount()).toBe(2);
  }, 60_000);

  it('가린 사본에도 두 장이 다 있다 (첫 장만 내면 나머지 장이 빠진다)', async () => {
    const r = await call('redact', { path: tiff, rules: ['email'] });
    expect(r.output_path).toMatch(/_가림\.pdf$/);
    const pdf = await PDFDocument.load(readFileSync(r.output_path));
    expect(pdf.getPageCount()).toBe(2);
    if (r.unscanned) expect(r.residual).toBeGreaterThanOrEqual(r.unscanned);
    else expect(r.total).toBe(1);
  }, 60_000);

  it('글 읽기(kordoc)도 두 장', async () => {
    const r = await call('convert', { path: tiff, save: false, ocr: 'off' });
    expect(r.page_count).toBe(2);
  });
});
