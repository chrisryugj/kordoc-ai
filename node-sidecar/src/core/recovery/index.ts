/** 한글 편집기 복구 사본 — 저장하지 않은 문서를 앱 데이터 폴더(recovery/)에 둔다. 앱이 갑자기 꺼져도 다음에 되살린다.
 *
 * 문서 경로마다 사본 하나(같은 파일을 다시 쓰면 덮는다). 사본은 편집기가 내보낸 바이트 그대로(문서와 같은 형식)이고,
 * 원본 파일·`.bak`·저장 안 됨 표시는 건드리지 않는다. 지우는 건 앱이 저장했거나 사용자가 버렸을 때뿐.
 * 되살릴 땐 editor_open 이 사본 바이트를 주되 저장 보정 정보(바탕쪽·메모 목록)는 원본 파일에서 읽는다(hwp-save).
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { rename, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { dataDir } from '../../infra/config.js';
import type { RecoveryEntry } from '../../types/rpc-contract.js';

/** 14일 지난 사본은 목록을 볼 때 지운다 (잊힌 사본이 쌓이지 않게) */
const KEEP_MS = 14 * 24 * 60 * 60 * 1000;
/** 이보다 큰 문서는 사본을 만들지 않는다 (편집기는 대개 수 MB) */
const MAX_BYTES = 200 * 1024 * 1024;

const dir = () => {
  const d = join(dataDir(), 'recovery');
  mkdirSync(d, { recursive: true });
  return d;
};
/** 이 실행에서 쓴 사본 — 지금 편집 중인 문서라 "꺼진 문서" 목록에 넣지 않는다 */
const live = new Set<string>();
/** 경로 키: 한글 이름의 조합 방식(NFC·NFD)과 Windows 대소문자 차이는 같은 파일 */
const idOf = (path: string) => {
  const p = path.normalize('NFC');
  return createHash('sha256').update(process.platform === 'win32' ? p.toLowerCase() : p).digest('hex').slice(0, 24);
};
const atomicWrite = async (path: string, data: Buffer) => {
  const tmp = `${path}.kordoc-tmp`;
  await writeFile(tmp, data);
  await rename(tmp, path);
};
const files = (path: string) => {
  const base = join(dir(), idOf(path));
  return { data: `${base}.bin`, meta: `${base}.json` };
};

export async function recoveryWrite(p: { path: string; data_b64: string; title?: string; working?: boolean }): Promise<{ ok: boolean }> {
  const bytes = Buffer.from(p.data_b64, 'base64');
  if (!bytes.length || bytes.length > MAX_BYTES) return { ok: false };
  const format: 'hwp' | 'hwpx' = /\.hwp$/i.test(p.path) ? 'hwp' : 'hwpx';
  const f = files(p.path);
  // 바이트 먼저: 꺼지는 순간이 둘 사이면 이전 메타가 새 바이트를 가리키는 것이 반대보다 낫다
  await atomicWrite(f.data, bytes);
  const meta: Omit<RecoveryEntry, 'exists'> = { path: p.path, name: basename(p.path), format, saved_at: Date.now(), size: bytes.length, ...(p.title ? { title: p.title } : {}), ...(p.working ? { working: true } : {}) };
  await atomicWrite(f.meta, Buffer.from(JSON.stringify(meta)));
  live.add(idOf(p.path));
  return { ok: true };
}

/** path 를 주면 그 문서의 사본만 (경로 비교는 idOf 와 같은 규칙) */
export function recoveryList(path?: string): { entries: RecoveryEntry[] } {
  const only = path ? idOf(path) : null;
  const entries: RecoveryEntry[] = [];
  const now = Date.now();
  for (const name of readdirSync(dir())) {
    if (!name.endsWith('.json') || live.has(name.slice(0, -5)) || (only && name.slice(0, -5) !== only)) continue;
    const meta = join(dir(), name);
    const data = meta.replace(/\.json$/, '.bin');
    try {
      const m = JSON.parse(readFileSync(meta, 'utf-8')) as Omit<RecoveryEntry, 'exists'>;
      if (!existsSync(data) || now - statSync(data).mtimeMs > KEEP_MS) {
        rmSync(meta, { force: true });
        rmSync(data, { force: true });
        continue;
      }
      entries.push({ ...m, exists: existsSync(m.path) });
    } catch {
      /* 쓰는 중이던 메타는 다음에 */
    }
  }
  return { entries: entries.sort((a, b) => b.saved_at - a.saved_at) };
}

/** 문서 경로의 사본 바이트 — 없으면 null */
export function recoveryBytes(path: string): Buffer | null {
  const f = files(path);
  return existsSync(f.data) && existsSync(f.meta) ? readFileSync(f.data) : null;
}

export function recoveryDiscard(path: string): boolean {
  const f = files(path);
  live.delete(idOf(path));
  const had = existsSync(f.meta);
  rmSync(f.meta, { force: true });
  rmSync(f.data, { force: true });
  return had;
}
