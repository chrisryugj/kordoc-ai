/** OpenAI 호환 공급자 — Ollama · LM Studio · vLLM · 기관 내부 LLM 서버 · OpenAI
 *
 * - 시간 제한은 "응답이 멈춘 시간" 기준(첫 글자 전 모델 적재 포함). 느린 PC 에서 긴 초안이 통째로 끊기지 않게.
 * - Ollama 면 사고(thinking)를 끈다(reasoning_effort none) — 사고 모델이 짧은 추출에도 20초씩 생각하는 것 방지(2026-10 gemma4 실측).
 * - 서버가 response_format·reasoning_effort 를 거부(400·422)하면 그 둘을 빼고 한 번 더 보낸다.
 * - 사고 글은 버린다: reasoning·reasoning_content 필드는 읽지 않고, 본문에 섞인 <think> 는 거른다.
 * - 넘겨주기(redirect)는 따라가지 않는다 — 문서가 든 요청이 관문을 거치지 않고 다른 주소로 다시 가지 않게.
 * - 클라우드 여부는 주소를 실제로 풀어서 판정(resolveOpenAiHost) — "gpu01" 같은 내부 이름도 기관 내부로 본다.
 */

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { assertAllowed, isPrivateAddress } from '../net-guard.js';
import { createThinkFilter, httpError, sseData, type ChatRequest, type LlmProvider } from './types.js';

export interface OpenAiConfig {
  base_url: string;
  api_key: string;
  model: string;
  vision_model: string;
}

function trimBase(url: string): string {
  return url.replace(/\/+$/, '');
}

const hostOf = (url: string) => { try { return new URL(url).hostname.replace(/^\[|\]$/g, ''); } catch { return ''; } };
/** 이름 → 내부망 여부 (DNS 로 푼 결과) */
const hostPrivacy = new Map<string, boolean>();

/** 내부망 주소인지 — 모르면 undefined. 점 없는 이름·내부 도메인 접미사는 내부로 본다 */
function knownPrivate(host: string): boolean | undefined {
  if (!host) return undefined;
  if (host === 'localhost' || isPrivateAddress(host)) return true;
  if (isIP(host)) return false;
  const cached = hostPrivacy.get(host);
  if (cached !== undefined) return cached;
  if (!host.includes('.') || /\.(local|lan|internal|intranet|corp|home\.arpa|localdomain)$/i.test(host)) return true;
  return undefined;
}

/** 요청 전에 한 번 — 호스트 이름을 실제 주소로 풀어 내부망인지 기억 (공급자의 isCloud 가 이 값을 쓴다) */
export async function resolveOpenAiHost(baseUrl: string): Promise<void> {
  const host = hostOf(baseUrl);
  if (!host || isIP(host) || host === 'localhost' || hostPrivacy.has(host)) return;
  const addrs = await Promise.race([
    lookup(host, { all: true }).catch(() => []),
    new Promise<[]>((r) => setTimeout(() => r([]), 3000)),
  ]);
  if (addrs.length) hostPrivacy.set(host, addrs.every((a) => isPrivateAddress(a.address)));
}

/** 넘겨주기 응답이면 따라가지 않고 고칠 방법을 알린다 */
function refuseRedirect(res: Response): void {
  if (res.status >= 300 && res.status < 400) {
    const to = res.headers.get('location') ?? '';
    throw new Error(`AI 서버가 다른 주소(${to})로 넘겨 보냅니다. 설정 > AI 연결의 주소를 그 주소로 바꾸세요.`);
  }
}

/** 서버 종류 판별 결과 (주소별 1회) — Ollama 는 /api/version 이 있다 */
const ollamaOrigins = new Map<string, boolean>();
/** 컨텍스트 크기 캐시 (주소|모델 → 토큰, 5분) */
const ctxCache = new Map<string, { tokens: number | undefined; at: number }>();

async function getJson(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<unknown> {
  await assertAllowed(url);
  const signal = AbortSignal.any([init.signal ?? new AbortController().signal, AbortSignal.timeout(init.timeoutMs ?? 3000)]);
  const res = await fetch(url, { ...init, signal, redirect: 'manual' });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

async function isOllama(origin: string): Promise<boolean> {
  const known = ollamaOrigins.get(origin);
  if (known !== undefined) return known;
  try {
    const body = (await getJson(`${origin}/api/version`)) as { version?: unknown };
    const yes = typeof body.version === 'string';
    ollamaOrigins.set(origin, yes);
    return yes;
  } catch (err) {
    // 404 등 응답이 있었으면 Ollama 아님으로 기억, 연결 자체가 안 되면 다음에 다시 본다
    if (err instanceof Error && /^\d{3}$/.test(err.message)) ollamaOrigins.set(origin, false);
    return false;
  }
}

/** Ollama: 모델을 올린 뒤 /api/ps 의 context_length (VRAM 에 따라 4K~256K 로 달라진다) */
async function ollamaContext(origin: string, model: string, signal?: AbortSignal): Promise<number | undefined> {
  const find = async () => {
    const ps = (await getJson(`${origin}/api/ps`, { signal })) as { models?: Array<{ name?: string; model?: string; context_length?: number }> };
    const names = new Set([model, model.includes(':') ? model : `${model}:latest`]);
    return ps.models?.find((m) => names.has(m.name ?? '') || names.has(m.model ?? ''))?.context_length;
  };
  const loadedCtx = await find();
  if (loadedCtx) return loadedCtx;
  // 빈 프롬프트 = 적재만 (어차피 다음 요청에서 올릴 모델)
  await getJson(`${origin}/api/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, prompt: '', stream: false }),
    signal,
    timeoutMs: 180_000,
  });
  return find();
}

/** vLLM(max_model_len) · LM Studio(loaded_context_length) · llama-server(/props n_ctx) */
async function otherContext(base: string, origin: string, model: string, headers: Record<string, string>, signal?: AbortSignal): Promise<number | undefined> {
  const tries: Array<() => Promise<number | undefined>> = [
    async () => {
      const body = (await getJson(`${base}/models`, { headers, signal })) as { data?: Array<{ id: string; max_model_len?: number }> };
      return body.data?.find((m) => m.id === model)?.max_model_len;
    },
    async () => {
      const body = (await getJson(`${origin}/api/v0/models/${encodeURIComponent(model)}`, { headers, signal })) as { loaded_context_length?: number; max_context_length?: number };
      return body.loaded_context_length ?? body.max_context_length;
    },
    async () => {
      const body = (await getJson(`${origin}/props`, { headers, signal })) as { default_generation_settings?: { n_ctx?: number } };
      return body.default_generation_settings?.n_ctx;
    },
  ];
  for (const t of tries) {
    const n = await t().catch(() => undefined);
    if (typeof n === 'number' && n > 0) return n;
  }
  return undefined;
}

export function createOpenAiProvider(cfg: OpenAiConfig, timeoutMs: number): LlmProvider {
  const base = trimBase(cfg.base_url);
  const parsed = (() => { try { return new URL(base); } catch { return null; } })();
  const origin = parsed?.origin ?? base;
  // 모르는 이름은 클라우드로 (마스킹 켜짐·폐쇄망 차단) — resolveOpenAiHost 가 먼저 풀어 두면 정확해진다
  const isCloud = !(knownPrivate(hostOf(base)) ?? false);
  const headers = (): Record<string, string> => ({
    'content-type': 'application/json',
    ...(cfg.api_key ? { authorization: `Bearer ${cfg.api_key}` } : {}),
  });

  return {
    id: 'openai',
    isCloud,
    supportsVision: Boolean(cfg.vision_model || cfg.model),
    async chat(req: ChatRequest) {
      const hasImages = req.messages.some((m) => m.images?.length);
      const model = (hasImages && cfg.vision_model) || cfg.model;
      if (!model) throw new Error('AI 모델 이름이 비어 있습니다. 설정 > AI 연결에서 모델을 고르세요.');
      const url = `${base}/chat/completions`;
      await assertAllowed(url);

      const messages: unknown[] = [];
      if (req.system) messages.push({ role: 'system', content: req.system });
      for (const m of req.messages) {
        if (!m.images?.length) {
          messages.push({ role: m.role, content: m.content });
          continue;
        }
        messages.push({
          role: m.role,
          content: [
            ...m.images.map((img) => ({ type: 'image_url', image_url: { url: `data:${img.mime};base64,${img.base64}` } })),
            { type: 'text', text: m.content },
          ],
        });
      }

      const optional: Record<string, unknown> = {};
      if (req.schema) optional.response_format = { type: 'json_schema', json_schema: { name: 'result', strict: true, schema: req.schema } };
      else if (req.json) optional.response_format = { type: 'json_object' };
      if (!isCloud && (await isOllama(origin))) optional.reasoning_effort = 'none';

      // 응답이 멈춘 시간 기준 시간 제한. 첫 글자 전에는 서버가 긴 글을 읽는 중이라(GPU 없는 서버는 몇 분) 4배까지 기다린다
      const idle = new AbortController();
      let timer: NodeJS.Timeout | undefined;
      let limit = timeoutMs * 4;
      const touch = () => {
        clearTimeout(timer);
        timer = setTimeout(() => idle.abort(new Error('idle')), limit);
      };
      const signal = AbortSignal.any([req.signal, idle.signal]);
      const post = (extra: Record<string, unknown>) => fetch(url, {
        method: 'POST',
        headers: headers(),
        signal,
        redirect: 'manual',
        body: JSON.stringify({ model, messages, stream: true, ...(req.maxTokens ? { max_tokens: req.maxTokens } : {}), ...extra }),
      });

      try {
        touch();
        let res = await post(optional);
        if ((res.status === 400 || res.status === 422) && Object.keys(optional).length) {
          await res.body?.cancel();
          res = await post({});
        }
        refuseRedirect(res);
        if (!res.ok) throw await httpError(res, 'AI 서버');

        let out = '';
        const filter = createThinkFilter();
        const emit = (t: string) => {
          if (!t) return;
          out += t;
          req.onToken?.(t);
        };
        for await (const data of sseData(res, signal)) {
          touch();
          if (data === '[DONE]') break;
          let chunk: { choices?: Array<{ delta?: { content?: string | null } }>; error?: { message?: string } };
          try { chunk = JSON.parse(data); } catch { continue; }
          if (chunk.error) throw new Error(`AI 서버: ${chunk.error.message ?? '알 수 없는 오류'}`);
          const t = chunk.choices?.[0]?.delta?.content;
          if (t) {
            if (limit !== timeoutMs) { limit = timeoutMs; touch(); }
            emit(filter.push(t));
          }
        }
        emit(filter.flush());
        return out;
      } catch (err) {
        if (idle.signal.aborted && !req.signal.aborted) {
          throw new Error(`AI 서버가 ${Math.round(limit / 1000)}초 동안 응답하지 않습니다. 서버가 켜져 있는지, 모델이 너무 크지 않은지 확인하세요.`);
        }
        throw err;
      } finally {
        clearTimeout(timer);
      }
    },
    async listModels(signal) {
      const url = `${base}/models`;
      await assertAllowed(url);
      const res = await fetch(url, { headers: headers(), signal: signal ?? AbortSignal.timeout(10_000), redirect: 'manual' });
      refuseRedirect(res);
      if (!res.ok) throw await httpError(res, 'AI 서버');
      const body = (await res.json()) as { data?: Array<{ id: string }> };
      return (body.data ?? []).map((m) => m.id).sort();
    },
    async contextTokens(signal) {
      if (isCloud || !cfg.model) return undefined;
      const key = `${base}|${cfg.model}`;
      const hit = ctxCache.get(key);
      if (hit && Date.now() - hit.at < 5 * 60_000) return hit.tokens;
      const tokens = (await isOllama(origin))
        ? await ollamaContext(origin, cfg.model, signal).catch(() => undefined)
        : await otherContext(base, origin, cfg.model, headers(), signal);
      if (tokens) ctxCache.set(key, { tokens, at: Date.now() });
      return tokens;
    },
  };
}
