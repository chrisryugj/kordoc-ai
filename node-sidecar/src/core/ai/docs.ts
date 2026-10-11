/** AI 가 읽을 문서 — kordoc 파싱(경로+수정시각 LRU 캐시) → 쪽·제목이 붙은 조각(passage) → 예산 안에서 고르기 */

import { readFile, stat } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { blocksToChunks, type ParseOptions } from 'kordoc';
import { getSettings } from '../../infra/config.js';
import { sendProgress } from '../../infra/progress.js';
import { decodeText, parseBytes } from '../converter/index.js';
import { bm25Scores } from './bm25.js';

export interface Passage {
  path: string;
  name: string;
  page?: number;
  /** 상위 제목 경로 (예: "Ⅱ. 추진 계획 > 1. 일정") */
  heading?: string;
  text: string;
}

export interface LoadedDoc {
  path: string;
  name: string;
  /** kordoc 마크다운 그대로 (표기법 검사용) */
  markdown: string;
  /** AI 에 넣을 글 — 마크다운 이스케이프(\~ \* \$ 등)를 푼 것. 그대로 넣으면 모델이 "14:00\~17:00" 처럼 옮겨 쓴다 */
  text: string;
  passages: Passage[];
  pageCount?: number;
  /** HWP·PDF 등을 파싱한 글 (md·txt 원고가 아님) — 표기법 검사 모드가 다르다 */
  parsed: boolean;
}

const TEXT_EXT = new Set(['.md', '.markdown', '.txt', '.csv']);
/** 조각 크기 — 검색 단위. 너무 작으면 문맥이 끊기고 크면 예산을 헤프게 쓴다 */
const PASSAGE_CHARS = 700;
const PASSAGE_MAX = 1400;

const cache = new Map<string, LoadedDoc>();
const CACHE_MAX = 6;

function ocrOption(): ParseOptions['ocr'] {
  const mode = getSettings().convert.ocr;
  return mode === 'off' ? false : mode === 'force' ? 'force' : undefined;
}

function shortHeading(crumbs: string[]): string | undefined {
  const parts = crumbs.slice(-2).map((c) => c.replace(/\s+/g, ' ').trim()).filter(Boolean).map((c) => (c.length > 40 ? `${c.slice(0, 40)}…` : c));
  return parts.length ? parts.join(' > ') : undefined;
}

/** 큰 덩어리(긴 표·문단)는 줄 단위로 PASSAGE_MAX 이하로 */
function splitLong(text: string): string[] {
  if (text.length <= PASSAGE_MAX) return [text];
  const out: string[] = [];
  let cur = '';
  for (const line of text.split('\n')) {
    if (cur && cur.length + line.length + 1 > PASSAGE_CHARS) { out.push(cur); cur = ''; }
    if (line.length > PASSAGE_MAX) {
      for (let i = 0; i < line.length; i += PASSAGE_CHARS) out.push(line.slice(i, i + PASSAGE_CHARS));
      continue;
    }
    cur = cur ? `${cur}\n${line}` : line;
  }
  if (cur) out.push(cur);
  return out;
}

/** 마크다운 이스케이프 풀기 — 표 칸 경계(\|)는 남긴다 */
export function unescapeMd(t: string): string {
  return t.replace(/\\([\\`*_{}\[\]()#+\-.!~$>])/g, '$1');
}

const headingOnly = (t: string) => t.split('\n').every((l) => !l.trim() || /^#{1,6}\s/.test(l));

/** 같은 제목·쪽 아래 이어지는 작은 조각을 PASSAGE_CHARS 까지 합침. 제목만 있는 조각은 다음 조각에 붙인다 */
function mergePieces(pieces: Array<{ text: string; page?: number; heading?: string }>, path: string, name: string): Passage[] {
  const out: Passage[] = [];
  for (const p of pieces) {
    const text = unescapeMd(p.text.replace(/!\[[^\]]*\]\([^)]*\)/g, '')).trim();
    if (!text) continue;
    const prev = out.at(-1);
    const lone = prev ? headingOnly(prev.text) : false;
    if (prev && (prev.heading === p.heading || lone) && prev.page === p.page && prev.text.length + text.length + 1 <= PASSAGE_CHARS) {
      prev.text = `${prev.text}\n${text}`;
      if (lone) prev.heading = p.heading;
      continue;
    }
    for (const part of splitLong(text)) out.push({ path, name, page: p.page, heading: p.heading, text: part });
  }
  return out;
}

/** md·txt — # 제목을 따라가며 빈 줄 단위 문단으로 */
function textPieces(markdown: string): Array<{ text: string; heading?: string }> {
  const pieces: Array<{ text: string; heading?: string }> = [];
  const stack: string[] = [];
  for (const para of markdown.split(/\n\s*\n/)) {
    const h = para.match(/^(#{1,6})\s+(.+)$/m);
    if (h && para.trim().startsWith('#')) {
      stack.length = Math.min(stack.length, h[1].length - 1);
      stack[h[1].length - 1] = h[2].trim();
    }
    pieces.push({ text: para, heading: shortHeading(stack.filter(Boolean)) });
  }
  return pieces;
}

async function readDoc(path: string, signal: AbortSignal): Promise<LoadedDoc> {
  const name = basename(path);
  if (TEXT_EXT.has(extname(path).toLowerCase())) {
    const markdown = decodeText(await readFile(path));
    return { path, name, markdown, text: markdown, passages: mergePieces(textPieces(markdown), path, name), parsed: false };
  }
  const buf = await readFile(path);
  signal.throwIfAborted();
  const r = await parseBytes(buf, { images: false, tableFormat: 'gfm', ocr: ocrOption() }, undefined, signal);
  if (!r.success) {
    if (r.code === 'ENCRYPTED') throw new Error(`암호가 걸린 문서입니다: ${name}. 문서 메뉴에서 암호를 넣어 변환한 뒤 그 결과(.md)로 다시 시도하세요.`);
    if (r.code === 'DRM_PROTECTED') throw new Error(`문서 보안(DRM)이 걸려 읽을 수 없습니다: ${name}. 보안을 해제한 사본으로 시도하세요.`);
    throw new Error(`문서를 읽지 못했습니다: ${name} (${r.error})`);
  }
  const chunks = blocksToChunks(r.blocks, { granularity: 'block', tableFormat: 'gfm' });
  const pieces = chunks.map((c) => ({ text: c.text, page: c.page, heading: shortHeading(c.type === 'heading' ? c.breadcrumb.concat(c.text.replace(/^#+\s*/, '')) : c.breadcrumb) }));
  return { path, name, markdown: r.markdown, text: unescapeMd(r.markdown), passages: mergePieces(pieces, path, name), pageCount: r.pageCount, parsed: true };
}

/** 문서 하나 — 같은 파일(경로·수정시각·크기)이면 다시 파싱하지 않는다 */
export async function loadDoc(path: string, signal: AbortSignal): Promise<LoadedDoc> {
  const st = await stat(path).catch(() => null);
  if (!st?.isFile()) throw new Error(`파일을 찾을 수 없습니다: ${basename(path)}`);
  const key = `${path}|${st.mtimeMs}|${st.size}`;
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const doc = await readDoc(path, signal);
  if (!doc.markdown.trim()) {
    throw new Error(`문서에서 글자를 찾지 못했습니다: ${doc.name}. 스캔 문서라면 설정에서 OCR을 켜고 다시 시도하세요.`);
  }
  cache.set(key, doc);
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
  return doc;
}

export async function loadDocs(paths: string[], signal: AbortSignal): Promise<LoadedDoc[]> {
  const docs: LoadedDoc[] = [];
  for (let i = 0; i < paths.length; i++) {
    signal.throwIfAborted();
    sendProgress({ current: i, total: paths.length, message: `문서 읽는 중 (${i + 1}/${paths.length})` });
    docs.push(await loadDoc(paths[i], signal));
  }
  return docs;
}

/** 예산 안에 다 들어가면 전부, 넘치면 질의와 가까운 조각부터 채운다. 돌려줄 때는 원래 순서대로 */
export function selectPassages(passages: Passage[], query: string, budgetChars: number): { selected: Passage[]; whole: boolean } {
  const cost = (p: Passage) => p.text.length + (p.heading?.length ?? 0) + 30;
  const total = passages.reduce((s, p) => s + cost(p), 0);
  if (total <= budgetChars) return { selected: passages, whole: true };
  const scores = bm25Scores(passages.map((p) => `${p.heading ?? ''}\n${p.text}`), query);
  const order = passages.map((_, i) => i).sort((a, b) => scores[b] - scores[a] || a - b);
  const keep = new Set<number>();
  let used = 0;
  for (const i of order) {
    const c = cost(passages[i]);
    if (used + c > budgetChars) continue;
    keep.add(i);
    used += c;
  }
  // 예산이 조각 하나보다도 작으면 가장 가까운 조각을 잘라서라도 넣는다
  if (!keep.size && passages.length) {
    const best = passages[order[0]];
    return { selected: [{ ...best, text: best.text.slice(0, Math.max(200, budgetChars - 100)) }], whole: false };
  }
  return { selected: passages.filter((_, i) => keep.has(i)), whole: false };
}

/** 조각 머리표 — "[3] (계획서.hwpx · 2쪽 · Ⅱ. 추진 계획)" */
export function passageLabel(p: Passage, n: number): string {
  const meta = [p.name, p.page ? `${p.page}쪽` : '', p.heading ?? ''].filter(Boolean).join(' · ');
  return `[${n}] (${meta})`;
}

const SPLITTERS = [/(\n[ \t]*\n\s*)/, /(\n)/, /(?<=[^\d\s][.!?。])(\s+)/, /(\s+)/];

/** 예산 이하 조각으로 — 빈 줄 → 줄바꿈 → 문장 끝 → 빈칸 순으로 자르고, 그래도 길면 글자 수로.
 *  sep = 원문에서 그 조각 뒤에 있던 구분자 (조각마다 text + sep 를 이으면 원문이 된다) */
export function chunkText(text: string, budget: number, level = 0): Array<{ text: string; sep: string }> {
  if (text.length <= budget) return [{ text, sep: '' }];
  if (level >= SPLITTERS.length) {
    const out: Array<{ text: string; sep: string }> = [];
    for (let i = 0; i < text.length; i += budget) out.push({ text: text.slice(i, i + budget), sep: '' });
    return out;
  }
  const parts = text.split(SPLITTERS[level]);
  const out: Array<{ text: string; sep: string }> = [];
  let cur = '';
  let curSep = '';
  const flush = () => {
    if (cur) out.push({ text: cur, sep: curSep });
    cur = '';
    curSep = '';
  };
  for (let i = 0; i < parts.length; i += 2) {
    const seg = parts[i];
    const sep = parts[i + 1] ?? '';
    if (seg.length > budget) {
      flush();
      const sub = chunkText(seg, budget, level + 1);
      sub[sub.length - 1].sep = sep;
      out.push(...sub);
      continue;
    }
    if (cur && cur.length + curSep.length + seg.length > budget) flush();
    cur = cur ? cur + curSep + seg : seg;
    curSep = sep;
  }
  flush();
  return out;
}

/** 예산 이하 조각들 (구분자 없이) */
export function splitByBudget(text: string, budget: number): string[] {
  return chunkText(text, budget).map((c) => c.text);
}
