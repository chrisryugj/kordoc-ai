/** 이 PC 의 로컬 모델 서버 찾기 — 잘 알려진 127.0.0.1 포트에 OpenAI 호환 `GET /v1/models` 를 물어 본다
 *
 * 모델 목록 읽기는 이음오피스 packages/ai-provider/src/custom-models.ts(Apache-2.0, 커밋 9bda9ac)에서 옮김.
 * 바꾼 곳: 사용자가 넣은 주소 하나 대신 이 PC 의 잘 알려진 포트를 한꺼번에 찾음, Ollama 는 /api/version 으로 확인,
 * 오류·느린 서버·이상한 답은 모두 "없음"(설정 화면이 막히지 않게), 넘겨주기(redirect)는 따라가지 않음.
 *
 * 127.0.0.1 만 본다 — 이 PC 밖으로 나가지 않아 폐쇄망 모드에서도 된다. 통신 기록에는 찾기 한 번을 한 줄로 남긴다.
 */

import { assertAllowed } from '../net-guard.js';

export interface LocalServer {
  /** 화면에 보일 이름 (포트로 짐작한 것은 "등"을 붙인다) */
  name: string;
  base_url: string;
  models: string[];
}

/** 포트 → 흔히 그 포트를 쓰는 서버 */
export const LOCAL_PORTS: ReadonlyArray<{ port: number; name: string }> = [
  { port: 11434, name: 'Ollama' },
  { port: 1234, name: 'LM Studio' },
  { port: 8080, name: 'llama.cpp 서버 등' },
  { port: 8000, name: 'vLLM 등' },
  { port: 1337, name: 'Jan' },
  { port: 5001, name: 'KoboldCpp' },
  { port: 4891, name: 'GPT4All' },
  { port: 5000, name: 'text-generation-webui 등' },
];

const PROBE_TIMEOUT_MS = 1500;
const MAX_MODELS = 500;
const MAX_BODY = 2 * 1024 * 1024;

/** 주소의 경로가 비었으면 OpenAI 호환 기본 경로(/v1)를 붙인다 — "http://127.0.0.1:1234" 만 넣어도 되게 */
export function normalizeLocalBase(url: string): string {
  const t = url.trim().replace(/\/+$/, '');
  try {
    const u = new URL(t);
    return u.pathname === '/' || u.pathname === '' ? `${t}/v1` : t;
  } catch {
    return t;
  }
}

/** 받으면서 크기를 센다 — 상한을 넘으면 그만 읽는다(서버가 끝없이 보내도 메모리가 커지지 않게) */
async function getJson(url: string, signal: AbortSignal): Promise<unknown> {
  const res = await fetch(url, { headers: { accept: 'application/json' }, signal, redirect: 'manual' });
  if (!res.ok || !res.body) { await res.body?.cancel(); throw new Error(String(res.status)); }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY) { await reader.cancel(); throw new Error('too big'); }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/** `/models` 의 { data: [{ id }] } → 모델 이름들 (순서 유지, 빈·중복 제외). 모양이 아니면 null */
export function modelIds(body: unknown): string[] | null {
  const data = (body as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) return null;
  const seen = new Set<string>();
  for (const e of data) {
    const id = (e as { id?: unknown } | null)?.id;
    if (typeof id === 'string' && id.trim()) seen.add(id.trim());
    if (seen.size >= MAX_MODELS) break;
  }
  return [...seen];
}

async function probe(host: string, port: number, name: string, signal: AbortSignal): Promise<LocalServer | null> {
  const origin = `http://${host}:${port}`;
  try {
    const models = modelIds(await getJson(`${origin}/v1/models`, signal));
    if (!models) return null;
    let label = name;
    if (name === 'Ollama') {
      const v = await getJson(`${origin}/api/version`, signal).catch(() => null) as { version?: unknown } | null;
      if (typeof v?.version !== 'string') label = 'OpenAI 호환 서버';
    }
    return { name: label, base_url: `${origin}/v1`, models };
  } catch {
    return null;
  }
}

/** 켜져 있는 로컬 서버들 (못 찾으면 빈 목록, 던지지 않는다 — 폐쇄망 관문 위반만 예외) */
export async function findLocalServers(opts: { signal?: AbortSignal; ports?: ReadonlyArray<{ port: number; name: string }>; host?: string } = {}): Promise<LocalServer[]> {
  const host = opts.host ?? '127.0.0.1';
  await assertAllowed(`http://${host}/`);
  const signal = AbortSignal.any([opts.signal ?? new AbortController().signal, AbortSignal.timeout(PROBE_TIMEOUT_MS)]);
  const found = await Promise.all((opts.ports ?? LOCAL_PORTS).map(({ port, name }) => probe(host, port, name, signal)));
  return found.filter((s): s is LocalServer => s !== null);
}
