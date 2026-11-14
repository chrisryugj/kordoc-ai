/** 나란히 비교 (compare_visual) — 두 문서를 쪽 모양 그대로 놓고 바뀐 글자 자리에 칠할 상자를 낸다
 *
 * 1) 쪽 위 글자 자리: HWP·HWPX 는 rhwp 쪽 SVG(글자마다 <text> 하나), PDF 는 PDFium 글자 상자.
 *    HWPX 는 화면 미리보기와 같은 사본(빈 누름틀 안내문을 넣은 것)으로 그려 화면 쪽과 자리가 맞는다.
 * 2) kordoc compare 의 블록 차이(바뀐 어절)를 그 글자들에 맞춘다: 블록 글을 문서 차례대로 쪽 글자 줄에서 찾고
 *    (그대로 있으면 바로, 아니면 근처 창에서 LCS), 바뀐 글자만 상자로 묶는다.
 * 좌표는 쪽 폭·높이에 대한 비율(0~1)이라 화면 배율과 상관없다.
 */

import { readFile } from 'node:fs/promises';
import { blocksToMarkdown, type BlockDiff, type IRBlock } from 'kordoc';
import type { CompareVisualResult, VisualChange, VisualMark, VisualSide } from '../../types/rpc-contract.js';
import { sendProgress } from '../../infra/progress.js';
import { formatOf } from '../files/format.js';
import { showFieldGuides } from '../render/guides.js';
import { rhwpPages, tooBigForRhwp } from '../render/rhwp.js';
import { openPdf } from '../render/pdfium.js';
import { compareRows, diffFiles, wordDiff } from './index.js';

/** 쪽 위 글자 하나 (쪽 단위 좌표: rhwp 는 px, PDF 는 pt) */
export interface Glyph { c: string; p: number; x: number; y: number; w: number; h: number }
interface Layout { pages: Array<{ width: number; height: number }>; glyphs: Glyph[] }

const SPACE = /\s/;
const ENTITY: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
const unescapeXml = (s: string) => s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (m, e: string) =>
  e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTITY[e.toLowerCase()] ?? m);
const num = (attrs: string, name: string) => {
  const m = new RegExp(`\\b${name}="(-?[\\d.]+)"`).exec(attrs);
  return m ? Number(m[1]) : undefined;
};
/** 한글·한자·전각은 글자 크기만큼, 나머지는 절반쯤 */
const wide = (c: string) => (c.codePointAt(0) ?? 0) >= 0x1100;

/** rhwp 쪽 SVG → 글자 자리. <text> 는 x·y 또는 transform="translate(x,y) scale(sx,…)" 로 놓이고 그룹에는 좌표 변환이 없다 (0.8.7 실측) */
export function svgGlyphs(svg: string, page: number): Glyph[] {
  const out: Array<Glyph & { fs: number; sx: number; tl?: number }> = [];
  for (const m of svg.matchAll(/<text\b([^>]*)>([^<]*)<\/text>/g)) {
    const attrs = m[1];
    const content = unescapeXml(m[2]);
    if (!content.trim()) continue;
    const fs = num(attrs, 'font-size') ?? 12;
    const tr = /translate\((-?[\d.]+)[ ,]+(-?[\d.]+)\)(?:\s*scale\((-?[\d.]+))?/.exec(attrs);
    const x0 = tr ? Number(tr[1]) : num(attrs, 'x') ?? 0;
    const y = tr ? Number(tr[2]) : num(attrs, 'y') ?? 0;
    const sx = tr?.[3] ? Number(tr[3]) : 1;
    const chars = Array.from(content);
    const tl = num(attrs, 'textLength');
    const each = tl != null ? (tl * sx) / chars.length : undefined;
    let x = x0;
    for (const c of chars) {
      const w = each ?? fs * sx * (wide(c) ? 1 : 0.55);
      if (!SPACE.test(c)) out.push({ c, p: page, x, y: y - fs * 0.88, w, h: fs * 1.12, fs, sx, tl: each });
      x += w;
    }
  }
  // 같은 줄 다음 글자까지를 폭으로 (글자 사이 간격·장평이 들어간 실제 자리)
  for (let i = 0; i < out.length - 1; i++) {
    const a = out[i];
    const b = out[i + 1];
    const gap = b.x - a.x;
    if (a.tl == null && Math.abs(b.y - a.y) < 0.5 && gap > 0 && gap < a.fs * 1.6) a.w = Math.min(gap, a.fs * a.sx * 1.05);
  }
  return out.map(({ c, p, x, y, w, h }) => ({ c, p, x, y, w, h }));
}

async function hangulLayout(bytes: Uint8Array, hwpx: boolean, signal?: AbortSignal): Promise<Layout | string> {
  const shown = hwpx ? await showFieldGuides(bytes) : bytes;
  const pages: Layout['pages'] = [];
  const glyphs: Glyph[] = [];
  for await (const pg of rhwpPages(shown, undefined, signal)) {
    signal?.throwIfAborted();
    const g = svgGlyphs(pg.svg, pages.length);
    if (glyphs.length + g.length > MAX_GLYPHS) return TOO_MANY_GLYPHS;
    // 펼쳐 넣으면(push(...g)) 글자가 수십만 개인 쪽에서 RangeError
    for (const x of g) glyphs.push(x);
    pages.push({ width: pg.width, height: pg.height });
  }
  return { pages, glyphs };
}

/** @hyzyla/pdfium 은 글자 상자 함수를 감싸 두지 않아 모듈 함수를 바로 부른다 (getText 와 같은 방식) */
interface PdfMod {
  _FPDFText_LoadPage(page: number): number;
  _FPDFText_ClosePage(tp: number): void;
  _FPDFText_CountChars(tp: number): number;
  _FPDFText_GetUnicode(tp: number, i: number): number;
  _FPDFText_GetCharBox(tp: number, i: number, l: number, r: number, b: number, t: number): number;
  _FPDF_ClosePage(page: number): void;
  _FPDF_PageToDevice(page: number, sx: number, sy: number, w: number, h: number, rot: number, px: number, py: number, dx: number, dy: number): number;
  HEAPF64: Float64Array;
  HEAPU8: Uint8Array;
  wasmExports: { malloc(n: number): number; free(p: number): void };
}

/** PDF 글자 상자를 읽는 쪽 수 한도 (엔진 스레드에서 돈다. 넘으면 대조표로) */
const PDF_MAX_PAGES = 600;
/** 한 문서의 글자 상자 수 한도 — 글자마다 객체 하나라, 한 쪽에 글자 수백만 개를 적은 PDF 하나로 엔진 메모리가 바닥난다. 넘으면 대조표로
 *  (빽빽한 600쪽도 쪽당 3천 자면 180만) */
const MAX_GLYPHS = 2_000_000;
const TOO_MANY_GLYPHS = '글자가 아주 많은 문서라 나란히 보기를 만들지 않았습니다. 대조표로 보세요.';
/** 이만큼 쪽마다 한 번 숨을 돌린다 (멈추기·진행 알림·다른 요청이 끼어들게) */
const PDF_YIELD_EVERY = 8;

async function pdfLayout(bytes: Uint8Array, signal?: AbortSignal): Promise<Layout | string> {
  const doc = await openPdf(bytes);
  const pages: Layout['pages'] = [];
  const glyphs: Glyph[] = [];
  try {
    const count = doc.getPageCount();
    if (count > PDF_MAX_PAGES) return '쪽이 아주 많은 문서라 나란히 보기를 만들지 않았습니다. 대조표로 보세요.';
    for (let n = 0; n < count; n++) {
      if (n % PDF_YIELD_EVERY === PDF_YIELD_EVERY - 1) await new Promise((r) => setImmediate(r));
      signal?.throwIfAborted();
      const page = doc.getPage(n);
      const { originalWidth: W, originalHeight: H } = page.getOriginalSize();
      pages.push({ width: W, height: H });
      const raw = page as unknown as { module: PdfMod; pageIdx: number };
      const mod = raw.module;
      const tp = mod._FPDFText_LoadPage(raw.pageIdx);
      if (!tp) { mod._FPDF_ClosePage(raw.pageIdx); continue; }
      // 글자 상자(쪽 좌표) → 그린 쪽 위 자리: PDFium 이 쪽 회전(/Rotate)·CropBox 를 반영해 바꾼다(가리기와 같은 방식).
      // 정수로 돌려주므로 10배 크게 잡아 바꾼 뒤 나눈다
      const Q = 10;
      const buf = mod.wasmExports.malloc(48);
      const toDev = (px: number, py: number): [number, number] => {
        mod._FPDF_PageToDevice(raw.pageIdx, 0, 0, Math.round(W * Q), Math.round(H * Q), 0, px, py, buf + 32, buf + 36);
        const v = new Int32Array(mod.HEAPU8.buffer, buf + 32, 2);
        return [v[0] / Q, v[1] / Q];
      };
      try {
        const total = mod._FPDFText_CountChars(tp);
        if (glyphs.length + total > MAX_GLYPHS) return TOO_MANY_GLYPHS;
        for (let i = 0; i < total; i++) {
          const c = String.fromCodePoint(mod._FPDFText_GetUnicode(tp, i) || 32);
          if (SPACE.test(c) || c < ' ') continue;
          if (!mod._FPDFText_GetCharBox(tp, i, buf, buf + 8, buf + 16, buf + 24)) continue;
          const [l, r, b, t] = mod.HEAPF64.subarray(buf / 8, buf / 8 + 4);
          const [ax, ay] = toDev(l, t);
          const [bx, by] = toDev(r, b);
          const x0 = Math.min(ax, bx);
          const y0 = Math.min(ay, by);
          const h = Math.max(Math.max(ay, by) - y0, 1);
          glyphs.push({ c, p: n, x: x0, y: y0 - h * 0.1, w: Math.max(Math.max(ax, bx) - x0, 1), h: h * 1.2 });
        }
      } finally {
        mod.wasmExports.free(buf);
        mod._FPDFText_ClosePage(tp);
        mod._FPDF_ClosePage(raw.pageIdx);
      }
    }
  } finally {
    doc.destroy();
  }
  return { pages, glyphs };
}

/** 쪽 모양이 있는 형식만 (화면이 쪽을 그리는 형식과 같다). 없으면 그 까닭 */
export async function layoutOf(path: string, signal?: AbortSignal): Promise<Layout | string> {
  const fmt = formatOf(path);
  if (fmt !== 'hwp' && fmt !== 'hwpx' && fmt !== 'pdf') return '이 형식은 쪽 모양이 없어 대조표로만 볼 수 있습니다.';
  const bytes = new Uint8Array(await readFile(path));
  try {
    if (fmt === 'pdf') return await pdfLayout(bytes, signal);
    if (await tooBigForRhwp(bytes)) return '쪽이 아주 많은 문서라 나란히 보기를 만들지 않았습니다. 대조표로 보세요.';
    return await hangulLayout(bytes, fmt === 'hwpx', signal);
  } catch (err) {
    if (signal?.aborted) throw err;
    return '이 문서는 쪽 모양을 그리지 못했습니다. 대조표로 보세요.';
  }
}

// ─── 블록 글 → 맞출 글자 (공백 없이, 바뀐 글자 표시) ───

/** 맞추기용 블록 글 — 표는 칸 글을 차례대로(칸 사이는 \u0001), 목록은 항목 글. 화면 대조표 글(blockText)과 달리 구분 기호를 넣지 않는다 */
export function alignText(b?: IRBlock): string {
  if (!b) return '';
  if (b.type === 'paragraph' || b.type === 'heading') return unescapeMd(b.text ?? '');
  if (b.type === 'image' || b.type === 'separator') return '';
  if (b.type === 'table' && b.table) {
    return b.table.cells.map((row) => row.map((c) => (c.blocks?.length ? c.blocks.map(alignText).join('\n') : c.text)).join(' \u0001 ')).join('\n');
  }
  if (b.children?.length) return b.children.map(alignText).join('\n');
  // 줄 머리의 목록 기호·번호만 뺀다 (본문의 "2026. 11. 5." 같은 날짜는 이스케이프돼 있어 남는다), 그다음 이스케이프를 푼다
  return unescapeMd(blocksToMarkdown([b]).replace(/^[\s>#*\-+]*(?:\d+\.\s+)?/gm, ''));
}

/** 블록 글의 마크다운 이스케이프(\$·\~·\* …)는 쪽에 없는 글자라 뺀다 */
const unescapeMd = (s: string) => s.replace(/\\([\\`*_{}[\]()#+\-.!|~$<>])/g, '$1');

interface Unit { chars: string[]; mask: boolean[] }

/** 조각(글·바뀜) → 공백·칸 구분을 뺀 글자와 바뀜 표시 */
function unitOf(segs: Array<{ text: string; changed: boolean }>): Unit {
  const chars: string[] = [];
  const mask: boolean[] = [];
  for (const s of segs) for (const c of s.text) if (!SPACE.test(c) && c !== '\u0001') { chars.push(c); mask.push(s.changed); }
  return { chars, mask };
}

// ─── 글자 줄에 맞추기 ───

const CHUNK = 500;

/** t 를 S[from…] 근처 창에서 LCS 로 맞춘 짝 (t 차례, S 차례). 같은 점수면 앞쪽 글자를 먼저 잡는다 */
function lcsPairs(t: string[], S: string[], from: number): Array<[number, number]> {
  const W = Math.min(S.length - from, t.length * 2 + 300);
  if (W <= 0 || !t.length) return [];
  const w = W + 1;
  const dp = new Uint16Array((t.length + 1) * w);
  for (let i = t.length - 1; i >= 0; i--) {
    for (let j = W - 1; j >= 0; j--) {
      dp[i * w + j] = t[i] === S[from + j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
    }
  }
  const pairs: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < t.length && j < W) {
    if (t[i] === S[from + j] && dp[i * w + j] === dp[(i + 1) * w + j + 1] + 1) { pairs.push([i, from + j]); i++; j++; }
    else if (dp[i * w + j + 1] >= dp[(i + 1) * w + j]) j++;
    else i++;
  }
  return pairs;
}

/** 한 덩어리를 맞춘다: 그대로 있으면 그 자리, 아니면 LCS. 절반도 못 맞추면 버린다. 돌려주는 값: [t 차례 → S 차례] 짝과 다음 출발점 */
function place(t: string[], S: string[], joined: string, from: number): { pairs: Array<[number, number]>; next: number } | null {
  const str = t.join('');
  // 가까운 곳만 본다 (문서 끝까지 훑으면 블록이 많을 때 느리다)
  const near = joined.slice(from, from + 3000 + t.length * 4).indexOf(str);
  const at = near < 0 ? -1 : from + near;
  if (at >= 0) return { pairs: t.map((_, k) => [k, at + k]), next: at + t.length };
  // 블록 차례와 쪽 위 차례가 다를 때(발신 명의·표·글상자): 문서 전체에서 딱 한 번 나오는 그대로의 글이면 그 자리. 출발점은 뒤로 돌리지 않는다
  if (t.length >= 4) {
    const any = joined.indexOf(str);
    if (any >= 0 && joined.indexOf(str, any + 1) < 0) return { pairs: t.map((_, k) => [k, any + k]), next: Math.max(from, any + t.length) };
  }
  const pairs = lcsPairs(t, S, from);
  // 짧은 덩어리일수록 더 많이 맞아야 하고, 맞은 글자가 덩어리보다 훨씬 넓게 흩어져 있으면 다른 곳의 글자를 주운 것이다
  // (예: "1.개요"가 "1)개요"로 그려졌는데 100자 뒤의 "1."과 "개요"를 잡으면 그 사이 바뀐 곳을 다 건너뛴다). 그러면 칠하지 않고 출발점도 그대로
  if (pairs.length < Math.max(1, t.length * (t.length < 20 ? 0.75 : 0.5))) return null;
  const span = pairs[pairs.length - 1][1] - pairs[0][1] + 1;
  if (span > t.length * 1.5 + 20) return null;
  return { pairs, next: pairs[pairs.length - 1][1] + 1 };
}

/** 한 쪽 글자 줄에 블록들을 차례로 맞춰, 글자마다 [바뀜 번호 | -1] 과 블록마다 그 앞까지 맞춘 마지막 글자(-1: 아직 없음)를 낸다.
 *  이쪽에 없는 블록은 그 글자 바로 뒤가 들어갈 자리다 (다음 글자 앞으로 잡으면 문서 끝에 넣은 내용이 쪽 번호 옆에 붙는다) */
export function alignSide(units: Array<Unit | null>, glyphs: Glyph[]): { hit: Int32Array; after: number[] } {
  // 아스트랄 글자는 한 칸으로 (indexOf 차례와 글자 차례를 맞추려고)
  const S = glyphs.map((g) => (g.c.length > 1 ? '�' : g.c));
  const joined = S.join('');
  const hit = new Int32Array(S.length).fill(-1);
  const after: number[] = [];
  let cur = 0;
  let last = -1;
  units.forEach((u, k) => {
    after.push(last);
    if (!u || !u.chars.length) return;
    const t = u.chars.map((c) => (c.length > 1 ? '�' : c));
    for (let off = 0; off < t.length; off += CHUNK) {
      const part = t.slice(off, off + CHUNK);
      const r = place(part, S, joined, cur);
      if (!r) continue;
      for (const [ti, si] of r.pairs) if (u.mask[off + ti]) hit[si] = k;
      last = r.pairs[r.pairs.length - 1][1];
      cur = r.next;
    }
  });
  return { hit, after };
}

/** 바뀐 글자 → 줄마다 하나로 묶은 상자 (쪽 비율 좌표) */
function marksOf(hit: Int32Array, glyphs: Glyph[], pages: Layout['pages'], kind: VisualMark['kind']): VisualMark[] {
  const out: VisualMark[] = [];
  let open: { change: number; p: number; x0: number; y0: number; x1: number; y1: number } | null = null;
  const flush = () => {
    if (!open) return;
    const pg = pages[open.p];
    out.push({ page: open.p + 1, change: open.change, kind, x: open.x0 / pg.width, y: open.y0 / pg.height, w: (open.x1 - open.x0) / pg.width, h: (open.y1 - open.y0) / pg.height });
    open = null;
  };
  for (let i = 0; i < glyphs.length; i++) {
    const k = hit[i];
    const g = glyphs[i];
    if (k < 0) { flush(); continue; }
    const sameLine = open && open.change === k && open.p === g.p && Math.abs(g.y - open.y0) < g.h * 0.5 && g.x >= open.x0 - g.h && g.x - open.x1 < g.h * 1.5;
    if (open && sameLine) {
      open.x1 = Math.max(open.x1, g.x + g.w);
      open.y1 = Math.max(open.y1, g.y + g.h);
      continue;
    }
    flush();
    open = { change: k, p: g.p, x0: g.x, y0: g.y, x1: g.x + g.w, y1: g.y + g.h };
  }
  flush();
  return out;
}

/** 다른 쪽에만 있는 블록이 이쪽에 들어갈(빠진) 자리 — 앞 블록 마지막 글자 바로 뒤(문서 맨 앞이면 첫 글자 앞)에 세로 막대 */
function gapMark(after: number, glyphs: Glyph[], pages: Layout['pages'], change: number): VisualMark | null {
  const g = glyphs[Math.max(0, after)];
  if (!g) return null;
  const pg = pages[g.p];
  const x = after < 0 ? Math.max(0, g.x - 4) : Math.min(pg.width - 3, g.x + g.w + 1);
  return { page: g.p + 1, change, kind: 'gap', x: x / pg.width, y: g.y / pg.height, w: 3 / pg.width, h: g.h / pg.height };
}

function sideOf(layout: Layout | string, units: Array<Unit | null>, diffs: BlockDiff[], side: 'old' | 'new'): VisualSide | { why: string } {
  if (typeof layout === 'string') return { why: layout };
  // 글자층이 없는 PDF(스캔본)는 쪽은 그려도 칠할 자리를 못 찾는다
  if (!layout.glyphs.length) return { why: '글자 정보가 없는 문서(스캔한 PDF 등)라 바뀐 곳을 쪽 위에 칠할 수 없습니다. 대조표로 보세요.' };
  const { hit, after: starts } = alignSide(units, layout.glyphs);
  const own = side === 'old' ? 'del' : 'add';
  const marks = marksOf(hit, layout.glyphs, layout.pages, own);
  const other = side === 'old' ? 'added' : 'removed';
  diffs.forEach((d, k) => {
    if (d.type !== other) return;
    const m = gapMark(starts[k], layout.glyphs, layout.pages, k);
    if (m) marks.push(m);
  });
  return { pages: layout.pages, marks };
}

/** 목록에 보낼 두 글: 앞뒤 같은 부분을 앞뒤 40자만 남기고 줄여서 바뀐 곳이 늘 들어가게 (화면이 이 글로 다시 낱말 차이를 낸다) */
export function snippets(a: string, b: string, ctx = 40, max = 240): [string, string] {
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  let s = 0;
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  const cut = (x: string) => {
    const from = Math.max(0, p - ctx);
    const to = Math.max(from, x.length - Math.max(0, s - ctx));
    let mid = x.slice(from, to);
    if (mid.length > max) mid = `${mid.slice(0, max)}…`;
    return `${from > 0 ? '…' : ''}${mid}${to < x.length && !mid.endsWith('…') ? '…' : ''}`;
  };
  return [cut(a), cut(b)];
}

export async function compareVisual(p: { old_path: string; new_path: string }, signal?: AbortSignal): Promise<CompareVisualResult> {
  const diff = await diffFiles(p.old_path, p.new_path, signal);
  sendProgress({ current: 1, total: 3, message: '두 문서 쪽 모양 읽는 중' });
  const [oldLayout, newLayout] = await Promise.all([layoutOf(p.old_path, signal), layoutOf(p.new_path, signal)]);
  signal?.throwIfAborted();
  sendProgress({ current: 2, total: 3, message: '바뀐 곳 자리 찾는 중' });

  const oldUnits: Array<Unit | null> = [];
  const newUnits: Array<Unit | null> = [];
  for (const d of diff.diffs) {
    const a = alignText(d.before);
    const b = alignText(d.after);
    if (d.type === 'modified') {
      const w = wordDiff(a, b);
      oldUnits.push(unitOf(w.old));
      newUnits.push(unitOf(w.new));
    } else {
      const changed = d.type !== 'unchanged';
      oldUnits.push(d.before ? unitOf([{ text: a, changed }]) : null);
      newUnits.push(d.after ? unitOf([{ text: b, changed }]) : null);
    }
  }
  const oldSide = sideOf(oldLayout, oldUnits, diff.diffs, 'old');
  const newSide = sideOf(newLayout, newUnits, diff.diffs, 'new');

  const rows = compareRows(diff.diffs);
  const firstMark = (s: VisualSide | { why: string }, k: number) => ('marks' in s ? s.marks.find((m) => m.change === k) : undefined);
  const changes: VisualChange[] = [];
  diff.diffs.forEach((d, k) => {
    if (d.type === 'unchanged') return;
    const o = firstMark(oldSide, k);
    const n = firstMark(newSide, k);
    const old = rowText(d.before);
    const neu = rowText(d.after);
    if (!old && !neu) return;
    const [so, sn] = d.type === 'modified' ? snippets(old, neu) : [snippets(old, '')[0], snippets('', neu)[1]];
    changes.push({ id: k, type: d.type as VisualChange['type'], old: so, new: sn, ...(o ? { old_page: o.page, old_y: o.y } : {}), ...(n ? { new_page: n.page, new_y: n.y } : {}) });
  });
  return {
    stats: diff.stats,
    rows,
    changes,
    old: 'marks' in oldSide ? oldSide : null,
    new: 'marks' in newSide ? newSide : null,
    ...('why' in oldSide ? { old_why: oldSide.why } : {}),
    ...('why' in newSide ? { new_why: newSide.why } : {}),
  };
}

/** 목록에 보일 글 — 표는 칸을 · 로 */
function rowText(b?: IRBlock): string {
  if (b?.type === 'image') return '[그림]';
  return alignText(b).replace(/ \u0001 /g, ' · ').replace(/\s*\n\s*/g, ' ').trim();
}
