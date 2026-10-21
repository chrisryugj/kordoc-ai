/** 구독 계정(Claude Code) 공급자 — PC 에 설치해 로그인해 둔 Claude Code 프로그램을 "한 번 답하는 두뇌"로 띄운다
 *
 * 이음오피스 packages/ai-provider/src/claude-code-cli.ts(Apache-2.0, 커밋 9bda9ac)에서 옮김.
 * 바꾼 곳: 앱 도구 호출용 구조화 차례(text+toolCalls, TurnTextScanner)는 빼고 kordoc 공급자 계약(글 하나, json·schema)에 맞춤,
 * 스키마는 지시문으로 주고 답은 parseJsonLoose 가 읽는다(--json-schema 는 StructuredOutput 도구가 생겨 0-도구 확인이 깨져서 쓰지 않음),
 * 사용량 창(rate_limit_event)은 한도 시각만 읽음, 실행 전 로그인 확인·폐쇄망 관문·통신 기록, 오류는 한국어 할 일 안내,
 * 응답이 멈춘 시간 기준 시간 제한을 더함.
 *
 * 지키는 것 (이음오피스 packages/ai-provider/AGENTS.md):
 * - 셸 없이 찾아 둔 실제 실행 파일 + 고정 인자. 문서·지시문·대화는 전부 stdin 으로(명령줄에 올리지 않는다). 명령줄의 가변 값은 MODEL_NAME 을 통과한 모델 이름뿐.
 * - 도구 0개: --tools "" · --restricted · --strict-mcp-config · --setting-sources "" · --disable-slash-commands · --no-session-persistence,
 *   실행마다 새 빈 임시 폴더. 플래그를 믿지 않고 init 보고의 tools 가 빈 배열이고 MCP 서버가 없을 때만 답을 받아들인다.
 *   한계(이음오피스 AGENTS.md 와 같음): Claude Code 는 첫 사용자 메시지를 stdin 으로 받은 뒤에야 도구 목록(init)을 알리므로
 *   확인은 그 시점에 이뤄진다. 도구가 보이면 답·도구 호출을 하나도 쓰지 않고 프로세스 트리를 끝낸다(대화는 이미 Anthropic 으로 갔다).
 *   init 전에 온 답·도구 블록·권한 요청도 모두 같은 처리. --bare 는 구독 로그인을 못 읽어 쓰지 않는다.
 * - 자식 환경에서 API 키·다른 요금 경로 변수를 뺀다(process.ts). 취소·시간 초과·오류면 프로세스 트리를 끝낸다.
 */

import type { ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertProgramEgress } from '../net-guard.js';
import { resolveSubscriptionProgram, type SubscriptionProgram } from './subscription/locate.js';
import { cancelledError, CliRunError } from './subscription/messages.js';
import { killProcessTree, MAX_LINE_BYTES, readLines, spawnSubscriptionProgram, type SpawnFn } from './subscription/process.js';
import { assertSubscriptionLogin } from './subscription/status.js';
import type { ChatMessage, ChatRequest, LlmProvider } from './types.js';

const PROVIDER = 'claude-code';
const EGRESS_HOST = 'api.anthropic.com';
const INITIALIZE_ID = 'initialize';
const EXIT_GRACE_MS = 5_000;
const TEMP_PREFIX = 'kordoc-claude-code-';
/** 짧게 도는 차례가 시작한 자동 업데이트가 중간에 끊기지 않게. 로그인·요금 경로와 무관 */
const RUN_ENV: Readonly<Record<string, string>> = { DISABLE_AUTOUPDATER: '1', DISABLE_TELEMETRY: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' };

export interface ClaudeCodeConfig {
  model: string;
  cli_path: string;
}

/** 시험용 바꿔 끼우기 — 어느 것도 실행 조건(도구 0개 확인)을 느슨하게 하지 않는다 */
export interface CliDeps {
  resolveProgram?: (configuredPath: string) => Promise<SubscriptionProgram>;
  spawn?: SpawnFn;
  killTree?: (child: { readonly pid?: number }) => void;
  baseEnv?: NodeJS.ProcessEnv;
  exitGraceMs?: number;
  /** 실행 직전 로그인 확인 (기본: 프로그램에 물어 10분 기억) */
  checkLogin?: (program: SubscriptionProgram) => Promise<void>;
}

const NO_TOOLS = '당신은 사무용 앱(KorDoc AI)에 들어 있는 언어 모델입니다. 스스로 쓰는 도구는 없습니다: 파일을 읽거나 고치거나, 명령을 실행하거나, 웹을 보거나, 어떤 도구도 부를 수 없고 시도하지 않습니다.';

/** 구독 프로그램 차례에 넣을 수 있는 토큰 — 모델 창(약 20만)에서 프로그램 자신의 지시문·여유를 뺀 값.
 *  contextCharBudget 이 이것으로 문서 글자 예산을 잡는다(인터넷 API 의 40만 자보다 작게: 넘치면 "문서가 너무 깁니다") */
export const SUBSCRIPTION_CONTEXT_TOKENS = 180_000;

/** 프로그램이 받는 모델 별칭·이름. 옵션으로 읽힐 수 있는 값은 막는다 */
export const MODEL_NAME = /^[A-Za-z0-9][A-Za-z0-9._:[\]-]{0,127}$/;

/** 명령줄 전체 — 고정 플래그 + 설정한 모델 */
export function claudeCodeLaunchArgs(model: string): string[] {
  const name = model.trim();
  if (name && !MODEL_NAME.test(name)) throw new CliRunError('failed', PROVIDER, `Claude Code 모델 이름이 올바르지 않습니다(${name.slice(0, 40)}). 설정 > AI 연결에서 모델을 다시 고르세요.`);
  return [
    '-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    '--tools', '', '--restricted', '--strict-mcp-config', '--setting-sources', '',
    '--disable-slash-commands', '--no-session-persistence',
    ...(name ? ['--model', name] : []),
  ];
}

type Block = { type: 'text'; text: string } | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } };

/** 지시문 — 앱의 system 뒤에 도구 없음·답 모양을 붙인다 */
export function claudeCodeInstructions(req: Pick<ChatRequest, 'json' | 'schema' | 'maxTokens'>): string {
  const parts = [NO_TOOLS];
  if (req.json || req.schema) parts.push('JSON 객체 하나로만 답합니다: 앞뒤 설명·코드블록 없이.');
  else parts.push('요청에 바로 답합니다.');
  if (req.schema) parts.push(`답은 이 JSON 스키마를 따릅니다:\n<response_schema>\n${JSON.stringify(req.schema)}\n</response_schema>`);
  if (req.maxTokens) parts.push(`답은 대략 ${req.maxTokens} 토큰 안으로 씁니다.`);
  return parts.join(' ');
}

const imageBlocks = (m: ChatMessage): Block[] => (m.images ?? []).map((img) => ({ type: 'image', source: { type: 'base64', media_type: img.mime, data: img.base64 } }));

/** 대화 → 사용자 메시지 하나. 한 차례면 그대로, 여러 차례면 차례마다 JSON 한 블록(그림은 그 차례 바로 뒤) */
export function conversationBlocks(messages: ChatMessage[]): Block[] {
  if (messages.length === 1 && messages[0].role === 'user') return [...imageBlocks(messages[0]), { type: 'text', text: messages[0].content }];
  const blocks: Block[] = [{ type: 'text', text: '다음 블록들은 지금까지의 대화입니다. 차례마다 JSON 하나이고, 사용자 차례에 붙은 그림은 그 바로 뒤에 옵니다. 마지막 사용자 차례에 답하세요.' }];
  for (const m of messages) {
    blocks.push({ type: 'text', text: JSON.stringify({ role: m.role, text: m.content }) });
    if (m.role === 'user') blocks.push(...imageBlocks(m));
  }
  return blocks;
}

/** stdin 두 줄: 먼저 initialize(지시문), 받아들였다는 답이 오면 사용자 메시지 */
export function buildClaudeCodeInput(req: Pick<ChatRequest, 'system' | 'messages' | 'json' | 'schema' | 'maxTokens'>) {
  return {
    initialize: { type: 'control_request', request_id: INITIALIZE_ID, request: { subtype: 'initialize', systemPrompt: [req.system ?? '', claudeCodeInstructions(req)].filter((s) => s.trim()) } },
    user: { type: 'user', message: { role: 'user', content: conversationBlocks(req.messages) } },
  };
}

// ── 실패 → 할 일 ──

const UNKNOWN_OPTION = /unknown option|unknown argument|unrecognized option/i;
const SIGNED_OUT_TEXT = /not logged in|please run \/login|invalid api key|authentication/i;
const NETWORK_TEXT = /connection error|unable to connect|fetch failed|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ECONNRESET|socket hang up/i;
const TIMEOUT_TEXT = /timed out|timeout/i;
const TOO_LONG_TEXT = /prompt is too long|context window|context length|too many (input )?tokens|input is too long/i;

/** 프로그램이 스스로 알린 실패. code 는 assistant 메시지의 error(authentication_failed·rate_limit·overloaded…), status 는 api_error_status */
export function reportedFailure(code: string | undefined, status: unknown, text: string, rateLimit: Record<string, unknown> | undefined): CliRunError {
  if (code === 'authentication_failed' || status === 401) return new CliRunError('signed-out', PROVIDER);
  if (code === 'rate_limit' || status === 429) {
    const r = rateLimit?.status === 'rejected' && typeof rateLimit.resetsAt === 'number' && rateLimit.resetsAt > 0 ? Math.round(rateLimit.resetsAt * 1000) : undefined;
    return new CliRunError('rate-limit', PROVIDER, undefined, { resetsAt: r });
  }
  if (TOO_LONG_TEXT.test(text)) return new CliRunError('too-long', PROVIDER);
  if (code === 'overloaded' || status === 529 || status === 503) return new CliRunError('overloaded', PROVIDER);
  if (code === 'server_error' || (typeof status === 'number' && status >= 500)) return new CliRunError('server-error', PROVIDER);
  if (NETWORK_TEXT.test(text)) return new CliRunError('network', PROVIDER);
  if (TIMEOUT_TEXT.test(text)) return new CliRunError('failed', PROVIDER, 'Claude Code 쪽 요청 시간이 넘었습니다.');
  if ((!code || code === 'unknown') && SIGNED_OUT_TEXT.test(text)) return new CliRunError('signed-out', PROVIDER);
  if (code === 'model_not_found' || status === 404) return new CliRunError('failed', PROVIDER, '고른 모델을 Claude Code가 찾지 못했습니다. 설정 > AI 연결에서 모델을 비우거나(기본 모델) 다른 모델을 고르세요.');
  if (code === 'invalid_request' || status === 400) return new CliRunError('bad-request', PROVIDER);
  return new CliRunError('failed', PROVIDER, 'Claude Code가 오류를 알렸습니다.');
}

/** 결과 없이 끝난 프로그램. 출력 원문은 계정 이름이 섞일 수 있어 문장에 넣지 않는다 */
export function exitFailure(code: number | null, stderr: string): CliRunError {
  if (UNKNOWN_OPTION.test(stderr)) return new CliRunError('needs-update', PROVIDER, 'Claude Code 버전이 낮아 이 앱이 쓰는 옵션을 모릅니다.');
  if (SIGNED_OUT_TEXT.test(stderr)) return new CliRunError('signed-out', PROVIDER);
  return new CliRunError('failed', PROVIDER, `Claude Code가 답하기 전에 끝났습니다(종료 코드 ${code ?? '없음'}).`);
}

export function startFailure(err: unknown): CliRunError {
  const code = (err as { code?: unknown } | null)?.code;
  if (code === 'ENOENT') return new CliRunError('not-installed', PROVIDER, 'Claude Code 프로그램을 실행하지 못했습니다.');
  return new CliRunError('failed', PROVIDER, `Claude Code를 실행하지 못했습니다${typeof code === 'string' ? `(${code})` : ''}.`);
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const textOf = (content: unknown) => (Array.isArray(content) ? content.map((b) => (isObj(b) && b.type === 'text' && typeof b.text === 'string' ? b.text : '')).join('') : '');
/** tool_use·server_tool_use·mcp_tool_use 와 그 결과 */
const isToolBlock = (b: unknown) => isObj(b) && typeof b.type === 'string' && /tool_use$|tool_result$/.test(b.type);

/** 프로그램을 찾아 로그인을 확인하고 새 빈 폴더에서 띄운다 */
async function startChild(cfg: ClaudeCodeConfig, model: string, deps: CliDeps, signal: AbortSignal): Promise<{ child: ChildProcess; removeCwd: () => void }> {
  const args = claudeCodeLaunchArgs(model);
  const program = await (deps.resolveProgram ?? ((p: string) => resolveSubscriptionProgram(PROVIDER, { configuredPath: p })))(cfg.cli_path);
  if (signal.aborted) throw cancelledError();
  await (deps.checkLogin ?? ((p) => assertSubscriptionLogin(PROVIDER, p)))(program);
  if (signal.aborted) throw cancelledError();
  // 실행마다 새 빈 폴더 — 다른 폴더의 프로젝트 설정(CLAUDE.md 등)이 끼지 않게
  const cwd = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
  const removeCwd = () => void rm(cwd, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined);
  try {
    if (signal.aborted) throw cancelledError();
    const child = spawnSubscriptionProgram(program, args, { cwd, baseEnv: deps.baseEnv, env: { ...RUN_ENV }, spawn: deps.spawn });
    return { child, removeCwd };
  } catch (err) {
    removeCwd();
    throw err instanceof DOMException ? err : startFailure(err);
  }
}

/** 한 차례 — 글 조각을 흘리고 답 전체를 돌려준다 */
function runTurn(child: ChildProcess, removeCwd: () => void, req: ChatRequest, timeoutMs: number, deps: CliDeps): Promise<string> {
  const killTree = deps.killTree ?? ((c) => killProcessTree(c));
  const input = buildClaudeCodeInput(req);
  return new Promise<string>((resolve, reject) => {
    let settled = false;
    let exited = false;
    let stderr = '';
    let initialized = false;
    let verified = false;
    let raw = '';
    let whole = '';
    let emitted = '';
    let skip = 0;
    /** 마지막 시도의 답 전체 — 흘린 조각(emitted)은 재시도 때 앞 시도와 섞일 수 있어 돌려주는 값으로 쓰지 않는다 */
    let final: string | undefined;
    let failureCode: string | undefined;
    let failureText = '';
    let rateLimit: Record<string, unknown> | undefined;
    let idle: NodeJS.Timeout | undefined;

    const stop = (force: boolean) => {
      if (exited) return;
      if (force) { killTree(child); return; }
      child.stdin?.end(); // 입력이 끝나면 스스로 나간다. 안 나가면 끝낸다
      const t = setTimeout(() => { if (!exited) killTree(child); }, deps.exitGraceMs ?? EXIT_GRACE_MS);
      t.unref?.();
      child.once('close', () => clearTimeout(t));
    };
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(idle);
      clearTimeout(cap);
      req.signal.removeEventListener('abort', onAbort);
      stop(err !== undefined);
      if (err) reject(err);
      else resolve(final ?? emitted);
    };
    // 응답이 멈춘 시간 기준 + 전체 상한(4배)
    const touch = () => {
      clearTimeout(idle);
      idle = setTimeout(() => finish(new CliRunError('timeout', PROVIDER, undefined, { seconds: Math.round(timeoutMs / 1000) })), timeoutMs);
    };
    const cap = setTimeout(() => finish(new CliRunError('timeout', PROVIDER, undefined, { seconds: Math.round((timeoutMs * 4) / 1000) })), timeoutMs * 4);
    const onAbort = () => finish(cancelledError());
    const refuse = (why: string) => finish(new CliRunError('unsafe-tools', PROVIDER, why));
    const requireVerified = () => { if (!verified) refuse('도구 목록을 알리기 전에 답하기 시작함'); return verified; };
    const write = (m: unknown) => { if (child.stdin?.writable) child.stdin.write(`${JSON.stringify(m)}\n`); };
    const deliver = (piece: string) => {
      if (skip > 0) { const n = Math.min(skip, piece.length); skip -= n; piece = piece.slice(n); }
      if (!piece) return;
      emitted += piece;
      req.onToken?.(piece);
    };

    /** 첫 도구 기미에서 멈춘다: 프로그램 자신의 것이든 MCP 서버의 것이든 */
    const checkTools = (ev: Record<string, unknown>) => {
      if (!Array.isArray(ev.tools)) { refuse('도구 목록을 알리지 않음'); return; }
      if (ev.tools.length) { refuse(`도구 ${ev.tools.length}개가 켜져 있음`); return; }
      const servers = ev.mcp_servers;
      if (Array.isArray(servers) ? servers.length > 0 : servers != null) { refuse('MCP 서버가 붙어 있음'); return; }
      verified = true;
    };

    const onStreamEvent = (ev: Record<string, unknown>) => {
      if (ev.type === 'content_block_start') { if (isToolBlock(ev.content_block)) refuse('도구를 부르기 시작함'); return; }
      if (ev.type === 'message_start') {
        // 다시 보낸 답(재시도): 이미 흘린 만큼 건너뛴다
        if (raw) { raw = ''; whole = ''; skip = emitted.length; }
        return;
      }
      if (ev.type !== 'content_block_delta' || !isObj(ev.delta)) return;
      const d = ev.delta;
      if (d.type === 'text_delta' && typeof d.text === 'string') { raw += d.text; deliver(d.text); }
      else if (d.type === 'input_json_delta') refuse('도구를 부르기 시작함');
      // thinking_delta 는 버린다 (사고 글은 화면에 내지 않는다)
    };

    const onResult = (ev: Record<string, unknown>) => {
      if (ev.is_error === true || ev.subtype !== 'success') {
        finish(reportedFailure(failureCode, ev.api_error_status, `${typeof ev.result === 'string' ? ev.result : ''} ${failureText} ${Array.isArray(ev.errors) ? ev.errors.join('; ') : ''}`, rateLimit));
        return;
      }
      if (!requireVerified()) return;
      const answer = raw || whole || (typeof ev.result === 'string' ? ev.result : '');
      skip = 0;
      if (answer.length > emitted.length && answer.startsWith(emitted)) deliver(answer.slice(emitted.length));
      else if (!emitted) deliver(answer);
      final = answer;
      finish();
    };

    const onLine = (line: string) => {
      if (settled) return;
      touch();
      let ev: unknown;
      try { ev = JSON.parse(line); } catch { return; }
      if (!isObj(ev)) return;
      switch (ev.type) {
        case 'control_response': {
          const r = ev.response;
          if (!isObj(r) || r.request_id !== INITIALIZE_ID || initialized) return;
          if (r.subtype !== 'success') { finish(new CliRunError('needs-update', PROVIDER, 'Claude Code가 이 앱의 준비 요청을 받지 않았습니다(버전이 낮을 수 있음).')); return; }
          // 지시문이 자리 잡은 뒤에야 대화가 앱 밖으로 나간다
          initialized = true;
          write(input.user);
          return;
        }
        case 'control_request': {
          const subtype = isObj(ev.request) ? ev.request.subtype : undefined;
          if (subtype === 'can_use_tool') { refuse('도구 사용 허락을 물음'); return; }
          // 훅·MCP 를 하나도 등록하지 않았으니 올 것이 없다. 기다리게 두지 않고 거절로 답한다
          write({ type: 'control_response', response: { subtype: 'error', request_id: ev.request_id, error: `Unsupported request: ${String(subtype)}` } });
          return;
        }
        case 'system':
          if (ev.subtype === 'init') checkTools(ev);
          return;
        case 'rate_limit_event':
          if (isObj(ev.rate_limit_info)) rateLimit = ev.rate_limit_info;
          return;
        case 'stream_event':
          if (requireVerified() && isObj(ev.event)) onStreamEvent(ev.event);
          return;
        case 'assistant': {
          const content = isObj(ev.message) ? ev.message.content : undefined;
          if (typeof ev.error === 'string') { failureCode = ev.error; failureText = textOf(content); return; }
          if (!requireVerified()) return;
          if (Array.isArray(content) && content.some(isToolBlock)) { refuse('도구를 부름'); return; }
          whole += textOf(content);
          return;
        }
        case 'user': {
          const content = isObj(ev.message) ? ev.message.content : undefined;
          if (Array.isArray(content) && content.some(isToolBlock)) refuse('도구를 실행함');
          return;
        }
        case 'result':
          onResult(ev);
      }
    };

    child.stdin?.on('error', () => undefined);
    child.stderr?.on('data', (c: Buffer) => { stderr = (stderr + c.toString()).slice(-4000); });
    if (child.stdout) {
      readLines(child.stdout, (line) => {
        try { onLine(line); } catch (err) { finish(err instanceof Error ? err : new Error(String(err))); }
      }, () => finish(new CliRunError('failed', PROVIDER, `Claude Code가 줄바꿈 없이 ${MAX_LINE_BYTES} 바이트 넘게 써서 멈췄습니다.`)));
    }
    child.once('error', (err) => {
      if (child.pid === undefined) { exited = true; removeCwd(); }
      finish(startFailure(err));
    });
    child.once('close', (code) => {
      exited = true;
      removeCwd();
      finish(failureCode ? reportedFailure(failureCode, undefined, failureText, rateLimit) : exitFailure(code, stderr));
    });
    if (req.signal.aborted) { finish(cancelledError()); return; }
    req.signal.addEventListener('abort', onAbort, { once: true });
    touch();
    write(input.initialize);
  });
}

export function createClaudeCodeProvider(cfg: ClaudeCodeConfig, timeoutMs: number, deps: CliDeps = {}): LlmProvider {
  return {
    id: PROVIDER,
    isCloud: true, // 문서가 Anthropic 서버로 간다 → 자동 마스킹·폐쇄망 차단
    supportsVision: true,
    async chat(req) {
      if (req.signal.aborted) throw cancelledError();
      assertProgramEgress(EGRESS_HOST, 'Claude Code');
      const { child, removeCwd } = await startChild(cfg, cfg.model, deps, req.signal);
      return runTurn(child, removeCwd, req, timeoutMs, deps);
    },
    contextTokens: async () => SUBSCRIPTION_CONTEXT_TOKENS,
    listModels: (signal) => listClaudeCodeModels(cfg, signal ?? AbortSignal.timeout(15_000), deps).then((ms) => ms.map((m) => m.id)),
  };
}

// ── 모델 목록 — 모델을 부르지 않고 initialize 답의 models 만 읽는다 ──

export interface CliModel {
  /** --model 에 넘길 값. 빈 값 = 프로그램 기본 모델 */
  id: string;
  label: string;
}

/** initialize 답의 models 만 읽는다(같은 답의 계정 정보는 건드리지 않음) */
export function claudeCodeModels(initialized: unknown): CliModel[] {
  const listed = isObj(initialized) ? initialized.models : undefined;
  if (!Array.isArray(listed)) return [];
  const out: CliModel[] = [];
  for (const e of listed) {
    if (!isObj(e) || typeof e.value !== 'string') continue;
    const value = e.value.trim();
    if (!MODEL_NAME.test(value)) continue;
    const id = value === 'default' ? '' : value;
    if (out.some((m) => m.id === id)) continue;
    const name = typeof e.displayName === 'string' ? e.displayName.trim().slice(0, 80) : '';
    out.push({ id, label: name || value });
  }
  return out;
}

export async function listClaudeCodeModels(cfg: ClaudeCodeConfig, signal: AbortSignal, deps: CliDeps = {}): Promise<CliModel[]> {
  if (signal.aborted) throw cancelledError();
  assertProgramEgress(EGRESS_HOST, 'Claude Code 모델 목록');
  const { child, removeCwd } = await startChild(cfg, '', { ...deps, checkLogin: deps.checkLogin ?? (async () => {}) }, signal);
  const killTree = deps.killTree ?? ((c) => killProcessTree(c));
  return new Promise<CliModel[]>((resolve, reject) => {
    let settled = false;
    let exited = false;
    const finish = (models: CliModel[] | undefined, err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      if (!exited) {
        if (err) killTree(child);
        else {
          child.stdin?.end();
          const g = setTimeout(() => { if (!exited) killTree(child); }, deps.exitGraceMs ?? EXIT_GRACE_MS);
          g.unref?.();
          child.once('close', () => clearTimeout(g));
        }
      }
      if (err) reject(err);
      else resolve(models ?? []);
    };
    const onAbort = () => finish(undefined, cancelledError());
    const timer = setTimeout(() => finish(undefined, new CliRunError('failed', PROVIDER, 'Claude Code가 모델 목록을 제때 알려 주지 않았습니다.')), 15_000);
    child.stdin?.on('error', () => undefined);
    child.stderr?.on('data', () => undefined); // 출력은 남기지 않는다 (계정 이름이 섞일 수 있음)
    if (child.stdout) {
      readLines(child.stdout, (line) => {
        if (settled) return;
        let ev: unknown;
        try { ev = JSON.parse(line); } catch { return; }
        if (!isObj(ev)) return;
        if (ev.type === 'control_response') {
          const r = ev.response;
          if (isObj(r) && r.request_id === INITIALIZE_ID) finish(r.subtype === 'success' ? claudeCodeModels(r.response) : []);
          return;
        }
        // 모델에 아무것도 묻지 않았으니 답·권한 요청·결과가 오면 하라는 일이 아니다
        if (['control_request', 'stream_event', 'assistant', 'user', 'result'].includes(String(ev.type))) {
          finish(undefined, new CliRunError('unsafe-tools', PROVIDER, '모델 목록만 물었는데 다른 일을 함'));
        }
      }, () => finish(undefined, new CliRunError('failed', PROVIDER, 'Claude Code가 끝없는 줄을 써서 멈췄습니다.')));
    }
    child.once('error', (err) => { if (child.pid === undefined) { exited = true; removeCwd(); } finish(undefined, startFailure(err)); });
    child.once('close', () => { exited = true; removeCwd(); finish(undefined, new CliRunError('failed', PROVIDER, 'Claude Code가 모델 목록을 알려 주기 전에 끝났습니다.')); });
    signal.addEventListener('abort', onAbort, { once: true });
    if (child.stdin?.writable) child.stdin.write(`${JSON.stringify({ type: 'control_request', request_id: INITIALIZE_ID, request: { subtype: 'initialize', systemPrompt: [NO_TOOLS] } })}\n`);
  });
}
