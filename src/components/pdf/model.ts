/**
 * PDF 작업 화면 상태: 넣은 파일, 쪽 줄(차례·더 돌린 각·빈 쪽), 나눌 자리, 고른 쪽, 저장 계획.
 * 바꾸는 함수는 모두 새 Board 를 돌려준다 (되돌리기는 Board 를 쌓기만 하면 된다). 화면 없이 시험한다 (model.test.ts)
 */

import type { PdfComposePage, PdfComposeParams } from "../../lib/contract";
import { stem, toRanges } from "../../lib/format";

export interface PdfFile {
  id: string;
  /** 사용자가 넣은 파일 */
  path: string;
  name: string;
  /** 쪽 그림·조립에 쓸 PDF (PDF 가 아니면 엔진이 바꾼 임시 PDF) */
  source: string;
  converted: boolean;
  secured: boolean;
  /** 보이는 방향 기준 쪽 크기(pt) */
  sizes: Array<{ width: number; height: number }>;
  /** 파일 표시 색 차례 (PALETTE) */
  color: number;
}

export interface PageItem {
  key: string;
  /** PdfFile.id, 빈 쪽은 "" */
  file: string;
  /** 원본 쪽 번호 (1부터), 빈 쪽은 0 */
  page: number;
  /** 원본에서 더 돌린 각 (0·90·180·270) */
  rotate: number;
  blank?: { width: number; height: number };
}

export interface Board {
  files: PdfFile[];
  items: PageItem[];
  /** 이 쪽 앞에서 나눈다 (쪽 key) */
  cuts: string[];
}

export const EMPTY: Board = { files: [], items: [], cuts: [] };
export const PALETTE = 6;

let seq = 0;
const newKey = () => `p${++seq}`;
const norm = (deg: number) => (((Math.round(deg / 90) * 90) % 360) + 360) % 360;

export function fileOf(b: Board, it: PageItem): PdfFile | undefined {
  return b.files.find((f) => f.id === it.file);
}

/** 보이는 방향 크기 (돌린 각까지) */
export function shownSize(b: Board, it: PageItem): { width: number; height: number } {
  const base = it.blank ?? fileOf(b, it)?.sizes[it.page - 1] ?? { width: 595.28, height: 841.89 };
  return it.rotate % 180 ? { width: base.height, height: base.width } : base;
}

/** 파일을 넣는다 (at: 그 자리 앞에, 없으면 끝에). 쪽은 원래 차례대로 */
export function addFile(b: Board, f: Omit<PdfFile, "id" | "color">, at?: number): Board {
  const used = new Set(b.files.map((x) => x.color));
  const color = [...Array(PALETTE).keys()].find((c) => !used.has(c)) ?? b.files.length % PALETTE;
  const file: PdfFile = { ...f, id: `f${++seq}`, color };
  const pages: PageItem[] = f.sizes.map((_, i) => ({ key: newKey(), file: file.id, page: i + 1, rotate: 0 }));
  const items = [...b.items];
  items.splice(at ?? items.length, 0, ...pages);
  return { ...b, files: [...b.files, file], items };
}

/** 파일과 그 쪽을 모두 뺀다 */
export function removeFile(b: Board, id: string): Board {
  const gone = new Set(b.items.filter((it) => it.file === id).map((it) => it.key));
  return { ...dropKeys(b, gone), files: b.files.filter((f) => f.id !== id) };
}

export function rotate(b: Board, keys: Set<string>, delta: number): Board {
  if (!keys.size) return b;
  return { ...b, items: b.items.map((it) => (keys.has(it.key) ? { ...it, rotate: norm(it.rotate + delta) } : it)) };
}

/** 쪽을 지운다. 지운 쪽 앞의 나눌 자리는 다음 남은 쪽으로 옮긴다 */
export function remove(b: Board, keys: Set<string>): Board {
  return b.items.some((it) => keys.has(it.key)) ? dropKeys(b, keys) : b;
}

function dropKeys(b: Board, gone: Set<string>): Board {
  const cuts = new Set<string>();
  let carry = false;
  for (const it of b.items) {
    const cut = b.cuts.includes(it.key);
    if (gone.has(it.key)) { carry ||= cut; continue; }
    if (cut || carry) cuts.add(it.key);
    carry = false;
  }
  const items = b.items.filter((it) => !gone.has(it.key));
  // 맨 앞 쪽 앞에서 나누는 것은 뜻이 없다
  if (items[0]) cuts.delete(items[0].key);
  return { ...b, items, cuts: items.filter((it) => cuts.has(it.key)).map((it) => it.key) };
}

/** 고른 쪽을 to 자리(지금 줄 기준, 그 쪽 앞. 끝은 items.length)로 옮긴다. 고른 쪽끼리의 차례는 그대로 */
export function move(b: Board, keys: Set<string>, to: number): Board {
  if (!keys.size) return b;
  const moving = b.items.filter((it) => keys.has(it.key));
  const before = b.items.slice(0, Math.max(0, Math.min(to, b.items.length))).filter((it) => !keys.has(it.key)).length;
  const rest = b.items.filter((it) => !keys.has(it.key));
  const items = [...rest.slice(0, before), ...moving, ...rest.slice(before)];
  if (items.every((it, i) => it === b.items[i])) return b;
  return { ...b, items, cuts: b.cuts.filter((k) => k !== items[0]?.key) };
}

/** 고른 쪽을 한 칸 앞(-1)·뒤(+1)로 */
export function nudge(b: Board, keys: Set<string>, dir: -1 | 1): Board {
  const idx = b.items.map((it, i) => (keys.has(it.key) ? i : -1)).filter((i) => i >= 0);
  if (!idx.length) return b;
  if (dir < 0) return idx[0] === 0 ? b : move(b, keys, idx[0] - 1);
  const last = idx[idx.length - 1];
  return last === b.items.length - 1 ? b : move(b, keys, last + 2);
}

/** 고른 쪽마다 바로 뒤에 같은 쪽을 하나 더 */
export function duplicate(b: Board, keys: Set<string>): Board {
  if (!keys.size) return b;
  return { ...b, items: b.items.flatMap((it) => (keys.has(it.key) ? [it, { ...it, key: newKey() }] : [it])) };
}

/** after 쪽 뒤에 빈 쪽 (크기는 그 쪽과 같게). after 가 없으면 맨 뒤에, 마지막 쪽 크기로 */
export function insertBlank(b: Board, after: string | null): Board {
  const i = after ? b.items.findIndex((it) => it.key === after) : b.items.length - 1;
  const ref = b.items[i];
  const size = ref ? shownSize(b, ref) : { width: 595.28, height: 841.89 };
  const items = [...b.items];
  items.splice(i + 1, 0, { key: newKey(), file: "", page: 0, rotate: 0, blank: { ...size } });
  return { ...b, items };
}

/** 고른 쪽들의 차례를 거꾸로 (고른 자리는 그대로) */
export function reverse(b: Board, keys: Set<string>): Board {
  const picked = b.items.filter((it) => keys.has(it.key)).reverse();
  if (picked.length < 2) return b;
  let j = 0;
  const items = b.items.map((it) => (keys.has(it.key) ? picked[j++] : it));
  return { ...b, items, cuts: b.cuts.filter((k) => k !== items[0]?.key) };
}

/** 두 파일의 쪽을 하나씩 번갈아 (양면 스캔: 앞면 파일 + 뒷면 파일. 뒷면 묶음을 뒤집어 스캔했으면 back 을 거꾸로).
 *  섞은 쪽은 두 파일 가운데 앞에 놓인 쪽 자리에, 다른 쪽은 그대로. 옮긴 쪽 앞의 나눌 자리는 푼다 */
export function interleave(b: Board, front: string, back: string, reverseBack: boolean): Board {
  const fs = b.items.filter((it) => it.file === front);
  const bs = b.items.filter((it) => it.file === back);
  if (!fs.length || !bs.length || front === back) return b;
  if (reverseBack) bs.reverse();
  const mixed: PageItem[] = [];
  for (let i = 0; i < Math.max(fs.length, bs.length); i++) {
    if (fs[i]) mixed.push(fs[i]);
    if (bs[i]) mixed.push(bs[i]);
  }
  const moved = new Set(mixed.map((it) => it.key));
  const at = b.items.findIndex((it) => moved.has(it.key));
  const rest = b.items.filter((it) => !moved.has(it.key));
  const before = b.items.slice(0, at).filter((it) => !moved.has(it.key)).length;
  const items = [...rest.slice(0, before), ...mixed, ...rest.slice(before)];
  return { ...b, items, cuts: b.cuts.filter((k) => !moved.has(k) && k !== items[0]?.key) };
}

/** key 쪽 앞에서 나누기 켜기·끄기 (맨 앞 쪽은 안 됨) */
export function toggleCut(b: Board, key: string): Board {
  if (!b.items.length || b.items[0].key === key || !b.items.some((it) => it.key === key)) return b;
  const on = b.cuts.includes(key);
  const cuts = on ? b.cuts.filter((k) => k !== key) : b.items.filter((it) => it.key === key || b.cuts.includes(it.key)).map((it) => it.key);
  return { ...b, cuts };
}

// ── 고르기 ──

export interface Selection {
  keys: Set<string>;
  /** Shift 로 늘릴 때 기준 */
  anchor: string | null;
}

export const NO_SELECTION: Selection = { keys: new Set(), anchor: null };

/** 누르기: 그냥 = 이것만, Ctrl(⌘) = 넣고 빼기, Shift = 기준부터 여기까지 */
export function clickSelect(items: PageItem[], sel: Selection, key: string, mod: { toggle?: boolean; range?: boolean }): Selection {
  if (mod.range && sel.anchor) {
    const a = items.findIndex((it) => it.key === sel.anchor);
    const z = items.findIndex((it) => it.key === key);
    if (a >= 0 && z >= 0) {
      const span = items.slice(Math.min(a, z), Math.max(a, z) + 1).map((it) => it.key);
      return { keys: new Set(mod.toggle ? [...sel.keys, ...span] : span), anchor: sel.anchor };
    }
  }
  if (mod.toggle) {
    const keys = new Set(sel.keys);
    if (keys.has(key)) keys.delete(key);
    else keys.add(key);
    return { keys, anchor: key };
  }
  return { keys: new Set([key]), anchor: key };
}

export const selectKeys = (keys: Iterable<string>, anchor: string | null = null): Selection => ({ keys: new Set(keys), anchor });

/** 지금 줄에 없는 쪽(지운 쪽)은 고른 것에서 뺀다 */
export function pruneSelection(items: PageItem[], sel: Selection): Selection {
  const live = new Set(items.map((it) => it.key));
  const keys = [...sel.keys].filter((k) => live.has(k));
  if (keys.length === sel.keys.size && (!sel.anchor || live.has(sel.anchor))) return sel;
  return { keys: new Set(keys), anchor: sel.anchor && live.has(sel.anchor) ? sel.anchor : null };
}

/** 홀수·짝수 쪽 (지금 차례 기준) */
export const oddEven = (items: PageItem[], odd: boolean) => items.filter((_, i) => (i % 2 === 0) === odd).map((it) => it.key);

export const invert = (items: PageItem[], sel: Selection) => items.filter((it) => !sel.keys.has(it.key)).map((it) => it.key);

/** "1-3,5" (지금 차례의 쪽 번호) → key. 못 읽은 조각이 있으면 null */
export function keysFromSpec(items: PageItem[], spec: string): string[] | null {
  const out = new Set<number>();
  for (const part of spec.split(",").map((s) => s.trim()).filter(Boolean)) {
    const m = /^(\d+)\s*(?:[-~]\s*(\d*))?$/.exec(part);
    if (!m) return null;
    const a = Number(m[1]);
    const z = m[2] === undefined ? a : m[2] === "" ? Math.max(a, items.length) : Number(m[2]);
    for (let n = Math.max(1, Math.min(a, z)); n <= Math.min(items.length, Math.max(a, z)); n++) out.add(n);
  }
  return [...out].sort((x, y) => x - y).map((n) => items[n - 1].key);
}

/** 고른 쪽의 지금 차례 번호 "1-3,5" */
export function positionsOf(items: PageItem[], keys: Set<string>): string {
  return toRanges(items.flatMap((it, i) => (keys.has(it.key) ? [i + 1] : [])));
}

// ── 저장 계획 ──

/** 엔진이 파일 이름을 80자에서 자른다: 뒤에 붙일 것이 남게 바탕을 줄인다 */
const clip = (base: string, room: number) => (base.length > room ? base.slice(0, room).trimEnd() : base);

/** 저장 이름 바탕: 파일 하나면 그 이름, 여럿이면 "첫 파일_외N건" */
export function baseName(b: Board): string {
  const used = b.files.filter((f) => b.items.some((it) => it.file === f.id));
  const list = used.length ? used : b.files;
  if (!list.length) return "PDF";
  const first = stem(list[0].name);
  return list.length > 1 ? `${first}_외${list.length - 1}건` : first;
}

function pagesOf(b: Board, items: PageItem[]): PdfComposePage[] {
  return items.map((it) => {
    if (it.blank) return { blank: it.blank };
    const f = fileOf(b, it)!;
    return it.rotate ? { path: f.source, page: it.page, rotate: it.rotate } : { path: f.source, page: it.page };
  });
}

type Outputs = PdfComposeParams["outputs"];

/** 한 파일로 (합치기·순서·돌리기·지우기 결과). 파일이 여럿이면 "_합본", 하나면 "_정리" */
export function planAll(b: Board, name = baseName(b) + (b.files.length > 1 ? "_합본" : "_정리")): Outputs {
  return [{ name, pages: pagesOf(b, b.items) }];
}

/** 고른 쪽만 (지금 차례대로) */
export function planSelected(b: Board, keys: Set<string>, name?: string): Outputs {
  const picked = b.items.filter((it) => keys.has(it.key));
  return [{ name: name ?? selectedName(baseName(b), b.items, keys), pages: pagesOf(b, picked) }];
}

/** "바탕_1-3,5쪽" (쪽 번호가 길면 "바탕_12쪽" 처럼 쪽 수로) */
export function selectedName(base: string, items: PageItem[], keys: Set<string>): string {
  const pos = positionsOf(items, keys);
  const tail = pos.length > 24 ? `${keys.size}쪽` : `${pos}쪽`;
  return `${clip(base, 78 - tail.length)}_${tail}`;
}

/** 나눌 자리마다 (자리가 없으면 한 파일) */
export function planCuts(b: Board, base = baseName(b)): Outputs {
  const groups: PageItem[][] = [];
  for (const it of b.items) {
    if (!groups.length || b.cuts.includes(it.key)) groups.push([]);
    groups[groups.length - 1].push(it);
  }
  return numbered(b, groups, base);
}

/** n 쪽씩 (n=1 이면 쪽마다) */
export function planEvery(b: Board, n: number, base = baseName(b)): Outputs {
  const size = Math.max(1, Math.floor(n));
  const groups: PageItem[][] = [];
  for (let i = 0; i < b.items.length; i += size) groups.push(b.items.slice(i, i + size));
  return numbered(b, groups, base);
}

function numbered(b: Board, groups: PageItem[][], base: string): Outputs {
  const digits = Math.max(2, String(groups.length).length);
  const head = clip(base, 78 - digits);
  return groups.map((g, i) => ({ name: `${head}_${String(i + 1).padStart(digits, "0")}`, pages: pagesOf(b, g) }));
}

/** 그림으로 저장할 쪽 (고른 쪽, 없으면 전부) */
export function imageItems(b: Board, keys: Set<string>): PdfComposePage[] {
  return pagesOf(b, keys.size ? b.items.filter((it) => keys.has(it.key)) : b.items);
}

// ── 빈 쪽 찾기 ──

/** 쪽 그림의 밝기(0~255) 표본 → 거의 빈 쪽인가. 바탕(밝은 쪽 90번째 백분위)이 밝고(160 넘음, 회색 스캔 종이까지),
 *  그보다 48 넘게 어두운 점이 0.4% 안이면 빈 쪽. 어두운 바탕(표지·간지)은 빈 쪽이 아니다 */
export function looksBlank(luma: ArrayLike<number>): boolean {
  if (!luma.length) return false;
  const sorted = Array.from(luma).sort((a, b) => a - b);
  const paper = sorted[Math.floor(sorted.length * 0.9)];
  if (paper < 160) return false;
  let ink = 0;
  for (let i = 0; i < sorted.length && sorted[i] < paper - 48; i++) ink++;
  return ink / sorted.length < 0.004;
}
