/** PDF 작업 화면 엔진 — 원본 열기(pdf_open)·쪽 그림(pdf_thumbs)·쪽 조립(pdf_compose)·쪽을 그림 파일로(pdf_to_images)
 *
 * 쪽 조립 하나로 합치기·쪽 뽑기·쪽 지우기·순서 바꾸기·돌리기·나누기를 다 한다: 화면이 결과 파일마다 넣을 쪽(원본·쪽 번호·더 돌릴 각)을
 * 차례로 준다. PDF 가 아닌 원본(그림·한글·워드·엑셀 …)은 export 와 같은 방법(docToPdf, 그림은 A4 한 쪽)으로 바꾼 임시 PDF 를 원본으로 쓴다.
 * 보안 설정 PDF 는 pdf-lib 이 쪽을 옮기지 못해 합본 PDF 와 같이 쪽 그림으로 넣는다(secured 로 화면에 알린다).
 */

import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { readFile, rename, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument, degrees, type PDFEmbeddedPage, type PDFPage } from 'pdf-lib';
import type { PDFiumDocument } from '@hyzyla/pdfium';
import type { PdfComposePage, PdfComposeParams, PdfComposeResult, PdfWorkSource } from '../../types/rpc-contract.js';
import { sendProgress } from '../../infra/progress.js';
import { docToPdf, loadPdf } from '../export/index.js';
import { stampPdf } from '../export/stamp.js';
import { shrinkImages } from '../pdf-shrink/index.js';
import { formatOf } from '../files/format.js';
import { outputDir, outputFile, safeFileName, stemOf, uniquePath } from '../output/index.js';
import { openPdf, rasterPdfPage } from '../render/pdfium.js';
import { parsePageSpec } from '../render/index.js';

const WORK_DIR = join(tmpdir(), 'kordoc-pdf-work');
const DAY = 24 * 60 * 60 * 1000;
const isEncrypted = (err: unknown) => /encrypt/i.test(err instanceof Error ? `${err.name} ${err.message}` : String(err));
const norm = (deg: number) => (((Math.round(deg / 90) * 90) % 360) + 360) % 360;

// ── 원본 열기 ──

let swept = false;
/** 하루 지난 임시 PDF 지우기 (켤 때마다 한 번) */
function sweepWorkDir() {
  if (swept) return;
  swept = true;
  try {
    for (const f of readdirSync(WORK_DIR)) {
      const p = join(WORK_DIR, f);
      if (Date.now() - statSync(p).mtimeMs > DAY) rmSync(p, { force: true });
    }
  } catch { /* 폴더가 없으면 지울 것도 없다 */ }
}

/** PDF 가 아닌 원본 → 임시 PDF. 같은 파일·같은 수정 시각이면 앞서 바꾼 것을 다시 쓴다 */
async function convertedPdf(path: string, signal?: AbortSignal): Promise<string> {
  sweepWorkDir();
  const st = await stat(path);
  const key = createHash('sha1').update(`${path}\0${st.size}\0${st.mtimeMs}`).digest('hex').slice(0, 20);
  const out = join(WORK_DIR, `${key}.pdf`);
  try {
    if (statSync(out).size > 0) return out;
  } catch { /* 없으면 만든다 */ }
  const bytes = await docToPdf(path, signal);
  mkdirSync(WORK_DIR, { recursive: true });
  const part = `${out}.${process.pid}.part`;
  await writeFile(part, bytes);
  await rename(part, out);
  return out;
}

export async function pdfOpen(p: { path: string }, signal?: AbortSignal): Promise<PdfWorkSource> {
  const converted = formatOf(p.path) !== 'pdf';
  const source = converted ? await convertedPdf(p.path, signal) : p.path;
  const bytes = new Uint8Array(await readFile(source));
  let doc: PDFDocument | null = null;
  try {
    doc = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (err) {
    if (!isEncrypted(err)) throw new Error('PDF가 손상되어 열 수 없습니다. 원본을 다시 받아 시도하세요.');
  }
  // 보안 PDF 도 PDFium 은 열린다 (열기 암호가 없으면). 쪽 크기를 여기서 다 읽으려고 쪽마다 불러오면 내용까지 다 풀어서, 열리는지만 본다
  const check = await openPdf(bytes).catch((err: unknown) => {
    if (err instanceof Error && /암호/.test(err.message)) throw new Error('열기 암호가 걸린 PDF는 PDF 작업에서 열 수 없습니다. 암호를 푼 사본을 저장해 넣으세요.');
    throw err;
  });
  const count = check.getPageCount();
  const r2 = (v: number) => Math.round(v * 100) / 100;
  let pages: PdfWorkSource['pages'];
  try {
    pages = doc
      ? doc.getPages().map((pg) => {
        const box = pg.getCropBox();
        const turned = norm(pg.getRotation().angle) % 180 !== 0;
        return turned ? { width: r2(box.height), height: r2(box.width) } : { width: r2(box.width), height: r2(box.height) };
      })
      // 보안 PDF 는 pdf-lib 으로 크기를 못 읽어 PDFium 으로 (쪽마다 불러와 내용까지 풀지만 보안 PDF 는 드물고 대개 짧다). 아주 길면 A4 로 둔다
      : Array.from({ length: count }, (_, i) => {
        if (count > 300) return { width: 595.28, height: 841.89 };
        const { originalWidth, originalHeight } = check.getPage(i).getOriginalSize();
        return { width: r2(originalWidth), height: r2(originalHeight) };
      });
  } finally {
    check.destroy();
  }
  return { source, converted, secured: !doc, page_count: count, pages };
}

// ── 쪽 그림 ──

/** 쪽 그림은 화면이 몇십 쪽씩 여러 번 부른다 → 연 문서를 잠깐 들고 있는다. 쓰는 중인 문서는 닫지 않는다 */
interface Held { key: string; doc: PDFiumDocument; users: number; used: number }
const held = new Map<string, Held>();
const HOLD_MS = 30_000;
const HOLD_MAX = 4;
let sweepTimer: NodeJS.Timeout | null = null;

function release(h: Held) {
  h.users--;
  h.used = Date.now();
  if (!sweepTimer) {
    sweepTimer = setTimeout(() => {
      sweepTimer = null;
      closeIdle(HOLD_MS);
    }, HOLD_MS + 1000);
    sweepTimer.unref?.();
  }
}

function closeIdle(idleMs: number, keep = 0) {
  const idle = [...held.values()].filter((h) => h.users === 0 && Date.now() - h.used >= idleMs).sort((a, b) => a.used - b.used);
  for (const h of idle.slice(0, Math.max(0, idle.length - keep))) {
    held.delete(h.key);
    h.doc.destroy();
  }
  if (held.size && !sweepTimer) {
    sweepTimer = setTimeout(() => { sweepTimer = null; closeIdle(HOLD_MS); }, HOLD_MS + 1000);
    sweepTimer.unref?.();
  }
}

async function hold(path: string): Promise<Held> {
  const st = await stat(path);
  const key = `${path}\0${st.size}\0${st.mtimeMs}`;
  let h = held.get(key);
  if (!h) {
    const doc = await openPdf(new Uint8Array(await readFile(path)));
    h = held.get(key);
    if (h) doc.destroy();
    else {
      h = { key, doc, users: 0, used: Date.now() };
      held.set(key, h);
      if (held.size > HOLD_MAX) closeIdle(0, HOLD_MAX - 1);
    }
  }
  h.users++;
  return h;
}

/** 쪽 그림(JPEG) — width 는 그림 폭(px). 고른 쪽이 많으면 앞 40쪽만 */
export async function pdfThumbs(p: { path: string; pages?: string; width?: number }, signal?: AbortSignal): Promise<{ page_count: number; pages: Array<{ page: number; data_url: string }> }> {
  const width = Math.round(Math.min(Math.max(p.width ?? 240, 80), 1600));
  const h = await hold(p.path);
  try {
    const count = h.doc.getPageCount();
    const wanted = (p.pages?.trim() ? parsePageSpec(p.pages, count) : [1]).filter((n) => n <= count).slice(0, 40);
    const pages: Array<{ page: number; data_url: string }> = [];
    for (const n of wanted) {
      signal?.throwIfAborted();
      const r = await rasterPdfPage(h.doc, n, width, 'jpeg', 78);
      pages.push({ page: n, data_url: `data:image/jpeg;base64,${r.data.toString('base64')}` });
    }
    return { page_count: count, pages };
  } finally {
    release(h);
  }
}

// ── 쪽 조립 ──

/** 원본마다 한 번만 연다 (보안 PDF 는 쪽 그림으로 다시 만든 것) */
function sources() {
  const docs = new Map<string, Promise<PDFDocument>>();
  const secured: string[] = [];
  const open = (path: string) => {
    let d = docs.get(path);
    if (!d) {
      d = readFile(path).then(async (buf) => {
        const bytes = new Uint8Array(buf);
        try {
          return await PDFDocument.load(bytes, { updateMetadata: false });
        } catch (err) {
          if (!isEncrypted(err)) throw err;
          secured.push(path);
          return loadPdf(bytes);
        }
      });
      docs.set(path, d);
    }
    return d;
  };
  return { open, secured };
}

const A4 = { w: 595.28, h: 841.89 };

/** 쪽 차례대로 새 PDF. 원본 하나에서 쪽을 한 번에 옮겨야 글꼴·그림을 쪽마다 따로 싣지 않는다.
 *  fitA4: 모든 쪽을 A4(보이는 방향대로 세로·가로)에 맞춰 가운데 놓는다 (크기가 제각각인 스캔·영수증) */
async function buildPdf(pages: PdfComposePage[], src: ReturnType<typeof sources>, fitA4 = false): Promise<PDFDocument> {
  const out = await PDFDocument.create();
  const order = new Map<string, number[]>();
  for (const it of pages) {
    if ('blank' in it) continue;
    const doc = await src.open(it.path);
    if (!Number.isInteger(it.page) || it.page < 1 || it.page > doc.getPageCount()) throw new Error(`없는 쪽입니다 (${it.page}쪽). 원본이 바뀌었으면 다시 넣으세요.`);
    order.set(it.path, [...(order.get(it.path) ?? []), it.page - 1]);
  }
  if (fitA4) return buildFitted(out, pages, src, order);
  // 같은 쪽을 두 번 넣으면(복제) 한 copyPages 안에서 /Contents 배열을 같이 써서 쪽 번호·워터마크가 두 쪽에 겹쳐 찍힌다
  // → 같은 쪽의 n 번째는 n 회차 copyPages 로 (회차 안에서는 원본마다 한 번)
  const seen = new Map<string, number>();
  const round = (it: { path: string; page: number }) => {
    const k = `${it.path}\u0000${it.page}`;
    const n = seen.get(k) ?? 0;
    seen.set(k, n + 1);
    return n;
  };
  const rounds: Array<Map<string, number[]>> = [];
  const nth = pages.map((it) => ('blank' in it ? -1 : round(it)));
  pages.forEach((it, i) => {
    if ('blank' in it) return;
    const r = (rounds[nth[i]] ??= new Map());
    r.set(it.path, [...(r.get(it.path) ?? []), it.page - 1]);
  });
  const copied: Array<Map<string, PDFPage[]>> = [];
  for (const r of rounds) {
    const m = new Map<string, PDFPage[]>();
    for (const [path, idx] of r) m.set(path, await out.copyPages(await src.open(path), idx));
    copied.push(m);
  }
  pages.forEach((it, i) => {
    if ('blank' in it) {
      out.addPage([Math.max(72, it.blank.width), Math.max(72, it.blank.height)]);
      return;
    }
    const page = copied[nth[i]].get(it.path)!.shift()!;
    if (it.rotate) page.setRotation(degrees(norm(page.getRotation().angle + it.rotate)));
    out.addPage(page);
  });
  return out;
}

/** A4 에 맞추기: 원본 쪽을 그림처럼 넣고(embedPages, 원본마다 한 번) 돌린 각까지 반영해 가운데에 */
async function buildFitted(out: PDFDocument, pages: PdfComposePage[], src: ReturnType<typeof sources>, order: Map<string, number[]>): Promise<PDFDocument> {
  const embedded = new Map<string, PDFEmbeddedPage[]>();
  for (const [path, idx] of order) {
    const doc = await src.open(path);
    const pgs = idx.map((i) => doc.getPage(i));
    const boxes = pgs.map((pg) => { const c = pg.getCropBox(); return { left: c.x, bottom: c.y, right: c.x + c.width, top: c.y + c.height }; });
    embedded.set(path, await out.embedPages(pgs, boxes));
  }
  for (const it of pages) {
    if ('blank' in it) {
      out.addPage(it.blank.width > it.blank.height ? [A4.h, A4.w] : [A4.w, A4.h]);
      continue;
    }
    const doc = await src.open(it.path);
    const emb = embedded.get(it.path)!.shift()!;
    const r = norm(doc.getPage(it.page - 1).getRotation().angle + (it.rotate ?? 0));
    const { width: w, height: h } = emb;
    const [sw, sh] = r % 180 ? [h, w] : [w, h];
    const [pw, ph] = sw > sh ? [A4.h, A4.w] : [A4.w, A4.h];
    const s = Math.min(pw / sw, ph / sh);
    const ox = (pw - sw * s) / 2;
    const oy = (ph - sh * s) / 2;
    // 쪽의 /Rotate 는 시계 방향: 그림을 -r 만큼 돌리고 돌린 뒤 왼쪽 아래가 (ox, oy) 에 오게
    const [x, y] = r === 0 ? [ox, oy] : r === 90 ? [ox, oy + w * s] : r === 180 ? [ox + w * s, oy + h * s] : [ox + h * s, oy];
    out.addPage([pw, ph]).drawPage(emb, { x, y, xScale: s, yScale: s, rotate: degrees(-r) });
  }
  return out;
}

export async function pdfCompose(p: PdfComposeParams, signal: AbortSignal): Promise<PdfComposeResult> {
  if (!p.outputs.length || p.outputs.some((o) => !o.pages.length)) throw new Error('저장할 쪽이 없습니다. 쪽을 하나 이상 남기세요.');
  const src = sources();
  const dir = p.output_dir ? outputDir({ output_dir: p.output_dir }) : undefined;
  const results: PdfComposeResult['outputs'] = [];
  for (const [i, o] of p.outputs.entries()) {
    signal.throwIfAborted();
    if (p.outputs.length > 1) sendProgress({ current: i + 1, total: p.outputs.length, message: `PDF 만드는 중 (${i + 1}/${p.outputs.length})` });
    const out = await buildPdf(o.pages, src, p.fit_a4);
    if (p.watermark?.trim() || p.page_numbers) await stampPdf(out, p);
    let bytes = await out.save();
    if (p.shrink) {
      const r = await shrinkImages(bytes, p.shrink, signal);
      if (r.bytes.length < bytes.length) bytes = r.bytes;
    }
    const name = `${safeFileName(o.name?.replace(/\.pdf$/i, '') ?? '', p.source ? stemOf(p.source) : 'PDF')}.pdf`;
    // 앞 결과를 이미 써 두었으니 같은 이름은 outputFile 이 (2) 로 피한다
    const path = o.output_path
      ? outputFile({ output_path: o.output_path, name, overwrite: p.overwrite })
      : outputFile({ output_dir: dir, source: p.source, name });
    await writeFile(path, bytes);
    results.push({ output_path: path, page_count: out.getPageCount(), bytes: bytes.length });
  }
  return { outputs: results, secured: src.secured };
}

// ── 쪽을 그림 파일로 ──

/** path(+pages) 의 쪽, 또는 items(PDF 작업 화면의 쪽 차례·돌린 각) 를 그림 파일로. 이름·기본 폴더는 source(없으면 path) */
export async function pdfToImages(
  p: { path?: string; pages?: string; items?: PdfComposePage[]; format?: 'png' | 'jpg'; dpi?: number; output_dir?: string; source?: string },
  signal?: AbortSignal,
): Promise<{ output_dir: string; files: string[] }> {
  const original = p.source ?? p.path;
  if (!original) throw new Error('그림으로 바꿀 문서를 고르세요.');
  let bytes: Uint8Array;
  if (p.items?.length) bytes = await (await buildPdf(p.items, sources())).save();
  else if (p.path) bytes = new Uint8Array(await readFile(formatOf(p.path) === 'pdf' ? p.path : await convertedPdf(p.path, signal)));
  else throw new Error('그림으로 바꿀 쪽이 없습니다.');
  const doc = await openPdf(bytes).catch((err: unknown) => {
    if (err instanceof Error && /암호/.test(err.message)) throw new Error('열기 암호가 걸린 PDF는 그림으로 바꿀 수 없습니다. 암호를 푼 사본을 저장해 다시 해 보세요.');
    throw err;
  });
  try {
    const count = doc.getPageCount();
    const wanted = p.pages?.trim() && !p.items?.length ? parsePageSpec(p.pages, count) : Array.from({ length: count }, (_, i) => i + 1);
    if (!wanted.length) throw new Error(`고른 쪽이 문서에 없습니다. 이 문서는 ${count}쪽입니다.`);
    const dpi = Math.min(Math.max(p.dpi ?? 150, 72), 300);
    const jpg = p.format === 'jpg';
    const stem = stemOf(original);
    const dir = uniquePath(join(p.output_dir ? outputDir({ output_dir: p.output_dir }) : outputDir({ source: original }), safeFileName(`${stem}_그림`)));
    mkdirSync(dir, { recursive: true });
    const digits = Math.max(2, String(count).length);
    const files: string[] = [];
    for (const [i, n] of wanted.entries()) {
      signal?.throwIfAborted();
      sendProgress({ current: i + 1, total: wanted.length, message: `쪽을 그림으로 (${i + 1}/${wanted.length})` });
      const page = doc.getPage(n - 1);
      const r = await rasterPdfPage(doc, n, Math.round((page.getOriginalSize().originalWidth / 72) * dpi), jpg ? 'jpeg' : 'png', 90, page, dpi / 72);
      const file = join(dir, `${safeFileName(stem)}_${String(n).padStart(digits, '0')}.${jpg ? 'jpg' : 'png'}`);
      await writeFile(file, r.data);
      files.push(file);
    }
    return { output_dir: dir, files };
  } finally {
    doc.destroy();
  }
}
