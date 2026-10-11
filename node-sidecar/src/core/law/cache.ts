/** 법제처 조회 캐시 — 메모리 + 앱 데이터 폴더 law-cache.json (24시간)
 *
 * 같은 법령을 문서마다 다시 묻지 않는다. MST(법령일련번호)는 개정마다 바뀌어 오래 두지 않는다.
 * 실패한 조회는 담지 않는다(다음 확인 때 다시 묻는다).
 */

import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { dataDir } from '../../infra/config.js';
import { logger } from '../../infra/logger.js';

const TTL_MS = 24 * 60 * 60 * 1000;
/** 조문 목록은 큰 법령이 수십 KB 라 파일이 끝없이 커지지 않게 */
const MAX_ENTRIES = 300;

interface Entry {
  at: number;
  v: unknown;
}

let mem: Map<string, Entry> | null = null;
let dirty = false;

const file = () => join(dataDir(), 'law-cache.json');
const fresh = (e: Entry | undefined): e is Entry => !!e && typeof e.at === 'number' && Date.now() - e.at < TTL_MS;

function load(): Map<string, Entry> {
  if (mem) return mem;
  mem = new Map();
  try {
    if (existsSync(file())) {
      const j = JSON.parse(readFileSync(file(), 'utf-8')) as { version?: number; entries?: Record<string, Entry> };
      if (j.version === 1 && j.entries) for (const [k, e] of Object.entries(j.entries)) if (fresh(e)) mem.set(k, e);
    }
  } catch (err) {
    logger.warn(`[law] 캐시 파일을 못 읽어 새로 시작: ${err}`);
  }
  return mem;
}

export function cacheGet<T>(key: string): T | undefined {
  const m = load();
  const e = m.get(key);
  if (fresh(e)) return e.v as T;
  if (e) m.delete(key);
  return undefined;
}

export function cacheSet(key: string, v: unknown): void {
  const m = load();
  m.delete(key);
  m.set(key, { at: Date.now(), v });
  while (m.size > MAX_ENTRIES) m.delete(m.keys().next().value as string);
  dirty = true;
}

/** 바뀐 것이 있으면 파일로 (원자적 쓰기) */
export async function cacheSave(): Promise<void> {
  if (!dirty || !mem) return;
  dirty = false;
  try {
    mkdirSync(dataDir(), { recursive: true });
    const tmp = `${file()}.tmp`;
    await writeFile(tmp, JSON.stringify({ version: 1, entries: Object.fromEntries(mem) }), 'utf-8');
    await rename(tmp, file());
  } catch (err) {
    logger.warn(`[law] 캐시를 저장하지 못했습니다: ${err}`);
  }
}
