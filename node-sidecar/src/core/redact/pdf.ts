/** PDF·스캔·그림 가림 — 쪽마다 개인정보 글자 자리를 찾아 검게 칠한 쪽 그림으로 새 PDF 를 만든다
 *
 * 글자층이 있는 쪽: PDFium 글자 상자(FPDFText_GetCharBox)로 정확한 자리. 글자층이 없는 쪽(스캔): kordoc 내장 OCR 의
 * 문단 상자 안에서 글자 위치를 어림잡고(여유를 두고) 칠한 뒤, 칠한 쪽을 다시 OCR 해 남은 곳을 센다.
 * 결과 PDF 는 쪽 그림만 담는다(글자층·메타데이터 없음) → 가린 글이 복사·검색으로 새지 않는다.
 */

import { parse, redactMarkdown, redactText, type IRBlock, type RedactHit, type RedactRule } from 'kordoc';
import { PDFDocument } from 'pdf-lib';
import type { PDFiumDocument, PDFiumPage } from '@hyzyla/pdfium';
import { openPdf } from '../render/pdfium.js';
import { sendProgress } from '../../infra/progress.js';

/** 가림 쪽 그림 해상도 — 150~200dpi (글자가 읽히고 파일이 너무 커지지 않게) */
export const REDACT_DPI = 170;

interface Box { x0: number; y0: number; x1: number; y1: number }
interface PdfHit { rule: RedactRule; masked: string }
export interface PdfRedaction {
  hits: PdfHit[];
  /** 글자를 읽지 못한 쪽 (스캔인데 OCR 이 안 됐다) */
  unscanned: number[];
  /** 칠한 뒤 다시 읽었더니 남은 곳 + 자리를 못 잡은 곳 */
  residual: number;
  pdf?: Uint8Array;
}

interface PdfiumModule {
  HEAPU8: Uint8Array;
  wasmExports: { malloc(n: number): number; free(p: number): void };
  _FPDFText_LoadPage(page: number): number;
  _FPDFText_ClosePage(tp: number): void;
  _FPDF_ClosePage(page: number): void;
  _FPDFText_CountChars(tp: number): number;
  _FPDFText_GetUnicode(tp: number, i: number): number;
  _FPDFText_GetCharBox(tp: number, i: number, l: number, r: number, b: number, t: number): number;
  _FPDF_PageToDevice(page: number, sx: number, sy: number, w: number, h: number, rot: number, px: number, py: number, dx: number, dy: number): number;
}

const internals = (page: PDFiumPage) => page as unknown as { module: PdfiumModule; pageIdx: number };

/** 쪽 글자층 — 글자마다 한 칸 (UTF-16 위치 → 글자 번호) */
function pageChars(page: PDFiumPage): { text: string; charAt: number[]; tp: number } {
  const { module: M, pageIdx } = internals(page);
  const tp = M._FPDFText_LoadPage(pageIdx);
  const n = tp ? M._FPDFText_CountChars(tp) : 0;
  let text = '';
  const charAt: number[] = [];
  for (let i = 0; i < n; i++) {
    const s = String.fromCodePoint(M._FPDFText_GetUnicode(tp, i) || 32);
    text += s;
    for (let k = 0; k < s.length; k++) charAt.push(i);
  }
  return { text, charAt, tp };
}

/** 글자 [from, to) 의 상자들 (쪽 좌표 pt, 줄마다 하나) */
function charBoxes(page: PDFiumPage, tp: number, text: string, charAt: number[], from: number, to: number): Box[] {
  const { module: M } = internals(page);
  const ptr = M.wasmExports.malloc(32);
  const boxes: Box[] = [];
  try {
    for (let i = from; i < to; i++) {
      if (/\s/.test(text[i])) continue;
      if (!M._FPDFText_GetCharBox(tp, charAt[i], ptr, ptr + 8, ptr + 16, ptr + 24)) continue;
      const [l, r, b, t] = new Float64Array(M.HEAPU8.buffer, ptr, 4);
      const last = boxes.at(-1);
      // 같은 줄(세로가 겹침)이면 이어 붙인다
      if (last && Math.min(last.y1, t) - Math.max(last.y0, b) > 0.3 * Math.min(last.y1 - last.y0, t - b) && l - last.x1 < 3 * (t - b)) {
        last.x0 = Math.min(last.x0, l); last.x1 = Math.max(last.x1, r); last.y0 = Math.min(last.y0, b); last.y1 = Math.max(last.y1, t);
      } else boxes.push({ x0: l, x1: r, y0: b, y1: t });
    }
  } finally {
    M.wasmExports.free(ptr);
  }
  return boxes;
}

/** 걸린 곳 모으기 — 쪽 글에서 바로 찾은 것 + 문서 전체(표 머리글 문맥)에서 찾은 원문을 쪽 글에서 다시 찾은 것. 겹치면 하나로 */
function pageHits(text: string, rules: readonly RedactRule[], known: Map<string, RedactRule>, keep: (s: string) => boolean): RedactHit[] {
  const hits: RedactHit[] = redactText(text, { rules }).hits.slice();
  for (const [orig, rule] of known) {
    let i = text.indexOf(orig);
    while (i >= 0) {
      if (!hits.some((h) => i < h.index + h.length && h.index < i + orig.length)) hits.push({ rule, index: i, length: orig.length, masked: redactText(orig, { rules: [rule] }).text });
      i = text.indexOf(orig, i + orig.length);
    }
  }
  return hits.filter((h) => !keep(text.slice(h.index, h.index + h.length)));
}

/** 글자 폭 어림 (한글·한자 1, 영문·숫자·문장부호 0.55, 띄어쓰기 0.3) */
const charW = (c: string) => (/\s/.test(c) ? 0.3 : /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af\u4e00-\u9fff\u3000-\u303f]/.test(c) ? 1 : 0.55);

/** OCR 문단 상자 안에서 글자 자리 어림 — 줄 수는 상자 높이/한 줄 높이, 글자 폭은 charW 비율. 어림이 빗나가도 덮게 앞뒤로 한 글자 반씩 더 칠한다 */
function estimateBoxes(block: { text: string; bbox: { x: number; y: number; width: number; height: number } }, from: number, to: number, lineH: number): Box[] {
  const { x, y, width, height } = block.bbox;
  const lines = Math.max(1, Math.round(height / Math.max(lineH, 1)));
  const cum = [0];
  for (const c of block.text) cum.push(cum.at(-1)! + charW(c));
  const total = Math.max(cum.at(-1)!, 1e-6);
  const perLine = total / lines;
  const unitW = (width * lines) / total;
  const a = Math.max(0, cum[from] - 1.6);
  const b = Math.min(total, cum[to] + 1.6);
  const out: Box[] = [];
  for (let li = Math.floor(a / perLine); li <= Math.min(lines - 1, Math.floor(Math.max(a, b - 1e-6) / perLine)); li++) {
    const ls = li * perLine;
    const s0 = Math.max(a, ls) - ls;
    const s1 = Math.min(b, ls + perLine) - ls;
    const top = y + height - li * (height / lines);
    out.push({ x0: x + s0 * unitW, x1: x + s1 * unitW, y0: top - height / lines, y1: top });
  }
  return out;
}

function flatten(blocks: IRBlock[]): IRBlock[] {
  return blocks.flatMap((b) => [b, ...(b.children ? flatten(b.children) : [])]);
}

/** 스캔 쪽 OCR — 쪽 번호별 블록 (kordoc 내장 OCR, bbox 는 PDF pt·아래가 0) */
async function ocrBlocks(bytes: Uint8Array, pages: number[], signal?: AbortSignal): Promise<Map<number, IRBlock[]> | null> {
  if (!pages.length) return new Map();
  signal?.throwIfAborted();
  const r = await parse(Buffer.from(bytes), { ocr: 'force', pages: pages.join(','), images: false }).catch(() => null);
  if (!r?.success) return null;
  const by = new Map<number, IRBlock[]>();
  for (const b of flatten(r.blocks)) {
    if (!b.bbox || !b.pageNumber) continue;
    by.set(b.pageNumber, [...(by.get(b.pageNumber) ?? []), b]);
  }
  return by;
}

/** 표 블록: 칸 상자가 없어 행·열을 고르게 나눠 칸 자리를 어림잡는다 (칸 전체를 칠한다) */
function tableCellBoxes(b: IRBlock, rules: readonly RedactRule[], keep: (s: string) => boolean, hits: PdfHit[]): Box[] {
  const t = b.table!;
  const { x, y, width, height } = b.bbox!;
  const out: Box[] = [];
  t.cells.forEach((row, r) => row.forEach((cell, c) => {
    const found = redactText(cell.text, { rules }).hits.filter((h) => !keep(cell.text.slice(h.index, h.index + h.length)));
    if (!found.length) return;
    hits.push(...found.map((h) => ({ rule: h.rule, masked: h.masked })));
    const cw = width / t.cols;
    const rh = height / t.rows;
    out.push({ x0: x + c * cw, x1: x + (c + Math.max(1, cell.colSpan)) * cw, y0: y + height - (r + Math.max(1, cell.rowSpan)) * rh, y1: y + height - r * rh });
  }));
  return out;
}

/** 쪽 그림 위에 상자를 검게 (RGBA, 상자는 장치 px) */
function paint(data: Uint8Array, w: number, h: number, boxes: Array<[number, number, number, number]>) {
  for (const [x0, y0, x1, y1] of boxes) {
    const xa = Math.max(0, Math.floor(Math.min(x0, x1)));
    const xb = Math.min(w, Math.ceil(Math.max(x0, x1)));
    const ya = Math.max(0, Math.floor(Math.min(y0, y1)));
    const yb = Math.min(h, Math.ceil(Math.max(y0, y1)));
    for (let yy = ya; yy < yb; yy++) {
      let o = (yy * w + xa) * 4;
      for (let xx = xa; xx < xb; xx++, o += 4) { data[o] = 0; data[o + 1] = 0; data[o + 2] = 0; data[o + 3] = 255; }
    }
  }
}

/** 그림(PNG·JPG·WEBP) → 한 쪽짜리 PDF (150dpi 로 보고 쪽 크기를 정한다) */
export async function imageToPdf(bytes: Uint8Array): Promise<Uint8Array> {
  const sharp = (await import('sharp')).default;
  const img = sharp(Buffer.from(bytes)).rotate();
  const meta = await img.metadata();
  const png = await img.png().toBuffer();
  const pdf = await PDFDocument.create();
  const image = await pdf.embedPng(png);
  const w = ((meta.autoOrient?.width ?? meta.width ?? image.width) * 72) / 150;
  const h = ((meta.autoOrient?.height ?? meta.height ?? image.height) * 72) / 150;
  pdf.addPage([w, h]).drawImage(image, { x: 0, y: 0, width: w, height: h });
  return pdf.save();
}

/** PDF 가리기 — dryRun 이면 찾기만 */
export async function redactPdf(
  bytes: Uint8Array,
  opts: { rules: readonly RedactRule[]; keep: (s: string) => boolean; dryRun?: boolean; dpi?: number; signal?: AbortSignal },
): Promise<PdfRedaction> {
  const { rules, keep, signal } = opts;
  const scale = (opts.dpi ?? REDACT_DPI) / 72;
  // 문서 전체 글(표 머리글 문맥)에서 찾은 원문 — 쪽 글에서는 칸이 흩어져 이름 같은 문맥 룰이 놓친다
  const known = new Map<string, RedactRule>();
  const whole = await parse(Buffer.from(bytes), { ocr: false, images: false }).catch(() => null);
  if (whole?.success) {
    for (const h of redactMarkdown(whole.markdown, { rules }).hits) {
      const orig = whole.markdown.slice(h.index, h.index + h.length);
      if (orig.length >= 2 && !/[\\*|]/.test(orig)) known.set(orig, h.rule);
    }
  }
  const doc: PDFiumDocument = await openPdf(bytes);
  const hits: PdfHit[] = [];
  let residual = 0;
  try {
    const count = doc.getPageCount();
    const pageBoxes: Box[][] = [];
    const scanned: number[] = [];
    for (let i = 0; i < count; i++) {
      signal?.throwIfAborted();
      const page = doc.getPage(i);
      const { text, charAt, tp } = pageChars(page);
      try {
        // 글자가 거의 없으면 스캔 쪽 (그림만)
        if (text.replace(/\s/g, '').length < 5) { scanned.push(i + 1); pageBoxes.push([]); continue; }
        const found = pageHits(text, rules, known, keep);
        const boxes: Box[] = [];
        for (const h of found) {
          const b = charBoxes(page, tp, text, charAt, h.index, h.index + h.length);
          if (!b.length) residual++;
          boxes.push(...b);
          hits.push({ rule: h.rule, masked: h.masked });
        }
        pageBoxes.push(boxes);
      } finally {
        if (tp) internals(page).module._FPDFText_ClosePage(tp);
        internals(page).module._FPDF_ClosePage(internals(page).pageIdx);
      }
    }

    // 스캔 쪽은 OCR 로
    const unscanned: number[] = [];
    const ocrPages = new Set<number>();
    if (scanned.length) {
      sendProgress({ current: 0, total: scanned.length, message: '스캔 쪽 글자를 읽는 중' });
      const ocr = await ocrBlocks(bytes, scanned, signal);
      for (const pn of scanned) {
        const blocks = ocr?.get(pn);
        if (!blocks?.length) { unscanned.push(pn); continue; }
        ocrPages.add(pn);
        const lineH = Math.min(...blocks.filter((b) => !b.table && b.bbox).map((b) => b.bbox!.height), 14);
        const boxes = pageBoxes[pn - 1];
        for (const b of blocks) {
          if (b.table) { boxes.push(...tableCellBoxes(b, rules, keep, hits)); continue; }
          const text = b.text ?? '';
          const found = pageHits(text, rules, known, keep);
          for (const h of found) {
            boxes.push(...estimateBoxes({ text, bbox: b.bbox! }, h.index, h.index + h.length, lineH));
            hits.push({ rule: h.rule, masked: h.masked });
          }
        }
      }
    }
    if (opts.dryRun) return { hits, unscanned, residual: residual + unscanned.length };

    // 쪽 그림 + 검은 상자 → 새 PDF (글자층 없음)
    const sharp = (await import('sharp')).default;
    const out = await PDFDocument.create();
    const recheck: Uint8Array[] = [];
    for (let i = 0; i < count; i++) {
      signal?.throwIfAborted();
      sendProgress({ current: i + 1, total: count, message: `${i + 1}/${count}쪽 가리는 중` });
      const page = doc.getPage(i);
      const { module: M, pageIdx } = internals(page);
      const { originalWidth, originalHeight } = page.getOriginalSize();
      // render 가 쪽을 닫으므로 상자 → 장치 좌표는 먼저 (render 와 같은 크기 계산: 내림한 pt × 배율, 다시 내림)
      const width = Math.floor(Math.floor(originalWidth) * scale);
      const height = Math.floor(Math.floor(originalHeight) * scale);
      const ip = M.wasmExports.malloc(16);
      const dev: Array<[number, number, number, number]> = [];
      try {
        const toDev = (px: number, py: number): [number, number] => {
          M._FPDF_PageToDevice(pageIdx, 0, 0, width, height, 0, px, py, ip, ip + 4);
          const v = new Int32Array(M.HEAPU8.buffer, ip, 2);
          return [v[0], v[1]];
        };
        const pad = 1.2; // pt — 글자 상자 가장자리 번짐까지
        for (const b of pageBoxes[i]) {
          const [ax, ay] = toDev(b.x0 - pad, b.y1 + pad);
          const [bx, by] = toDev(b.x1 + pad, b.y0 - pad);
          dev.push([ax, ay, bx, by]);
        }
      } finally {
        M.wasmExports.free(ip);
      }
      const r = await page.render({ scale, render: async ({ data }) => data });
      const data = new Uint8Array(r.data);
      paint(data, r.width, r.height, dev);
      const jpg = await sharp(Buffer.from(data), { raw: { width: r.width, height: r.height, channels: 4 } }).flatten({ background: '#ffffff' }).jpeg({ quality: 82 }).toBuffer();
      const image = await out.embedJpg(jpg);
      out.addPage([originalWidth, originalHeight]).drawImage(image, { x: 0, y: 0, width: originalWidth, height: originalHeight });
      if (ocrPages.has(i + 1)) recheck.push(jpg);
    }
    out.setProducer('KorDoc AI');
    out.setCreator('KorDoc AI');
    const pdf = await out.save();

    // 스캔 쪽은 칠한 그림을 다시 읽어 남은 곳을 센다 (어림잡은 자리가 빗나갔을 수 있다)
    if (recheck.length) {
      const again = await PDFDocument.create();
      for (const jpg of recheck) {
        const img = await again.embedJpg(jpg);
        again.addPage([img.width, img.height]).drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
      }
      const r = await parse(Buffer.from(await again.save()), { ocr: 'force', images: false }).catch(() => null);
      if (r?.success) residual += redactMarkdown(r.markdown, { rules }).hits.filter((h) => !keep(r.markdown.slice(h.index, h.index + h.length))).length;
    }
    return { hits, unscanned, residual: residual + unscanned.length, pdf };
  } finally {
    doc.destroy();
  }
}
