/** PDF 용량 줄이기 (pdf_shrink) — 그림만 줄여 글자는 그대로, 한도 맞추기, 쪽을 그림으로, 줄일 것 없으면 저장 안 함 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { join } from 'node:path';
import sharp from 'sharp';
import { PDFDocument, PDFName, PDFRawStream, StandardFonts } from 'pdf-lib';
import { call, sample, setupEnv } from './doc-helpers.js';
import { unpredictPng } from '../src/core/pdf-shrink/index.js';
import { openPdf } from '../src/core/render/pdfium.js';

vi.mock('../src/infra/progress.js', async (orig) => ({ ...(await orig<typeof import('../src/infra/progress.js')>()), sendProgress: vi.fn(), sendNotification: vi.fn() }));

let env: ReturnType<typeof setupEnv>;
beforeAll(() => { env = setupEnv(); });

/** 잡음이 많은 큰 사진(잘 안 줄어드는 JPEG) */
async function photo(w: number, h: number): Promise<Buffer> {
  const px = Buffer.alloc(w * h * 3);
  for (let i = 0; i < px.length; i++) px[i] = (i * 2654435761) >>> 24;
  return sharp(px, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 95 }).toBuffer();
}

async function pdfWithPhoto(file: string, text = '결재 첨부 시험 문서'): Promise<string> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('Attachment test', { x: 50, y: 800, size: 14, font });
  const jpg = await doc.embedJpg(await photo(3000, 2200));
  page.drawImage(jpg, { x: 50, y: 300, width: 495, height: 363 });
  // 알파가 든 PNG(Flate + SMask)도 하나
  const png = await sharp({ create: { width: 1600, height: 1200, channels: 4, background: { r: 200, g: 30, b: 30, alpha: 0.5 } } }).png().toBuffer();
  page.drawImage(await doc.embedPng(png), { x: 50, y: 50, width: 200, height: 150 });
  void text;
  const path = join(env.work, file);
  writeFileSync(path, await doc.save());
  return path;
}

const images = async (bytes: Uint8Array) => {
  const doc = await PDFDocument.load(bytes);
  return doc.context.enumerateIndirectObjects()
    .map(([, o]) => o)
    .filter((o): o is PDFRawStream => o instanceof PDFRawStream && o.dict.get(PDFName.of('Subtype'))?.toString() === '/Image')
    .map((o) => ({ w: Number(o.dict.get(PDFName.of('Width'))?.toString()), filter: o.dict.get(PDFName.of('Filter'))?.toString() }));
};

// 큰 사진을 몇 번씩 다시 압축한다 — 다른 시험과 함께 돌면 기본 5초를 넘는다
describe('pdf_shrink', { timeout: 60_000 }, () => {
  it('그림만 줄이고 글자·쪽 수는 그대로, 결과 PDF 는 PDFium 으로 열린다', async () => {
    const src = await pdfWithPhoto('사진첨부.pdf');
    const r = await call('pdf_shrink', { path: src, level: 'normal' });
    expect(r.output_path).toMatch(/사진첨부_용량줄임\.pdf$/);
    expect(r.after_bytes).toBeLessThan(r.before_bytes * 0.5);
    expect(r.images_shrunk).toBeGreaterThanOrEqual(1);
    expect(r.text_kept).toBe(true);
    const out = readFileSync(r.output_path);
    const big = (await images(out)).find((i) => i.filter === '/DCTDecode');
    expect(big!.w).toBeLessThanOrEqual(1754);
    const pdf = await openPdf(new Uint8Array(out));
    expect(pdf.getPageCount()).toBe(1);
    pdf.destroy();
    // 원본은 그대로
    expect(readFileSync(src).length).toBe(r.before_bytes);
  });

  it('한도를 주면 한도 안에 들 때까지 단계를 올린다', async () => {
    const src = await pdfWithPhoto('한도.pdf');
    const light = await call('pdf_shrink', { path: src, level: 'light' });
    const target = (light.after_bytes * 0.6) / (1024 * 1024);
    const r = await call('pdf_shrink', { path: src, target_mb: target });
    expect(r.under_target).toBe(true);
    expect(['normal', 'strong']).toContain(r.level_used);
  });

  it('그래도 넘으면 쪽을 그림으로 바꾸는 것은 켰을 때만, 바꾸면 글자 복사가 안 된다고 알린다', async () => {
    const src = await pdfWithPhoto('그림으로.pdf');
    const tiny = 0.003;
    const off = await call('pdf_shrink', { path: src, target_mb: tiny });
    expect(off.under_target).toBe(false);
    expect(off.text_kept).toBe(true);
    expect(off.note).toContain('쪽을 그림으로');
    const on = await call('pdf_shrink', { path: src, target_mb: tiny, allow_raster: true });
    expect(on.after_bytes).toBeLessThanOrEqual(off.after_bytes);
    if (on.level_used === 'raster') {
      expect(on.text_kept).toBe(false);
      expect(on.note).toContain('복사');
    }
  });

  it('이미 압축된 글만 있는 PDF 는 줄일 것이 없다고 알리고 파일을 만들지 않는다', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    doc.addPage([595, 842]).drawText('Only text', { x: 50, y: 800, size: 14, font });
    const path = join(env.work, '글만.pdf');
    writeFileSync(path, await doc.save({ useObjectStreams: true }));
    const r = await call('pdf_shrink', { path });
    expect(r.output_path).toBeNull();
    expect(r.note).toContain('그림이 없는');
  });

  it('압축 안 된 객체가 많은 PDF 는 그림이 없어도 줄고, 본문 글은 그대로다', async () => {
    const src = sample('1-받은공문_도민체육대회 참가 협조 요청.pdf');
    const r = await call('pdf_shrink', { path: src });
    expect(r.after_bytes).toBeLessThan(r.before_bytes);
    const text = async (p: string) => (await call('convert', { path: p, format: 'txt', save: false })).content.replace(/\s+/g, '');
    expect(await text(r.output_path)).toBe(await text(src));
  });

  it('한글 문서는 PDF 로 바꿔 저장한다', async () => {
    const r = await call('pdf_shrink', { path: sample('1-받은공문_도민체육대회 참가 협조 요청.hwpx') });
    expect(r.output_path).toMatch(/\.pdf$/);
    expect(readFileSync(r.output_path).subarray(0, 5).toString()).toBe('%PDF-');
  }, 60_000);

  it('투명도 마스크(직인 알파)는 다시 압축하지 않는다', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([595, 842]);
    const W = 1800, px = Buffer.alloc(W * W * 4);
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
      const r = Math.hypot(x - W / 2, y - W / 2), i = (y * W + x) * 4;
      const on = r > W * 0.35 && r < W * 0.45;
      px[i] = 220; px[i + 1] = (x * y) & 0xff; px[i + 2] = 30; px[i + 3] = on ? 255 : 0;
    }
    const png = await sharp(px, { raw: { width: W, height: W, channels: 4 } }).png().toBuffer();
    page.drawImage(await doc.embedPng(png), { x: 100, y: 300, width: 300, height: 300 });
    const path = join(env.work, '직인.pdf');
    writeFileSync(path, await doc.save());
    const r = await call('pdf_shrink', { path, level: 'strong' });
    const filters = (await images(readFileSync(r.output_path ?? path))).map((i) => i.filter);
    // 마스크(회색 Flate)는 그대로 Flate
    expect(filters.filter((f) => f === '/FlateDecode').length).toBeGreaterThanOrEqual(1);
  });

  it('이미 한도 안이면 줄이지 않고 알린다', async () => {
    const src = await pdfWithPhoto('작은.pdf');
    const r = await call('pdf_shrink', { path: src, target_mb: 500 });
    expect(r.output_path).toBeNull();
    expect(r.under_target).toBe(true);
    expect(r.note).toContain('이미 한도');
  });

  it('PNG 예측자 풀기', () => {
    // 2×2 RGB, 첫 줄 Sub(1), 둘째 줄 Up(2)
    const raw = Buffer.from([1, 10, 20, 30, 5, 5, 5, 2, 1, 1, 1, 1, 1, 1]);
    expect([...unpredictPng(raw, 2, 3)!]).toEqual([10, 20, 30, 15, 25, 35, 11, 21, 31, 16, 26, 36]);
    expect(unpredictPng(deflateSync(Buffer.alloc(3)), 2, 3)).toBeNull();
  });
});
