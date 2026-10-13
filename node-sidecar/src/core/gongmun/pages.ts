/** 글 → 쪽 찾기 (find_pages·결재 전 점검) — 화면 미리보기와 같은 조판으로 쪽마다 글을 뽑아 둔다
 *
 * HWP·HWPX: rhwp 쪽 SVG 의 글(작업대 미리보기가 rhwp 로 그린다), PDF: PDFium 쪽 글. 그 밖 형식은 쪽이 없다.
 * 띄어쓰기·줄바꿈은 조판마다 달라 빼고 비교한다. (경로·수정 시각·크기) 로 캐시.
 */

import { readFile, stat } from 'node:fs/promises';
import { formatOf } from '../files/format.js';
import { RHWP_MAX_PAGES, rhwpPages, tooBigForRhwp } from '../render/rhwp.js';
import { openPdf } from '../render/pdfium.js';

const squash = (s: string) => s.replace(/\\([\\`*_{}[\]()#+\-.!~$>|])/g, '$1').replace(/\*\*/g, '').replace(/[\s 　]+/g, '');
const decode = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, '&');

const cache = new Map<string, Promise<string[] | null>>();

async function load(path: string, signal?: AbortSignal): Promise<string[] | null> {
  const fmt = formatOf(path);
  const bytes = new Uint8Array(await readFile(path));
  if (fmt === 'hwp' || fmt === 'hwpx') {
    if (await tooBigForRhwp(bytes)) return null;
    const out: string[] = [];
    for await (const p of rhwpPages(bytes, undefined, signal)) {
      out.push(squash(decode([...p.svg.matchAll(/<text\b[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]).join(''))));
      if (out.length >= RHWP_MAX_PAGES) break;
    }
    return out;
  }
  if (fmt === 'pdf') {
    const doc = await openPdf(bytes);
    try {
      const out: string[] = [];
      for (let i = 0; i < doc.getPageCount(); i++) out.push(squash(doc.getPage(i).getText()));
      return out;
    } finally {
      doc.destroy();
    }
  }
  return null;
}

/** 쪽마다 띄어쓰기를 뺀 글 (쪽이 없는 형식·너무 큰 문서는 null) */
export async function pageTexts(path: string, signal?: AbortSignal): Promise<string[] | null> {
  const st = await stat(path);
  const key = `${path}|${st.mtimeMs}|${st.size}`;
  let hit = cache.get(key);
  if (!hit) {
    hit = load(path, signal).catch(() => null);
    cache.set(key, hit);
    if (cache.size > 6) cache.delete(cache.keys().next().value!);
  }
  return hit;
}

/** 글이 처음 나오는 쪽 (1부터). 긴 글은 앞 40자로, 너무 짧은 글(2자 이하)은 찾지 않는다 */
export function findPage(pages: string[] | null, text: string | undefined): number | undefined {
  if (!pages || !text) return undefined;
  const needle = squash(text).slice(0, 40);
  if (needle.length < 3) return undefined;
  const i = pages.findIndex((p) => p.includes(needle));
  return i >= 0 ? i + 1 : undefined;
}

export async function findPages(p: { path: string; texts: string[] }, signal?: AbortSignal): Promise<{ pages: Array<number | null> }> {
  const pages = await pageTexts(p.path, signal);
  return { pages: p.texts.map((t) => findPage(pages, t) ?? null) };
}
