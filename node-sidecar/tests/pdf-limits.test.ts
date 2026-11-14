/** PDF 를 그림으로 그릴 때의 상한 (render/pdfium·pdf-shrink·export·comparator) — 받은 PDF 하나로 엔진이 멈추거나 메모리를 다 쓰지 않게.
 *  고치기 전 실측: 쪽이 아주 긴 1KB PDF 미리보기 RSS 4.1GB(sharp 영어 오류), 300dpi 그림 파일 6.4GB, 그림 크기만 3만×3만으로 적은 1KB PDF 의 쪽 그림 하나에 엔진 11초 멈춤 */

import { describe, it, expect, vi, beforeAll } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as zlib from 'node:zlib';
import sharp from 'sharp';
import { PDFDocument, PDFName, PDFRawStream, StandardFonts } from 'pdf-lib';

vi.mock('node:zlib', async (orig) => {
  const m = await orig<typeof import('node:zlib')>();
  return { ...m, inflateSync: vi.fn(m.inflateSync) };
});
vi.mock('../src/infra/progress.js', async (orig) => ({ ...(await orig<typeof import('../src/infra/progress.js')>()), sendProgress: vi.fn(), sendNotification: vi.fn() }));

import { call, corpus, hasCorpus, setupEnv } from './doc-helpers.js';
import { fitScale, MAX_PAGE_PIXELS, MAX_PAGE_SIDE } from '../src/core/render/pdfium.js';
import { shrinkImages } from '../src/core/pdf-shrink/index.js';
import { docToPdf, loadPdf } from '../src/core/export/index.js';
import { imageToPdf } from '../src/core/redact/pdf.js';
import { findBrowser, pagesToPdf } from '../src/core/export/chromium.js';
import { layoutOf } from '../src/core/comparator/visual.js';

let env: ReturnType<typeof setupEnv>;
let tall: string;
let heavy: string;
beforeAll(async () => {
  env = setupEnv();
  // 폭 600pt·높이 20만pt 한 쪽 (글자층에 전화번호)
  const a = await PDFDocument.create();
  const font = await a.embedFont(StandardFonts.Helvetica);
  a.addPage([600, 200_000]).drawText('010-1234-5678', { x: 20, y: 199_900, size: 14, font });
  tall = join(env.work, 'tall.pdf');
  writeFileSync(tall, await a.save());
  // 그림 크기만 3만×3만으로 적은 그림 한 장 (흐름은 몇 KB)
  const b = await PDFDocument.create();
  const data = zlib.deflateSync(Buffer.alloc(3000, 0xff));
  const img = b.context.register(PDFRawStream.of(b.context.obj({ Type: 'XObject', Subtype: 'Image', Width: 30_000, Height: 30_000, ColorSpace: 'DeviceRGB', BitsPerComponent: 8, Filter: 'FlateDecode', Length: data.length }), data));
  const pg = b.addPage([595, 842]);
  pg.node.setXObject(PDFName.of('Im0'), img);
  pg.node.set(PDFName.of('Contents'), b.context.register(b.context.flateStream('q 595 0 0 842 0 0 cm /Im0 Do Q')));
  heavy = join(env.work, 'heavy.pdf');
  writeFileSync(heavy, await b.save());
});

const dims = async (dataUrl: string) => sharp(Buffer.from(dataUrl.replace(/^data:[^,]+,/, ''), 'base64')).metadata();

describe('쪽 그림 화소 상한 (fitScale)', () => {
  it('보통 쪽은 배율 그대로, 아주 긴 쪽은 화소 수·긴 변 상한까지 낮춘다', () => {
    expect(fitScale(595, 842, 4)).toBe(4);
    const s = fitScale(600, 200_000, 1000 / 600);
    expect(Math.floor(600 * s) * Math.floor(200_000 * s)).toBeLessThanOrEqual(MAX_PAGE_PIXELS);
    expect(Math.floor(200_000 * s)).toBeLessThanOrEqual(MAX_PAGE_SIDE);
  });

  it('아주 긴 쪽도 미리보기·쪽 그림이 나온다 (긴 변 상한 안)', async () => {
    const r = await call('render_pages', { path: tall, pages: '1' });
    expect(r.pages).toHaveLength(1);
    const m = await dims(r.pages[0].data_url);
    expect(m.width! * m.height!).toBeLessThanOrEqual(MAX_PAGE_PIXELS);
    expect(m.height!).toBeLessThanOrEqual(MAX_PAGE_SIDE);
    const t = await call('pdf_thumbs', { path: tall, pages: '1', width: 240 });
    expect(t.pages).toHaveLength(1);
  }, 30_000);

  it('아주 긴 쪽 PDF 가리기: 상한까지 줄인 쪽 그림으로 가린 사본을 만든다', async () => {
    const r = await call('redact', { path: tall });
    expect(r.total).toBeGreaterThan(0);
    expect(r.output_path).toMatch(/\.pdf$/);
    const out = await PDFDocument.load(readFileSync(r.output_path));
    expect(out.getPage(0).getSize()).toEqual({ width: 600, height: 200_000 });
  }, 60_000);
});

describe('그림이 아주 큰 쪽 (적힌 그림 크기 합)', () => {
  it('쪽 그림·미리보기는 그 쪽을 비워 두고 금방 돌아온다', async () => {
    const t0 = performance.now();
    expect((await call('pdf_thumbs', { path: heavy, pages: '1', width: 240 })).pages).toEqual([]);
    expect((await call('render_pages', { path: heavy, pages: '1' })).pages).toEqual([]);
    expect(performance.now() - t0).toBeLessThan(4000);
  }, 30_000);

  it('쪽을 그림 파일로: 그리지 않고 알아들을 오류', async () => {
    await expect(call('pdf_to_images', { path: heavy, output_dir: env.work })).rejects.toThrow(/1쪽에 아주 큰 그림\(약 9\.0억 화소\)/);
  }, 30_000);
});

describe('용량 줄이기: 그림을 풀 크기를 먼저 정한다', () => {
  it('적힌 크기보다 크게 풀리는 그림 흐름은 그 크기까지만 풀고 그대로 둔다', async () => {
    const doc = await PDFDocument.create();
    // 200×100 RGB = 6만 바이트라고 적고, 실제로는 3MB 로 풀리는 흐름
    const data = zlib.deflateSync(Buffer.alloc(3 * 1024 * 1024, 0x80));
    const img = doc.context.register(PDFRawStream.of(doc.context.obj({ Type: 'XObject', Subtype: 'Image', Width: 200, Height: 100, ColorSpace: 'DeviceRGB', BitsPerComponent: 8, Filter: 'FlateDecode', Length: data.length }), data));
    const pg = doc.addPage([595, 842]);
    pg.node.setXObject(PDFName.of('Im0'), img);
    pg.node.set(PDFName.of('Contents'), doc.context.register(doc.context.flateStream('q 200 0 0 100 0 0 cm /Im0 Do Q')));
    const inflate = vi.mocked(zlib.inflateSync);
    inflate.mockClear();
    const r = await shrinkImages(await doc.save(), 'normal');
    expect(r).toMatchObject({ images: 1, shrunk: 0 });
    expect(inflate.mock.calls.some(([, o]) => (o as zlib.ZlibOptions | undefined)?.maxOutputLength === 200 * 100 * 3)).toBe(true);
  });
});

/** PDF 안 그림들의 [필터, 폭] */
async function pdfImages(bytes: Uint8Array): Promise<Array<[string, number]>> {
  const doc = await PDFDocument.load(bytes);
  return doc.context.enumerateIndirectObjects()
    .filter(([, o]) => o instanceof PDFRawStream && o.dict.get(PDFName.of('Subtype'))?.toString() === '/Image')
    .map(([, o]) => [String((o as PDFRawStream).dict.get(PDFName.of('Filter'))), Number((o as PDFRawStream).dict.get(PDFName.of('Width'))?.toString())]);
}
const noisePng = (w: number, h: number) => {
  const px = Buffer.alloc(w * h * 3);
  for (let i = 0; i < px.length; i++) px[i] = (i * 2654435761) >>> 24;
  return sharp(px, { raw: { width: w, height: h, channels: 3 } }).png({ compressionLevel: 1 }).toBuffer();
};

describe('그림 → PDF: 큰 PNG 를 pdf-lib 이 다 풀지 않게', () => {
  it('가리기·글자 읽기용(redact imageToPdf): 4백만 화소 넘는 그림은 JPEG 로, 작은 그림은 그대로 PNG', async () => {
    expect(await pdfImages(await imageToPdf(await noisePng(2500, 2000)))).toEqual([['/DCTDecode', 2500]]);
    expect(await pdfImages(await imageToPdf(await noisePng(300, 200)))).toEqual([['/FlateDecode', 300]]);
  }, 30_000);
  it('PDF 만들기(export): PNG 는 긴 변 4000px 까지', async () => {
    const path = join(env.work, '넓은그림.png');
    writeFileSync(path, await noisePng(6000, 1000));
    expect(await pdfImages(await docToPdf(path))).toEqual([['/FlateDecode', 4000]]);
  }, 30_000);
});

const SECURED = 'licbyl2/8536495_쌀가공산업 육성 및 쌀 이용 촉진에 관한 법률 시행규칙_전문인력 양성기관 지정신청서.pdf';
describe.skipIf(!hasCorpus(SECURED))('보안 설정 PDF 를 쪽 그림으로 (loadPdf)', () => {
  it('멈추면 쪽을 더 그리지 않는다', async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(loadPdf(new Uint8Array(readFileSync(corpus(SECURED))), ac.signal)).rejects.toThrow(/abort/i);
  });
});

describe('나란히 비교: 글자 상자 수 상한', () => {
  it('한 쪽에 글자 210만 개인 PDF 는 글자 상자를 만들지 않고 대조표로', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const pg = doc.addPage([595, 842]);
    const line = 'abcdefghij'.repeat(100);
    for (let i = 0; i < 2100; i++) pg.drawText(line, { x: 0, y: 800 - (i % 800), size: 1, font });
    const path = join(env.work, 'glyphs.pdf');
    writeFileSync(path, await doc.save());
    expect(await layoutOf(path)).toMatch(/글자가 아주 많은 문서라 나란히 보기를 만들지 않았습니다/);
  }, 30_000);
});

describe.skipIf(!findBrowser())('Chromium 인쇄: 멈추면 브라우저를 닫는다', () => {
  it('쪽을 다 받은 뒤 멈춰도(setContent·pdf 중) 멈춤으로 끝난다', async () => {
    const ac = new AbortController();
    async function* pages() {
      yield { svg: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><text x="10" y="50">a</text></svg>', width: 100, height: 100 };
      ac.abort();
    }
    await expect(pagesToPdf(pages(), undefined, ac.signal)).rejects.toThrow(/abort/i);
  }, 90_000);
});
