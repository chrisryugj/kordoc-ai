/** 폴더 감시 (watch_start·watch_stop·watch_list) — 새로 들어오거나 바뀐 문서를 자동 변환
 *
 * fs.watch(하위 폴더 포함) + 파일별 디바운스(쓰기가 끝나 크기가 멈출 때까지) + 감시마다 한 번에 하나씩 변환.
 * fs.watch 는 바쁠 때 이벤트를 놓치고 공유 폴더(SMB·NAS)에서는 아예 안 오기도 해서, 시작할 때 문서 목록을 기준으로 잡고
 * 주기적으로 다시 훑어 새로 생기거나 바뀐 문서를 보충한다 (훑는 데 오래 걸리면 간격을 늘림).
 * 결과는 out_dir 에 하위 폴더 구조 그대로, 같은 원본의 결과는 덮어쓴다 (감시 폴더의 거울 — 출력 규칙의 예외).
 * 알림 `watch_event` { id, path, ok, output_path?, error? }. 앱이 끝날 때 전부 닫는다.
 */

import { watch, type FSWatcher } from 'node:fs';
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, isAbsolute, join, relative } from 'node:path';
import type { DocFormat } from '../../types/rpc-contract.js';
import { getSettings } from '../../infra/config.js';
import { validatePath } from '../../infra/pathGuard.js';
import { sendNotification } from '../../infra/progress.js';
import { logger } from '../../infra/logger.js';
import { errorText } from '../errors.js';
import { convert } from '../converter/index.js';
import { formatOf, isJunkName } from '../files/format.js';
import { stemOf } from '../output/index.js';

type WatchFormat = 'md' | 'html' | 'txt';

interface Watcher {
  id: string;
  dir: string;
  out_dir: string;
  format: WatchFormat;
  processed: number;
  started_at: string;
  fsw: FSWatcher;
  timers: Map<string, NodeJS.Timeout>;
  /** 원본 경로 → 변환한 판의 수정 시각 (같은 판을 두 번 변환하지 않게) */
  done: Map<string, number>;
  /** 다시 훑기의 기준: 원본 경로 → 마지막으로 본 수정 시각 (시작 때 있던 문서는 변환하지 않음) */
  seen: Map<string, number>;
  scan?: NodeJS.Timeout;
  queue: string[];
  busy: boolean;
}

const watchers = new Map<string, Watcher>();
const WATCH_FORMATS = new Set<DocFormat>(['hwp', 'hwp3', 'hwpx', 'hwpml', 'pdf', 'xls', 'xlsx', 'docx', 'pptx']);
const MAX_WATCHERS = 8;
const DEBOUNCE_MS = 1500;
const RESCAN_MS = 5000;
const EXT: Record<WatchFormat, string> = { md: '.md', html: '.html', txt: '.txt' };

const inside = (child: string, parent: string) => {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};

let exitHooked = false;

export function stopAllWatchers(): void {
  for (const w of watchers.values()) close(w);
  watchers.clear();
}

function close(w: Watcher): void {
  w.fsw.close();
  clearTimeout(w.scan);
  for (const t of w.timers.values()) clearTimeout(t);
  w.timers.clear();
  w.queue.length = 0;
}

async function pump(w: Watcher): Promise<void> {
  if (w.busy) return;
  w.busy = true;
  try {
    for (let path = w.queue.shift(); path && watchers.has(w.id); path = w.queue.shift()) {
      const st = await stat(path).catch(() => null);
      if (!st?.isFile() || w.done.get(path) === st.mtimeMs) continue;
      try {
        const r = await convert({ path, format: w.format, save: false, images: false });
        const out = join(w.out_dir, relative(w.dir, dirname(path)), stemOf(path) + EXT[w.format]);
        await mkdir(dirname(out), { recursive: true });
        await writeFile(out, r.content, 'utf-8');
        w.done.set(path, st.mtimeMs);
        w.processed++;
        sendNotification('watch_event', { id: w.id, path, ok: true, output_path: out });
      } catch (err) {
        w.done.set(path, st.mtimeMs);
        sendNotification('watch_event', { id: w.id, path, ok: false, error: errorText(err) });
      }
    }
  } finally {
    w.busy = false;
  }
}

/** 쓰기가 끝났는지 — 0.5초 사이 크기·수정 시각이 그대로면 대기열로 */
async function settle(w: Watcher, path: string): Promise<void> {
  const a = await stat(path).catch(() => null);
  if (!a?.isFile()) return;
  await new Promise((r) => setTimeout(r, 500));
  const b = await stat(path).catch(() => null);
  if (!b || !watchers.has(w.id)) return;
  if (a.size !== b.size || a.mtimeMs !== b.mtimeMs) return schedule(w, path);
  if (w.done.get(path) === b.mtimeMs || w.queue.includes(path)) return;
  w.queue.push(path);
  void pump(w);
}

function schedule(w: Watcher, path: string): void {
  clearTimeout(w.timers.get(path));
  w.timers.set(path, setTimeout(() => {
    w.timers.delete(path);
    void settle(w, path);
  }, DEBOUNCE_MS));
}

/** 하위 폴더까지 감시 대상 문서와 수정 시각 (결과 폴더·임시 파일 제외) */
async function listDocs(dir: string, outDir: string, out = new Map<string, number>()): Promise<Map<string, number>> {
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const full = join(dir, e.name);
    if (isJunkName(e.name) || inside(full, outDir)) continue;
    if (e.isDirectory()) await listDocs(full, outDir, out);
    else if (e.isFile() && WATCH_FORMATS.has(formatOf(full))) {
      const st = await stat(full).catch(() => null);
      if (st) out.set(full, st.mtimeMs);
    }
  }
  return out;
}

/** 다시 훑기 — fs.watch 가 놓친 새 문서·바뀐 문서를 디바운스에 태운다 */
async function rescan(w: Watcher): Promise<void> {
  for (const [path, mtime] of await listDocs(w.dir, w.out_dir)) {
    if (w.seen.get(path) === mtime) continue;
    w.seen.set(path, mtime);
    if (!w.timers.has(path) && !w.queue.includes(path) && w.done.get(path) !== mtime) schedule(w, path);
  }
}

function scanLoop(w: Watcher, delay: number): void {
  w.scan = setTimeout(async () => {
    const t0 = Date.now();
    await rescan(w).catch((err) => logger.warn(`[watch] ${w.id} 다시 훑기 실패: ${errorText(err)}`));
    if (watchers.has(w.id)) scanLoop(w, Math.max(RESCAN_MS, (Date.now() - t0) * 10));
  }, delay);
}

export async function watchStart(p: { dir: string; out_dir?: string; format?: WatchFormat }): Promise<{ id: string }> {
  const st = await stat(p.dir).catch(() => null);
  if (!st?.isDirectory()) throw new Error('감시할 폴더를 찾을 수 없습니다. 폴더를 다시 고르세요.');
  if ([...watchers.values()].some((w) => w.dir === p.dir)) throw new Error('이미 감시 중인 폴더입니다.');
  if (watchers.size >= MAX_WATCHERS) throw new Error(`폴더 감시는 ${MAX_WATCHERS}곳까지 됩니다. 쓰지 않는 감시를 멈추세요.`);
  const configured = getSettings().convert.output_dir?.trim();
  const outDir = p.out_dir ?? (configured ? validatePath(configured) : join(p.dir, '변환 결과'));
  await mkdir(outDir, { recursive: true });

  const id = randomUUID().slice(0, 8);
  const seen = await listDocs(p.dir, outDir);
  const fsw = watch(p.dir, { recursive: true }, (_event, name) => {
    if (!name) return;
    const rel = name.toString();
    const full = join(p.dir, rel);
    if (inside(full, outDir) || rel.split(/[\\/]/).some(isJunkName) || !WATCH_FORMATS.has(formatOf(full))) return;
    schedule(w, full);
  });
  const w: Watcher = {
    id, dir: p.dir, out_dir: outDir, format: p.format ?? 'md', processed: 0, started_at: new Date().toISOString(),
    fsw, timers: new Map(), done: new Map(), seen, queue: [], busy: false,
  };
  fsw.on('error', (err) => {
    logger.warn(`[watch] ${id} 감시 중단: ${err.message}`);
    close(w);
    watchers.delete(id);
    sendNotification('watch_event', { id, path: p.dir, ok: false, error: '감시하던 폴더를 더 볼 수 없어 감시를 멈췄습니다. 폴더가 있는지 확인하세요.' });
  });
  watchers.set(id, w);
  scanLoop(w, RESCAN_MS);
  if (!exitHooked) {
    exitHooked = true;
    process.once('exit', stopAllWatchers);
  }
  return { id };
}

export function watchStop(id: string): boolean {
  const w = watchers.get(id);
  if (!w) return false;
  close(w);
  watchers.delete(id);
  return true;
}

export function watchList(): Array<{ id: string; dir: string; out_dir: string; format: string; processed: number; started_at: string }> {
  return [...watchers.values()].map(({ id, dir, out_dir, format, processed, started_at }) => ({ id, dir, out_dir, format, processed, started_at }));
}
