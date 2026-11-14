/** 폴더 감시 (watch_start·watch_stop·watch_list) — 새로 들어오거나 바뀐 문서를 자동 변환
 *
 * fs.watch(하위 폴더 포함) + 파일별 디바운스(쓰기가 끝나 크기가 멈출 때까지) + 감시마다 한 번에 하나씩 변환.
 * fs.watch 는 바쁠 때 이벤트를 놓치고 공유 폴더(SMB·NAS)에서는 아예 안 오기도 해서, 시작할 때 문서 목록을 기준으로 잡고
 * 주기적으로 다시 훑어 새로 생기거나 바뀐 문서를 보충한다 (훑는 데 오래 걸리면 간격을 늘림).
 * 결과는 out_dir 에 하위 폴더 구조 그대로, 같은 원본의 결과는 덮어쓴다 (감시 폴더의 거울 — 출력 규칙의 예외).
 * 알림 `watch_event` { id, path, ok, output_path?, error? }. 앱이 끝날 때 전부 닫는다.
 */

import { watch, type FSWatcher } from 'node:fs';
import { mkdir, readdir, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import type { DocFormat } from '../../types/rpc-contract.js';
import { DEFAULT_SETTINGS, getSettings } from '../../infra/config.js';
import { validatePath } from '../../infra/pathGuard.js';
import { sendNotification } from '../../infra/progress.js';
import { logger } from '../../infra/logger.js';
import { LOCKED } from '../../infra/rename.js';
import { errorText } from '../errors.js';
import { convert } from '../converter/index.js';
import { formatOf, isJunkName } from '../files/format.js';
import { atomicWriteFile } from '../files/io.js';
import { sameFile, stemOf } from '../output/index.js';

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
  /** 다른 프로그램이 쥐고 있어 못 읽고 다시 해 볼 원본 (실패 알림은 처음 한 번만) */
  locked: Set<string>;
  scan?: NodeJS.Timeout;
  queue: string[];
  busy: boolean;
}

const watchers = new Map<string, Watcher>();
const GONE = '지켜보던 폴더를 더 볼 수 없어 지켜보기를 멈췄습니다. 폴더 이름을 바꿨거나 지웠다면 다시 골라 시작하세요.';
/** 지금 거는 중인 폴더 */
const starting = new Set<string>();
const WATCH_FORMATS = new Set<DocFormat>(['hwp', 'hwp3', 'hwpx', 'hwpml', 'pdf', 'xls', 'xlsx', 'docx', 'pptx']);
const MAX_WATCHERS = 8;
const DEBOUNCE_MS = 1500;
const RESCAN_MS = 5000;
const EXT: Record<WatchFormat, string> = { md: '.md', html: '.html', txt: '.txt' };

const inside = (child: string, parent: string) => {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};

/** 결과 이름 — 원래 확장자를 넣는다 (공문.hwpx·공문.pdf 가 둘 다 공문.md 가 되어 서로 덮지 않게): 공문_hwpx.md */
export function resultName(path: string, format: WatchFormat): string {
  const ext = extname(path).slice(1).toLowerCase();
  return `${stemOf(path)}${ext ? `_${ext}` : ''}${EXT[format]}`;
}

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
        const out = join(w.out_dir, relative(w.dir, dirname(path)), resultName(path, w.format));
        await mkdir(dirname(out), { recursive: true });
        // 결과 파일은 같은 원본이 바뀔 때마다 덮는다: 쓰다 끊기면 앞 결과까지 잃지 않게 옆에 쓴 뒤 바꿔 넣는다
        await atomicWriteFile(out, r.content);
        w.done.set(path, st.mtimeMs);
        w.locked.delete(path);
        w.processed++;
        sendNotification('watch_event', { id: w.id, path, ok: true, output_path: out });
      } catch (err) {
        // 한글이 쥐고 있어 못 읽은 것(Windows EBUSY 등)은 처리한 것으로 적지 않는다: 다음 다시 훑기 때 또 해 본다(알림은 처음 한 번)
        if (LOCKED.test((err as NodeJS.ErrnoException).code ?? '')) {
          w.seen.delete(path);
          if (w.locked.has(path)) continue;
          w.locked.add(path);
        } else w.done.set(path, st.mtimeMs);
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
  // 지켜보던 폴더의 이름을 바꾸거나 지우면 감시는 아무 신호 없이 죽는다(없는 폴더는 빈 폴더로 읽힌다) → 여기서 알아채고 멈췄다고 알린다
  const st = await stat(w.dir).catch(() => null);
  if (!st?.isDirectory()) {
    if (!watchers.has(w.id)) return;
    logger.warn(`[watch] ${w.id} 감시 중단: 폴더가 없음`);
    close(w);
    watchers.delete(w.id);
    sendNotification('watch_event', { id: w.id, path: w.dir, ok: false, error: GONE });
    return;
  }
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
  if (!st?.isDirectory()) throw new Error('지켜볼 폴더를 찾을 수 없습니다. 폴더를 다시 고르세요.');
  // 거는 중인 폴더도 센다: 아래에서 폴더를 훑는 동안(await) 같은 요청이 또 오면 한 폴더에 감시가 둘 걸려 문서마다 두 번 변환한다.
  // 글자열이 아니라 같은 폴더인지로: 맥 자소 분리(NFD)·대소문자만 다른 경로로 두 번 걸면 두 감시가 같은 결과 파일에 동시에 썼다
  const same = (d: string) => sameFile(d, p.dir);
  if ([...starting].some(same) || [...watchers.values()].some((w) => same(w.dir))) throw new Error('이미 지켜보는 폴더입니다.');
  if (watchers.size + starting.size >= MAX_WATCHERS) throw new Error(`폴더 지켜보기는 ${MAX_WATCHERS}곳까지 됩니다. 쓰지 않는 폴더는 그만 보기를 누르세요.`);
  starting.add(p.dir);
  try {
    return await startWatcher(p);
  } finally {
    starting.delete(p.dir);
  }
}

async function startWatcher(p: { dir: string; out_dir?: string; format?: WatchFormat }): Promise<{ id: string }> {
  // 사용자가 정한 출력 폴더가 있으면 그곳, 기본값(문서/KorDoc AI 결과)이면 감시 폴더 안 '변환 결과'
  // (감시는 같은 원본의 결과를 덮어쓰므로 여러 감시가 한 기본 폴더를 함께 쓰면 같은 이름끼리 덮인다)
  const configured = getSettings().convert.output_dir?.trim();
  const own = configured && configured !== DEFAULT_SETTINGS.convert.output_dir ? configured : '';
  // 결과 폴더가 지켜볼 폴더와 같거나 그 위(상위)면 들어오는 문서가 모두 결과 폴더 안이라 하나도 변환하지 못한다
  const above = (out: string) => inside(resolve(p.dir), resolve(out));
  if (p.out_dir && above(p.out_dir)) {
    throw new Error('결과를 저장할 폴더가 지켜볼 폴더와 같거나 그 바깥(위) 폴더라 들어오는 문서를 변환할 수 없습니다. 결과 폴더를 지켜볼 폴더 안이나 전혀 다른 폴더로 바꾸세요.');
  }
  // 설정의 저장 폴더가 그렇다면 이 감시만 지켜볼 폴더 안 '변환 결과' 에
  const outDir = p.out_dir ?? (own && !above(validatePath(own)) ? validatePath(own) : join(p.dir, '변환 결과'));
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
    fsw, timers: new Map(), done: new Map(), seen, locked: new Set(), queue: [], busy: false,
  };
  fsw.on('error', (err) => {
    logger.warn(`[watch] ${id} 감시 중단: ${err.message}`);
    close(w);
    watchers.delete(id);
    sendNotification('watch_event', { id, path: p.dir, ok: false, error: GONE });
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
