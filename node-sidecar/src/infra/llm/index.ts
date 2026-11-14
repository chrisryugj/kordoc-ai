/** AI 진입점 — 설정에 맞는 공급자를 고르고, 클라우드로 나가기 전 마스킹·토큰 스트림을 붙인다 */

// 외부 AI 로 보내기 전 가림: kordoc 규칙 + kordoc 이 놓치는 도로명·동·호 주소까지 (문서 가리기와 같은 규칙)
import { DEFAULT_REDACT_RULES } from 'kordoc';
import { redactMarkdown } from '../../core/redact/rules.js';

/** 외부 AI 로 나가는 글: kordoc 기본 규칙(주민·전화·전자우편·카드·계좌·외국인·여권·운전면허)에 주소까지. 이름은 문서 뜻을 망가뜨려 두지 않는다 */
const CLOUD_RULES = [...DEFAULT_REDACT_RULES, 'address' as const];
import { getSettings } from '../config.js';
import { sendToken } from '../progress.js';
import { createAnthropicProvider } from './anthropic.js';
import { createClaudeCodeProvider } from './claude-code.js';
import { createCodexProvider } from './codex.js';
import { createEmbeddedProvider } from './embedded.js';
import { createGeminiProvider } from './gemini.js';
import { createGeminiCliProvider } from './gemini-cli.js';
import { normalizeLocalBase } from './local-servers.js';
import { createOpenAiProvider, resolveOpenAiHost } from './openai.js';
import type { ChatMessage, ChatRequest, JsonSchema, LlmProvider } from './types.js';

export type { ChatImage, ChatMessage, JsonSchema, LlmProvider } from './types.js';

/** 구독 계정 연결이 꺼져 있을 때 — 기관이 막았는지, 사용자가 아직 켜지 않았는지 */
function subscriptionOff(): Error {
  const lockedOff = getSettings().policy?.locked.includes('ai.allow_subscription');
  return new Error(lockedOff
    ? '기관에서 구독 계정(Claude Code·Codex·Antigravity CLI) 연결을 막았습니다. 설정 › AI 연결에서 다른 AI를 고르세요.'
    : '구독 계정으로 문서 보내기가 꺼져 있습니다. 설정 › AI 연결의 구독 계정에서 문서 보내기를 허용하거나 다른 AI를 고르세요.');
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
    case 'gemini-cli':
      if (!ai.allow_subscription) throw subscriptionOff();
      p = createGeminiCliProvider(ai.gemini_cli, ai.timeout_ms);
      break;
    default:
      throw new Error('AI가 아직 연결되지 않았습니다. 설정 › AI 연결에서 내장 모델이나 AI 서버를 고르세요.');
  }
  if (privacy.offline && p.isCloud) {
    throw new Error('폐쇄망 모드에서는 외부 AI를 쓸 수 없습니다. 내장 모델이나 기관 내부 AI 서버를 고르세요.');
  }
  return p;
}

/** OpenAI 호환 주소가 이름이면 실제 주소를 풀어 둔다 (내부 DNS 이름을 클라우드로 오판하지 않게) */
export async function primeHost(): Promise<void> {
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

/** 가린 모양 → 원래 값 대응표 — 외부 AI 로 보낼 때 가린 값("02-●●●-7114")이 답에 그대로 실려 오면 원래 값으로 되돌리는 데 쓴다.
 *  source 는 보낸 글(가리기 전). 고쳐 쓴 글·칸 값은 문서에 그대로 들어가므로, 되돌리지 않으면 전화·전자우편·주소가 ● 로 바뀐 문서가 만들어진다.
 *  같은 가림 모양이 서로 다른 값에서 나왔거나(끝자리가 같은 전화 둘) literal 에 그 모양이 글자 그대로 있었으면(사용자가 이미 가려 둔 자리)
 *  어느 값인지 알 수 없어 뺀다. 긴 모양부터 (짧은 모양이 긴 모양 안을 먼저 바꾸지 않게) */
export function maskTable(source: string, literal = source): Array<[string, string]> {
  const r = redactMarkdown(source, { rules: CLOUD_RULES });
  const byMask = new Map<string, Set<string>>();
  for (const h of r.hits) {
    if (!h.masked.includes('●')) continue;
    if (!byMask.has(h.masked)) byMask.set(h.masked, new Set());
    byMask.get(h.masked)!.add(source.slice(h.index, h.index + h.length));
  }
  return [...byMask]
    .filter(([masked, originals]) => originals.size === 1 && !literal.includes(masked))
    .map(([masked, originals]): [string, string] => [masked, [...originals][0]])
    .sort((a, b) => b[0].length - a[0].length);
}

/** 대응표로 답의 가린 값을 되돌린다 */
export function restoreWith(table: Array<[string, string]>, answer: string): string {
  if (!answer.includes('●')) return answer;
  let out = answer;
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // 더 긴 가림 모양의 일부로 든 것은 바꾸지 않는다("●●● ●●●" 안의 "●●● ●●"): 앞뒤가 가림 글자가 아닌 자리만
  for (const [masked, original] of table) out = out.replace(new RegExp(`(?<!●)${esc(masked)}(?!●)`, 'g'), () => original);
  return out;
}

export function restoreMasked(source: string, answer: string): string {
  return answer.includes('●') ? restoreWith(maskTable(source), answer) : answer;
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
export async function ask(opts: AskOptions): Promise<{ text: string; redacted: number; truncated?: boolean; restore: (answer: string) => string }> {
  await primeHost();
  const p = getProvider();
  const { ai } = getSettings();
  let redacted = 0;
  let messages = opts.messages;
  let system = opts.system;
  if (p.isCloud && ai.redact_before_cloud) {
    messages = messages.map((m) => {
      const r = redactMarkdown(m.content, { rules: CLOUD_RULES });
      redacted += r.hits.length;
      return { ...m, content: r.text };
    });
    if (system && (p.id === 'claude-code' || p.id === 'codex' || p.id === 'gemini-cli')) {
      const r = redactMarkdown(system, { rules: CLOUD_RULES });
      redacted += r.hits.length;
      system = r.text;
    }
  }
  // 답 길이 상한: 서버가 max_tokens 를 무시하거나 모델이 같은 말을 끝없이 되풀이하면 수십만 자가 온다.
  // 그 글이 미리보기·검사로 넘어가면 엔진이 몇 분씩 멈춰 다른 일(문서 열기·편집기)까지 못 한다 → 넘으면 그 자리에서 끊는다
  const cap = answerCharCap(opts.maxTokens);
  const guard = new AbortController();
  let got = 0;
  let over = false;
  /** 답이 길이 한도에서 끊겼다 (부른 쪽이 본다: 고쳐 쓰기는 끊긴 글을 문서에 넣으면 안 된다) */
  let truncated = false;
  const count = (t: string) => {
    got += t.length;
    if (got > cap && !over) { over = true; guard.abort(); }
  };
  const req: ChatRequest = {
    system,
    messages,
    maxTokens: opts.maxTokens,
    json: opts.json || Boolean(opts.schema),
    schema: opts.schema,
    signal: AbortSignal.any([opts.signal, guard.signal]),
    // 화면으로 흘려보내지 않는 호출(stream: false)도 받는 글자는 센다: 끝난 뒤에만 보면 되풀이하는 답을 끝까지 기다리게 된다
    onToken: (t) => { count(t); if (!over && opts.stream !== false) sendToken(t); },
    onTruncated: () => { truncated = true; },
  };
  let text: string;
  try {
    text = await p.chat(req);
  } catch (err) {
    if (over) throw new Error(ANSWER_TOO_LONG);
    throw err;
  }
  if (over || text.length > cap) throw new Error(ANSWER_TOO_LONG);
  // 가린 값("02-●●●-7114")을 답에서 되돌리는 함수 — 답을 문서·표에 넣는 쪽이 쓴다(가린 채 넣으면 연락처가 ● 로 바뀐 문서가 나온다)
  const source = [opts.system ?? '', ...opts.messages.map((m) => m.content)].join('\n');
  // 사용자가 이미 가려 둔 자리 판정은 시스템·사용자 글에서만 — 다시 받기에 실은 앞 답(모델이 쓴 가린 꼴)까지 보면 되돌리기가 통째로 꺼졌다.
  // 대응표는 한 번만 만든다(도구 인자마다 대화 전체를 다시 가리면 30만 자 기록에서 50번에 5초, 그동안 엔진이 멈췄다)
  const literal = [opts.system ?? '', ...opts.messages.filter((m) => m.role !== 'assistant').map((m) => m.content)].join('\n');
  let table: Array<[string, string]> | undefined;
  const restore = (answer: string) => (redacted && answer.includes('●') ? restoreWith((table ??= maskTable(source, literal)), answer) : answer);
  return { text, redacted, restore, ...(truncated ? { truncated: true } : {}) };
}

export const ANSWER_TOO_LONG = 'AI 답이 끝없이 길어져 멈췄습니다. 같은 말을 되풀이했을 수 있습니다. 다시 시도하거나 다른 모델로 바꿔 보세요.';

/** AI 답 글자 수 상한 — 답 토큰 한도의 여섯 배(토큰 하나가 길어야 네댓 자), 적어도 4만 자 */
export function answerCharCap(maxTokens?: number): number {
  return Math.max(40_000, (maxTokens ?? 8192) * 6);
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
