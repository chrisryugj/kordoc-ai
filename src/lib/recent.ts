/** 최근 문서 — 이 PC 화면 편의용 기록 (브라우저 저장소, 없어도 동작) */

import type { DocFormat } from "./contract";

export interface RecentDoc {
  path: string;
  name: string;
  format: DocFormat;
  at: number;
}

const KEY = "kordoc-recent";
const MAX = 12;

export function loadRecent(): RecentDoc[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as RecentDoc[]) : [];
    return Array.isArray(list) ? list.slice(0, MAX) : [];
  } catch {
    return [];
  }
}

export function saveRecent(list: RecentDoc[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
  } catch {
    /* 저장소를 못 쓰면 이번 실행 동안만 기억 */
  }
}

export function pushRecent(list: RecentDoc[], docs: RecentDoc[]): RecentDoc[] {
  const paths = new Set(docs.map((d) => d.path));
  return [...docs, ...list.filter((d) => !paths.has(d.path))].slice(0, MAX);
}

/** 화면 기본값 같은 작은 기록용 */
export function readPref<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function writePref(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* 무시 */
  }
}
