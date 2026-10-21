/** AI 진입점 — 설정에 맞는 공급자를 고르고, 클라우드로 나가기 전 마스킹·토큰 스트림을 붙인다 */

import { redactMarkdown } from 'kordoc';
import { getSettings } from '../config.js';
import { sendToken } from '../progress.js';
import { createAnthropicProvider } from './anthropic.js';
import { createClaudeCodeProvider } from './claude-code.js';
import { createCodexProvider } from './codex.js';
import { createEmbeddedProvider } from './embedded.js';
import { createGeminiProvider } from './gemini.js';
import { normalizeLocalBase } from './local-servers.js';
import { createOpenAiProvider, resolveOpenAiHost } from './openai.js';
import type { ChatMessage, ChatRequest, JsonSchema, LlmProvider } from './types.js';

export type { ChatImage, ChatMessage, JsonSchema, LlmProvider } from './types.js';

/** 구독 계정 연결이 꺼져 있을 때 — 기관이 막았는지, 사용자가 아직 켜지 않았는지 */
function subscriptionOff(): Error {
  const lockedOff = getSettings().policy?.locked.includes('ai.allow_subscription');
  return new Error(lockedOff
    ? '기관에서 구독 계정(Claude Code·Codex) 연결을 막았습니다. 설정 > AI 연결에서 다른 AI를 고르세요.'
    : '구독 계정으로 문서 보내기가 꺼져 있습니다. 설정 > AI 연결의 구독 계정에서 문서 보내기를 허용하거나 다른 AI를 고르세요.');
}

export function getProvider(): LlmProvider {
  const { ai, privacy } = getSettings();
  let p: LlmProvider;
  switch (ai.provider) {
    case 'embedded': p = createEmbeddedProvider(ai.embedded); break;
    case 'openai': p = createOpenAiProvider(ai.openai, ai.timeout_ms); break;
    // 같은 OpenAI 호환 공급자를 이 PC 서버 칸으로 (127.0.0.1 이면 클라우드 아님 → 폐쇄망에서도 됨)
    case 'local': p = { ...createOpenAiProvider({ ...ai.local, base_url: normalizeLocalBase(ai.local.base_url), vision_model: '' }, ai.timeout_ms), id: 'local' }; break;
    case 'gemini': p = createGeminiProvider(ai.gemini, ai.timeout_ms); break;
    case 'anthropic': p = createAnthropicProvider(ai.anthropic, ai.timeout_ms); break;
    case 'claude-code':
      if (!ai.allow_subscription) throw subscriptionOff();
      p = createClaudeCodeProvider(ai.claude_code, ai.timeout_ms);
      break;
    case 'codex':
      if (!ai.allow_subscription) throw subscriptionOff();
      p = createCodexProvider(ai.codex, ai.timeout_ms);
      break;
    default:
      throw new Error('AI가 아직 연결되지 않았습니다. 설정 > AI 연결에서 내장 모델이나 AI 서버를 고르세요.');
  }
  if (privacy.offline && p.isCloud) {
    throw new Error('폐쇄망 모드에서는 인터넷 AI를 쓸 수 없습니다. 내장 모델이나 기관 내부 AI 서버를 고르세요.');
  }
  return p;
}

/** OpenAI 호환 주소가 이름이면 실제 주소를 풀어 둔다 (내부 DNS 이름을 클라우드로 오판하지 않게) */
async function primeHost(): Promise<void> {
  const { ai } = getSettings();
  if (ai.provider === 'openai') await resolveOpenAiHost(ai.openai.base_url);
  if (ai.provider === 'local') await resolveOpenAiHost(ai.local.base_url);
}

export function aiConfigured(): boolean {
  try { getProvider(); return true; } catch { return false; }
}

/** 한국어는 토큰당 1.2자 정도로 잡는다 (Qwen 계열 실측이 더 촘촘해 보수적으로) */
const CHARS_PER_TOKEN = 1.2;
/** 컨텍스트를 알아낼 수 없는 내부 서버 — 넘치면 서버가 앞부분을 조용히 잘라 버리니 작게 잡는다 */
const UNKNOWN_LOCAL_CONTEXT = 8192;

/** 한 번에 넣을 수 있는 대략의 글자 수 — 답변 몫(reserveTokens)을 뺀 나머지.
 *  내장은 실제로 올린 컨텍스트, Ollama·vLLM·LM Studio·llama-server 는 서버에 물어본 값, 클라우드는 넉넉히. */
export async function contextCharBudget(opts: { reserveTokens?: number; signal?: AbortSignal; provider?: LlmProvider } = {}): Promise<number> {
  if (!opts.provider) await primeHost();
  const p = opts.provider ?? getProvider();
  const known = await p.contextTokens?.(opts.signal).catch(() => undefined);
  // 인터넷 API 는 넉넉히. 구독 프로그램(Claude Code·Codex)처럼 창 크기를 밝히는 클라우드는 그 값으로
  if (p.isCloud && !known) return 400_000;
  const tokens = known ?? (p.id === 'embedded' ? getSettings().ai.embedded.context_size : UNKNOWN_LOCAL_CONTEXT);
  return Math.max(1500, Math.floor((tokens - (opts.reserveTokens ?? 2048)) * CHARS_PER_TOKEN));
}

export interface AskOptions {
  system?: string;
  messages: ChatMessage[];
  maxTokens?: number;
  json?: boolean;
  /** 이 모양의 JSON 만 (json 을 함께 켬) */
  schema?: JsonSchema;
  signal: AbortSignal;
  /** 토큰을 프론트로 흘려보낼지 (기본 켬) */
  stream?: boolean;
}

/** 공급자 호출 — 클라우드면 설정에 따라 개인정보를 가린 뒤 보낸다.
 *  system 은 가리지 않으니 고정 지시문만 넣고, 문서·기관 정보 같은 내용은 messages 로 보낼 것.
 *  구독 프로그램(Claude Code·Codex)은 system 도 대화와 같은 글로 넘어가므로 system 까지 가린다. */
export async function ask(opts: AskOptions): Promise<{ text: string; redacted: number }> {
  await primeHost();
  const p = getProvider();
  const { ai } = getSettings();
  let redacted = 0;
  let messages = opts.messages;
  let system = opts.system;
  if (p.isCloud && ai.redact_before_cloud) {
    messages = messages.map((m) => {
      const r = redactMarkdown(m.content);
      redacted += r.hits.length;
      return { ...m, content: r.text };
    });
    if (system && (p.id === 'claude-code' || p.id === 'codex')) {
      const r = redactMarkdown(system);
      redacted += r.hits.length;
      system = r.text;
    }
  }
  const req: ChatRequest = {
    system,
    messages,
    maxTokens: opts.maxTokens,
    json: opts.json || Boolean(opts.schema),
    schema: opts.schema,
    signal: opts.signal,
    onToken: opts.stream === false ? undefined : sendToken,
  };
  const text = await p.chat(req);
  return { text, redacted };
}

/** JSON 응답 파싱 — 코드펜스·앞뒤 잡문·끝 쉼표가 섞여도 첫 객체를 꺼낸다 */
export function parseJsonLoose<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.search(/[[{]/);
  if (start < 0) throw new Error('AI 응답에서 JSON을 찾지 못했습니다');
  const open = body[start];
  const close = open === '{' ? '}' : ']';
  const end = body.lastIndexOf(close);
  const slice = body.slice(start, end + 1);
  try {
    return JSON.parse(slice) as T;
  } catch {
    return JSON.parse(slice.replace(/,\s*([}\]])/g, '$1')) as T;
  }
}
