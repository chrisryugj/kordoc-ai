/** PDF·스캔·그림 가림 — 쪽마다 개인정보 글자 자리를 찾아 검게 칠한 쪽 그림으로 새 PDF 를 만든다
 *
 * 글자층이 있는 쪽: PDFium 글자 상자(FPDFText_GetCharBox)로 정확한 자리. 글자층이 없는 쪽(스캔): kordoc 내장 OCR 의
 * 문단 상자 안에서 글자 위치를 어림잡고(여유를 두고) 칠한 뒤, 칠한 쪽을 다시 OCR 해 남은 곳을 센다.
 * 결과 PDF 는 쪽 그림만 담는다(글자층·메타데이터 없음) → 가린 글이 복사·검색으로 새지 않는다.
 */

import type { IRBlock, ParseResult, RedactHit, RedactRule } from 'kordoc';
import { countRead, joinBroken, redactMarkdown, redactText, tighten } from './rules.js';
import { PDFDocument } from 'pdf-lib';
import type { PDFiumDocument, PDFiumPage } from '@hyzyla/pdfium';
import { openPdf } from '../render/pdfium.js';
import { sendProgress } from '../../infra/progress.js';
import { parseBytes } from '../converter/index.js';

/** 가림 쪽 그림 해상도 — 150~200dpi (글자가 읽히고 파일이 너무 커지지 않게) */
export const REDACT_DPI = 170;
/** 검은 상자를 글자 상자보다 넓힐 폭 (pt) — 글자 가장자리 번짐까지 */
const PAD = 1.2;

/** view: 보이는 쪽 그림 기준 자리(글자 읽기 결과. 왼쪽·아래가 0, pt). 없으면 PDF 쪽 좌표(글자층 상자) */
interface Box { x0: number; y0: number; x1: number; y1: number; view?: boolean }
/** 문서 전체 글에서 걸린 원문 → 규칙과 가린 모양 (가린 모양을 원문에서 다시 만들면 표 문맥으로 걸린 이름은 가려지지 않은 채 결과에 실린다) */
type Known = Map<string, { rule: RedactRule; masked: string }>;

/** 큰 PDF 는 작업자에서 읽는다 (주 스레드에서 읽으면 그동안 멈추기·미리보기·다른 일이 모두 멈춘다) */
const read = (bytes: Uint8Array | Buffer, opts: Parameters<typeof parseBytes>[1], signal?: AbortSignal): Promise<ParseResult | null> =>
  parseBytes(Buffer.from(bytes), opts, undefined, signal).catch((err) => { if (signal?.aborted) throw err; return null; });
interface PdfHit { rule: RedactRule; masked: string }
export interface PdfRedaction {
  hits: PdfHit[];
  /** 글자를 읽지 못한 쪽 (스캔인데 OCR 이 안 됐다) */
  unscanned: number[];
  /** 칠한 뒤 다시 읽었더니 남은 곳 + 자리를 못 잡은 곳 */
  residual: number;
  /** 사람이 볼 곳 안내 (그림 속 글자를 못 읽은 쪽, 자리를 못 찾은 곳) */
  notes: string[];
  /** 가린 쪽을 다시 읽어 마저 칠한 곳 수 (찾은 곳이 0 이어도 이것이 있으면 가린 사본을 만들어야 한다) */
  repainted: number;
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
  _FPDFPage_CountObjects(page: number): number;
  _FPDFPage_GetObject(page: number, i: number): number;
  _FPDFPageObj_GetType(obj: number): number;
  _FPDFPageObj_GetBounds(obj: number, l: number, b: number, r: number, t: number): number;
  _FPDFFormObj_CountObjects(obj: number): number;
  _FPDFFormObj_GetObject(obj: number, i: number): number;
  _FPDFPage_GetAnnotCount(page: number): number;
  _FPDFPage_GetAnnot(page: number, i: number): number;
  _FPDFAnnot_GetSubtype(annot: number): number;
  _FPDFPage_CloseAnnot(annot: number): void;
}

const internals = (page: PDFiumPage) => page as unknown as { module: PdfiumModule; pageIdx: number };

/** PDFium 개체 종류 — 그림 3, 묶음(안에 그림이 들 수 있다) 5 */
const OBJ_IMAGE = 3;
const OBJ_FORM = 5;
/** 쪽 그림에 글이 찍혀 나오는 주석 — 글상자 3, 도장 13, 양식 칸 20 */
const TEXT_ANNOTS = new Set([3, 13, 20]);
/** 이보다 큰 그림은 글이 들었을 수 있다고 본다 (쪽 넓이의 2%: 신분증·통장 사본. 기관 표지·직인은 그보다 작다) */
const BIG_IMAGE = 0.02;

/** 글자층이 있어도 글자층 밖에 글이 있을 만한 쪽인가 — 큰 그림(붙여 넣은 신분증·통장 사본)이나 글이 찍히는 주석.
 *  글자층만 보면 그 글은 검사도 못 하고 쪽 그림에는 그대로 찍혀 나간다 */
function textOutsideLayer(page: PDFiumPage, pageArea: number): 'image' | 'annot' | null {
  const { module: M, pageIdx } = internals(page);
  const p = M.wasmExports.malloc(16);
  try {
    const holdsImage = (obj: number, depth: number): boolean => {
      const type = M._FPDFPageObj_GetType(obj);
      if (type === OBJ_IMAGE) return true;
      if (type !== OBJ_FORM || depth > 4) return false;
      for (let i = 0, n = M._FPDFFormObj_CountObjects(obj); i < n; i++) if (holdsImage(M._FPDFFormObj_GetObject(obj, i), depth + 1)) return true;
      return false;
    };
    for (let i = 0, n = M._FPDFPage_CountObjects(pageIdx); i < n; i++) {
      const obj = M._FPDFPage_GetObject(pageIdx, i);
      if (!holdsImage(obj, 0)) continue;
      if (!M._FPDFPageObj_GetBounds(obj, p, p + 4, p + 8, p + 12)) return 'image';
      const [l, b, r, t] = new Float32Array(M.HEAPU8.buffer, p, 4);
      if ((r - l) * (t - b) >= pageArea * BIG_IMAGE) return 'image';
    }
    for (let i = 0, n = M._FPDFPage_GetAnnotCount(pageIdx); i < n; i++) {
      const annot = M._FPDFPage_GetAnnot(pageIdx, i);
      if (!annot) continue;
      const kind = M._FPDFAnnot_GetSubtype(annot);
      M._FPDFPage_CloseAnnot(annot);
      if (TEXT_ANNOTS.has(kind)) return 'annot';
    }
    return null;
  } finally {
    M.wasmExports.free(p);
  }
}

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

/** 걸린 곳 모으기 — 쪽 글에서 바로 찾은 것 + 문서 전체(표 머리글 문맥)에서 찾은 원문을 쪽 글에서 다시 찾은 것. 겹치면 하나로.
 *  끊긴 곳(기호 앞뒤 띄어쓰기, 줄표 자리에서 바뀐 줄)을 붙인 글에서도 찾고 자리는 원래 글 기준으로 되돌린다:
 *  글자 읽기는 "hong @ gaon.example"처럼 띄워 읽고, 좁은 표 칸에서는 "010-1234-" / "5678"로 줄이 바뀐다 */
function pageHits(text: string, rules: readonly RedactRule[], known: Known, keep: (s: string) => boolean, located?: Set<string>): RedactHit[] {
  const hits = plainHits(text, rules, known, located);
  const tight = tighten(text, true);
  if (tight.text.length !== text.length) {
    for (const h of plainHits(tight.text, rules, known, located)) {
      const index = tight.at[h.index];
      const length = tight.at[h.index + h.length - 1] + 1 - index;
      if (!hits.some((o) => index < o.index + o.length && o.index < index + length)) hits.push({ ...h, index, length });
    }
  }
  return hits.filter((h) => !keep(text.slice(h.index, h.index + h.length)) && !keep(squeeze(text.slice(h.index, h.index + h.length))));
}

function plainHits(text: string, rules: readonly RedactRule[], known: Known, located?: Set<string>): RedactHit[] {
  const hits: RedactHit[] = redactText(text, { rules }).hits.slice();
  for (const [orig, k] of known) {
    // 쪽 글은 줄바꿈·띄어쓰기가 문서 전체 글과 다르다 → 띄어쓰기를 무시하고 찾는다
    for (const m of text.matchAll(spaceBlind(orig))) {
      located?.add(orig);
      const i = m.index;
      const length = m[0].length;
      if (!hits.some((h) => i < h.index + h.length && h.index < i + length)) hits.push({ rule: k.rule, index: i, length, masked: k.masked });
    }
  }
  return hits;
}

/** 글자 사이 띄어쓰기·줄바꿈을 무시하는 찾기식 */
function spaceBlind(s: string): RegExp {
  const chars = [...s.replace(/\s+/g, '')].map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(chars.join('\\s*'), 'g');
}

const squeeze = (s: string) => s.replace(/\s+/g, '');

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
    out.push({ x0: x + s0 * unitW, x1: x + s1 * unitW, y0: top - height / lines, y1: top, view: true });
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
  const r = await read(bytes, { ocr: 'force', pages: pages.join(','), images: false }, signal);
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
    // 표 칸은 글자 읽기로만 온다 → 기호 앞뒤 띄어쓰기를 뺀 글에서도 찾는다 (칸 전체를 칠하니 자리는 필요 없다)
    const tight = tighten(cell.text, true).text;
    const hitsIn = (s: string) => redactText(s, { rules }).hits.filter((h) => !keep(s.slice(h.index, h.index + h.length)));
    const plain = hitsIn(cell.text);
    const found = tight.length === cell.text.length ? plain : [plain, hitsIn(tight)].sort((a, b) => b.length - a.length)[0];
    if (!found.length) return;
    hits.push(...found.map((h) => ({ rule: h.rule, masked: h.masked })));
    const cw = width / t.cols;
    const rh = height / t.rows;
    out.push({ x0: x + c * cw, x1: x + (c + Math.max(1, cell.colSpan)) * cw, y0: y + height - (r + Math.max(1, cell.rowSpan)) * rh, y1: y + height - r * rh, view: true });
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
  const known: Known = new Map();
  const whole = await read(bytes, { ocr: false, images: false }, signal);
  if (whole?.success) {
    // 표 칸 안에서 줄이 바뀐 번호("010-1234-<br>5678")는 붙인 글에서만 걸린다 → 붙인 글에서도 찾는다 (쪽 글에서는 띄어쓰기·줄바꿈을 무시하고 찾는다)
    const joined = joinBroken(whole.markdown);
    for (const md of joined === whole.markdown ? [whole.markdown] : [whole.markdown, joined]) {
      for (const h of redactMarkdown(md, { rules }).hits) {
        const orig = md.slice(h.index, h.index + h.length);
        if (squeeze(orig).length >= 2 && !/[\\*|]/.test(orig) && !known.has(orig)) known.set(orig, { rule: h.rule, masked: h.masked });
      }
    }
  }
  const doc: PDFiumDocument = await openPdf(bytes);
  const hits: PdfHit[] = [];
  const notes: string[] = [];
  /** 쪽 글에서 자리를 찾은 문서 전체 원문 */
  const located = new Set<string>();
  let residual = 0;
  try {
    const count = doc.getPageCount();
    const pageBoxes: Box[][] = [];
    const scanned: number[] = [];
    /** 글자층도 있고 큰 그림·주석도 있는 쪽 → 글자층 글(띄어쓰기 뺌). 그림 속 글자는 따로 읽는다 */
    const mixed = new Map<number, string>();
    /** 글이 찍히는 주석(양식 칸·글상자·도장)이 있는 쪽 — 그 글은 쪽 그림을 만든 뒤 다시 읽을 때에야 보인다 */
    const annotated: number[] = [];
    for (let i = 0; i < count; i++) {
      signal?.throwIfAborted();
      const page = doc.getPage(i);
      const { text, charAt, tp } = pageChars(page);
      try {
        // 글자가 거의 없으면 스캔 쪽 (그림만)
        if (text.replace(/\s/g, '').length < 5) { scanned.push(i + 1); pageBoxes.push([]); continue; }
        const { originalWidth, originalHeight } = page.getOriginalSize();
        const outside = textOutsideLayer(page, originalWidth * originalHeight);
        if (outside) mixed.set(i + 1, squeeze(text));
        if (outside === 'annot') annotated.push(i + 1);
        const found = pageHits(text, rules, known, keep, located);
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

    // 스캔 쪽, 그리고 글자층 밖에 글이 있을 만한 쪽(큰 그림·주석)은 OCR 로
    const unscanned: number[] = [];
    const ocrPages = new Set<number>();
    /** 그림 속 글자를 읽지 못한 쪽 (글자층은 가렸다) */
    const blind: number[] = [];
    const toRead = [...scanned, ...mixed.keys()].sort((a, b) => a - b);
    if (toRead.length) {
      sendProgress({ current: 0, total: toRead.length, message: scanned.length ? '스캔 쪽 글자를 읽는 중' : '그림 속 글자를 읽는 중' });
      const ocr = await ocrBlocks(bytes, toRead, signal);
      for (const pn of toRead) {
        const blocks = ocr?.get(pn);
        const layer = mixed.get(pn);
        // OCR 자체가 안 되면(모델 없음) 그림 속 글자를 본 것이 아니다. 되는데 글이 없으면 그림에 글이 없는 것
        if (layer !== undefined ? !ocr : !blocks?.length) { (layer !== undefined ? blind : unscanned).push(pn); continue; }
        ocrPages.add(pn);
        if (!blocks?.length) continue;
        // 글자층에서 이미 정확한 자리로 가린 글은 건너뛴다 (어림 상자로 넓게 덧칠하지 않게). 그림에만 있는 글이 여기서 걸린다.
        // 같은 글이 글자층과 그림 양쪽에 있으면 여기서 빠지지만, 칠한 쪽을 다시 읽는 마지막 검사에서 걸려 칠해진다
        const skip = layer === undefined ? keep : (s: string) => keep(s) || layer.includes(squeeze(s));
        const lineH = Math.min(...blocks.filter((b) => !b.table && b.bbox).map((b) => b.bbox!.height), 14);
        const boxes = pageBoxes[pn - 1];
        for (const b of blocks) {
          if (b.table) { boxes.push(...tableCellBoxes(b, rules, skip, hits)); continue; }
          const text = b.text ?? '';
          const found = pageHits(text, rules, known, skip, located);
          for (const h of found) {
            boxes.push(...estimateBoxes({ text, bbox: b.bbox! }, h.index, h.index + h.length, lineH));
            hits.push({ rule: h.rule, masked: h.masked });
          }
        }
      }
    }
    // 문서 전체 글에서는 걸렸는데 어느 쪽에서도 자리를 못 찾은 곳 — 가리지 못했으니 숨기지 않는다
    const lost = [...known.keys()].filter((orig) => !located.has(orig) && !keep(orig)).length;
    if (lost) notes.push(`문서 글에서 찾은 ${lost}곳은 쪽에서 자리를 찾지 못해 가리지 못했습니다. 눈으로 확인하세요.`);
    if (blind.length) notes.push(`그림이나 주석이 있는 ${blind.join(', ')}쪽은 그림 속 글자를 읽지 못했습니다. 눈으로 확인하세요.`);
    residual += lost + blind.length;
    if (opts.dryRun) {
      // 양식 칸·글상자에 적힌 글은 쪽 그림을 만들어 다시 읽어야 보인다 → 미리 찾기에는 안 나오니 그렇다고 알린다
      // (안 알리면 칸에만 개인정보가 있는 PDF 가 "0곳"으로 나와 원본을 그대로 내보내게 된다)
      if (annotated.length) notes.push(`${annotated.join(', ')}쪽에는 양식 칸이나 글상자가 있습니다. 그 안의 글자는 가린 사본을 만들 때 읽어 가립니다(미리 찾기에는 나오지 않습니다).`);
      return { hits, unscanned, residual: residual + unscanned.length + annotated.length, notes, repainted: 0 };
    }

    // 쪽 그림 + 검은 상자 → 새 PDF (글자층 없음)
    const sharp = (await import('sharp')).default;
    const shots: Array<{ jpg: Buffer; pw: number; ph: number }> = [];
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
        for (const b of pageBoxes[i]) {
          if (b.view) continue;
          const [ax, ay] = toDev(b.x0 - PAD, b.y1 + PAD);
          const [bx, by] = toDev(b.x1 + PAD, b.y0 - PAD);
          dev.push([ax, ay, bx, by]);
        }
      } finally {
        M.wasmExports.free(ip);
      }
      // 양식 칸에 적어 넣은 값도 그린다 (안 그리면 칸의 글이 사라진 PDF 가 되고, 그 글의 개인정보는 검사도 못 한다)
      const r = await page.render({ scale, renderFormFields: true, render: async ({ data }) => data });
      const data = new Uint8Array(r.data);
      // 글자 읽기로 잡은 자리는 보이는 쪽 그림 기준이다 (돌려진 쪽·잘린 쪽은 PDF 쪽 좌표와 다르다) → 쪽 좌표 변환 없이 화소로 바로
      for (const b of pageBoxes[i]) {
        if (b.view) dev.push([(b.x0 - PAD) * scale, r.height - (b.y1 + PAD) * scale, (b.x1 + PAD) * scale, r.height - (b.y0 - PAD) * scale]);
      }
      paint(data, r.width, r.height, dev);
      const jpg = await sharp(Buffer.from(data), { raw: { width: r.width, height: r.height, channels: 4 } }).flatten({ background: '#ffffff' }).jpeg({ quality: 82 }).toBuffer();
      shots.push({ jpg, pw: originalWidth, ph: originalHeight });
    }

    // OCR 로 읽은 쪽은 칠한 그림을 다시 읽는다 (어림잡은 자리가 빗나갔을 수 있고, 주석 글은 여기서야 보인다).
    // 남은 곳은 그 자리를 마저 칠하고, 어림이니 사람이 볼 곳으로 센다
    /** 칠한 쪽 그림들을 다시 읽어 남은 곳을 찾는다. paintLeft 면 그 자리를 마저 칠한다. 읽지 못하면 null */
    const reread = async (pages: number[], paintLeft: boolean): Promise<{ found: number; touched: number[] } | null> => {
      signal?.throwIfAborted();
      const again = await PDFDocument.create();
      for (const pn of pages) {
        const img = await again.embedJpg(shots[pn - 1].jpg);
        again.addPage([img.width, img.height]).drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
      }
      const r = await read(await again.save(), { ocr: 'force', images: false }, signal);
      if (!r?.success) return null;
      const by = new Map<number, IRBlock[]>();
      for (const b of flatten(r.blocks)) if (b.bbox && b.pageNumber) by.set(b.pageNumber, [...(by.get(b.pageNumber) ?? []), b]);
      let placed = 0;
      const touched: number[] = [];
      for (const [k, pn] of pages.entries()) {
        const blocks = by.get(k + 1) ?? [];
        const left: PdfHit[] = [];
        const boxes: Box[] = [];
        const lineH = Math.min(...blocks.filter((b) => !b.table).map((b) => b.bbox!.height), 34);
        for (const b of blocks) {
          if (b.table) { boxes.push(...tableCellBoxes(b, rules, keep, left)); continue; }
          const text = b.text ?? '';
          for (const h of pageHits(text, rules, known, keep)) {
            boxes.push(...estimateBoxes({ text, bbox: b.bbox! }, h.index, h.index + h.length, lineH));
            left.push({ rule: h.rule, masked: h.masked });
          }
        }
        if (!left.length) continue;
        placed += left.length;
        touched.push(pn);
        if (!paintLeft) continue;
        // 글자층 쪽에서 새로 걸린 곳(그림·주석·양식 칸의 글)은 찾은 곳에도 넣는다. 스캔 쪽은 처음 읽을 때 이미 셌다
        if (mixed.has(pn)) hits.push(...left);
        const shot = shots[pn - 1];
        const { data, info } = await sharp(shot.jpg).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        const px = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        // 다시 읽은 쪽은 그림 화소가 곧 pt (아래가 0) → 위가 0 인 화소 자리로
        paint(px, info.width, info.height, boxes.map((b) => [b.x0 - 3, info.height - b.y1 - 3, b.x1 + 3, info.height - b.y0 + 3]));
        shot.jpg = await sharp(Buffer.from(px), { raw: { width: info.width, height: info.height, channels: 4 } }).flatten({ background: '#ffffff' }).jpeg({ quality: 82 }).toBuffer();
      }
      // 상자 없이 본문에만 잡힌 글이 더 있으면 그것도 센다 (자리를 몰라 칠하지 못한다)
      const inText = countRead(r.markdown, rules, keep);
      return { found: Math.max(placed, inText), touched };
    };

    // 글자 읽기로 가린 쪽·그림이나 주석이 있는 쪽은 칠한 그림을 다시 읽는다 (어림잡은 자리가 빗나갔을 수 있고, 주석·양식 칸의 글은 여기서야 보인다).
    // 남은 곳은 그 자리를 마저 칠하고, 칠한 쪽을 한 번 더 읽어 정말 가려졌는지 본다
    let repainted = 0;
    const recheck = [...ocrPages].sort((a, b) => a - b);
    if (recheck.length) {
      sendProgress({ current: count, total: count, message: '가린 쪽을 다시 읽어 확인하는 중' });
      const first = await reread(recheck, true);
      if (!first) {
        // 다시 읽지 못했으면 가려졌는지 확인하지 못한 것이다
        residual += recheck.length;
        notes.push(`가린 뒤 ${recheck.join(', ')}쪽을 다시 읽어 확인하지 못했습니다. 눈으로 확인하세요.`);
      } else if (first.found) {
        repainted = first.found;
        const second = first.touched.length ? await reread(first.touched, false) : { found: first.found, touched: [] };
        const still = second ? second.found : first.found;
        residual += Math.max(still, 1);
        notes.push(still
          ? `다시 읽어 보니 ${first.found}곳이 남아 있어 마저 칠했지만 ${still}곳은 아직 보입니다(${(second?.touched.length ? second.touched : first.touched).join(', ')}쪽). 이 PDF는 그대로 내보내지 말고 눈으로 확인하세요.`
          : `다시 읽어 보니 ${first.found}곳이 남아 있어 그 자리를 마저 칠했습니다. 어림으로 칠했으니 눈으로 확인하세요.`);
      }
    }

    const out = await PDFDocument.create();
    for (const s of shots) {
      const image = await out.embedJpg(s.jpg);
      out.addPage([s.pw, s.ph]).drawImage(image, { x: 0, y: 0, width: s.pw, height: s.ph });
    }
    out.setProducer('KorDoc AI');
    out.setCreator('KorDoc AI');
    const pdf = await out.save();
    return { hits, unscanned, residual: residual + unscanned.length, notes, pdf, repainted };
  } finally {
    doc.destroy();
  }
}
