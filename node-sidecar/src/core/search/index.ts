/** 여러 문서에서 낱말 찾기 (search_files) — 파싱 결과를 (수정 시각·크기)로 캐시
 *
 * 띄어쓰기·영문 대소문자를 가리지 않는다 ("추진계획" 으로 "추진 계획" 도 찾음). 폴더를 주면 안의 문서까지.
 */

import { stat } from 'node:fs/promises';
import { basename } from 'node:path';
import { sendProgress } from '../../infra/progress.js';
import { parseDoc } from '../converter/index.js';
import { scanPaths } from '../files/index.js';

interface Entry { key: string; chunks: Array<{ page?: number; text: string }>; chars: number }

const cache = new Map<string, Entry>();
let cachedChars = 0;
const MAX_CHARS = 80_000_000;
const MAX_ENTRIES = 500;

async function textOf(path: string, signal?: AbortSignal): Promise<Entry> {
  const st = await stat(path);
  const key = `${st.mtimeMs}|${st.size}`;
  const hit = cache.get(path);
  if (hit) {
    cache.delete(path);
    if (hit.key === key) {
      cache.set(path, hit);
      return hit;
    }
    cachedChars -= hit.chars;
  }
  const r = await parseDoc(path, { images: false, ocr: 'off', signal });
  const chunks = r.pages?.length ? r.pages.map((pg) => ({ page: pg.pageNumber, text: pg.markdown })) : [{ text: r.markdown }];
  const entry: Entry = { key, chunks, chars: chunks.reduce((n, c) => n + c.text.length, 0) };
  cache.set(path, entry);
  cachedChars += entry.chars;
  while ((cachedChars > MAX_CHARS || cache.size > MAX_ENTRIES) && cache.size > 1) {
    const [oldKey, old] = cache.entries().next().value!;
    cache.delete(oldKey);
    cachedChars -= old.chars;
  }
  return entry;
}

const isSpace = (ch: string) => /\s/.test(ch);
const fold = (ch: string) => (ch >= 'A' && ch <= 'Z' ? ch.toLowerCase() : ch);

function excerpt(text: string, start: number, end: number): string {
  const a = Math.max(0, start - 40);
  const b = Math.min(text.length, end + 40);
  return `${a > 0 ? '…' : ''}${text.slice(a, b).replace(/\s+/g, ' ').trim()}${b < text.length ? '…' : ''}`;
}

/** 공백을 뺀 글에서 찾고 원래 위치로 되돌려 앞뒤 문맥을 붙인다 */
export function findHits(chunks: Entry['chunks'], query: string, max: number): Array<{ page?: number; excerpt: string }> {
  const q = [...query].filter((ch) => !isSpace(ch)).map(fold).join('');
  const hits: Array<{ page?: number; excerpt: string }> = [];
  if (!q) return hits;
  for (const c of chunks) {
    let compact = '';
    const pos: number[] = [];
    for (let i = 0; i < c.text.length; i++) {
      const ch = c.text[i];
      if (isSpace(ch)) continue;
      compact += fold(ch);
      pos.push(i);
    }
    for (let at = compact.indexOf(q); at >= 0 && hits.length < max; at = compact.indexOf(q, at + q.length)) {
      hits.push({ ...(c.page ? { page: c.page } : {}), excerpt: excerpt(c.text, pos[at], pos[at + q.length - 1] + 1) });
    }
    if (hits.length >= max) break;
  }
  return hits;
}

export async function searchFiles(
  p: { paths: string[]; query: string; max_hits?: number },
  signal: AbortSignal,
): Promise<{ results: Array<{ path: string; hits: Array<{ page?: number; excerpt: string }> }>; searched: number; failed: number }> {
  if (!p.query?.trim()) throw new Error('찾을 낱말을 적으세요.');
  const max = Math.min(Math.max(p.max_hits ?? 20, 1), 200);
  const { files } = await scanPaths(p.paths);
  const results: Array<{ path: string; hits: Array<{ page?: number; excerpt: string }> }> = [];
  let searched = 0;
  let failed = 0;
  for (const [i, f] of files.entries()) {
    signal.throwIfAborted();
    sendProgress({ current: i + 1, total: files.length, message: `${basename(f.path)} 찾는 중 (${i + 1}/${files.length})` });
    try {
      const hits = findHits((await textOf(f.path, signal)).chunks, p.query, max);
      searched++;
      if (hits.length) results.push({ path: f.path, hits });
    } catch (err) {
      if (signal.aborted) throw err;
      failed++;
    }
  }
  return { results, searched, failed };
}
