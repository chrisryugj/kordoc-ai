/** 쪽 미리보기 (render_pages) — HWP·HWPX 는 kordoc 렌더(PNG), PDF 는 PDFium, 이미지는 그대로(크면 축소)
 *
 * 그 밖의 형식은 'NO_LAYOUT:' 으로 시작하는 오류 — 프론트는 글 보기로 바꾼다.
 * 쪽을 안 고르면 앞 5쪽, 한 번에 최대 20쪽 (data URL 크기 상한).
 */

import { readFile } from 'node:fs/promises';
import { renderDocument } from 'kordoc';
import type { PagePreview } from '../../types/rpc-contract.js';
import { logger } from '../../infra/logger.js';
import { formatOf } from '../files/format.js';
import { openPdf, rasterPdfPage } from './pdfium.js';

const DEFAULT_PAGES = 5;
const MAX_PAGES = 20;

/** "1-3,5" · "7-"(끝까지, max 필요) → 1-based 쪽 번호 오름차순 */
export function parsePageSpec(spec: string | undefined, max?: number): number[] {
  if (!spec?.trim()) return [];
  const out = new Set<number>();
  for (const part of spec.split(',')) {
    const m = /^\s*(\d+)\s*(-\s*(\d*))?\s*$/.exec(part);
    if (!m) continue;
    const a = Number(m[1]);
    const b = m[2] ? (m[3] ? Number(m[3]) : (max ?? a)) : a;
    const end = Math.min(b, max ?? b, a + 10_000);
    for (let n = Math.max(1, a); n <= end; n++) out.add(n);
  }
  return [...out].sort((x, y) => x - y);
}

const dataUrl = (mime: string, buf: Buffer) => `data:${mime};base64,${buf.toString('base64')}`;
const pt = (v: number) => Math.round(v * 100) / 100;

export async function renderPages(
  p: { path: string; pages?: string; max_width?: number; password?: string },
  signal?: AbortSignal,
): Promise<{ page_count: number; pages: PagePreview[] }> {
  const fmt = formatOf(p.path);
  const maxW = Math.round(Math.min(Math.max(p.max_width ?? 1000, 200), 2400));
  if (fmt === 'hwp' || fmt === 'hwpx') return renderHangul(p.path, p.pages, maxW, p.password, signal);
  if (fmt === 'pdf') return renderPdf(p.path, p.pages, maxW, p.password, signal);
  if (fmt === 'image') return renderImage(p.path, maxW);
  throw new Error('NO_LAYOUT: 이 형식은 쪽 모양 미리보기가 없습니다. 글 보기로 확인하세요.');
}

async function renderHangul(path: string, spec: string | undefined, maxW: number, password: string | undefined, signal?: AbortSignal) {
  const wanted = parsePageSpec(spec);
  if (spec?.trim() && !wanted.length) throw new Error('쪽 번호를 "1-3,5"처럼 적으세요.');
  const buf = await readFile(path);
  const r = await renderDocument(buf, {
    format: 'png',
    pages: wanted.length ? wanted.slice(0, MAX_PAGES).join(',') : `1-${DEFAULT_PAGES}`,
    maxWidthPx: maxW,
    password,
  }).catch((err: unknown) => {
    // kordoc 렌더(4.21.18)는 암호 HWPX 를 풀지 못하고 영어 XML 오류를 낸다. 화면은 NO_LAYOUT 을 보고 글 보기로 넘어간다
    logger.warn(`[render_pages] kordoc 렌더 실패: ${err instanceof Error ? err.message : String(err)}`);
    throw new Error(`NO_LAYOUT: ${password ? '암호가 걸린 문서는' : '이 문서는'} 쪽 모양 미리보기를 만들지 못했습니다. 글 보기로 확인하세요.`);
  });
  signal?.throwIfAborted();
  const pages: PagePreview[] = [];
  for (const a of r.assets) {
    if (!a.page || !Buffer.isBuffer(a.data)) continue;
    const size = r.scene.pages.find((sp) => sp.page === a.page);
    pages.push({ page: a.page, width: pt(size?.width ?? 0), height: pt(size?.height ?? 0), data_url: dataUrl('image/png', a.data) });
  }
  return { page_count: r.scene.pages.length, pages };
}

async function renderPdf(path: string, spec: string | undefined, maxW: number, password: string | undefined, signal?: AbortSignal) {
  const doc = await openPdf(new Uint8Array(await readFile(path)), password);
  try {
    const count = doc.getPageCount();
    const wanted = spec?.trim() ? parsePageSpec(spec, count) : Array.from({ length: Math.min(DEFAULT_PAGES, count) }, (_, i) => i + 1);
    if (!wanted.length) throw new Error(`고른 쪽이 문서에 없습니다. 이 문서는 ${count}쪽입니다.`);
    const pages: PagePreview[] = [];
    for (const n of wanted.slice(0, MAX_PAGES)) {
      signal?.throwIfAborted();
      const r = await rasterPdfPage(doc, n, maxW);
      pages.push({ page: n, width: pt(r.width), height: pt(r.height), data_url: dataUrl('image/png', r.data) });
    }
    return { page_count: count, pages };
  } finally {
    doc.destroy();
  }
}

/** 이미지 — width·height 는 원본 픽셀 */
async function renderImage(path: string, maxW: number) {
  const sharp = (await import('sharp')).default;
  const buf = await readFile(path);
  const meta = await sharp(buf).metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  const mime = meta.format === 'jpeg' ? 'image/jpeg' : meta.format === 'png' ? 'image/png' : meta.format === 'webp' ? 'image/webp' : '';
  const fits = mime && w <= maxW && (meta.orientation ?? 1) === 1;
  const data = fits ? buf : await sharp(buf).rotate().resize({ width: maxW, withoutEnlargement: true }).png().toBuffer();
  return { page_count: 1, pages: [{ page: 1, width: w, height: h, data_url: dataUrl(fits ? mime : 'image/png', data) }] };
}
