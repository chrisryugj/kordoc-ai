/** PDF 만들기 — export_pdf(한 문서) · bundle_pdf(본문+붙임 합본) · pdf_stamp(워터마크·쪽번호)
 *
 * 문서 → PDF: HWP·HWPX 는 rhwp 쪽 SVG 를 Chromium 으로 인쇄(실패하면 kordoc 렌더), PDF 는 그대로, 이미지는 A4 쪽으로,
 * 그 밖(워드·엑셀·파워포인트·md 등)은 글 변환 후 인쇄용 PDF(Chromium). Chromium 은 Edge·Chrome 을 찾아 쓴다.
 * 보안(암호) 설정 때문에 pdf-lib 이 못 여는 PDF 는 PDFium 으로 쪽을 그림으로 바꿔 합친다.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { atomicWriteFile } from '../files/io.js';
import { basename } from 'node:path';
import { markdownToPdf, renderDocument } from 'kordoc';
import { PDFDocument } from 'pdf-lib';
import type { BatchItemResult } from '../../types/rpc-contract.js';
import { sendProgress } from '../../infra/progress.js';
import { logger } from '../../infra/logger.js';
import { errorText } from '../errors.js';
import { parseDoc } from '../converter/index.js';
import { formatOf } from '../files/format.js';
import { outputFile, sameFile, stemOf } from '../output/index.js';
import { openPdf, rasterPdfPage } from '../render/pdfium.js';
import { rhwpPages, tooBigForRhwp } from '../render/rhwp.js';
import { NO_BROWSER, pagesToPdf } from './chromium.js';
import { stampPdf } from './stamp.js';

const A4: [number, number] = [595.28, 841.89];

async function imageToPdf(path: string): Promise<Uint8Array> {
  const sharp = (await import('sharp')).default;
  const img = sharp(await readFile(path)).rotate();
  const meta = await img.metadata();
  const jpeg = meta.format === 'jpeg';
  // PNG 는 pdf-lib 이 엔진 스레드에서 다 풀어 다시 압축한다(8000px 정사각 1.1초·RSS +715MB) → 긴 변 4000px(A4 에 약 340dpi)까지만
  const data = jpeg ? await img.jpeg({ quality: 90 }).toBuffer() : await img.resize({ width: 4000, height: 4000, fit: 'inside', withoutEnlargement: true }).png().toBuffer();
  const doc = await PDFDocument.create();
  const pic = jpeg ? await doc.embedJpg(data) : await doc.embedPng(data);
  const [pw, ph] = pic.width > pic.height ? [A4[1], A4[0]] : A4;
  const s = Math.min(pw / pic.width, ph / pic.height);
  const page = doc.addPage([pw, ph]);
  page.drawImage(pic, { x: (pw - pic.width * s) / 2, y: (ph - pic.height * s) / 2, width: pic.width * s, height: pic.height * s });
  return doc.save();
}

/** 글 변환본 PDF — 그림은 data URI 로 본문에 넣는다 */
async function textToPdf(path: string, signal?: AbortSignal): Promise<Uint8Array> {
  // 브라우저 인쇄라 BMP·TIFF 그림은 그려지지 않는다: 그런 그림만 PNG 로. PDF 그림은 읽는 차례 제자리에
  const r = await parseDoc(path, { images: true, drawableImages: true, imagePlacement: 'flow', signal });
  const byName = new Map((r.images ?? []).map((i) => [i.filename, `data:${i.mimeType};base64,${Buffer.from(i.data).toString('base64')}`]));
  const md = r.markdown.replace(/(!\[[^\]]*\]\()([^)\s]+)(\))/g, (m, a: string, src: string, b: string) => (byName.has(src) ? a + byName.get(src) + b : m));
  return markdownToPdf(md, { preset: 'default' });
}

/** 대체 렌더로 만든 PDF 에 붙이는 알림 — 표·쪽 나눔이 원본과 다를 수 있다 */
export const FALLBACK_NOTE = '쪽을 원본대로 그리지 못해 다른 방식으로 PDF를 만들었습니다. 표·쪽 나눔이 원본과 다를 수 있습니다. 열어서 확인하세요.';

/** @param note 원본대로 그리지 못해 대체 렌더로 만들었을 때 부른다 (성공에 묻히지 않게 화면에 올릴 알림) */
export async function docToPdf(path: string, signal?: AbortSignal, note?: (warning: string) => void): Promise<Uint8Array> {
  const fmt = formatOf(path);
  if (fmt === 'pdf') return new Uint8Array(await readFile(path));
  if (fmt === 'hwp' || fmt === 'hwpx') {
    const bytes = new Uint8Array(await readFile(path));
    const big = await tooBigForRhwp(bytes);
    if (big) throw new Error(`문서가 너무 커서(약 ${big.toLocaleString('ko-KR')}쪽) PDF로 한 번에 만들 수 없습니다. 한글에서 쪽을 나눠 저장한 뒤 다시 시도하세요.`);
    // rhwp 쪽 SVG → Chromium 인쇄, 쪽 묶음마다 찍어 잇는다 (kordoc 렌더는 칸 안 줄바꿈을 아직 무시). rhwp 가 못 읽으면 kordoc 렌더로
    try {
      // 쪽마다 취소를 본다: 안 보면 수백 쪽 문서는 취소한 뒤에도 끝까지 만들어 파일까지 쓴다
      return await pagesToPdf(rhwpPages(bytes, undefined, signal), (n) => { signal?.throwIfAborted(); if (n % 20 === 0) sendProgress({ current: n, total: 0, message: `PDF 만드는 중 (${n}쪽)` }); }, signal);
    } catch (err) {
      if (signal?.aborted || (err instanceof Error && err.message === NO_BROWSER)) throw err;
      logger.warn(`[pdf] rhwp 경로 실패 → kordoc 렌더: ${err instanceof Error ? err.message : err}`);
    }
    // 대체 렌더는 취소를 받지 못한다: 들어가기 전에 본다
    signal?.throwIfAborted();
    note?.(FALLBACK_NOTE);
    const r = await renderDocument(Buffer.from(bytes), { format: 'pdf', title: stemOf(path) });
    const pdf = r.assets.find((a) => a.format === 'pdf');
    if (!pdf || typeof pdf.data === 'string') throw new Error('PDF를 만들지 못했습니다.');
    return new Uint8Array(pdf.data);
  }
  if (fmt === 'image') return imageToPdf(path);
  return textToPdf(path, signal);
}

/** 쪽 그림으로 바꿔 넣을 보안 설정 PDF 의 쪽 수 상한 (쪽마다 그리고 JPEG 로 만들어 엔진 스레드에서 쪽당 수백 ms) */
const SECURED_MAX_PAGES = 500;

/** pdf-lib 으로 열기 — 보안 설정 PDF 는 쪽 그림(약 150dpi JPEG)으로 다시 만든다 */
export async function loadPdf(bytes: Uint8Array, signal?: AbortSignal): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (err) {
    if (!/encrypt/i.test(err instanceof Error ? `${err.name} ${err.message}` : String(err))) throw err;
    logger.info('[pdf] 보안 설정 PDF → 쪽 그림으로 합침');
    const src = await openPdf(bytes);
    try {
      const out = await PDFDocument.create();
      const count = src.getPageCount();
      if (count > SECURED_MAX_PAGES) throw new Error(`보안 설정이 걸린 PDF는 쪽을 그림으로 바꿔 넣는데, ${count.toLocaleString('ko-KR')}쪽은 너무 많습니다(${SECURED_MAX_PAGES}쪽까지). 보안을 푼 사본을 저장하거나 쪽을 나눠 넣으세요.`);
      for (let n = 1; n <= count; n++) {
        // 멈추면 바로 그만 그린다 (쪽마다 엔진 스레드에서 그려서, 안 보면 멈춘 뒤에도 끝까지 그렸다)
        signal?.throwIfAborted();
        const r = await rasterPdfPage(src, n, 1300, 'jpeg');
        const pic = await out.embedJpg(r.data);
        out.addPage([r.width, r.height]).drawImage(pic, { x: 0, y: 0, width: r.width, height: r.height });
      }
      return out;
    } finally {
      src.destroy();
    }
  }
}

export async function exportPdf(p: { path: string; output_path?: string; overwrite?: boolean }, signal?: AbortSignal): Promise<{ output_path: string; warnings?: string[] }> {
  if (formatOf(p.path) === 'pdf') throw new Error('이미 PDF 문서입니다.');
  sendProgress({ current: 0, total: 1, message: 'PDF 만드는 중' });
  const warnings: string[] = [];
  const bytes = await docToPdf(p.path, signal, (w) => warnings.push(w));
  // 취소했으면 결과 파일을 남기지 않는다
  signal?.throwIfAborted();
  const outPath = outputFile({ output_path: p.output_path, source: p.path, name: `${stemOf(p.path)}.pdf`, overwrite: p.overwrite });
  // 덮어쓰기 저장이 쓰다 끊겨도 원래 PDF 는 남게 (옆에 다 쓴 뒤 바꿔 넣기)
  await atomicWriteFile(outPath, bytes);
  return { output_path: outPath, ...(warnings.length ? { warnings } : {}) };
}

export async function bundlePdf(
  p: { paths: string[]; output_path?: string; watermark?: string; page_numbers?: boolean; overwrite?: boolean },
  signal: AbortSignal,
): Promise<{ output_path: string; page_count: number; failed: BatchItemResult[] }> {
  const merged = await PDFDocument.create();
  const failed: BatchItemResult[] = [];
  for (const [i, path] of p.paths.entries()) {
    signal.throwIfAborted();
    sendProgress({ current: i + 1, total: p.paths.length, message: `${basename(path)} 넣는 중 (${i + 1}/${p.paths.length})` });
    try {
      const src = await loadPdf(await docToPdf(path, signal), signal);
      for (const page of await merged.copyPages(src, src.getPageIndices())) merged.addPage(page);
    } catch (err) {
      if (signal.aborted) throw err;
      failed.push({ path, ok: false, error: errorText(err) });
    }
  }
  if (!merged.getPageCount()) throw new Error(`합칠 수 있는 문서가 없습니다. ${failed[0]?.error ?? ''}`.trim());
  if (p.watermark?.trim() || p.page_numbers) await stampPdf(merged, p);
  signal.throwIfAborted();
  // overwrite: 화면이 덮어쓰기를 확인한 경로. 합칠 원본 자리면 덮어쓰지 않는다
  const overwrite = !!p.overwrite && !!p.output_path && !p.paths.some((x) => sameFile(x, p.output_path!));
  const outPath = outputFile({ output_path: p.output_path, source: p.paths[0], name: `${stemOf(p.paths[0])}${p.paths.length > 1 ? `_외${p.paths.length - 1}건` : ''}_합본.pdf`, overwrite });
  await atomicWriteFile(outPath, await merged.save());
  return { output_path: outPath, page_count: merged.getPageCount(), failed };
}

export async function pdfStamp(p: { path: string; watermark?: string; page_numbers?: boolean; output_path?: string }, signal?: AbortSignal): Promise<{ output_path: string }> {
  if (!p.watermark?.trim() && !p.page_numbers) throw new Error('워터마크 글자나 쪽번호 중 하나를 고르세요.');
  const doc = await loadPdf(await docToPdf(p.path, signal), signal);
  await stampPdf(doc, p);
  signal?.throwIfAborted();
  const outPath = outputFile({ output_path: p.output_path, source: p.path, name: `${stemOf(p.path)}_${p.watermark?.trim() ? '워터마크' : '쪽번호'}.pdf` });
  await writeFile(outPath, await doc.save());
  return { output_path: outPath };
}
