/** 받은 공문 목록 — 앱 데이터 폴더 inbox.json { version: 1, items } 에 이 PC 에만 보관
 *
 * 같은 파일(경로)을 다시 넣으면 뽑은 값만 새로 읽고, 사람이 정한 상태·메모·고친 기한은 그대로 둔다.
 * id 는 경로 해시(맥 끌어 놓기 경로의 NFD·고르기 창의 NFC 를 같은 파일로 친다).
 */

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { InboxItem } from '../../types/rpc-contract.js';
import { dataDir } from '../../infra/config.js';
import { logger } from '../../infra/logger.js';
import { sendProgress } from '../../infra/progress.js';
import { parseDoc } from '../converter/index.js';
import { errorText } from '../errors.js';
import { formatOf } from '../files/format.js';
import { isIsoDate, todayIso } from './dates.js';
import { extractInbox } from './extract.js';

/** manual_due: 사람이 고친 기한 ('' 은 "기한 없음"으로 정함). 화면에는 due 하나로 나간다 */
type Stored = InboxItem & { manual_due?: string };

const READABLE = new Set(['hwp', 'hwp3', 'hwpx', 'hwpml', 'pdf', 'docx', 'image', 'txt', 'md']);
const file = () => join(dataDir(), 'inbox.json');

/** 읽고 고쳐 쓰기를 한 줄로 세운다 (공문 넣기와 상태 바꾸기가 겹쳐도 서로 덮어쓰지 않게) */
let chain: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => undefined);
  return run;
}

async function load(): Promise<Stored[]> {
  if (!existsSync(file())) return [];
  try {
    const j = JSON.parse(await readFile(file(), 'utf-8')) as { items?: Stored[] };
    return Array.isArray(j.items) ? j.items.filter((x) => x && typeof x.id === 'string' && typeof x.path === 'string') : [];
  } catch (err) {
    // 깨진 파일은 옆에 남겨 두고 새로 시작 (다음 저장이 덮어쓰지 않게)
    const keep = `${file()}.broken-${Date.now()}`;
    await rename(file(), keep).catch(() => undefined);
    logger.warn(`[inbox] 목록 파일을 못 읽어 ${basename(keep)} 로 옮기고 새로 시작: ${err}`);
    return [];
  }
}

async function save(items: Stored[]): Promise<void> {
  await mkdir(dataDir(), { recursive: true });
  const tmp = `${file()}.tmp`;
  await writeFile(tmp, JSON.stringify({ version: 1, items }, null, 2), 'utf-8');
  await rename(tmp, file());
}

export function inboxId(path: string): string {
  // 맥에서 옮겨 온 이름은 자소가 갈라진(NFD) 채로 올 수 있어 어느 운영체제에서나 완성형(NFC)으로, Windows 는 대소문자도 무시
  const nfc = path.normalize('NFC');
  const key = process.platform === 'win32' ? nfc.toLowerCase() : nfc;
  return createHash('sha256').update(key).digest('hex').slice(0, 16);
}

/** 사람이 고친 기한 → 없으면 요청 기한 중 가장 이른 것 */
function withDue(it: Stored): Stored {
  const auto = it.requests.map((r) => r.due).filter((d): d is string => Boolean(d)).sort()[0];
  const due = it.manual_due !== undefined ? it.manual_due || undefined : auto;
  const { due: _old, ...rest } = it;
  return due ? { ...rest, due } : rest;
}

function view(it: Stored): InboxItem {
  const { manual_due: _m, ...rest } = it;
  return rest;
}

/** 할 일 먼저 기한 순(기한 없는 것은 뒤), 끝난 것은 아래 */
function order(a: Stored, b: Stored): number {
  if (a.status !== b.status) return a.status === 'todo' ? -1 : 1;
  if (a.due !== b.due) return !a.due ? 1 : !b.due ? -1 : a.due.localeCompare(b.due);
  return b.added_at.localeCompare(a.added_at);
}

async function readOne(path: string, signal?: AbortSignal) {
  const format = formatOf(path);
  if (!READABLE.has(format)) throw new Error('받은 공문으로 읽을 수 없는 형식입니다. HWP·HWPX·PDF(스캔본 포함) 파일을 넣으세요.');
  // PDF 는 붙임까지 합친 긴 파일이 있어 앞 10쪽만 (공문 본문·시행 줄은 앞에 있다)
  const r = await parseDoc(path, { images: false, plain: true, pages: format === 'pdf' ? '1-10' : undefined, signal });
  if (r.markdown.replace(/\s/g, '').length < 20) {
    throw new Error('글자를 읽지 못했습니다. 스캔한 공문이면 설정 > 저장과 연결에서 스캔한 쪽 글자 읽기를 켜고 다시 넣으세요.');
  }
  return extractInbox(r.markdown, todayIso());
}

/** 공문을 읽어 목록에 넣는다 — 같은 경로는 뽑은 값만 갱신 */
export async function inboxAdd(paths: string[], signal?: AbortSignal): Promise<{ items: InboxItem[]; failed: Array<{ path: string; error: string }> }> {
  const items: InboxItem[] = [];
  const failed: Array<{ path: string; error: string }> = [];
  for (const [i, path] of paths.entries()) {
    signal?.throwIfAborted();
    sendProgress({ current: i + 1, total: paths.length, message: `${basename(path)} 읽는 중 (${i + 1}/${paths.length})` });
    try {
      const ex = await readOne(path, signal);
      items.push(await serial(async () => {
        const list = await load();
        const id = inboxId(path);
        const prev = list.find((x) => x.id === id);
        const next = withDue({
          id, path, name: basename(path).normalize('NFC'), added_at: prev?.added_at ?? new Date().toISOString(),
          ...ex,
          status: prev?.status ?? 'todo',
          ...(prev?.note ? { note: prev.note } : {}),
          ...(prev?.manual_due !== undefined ? { manual_due: prev.manual_due } : {}),
        });
        await save(prev ? list.map((x) => (x.id === id ? next : x)) : [...list, next]);
        return view(next);
      }));
    } catch (err) {
      if (signal?.aborted) throw err;
      failed.push({ path, error: errorText(err) });
    }
  }
  return { items, failed };
}

export async function inboxList(): Promise<{ items: InboxItem[] }> {
  return { items: (await serial(load)).sort(order).map(view) };
}

/** 상태·메모·기한 고치기 — due: null 이면 뽑은 기한으로, '' 이면 기한 없음 */
export function inboxUpdate(p: { id: string; status?: 'todo' | 'done'; due?: string | null; note?: string }): Promise<InboxItem> {
  if (typeof p.due === 'string' && p.due !== '' && !isIsoDate(p.due)) throw new Error('기한은 2026-10-23처럼 연-월-일로 넣으세요.');
  return serial(async () => {
    const list = await load();
    const cur = list.find((x) => x.id === p.id);
    if (!cur) throw new Error('목록에 없는 공문입니다. 받은 공문 화면을 다시 열어 목록을 확인하세요.');
    const next: Stored = { ...cur, ...(p.status ? { status: p.status } : {}) };
    if (p.due === null) delete next.manual_due;
    else if (typeof p.due === 'string') next.manual_due = p.due;
    if (typeof p.note === 'string') {
      const note = p.note.trim().slice(0, 2000);
      if (note) next.note = note;
      else delete next.note;
    }
    const done = withDue(next);
    await save(list.map((x) => (x.id === p.id ? done : x)));
    return view(done);
  });
}

export function inboxRemove(id: string): Promise<boolean> {
  return serial(async () => {
    const list = await load();
    const next = list.filter((x) => x.id !== id);
    if (next.length === list.length) return false;
    await save(next);
    return true;
  });
}
