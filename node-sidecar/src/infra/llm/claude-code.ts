/** 구독 계정 다리: 이 PC 에 깔고 로그인해 둔 Claude Code 로 한 번 묻고 답 받기
 *
 * 근거: Claude Code 공식 CLI 문서(headless `-p`, `--input-format`/`--output-format stream-json`, `--tools ""`,
 * `--strict-mcp-config`, `--setting-sources`, `--system-prompt-file`, `--permission-mode dontAsk`, 모델 별칭).
 * - 도구는 하나도 주지 않는다(`--tools ""`, MCP·사용자 설정·슬래시 명령 끔, `--restricted`, 허락 없는 일은 모두 거절).
 *   시작 보고(system/init)의 도구·MCP 서버가 0개가 아니거나 API 키로 로그인돼 있으면 답이 오기 전에 끝낸다.
 * - 지시문은 작업 폴더의 파일로, 대화는 stdin 으로만 준다. 명령줄에는 고정 인자와 모델 이름만.
 */

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { assertProgramEgress } from '../net-guard.js';
import { SubscriptionError, type FailKind } from './subscription/errors.js';
import { requireSubscription } from './subscription/login.js';
import { findProgram, removeDir, runProgram, workDir, type Program, type SpawnFn } from './subscription/program.js';
import type { ChatMessage, ChatRequest, LlmProvider } from './types.js';

export interface ClaudeCodeConfig { model: string; cli_path: string }

/** 시험이 바꿔 끼우는 것 */
export interface SubscriptionDeps {
  find?: () => Promise<Program | null>;
  /** 보내기 직전 로그인 확인 (기본: requireSubscription) */
  login?: (program: Program) => Promise<void>;
  baseEnv?: NodeJS.ProcessEnv;
  spawn?: SpawnFn;
}

/** 구독 프로그램의 대략의 창 크기 (문서 예산용) */
export const SUBSCRIPTION_CONTEXT_TOKENS = 180_000;

/** 모델 칸: 별칭(opus·sonnet[1m] 등)이나 전체 이름. '-' 로 시작하지 않아 옵션으로 읽히지 않는다 */
export const MODEL_NAME = /^(?!-)[\w.:[\]-]{1,100}$/;

const FIXED = [
  '-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
  '--tools', '', '--strict-mcp-config', '--setting-sources', '', '--disable-slash-commands', '--no-session-persistence',
  '--restricted', '--permission-mode', 'dontAsk',
];

export function claudeArgs(model: string, systemFile: string): string[] {
  if (model && !MODEL_NAME.test(model)) throw new SubscriptionError('bad-request', 'claude-code', { why: '모델 이름 꼴이 아님' });
  return [...FIXED, '--system-prompt-file', systemFile, ...(model ? ['--model', model] : [])];
}

/** 우리가 앞에 두는 지시: 도구 없이 글로만 */
export function claudeSystemText(req: Pick<ChatRequest, 'system' | 'json' | 'schema' | 'maxTokens'>): string {
  const parts = [
    '이 대화는 KorDoc AI 가 보낸 것입니다. 도구는 없습니다. 파일·명령·웹을 쓰지 말고, 받은 글만 보고 답을 글로만 쓰세요.',
  ];
  if (req.schema) parts.push(`답은 아래 JSON 스키마에 맞는 JSON 객체 하나만 쓰세요. 코드 블록·설명을 붙이지 마세요.\n<response_schema>\n${JSON.stringify(req.schema)}\n</response_schema>`);
  else if (req.json) parts.push('답은 JSON 객체 하나만 쓰세요. 코드 블록·설명을 붙이지 마세요.');
  if (req.maxTokens) parts.push(`답은 대략 ${req.maxTokens} 토큰 안으로 쓰세요.`);
  if (req.system) parts.push(req.system);
  return parts.join('\n\n');
}

/** 대화 전체를 사용자 메시지 하나로: 앞선 차례는 글로 적고, 마지막 사용자 말과 그림은 그대로 */
export function claudeUserLine(messages: ChatMessage[]): string {
  const last = messages.at(-1);
  if (!last || last.role !== 'user') throw new SubscriptionError('bad-request', 'claude-code', { why: '마지막 말이 사용자 말이 아님' });
  const earlier = messages.slice(0, -1);
  const text = earlier.length
    ? `<earlier_conversation>\n${earlier.map((m) => `<${m.role}>\n${m.content}\n</${m.role}>`).join('\n')}\n</earlier_conversation>\n\n${last.content}`
    : last.content;
  const images = messages.flatMap((m) => m.images ?? []).map((im) => ({ type: 'image', source: { type: 'base64', media_type: im.mime, data: im.base64 } }));
  return JSON.stringify({ type: 'user', message: { role: 'user', content: [...images, { type: 'text', text }] } });
}

type Ev = Record<string, unknown>;
const obj = (v: unknown): Ev | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Ev) : undefined);
/** 도구 블록: tool_use·server_tool_use·mcp_tool_use 와 그 결과(…_tool_result) */
const isToolBlock = (b: unknown) => /tool_(use|result)$/.test(String(obj(b)?.type ?? ''));

/** 답 메시지의 error 값(공식 SDK 문서의 종류) → 우리 실패 종류 */
const ASSISTANT_ERROR: Record<string, FailKind> = {
  authentication_failed: 'signed-out',
  billing_error: 'rate-limit',
  rate_limit: 'rate-limit',
  invalid_request: 'bad-request',
  server_error: 'server-error',
};

function failureOf(errorKind: string | undefined, status: unknown, text: string): FailKind {
  if (/prompt is too long|too long|context.{0,20}(limit|window)/i.test(text)) return 'too-long';
  if (/not logged in|\/login|invalid api key|oauth/i.test(text) || status === 401) return 'signed-out';
  if (/overloaded/i.test(text) || status === 529) return 'overloaded';
  if (/usage limit|rate.?limit/i.test(text) || status === 429) return 'rate-limit';
  if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|network|connection error/i.test(text)) return 'network';
  if (errorKind && ASSISTANT_ERROR[errorKind]) return ASSISTANT_ERROR[errorKind];
  if (typeof status === 'number' && status >= 500) return 'server-error';
  return 'failed';
}

/** 한 번 띄워 묻는다. 답 글 조각은 onToken 으로 */
async function ask(program: Program, cfg: ClaudeCodeConfig, req: ChatRequest, timeoutMs: number, deps: SubscriptionDeps): Promise<string> {
  const dir = await workDir();
  try {
    const systemFile = join(dir, 'system.txt');
    await writeFile(systemFile, claudeSystemText(req), { encoding: 'utf-8', mode: 0o600 });
    const args = claudeArgs(cfg.model, systemFile);
    let streamed = '';
    let answer: string | null = null;
    let errorKind: string | undefined;
    let resetsAt: number | undefined;
    let ended: { kind: FailKind } | null = null;
    let sawInit = false;
    const r = await runProgram(program, args, {
      signal: req.signal,
      idleMs: timeoutMs,
      cwd: dir,
      input: `${claudeUserLine(req.messages)}\n`,
      baseEnv: deps.baseEnv,
      spawn: deps.spawn,
      extraEnv: { DISABLE_AUTOUPDATER: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' },
      onLine: (line) => {
        let ev: Ev;
        try { ev = JSON.parse(line); } catch { return; }
        if (ev.type === 'system' && ev.subtype === 'init') {
          sawInit = true;
          const tools = Array.isArray(ev.tools) ? ev.tools.length : -1;
          const mcp = Array.isArray(ev.mcp_servers) ? ev.mcp_servers.length : -1;
          if (tools !== 0) throw new SubscriptionError('unsafe-tools', 'claude-code', { why: tools < 0 ? '도구 목록을 알려 주지 않음' : `도구 ${tools}개가 켜져 있음` });
          if (mcp !== 0) throw new SubscriptionError('unsafe-tools', 'claude-code', { why: mcp < 0 ? 'MCP 서버 목록을 알려 주지 않음' : `MCP 서버 ${mcp}개가 연결돼 있음` });
          // 'none' = API 키 없이 구독 로그인. 키 이름이 오거나 값이 없으면 보내지 않는다
          if (ev.apiKeySource === undefined) throw new SubscriptionError('needs-update', 'claude-code', { why: '로그인 방식을 알려 주지 않음' });
          if (ev.apiKeySource !== 'none') throw new SubscriptionError('metered', 'claude-code');
          return;
        }
        if (!sawInit && (ev.type === 'assistant' || ev.type === 'stream_event' || ev.type === 'result')) {
          throw new SubscriptionError('unsafe-tools', 'claude-code', { why: '시작 보고 전에 답이 옴' });
        }
        if (ev.type === 'stream_event') {
          const e = obj(ev.event);
          if (e?.type === 'message_start') streamed = ''; // 다시 시도한 답이면 앞 시도를 버린다
          const d = obj(e?.delta);
          if (e?.type === 'content_block_delta' && d?.type === 'text_delta' && typeof d.text === 'string') {
            streamed += d.text;
            req.onToken?.(d.text);
          }
          if ((e?.type === 'content_block_start' && isToolBlock(e.content_block)) || d?.type === 'input_json_delta') {
            throw new SubscriptionError('unsafe-tools', 'claude-code', { why: '도구를 쓰려 함' });
          }
          return;
        }
        if (ev.type === 'assistant') {
          const content = obj(ev.message)?.content;
          if (Array.isArray(content) && content.some(isToolBlock)) throw new SubscriptionError('unsafe-tools', 'claude-code', { why: '도구를 쓰려 함' });
          if (typeof ev.error === 'string') errorKind = ev.error;
          return;
        }
        if (ev.type === 'rate_limit_event') {
          const info = obj(ev.rate_limit_info);
          if (info?.status === 'rejected' && typeof info.resetsAt === 'number') resetsAt = info.resetsAt * 1000;
          return;
        }
        if (ev.type === 'control_request') throw new SubscriptionError('unsafe-tools', 'claude-code', { why: '허락을 물음' });
        // 도구 결과는 사용자 차례로 되돌아온다 (도구가 돌았다는 뜻)
        if (ev.type === 'user') throw new SubscriptionError('unsafe-tools', 'claude-code', { why: '도구 결과가 돌아옴' });
        if (ev.type === 'result') {
          const text = typeof ev.result === 'string' ? ev.result : '';
          if (ev.is_error === true || ev.subtype !== 'success') {
            ended = { kind: resetsAt ? 'rate-limit' : failureOf(errorKind, ev.api_error_status, text) };
          } else {
            answer = text || streamed;
          }
          return 'done';
        }
      },
    });
    if (ended) throw new SubscriptionError((ended as { kind: FailKind }).kind, 'claude-code', { resetsAt });
    if (answer !== null && (answer as string).trim()) return answer;
    if (answer !== null) throw new SubscriptionError('failed', 'claude-code', { why: '빈 답이 옴' });
    if (/unknown option|unknown argument|unrecognized/i.test(r.stderr)) throw new SubscriptionError('needs-update', 'claude-code', { why: '모르는 옵션이 있다고 함' });
    const kind = failureOf(errorKind, undefined, r.stderr);
    throw new SubscriptionError(kind, 'claude-code', kind === 'failed' ? { why: `답 없이 끝남, 종료 코드 ${r.code}` } : { resetsAt });
  } finally {
    await removeDir(dir);
  }
}

const findClaude = (cfg: ClaudeCodeConfig) => () => findProgram('claude-code', { configured: cfg.cli_path });

export function createClaudeCodeProvider(cfg: ClaudeCodeConfig, timeoutMs: number, deps: SubscriptionDeps = {}): LlmProvider {
  return {
    id: 'claude-code',
    isCloud: true,
    supportsVision: true,
    async chat(req) {
      // 통신 기록에 남기고, 폐쇄망 모드면 띄우기 전에 막는다
      assertProgramEgress('api.anthropic.com', 'Claude Code');
      const program = await (deps.find ?? findClaude(cfg))();
      if (!program) throw new SubscriptionError('not-installed', 'claude-code');
      await (deps.login ?? ((p: Program) => requireSubscription('claude-code', p, { signal: req.signal, baseEnv: deps.baseEnv, spawn: deps.spawn })))(program);
      return ask(program, cfg, req, timeoutMs, deps);
    },
    contextTokens: async () => SUBSCRIPTION_CONTEXT_TOKENS,
  };
}

export interface CliModel { id: string; label: string }

/** 고를 수 있는 모델: 공식 문서의 별칭. 프로그램을 띄우지 않는다 (계정에 없는 모델은 보낼 때 프로그램이 알린다) */
export const CLAUDE_MODELS: readonly CliModel[] = [
  { id: '', label: '기본 모델 (계정 기본값)' },
  { id: 'opus', label: 'Opus (복잡한 일)' },
  { id: 'sonnet', label: 'Sonnet (일상 작업)' },
  { id: 'haiku', label: 'Haiku (빠르고 가벼움)' },
  { id: 'fable', label: 'Fable (계정에서 쓸 수 있을 때)' },
];

export async function listClaudeCodeModels(_cfg: ClaudeCodeConfig, _signal: AbortSignal): Promise<CliModel[]> {
  return [...CLAUDE_MODELS];
}
