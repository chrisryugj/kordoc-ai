/** 구독 계정 다리: 이 PC 에 깔고 ChatGPT 로 로그인해 둔 Codex 로 한 번 묻고 답 받기
 *
 * 근거: Codex 공식 CLI(`codex exec --json` 비대화 실행, `--ignore-user-config`, `--sandbox read-only`, `--ephemeral`,
 * `--output-schema`, `-c`·`--disable`, `codex features list`, `codex login status`, `codex debug models`).
 * - 사용자 config.toml 을 읽지 않는다(MCP 서버·알림 프로그램·프로필이 따라오지 않음). 로그인은 Codex 자기 폴더에서 읽는다.
 * - Codex 자신의 도구는 기능 스위치로 끈다. read-only 샌드박스는 셸 명령 실행을 막지 않으므로(우리 실측: Windows·Codex 0.163)
 *   보내기 전에 `features list` 로 꺼진 것을 확인하고, 못 끄면 보내지 않는다. `unified_exec` 은 꺼도 true 로 남아(macOS·0.157 실측)
 *   셸 도구 스위치 `shell_tool` 로 보고, 마지막 방어는 아래 항목 감시다.
 * - 실행 중 글·생각·계획이 아닌 항목(명령 실행·파일 고침·MCP·웹 검색 등)이 보이면 바로 끝낸다.
 * - `exec --json` 은 글 조각을 흘리지 않아 답 전체가 끝에 한 번에 온다. 그래서 무응답 시간 제한을 설정값의 두 배로 둔다.
 * - 대화는 stdin 으로만, 그림·스키마는 작업 폴더 파일로.
 */

import { statSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { assertProgramEgress } from '../net-guard.js';
import { SUBSCRIPTION_CONTEXT_TOKENS, MODEL_NAME, type CliModel, type SubscriptionDeps } from './claude-code.js';
import { abortError, SubscriptionError, type FailKind } from './subscription/errors.js';
import { requireSubscription } from './subscription/login.js';
import { findProgram, removeDir, runProgram, workDir, type Program } from './subscription/program.js';
import type { ChatMessage, ChatRequest, LlmProvider } from './types.js';

export interface CodexConfig { model: string; cli_path: string }

/** 모델에게 도구·바깥 동작을 주는 기능 (codex-cli 0.157 `features list` 기준). 있는 것만 끈다 */
export const TOOL_FEATURES: readonly string[] = [
  'shell_tool', 'unified_exec', 'unified_exec_tty', 'shell_snapshot', 'view_image', 'image_generation',
  'browser_use', 'browser_use_external', 'browser_use_full_cdp_access', 'in_app_browser', 'computer_use',
  'apps', 'plugins', 'remote_plugin', 'multi_agent', 'multi_agent_v2', 'code_mode_host', 'hooks', 'sleep_tool',
  'goals', 'skill_search', 'skill_mcp_dependency_install', 'tool_suggest', 'realtime_conversation', 'worktrees',
  'in_app_local_automation', 'memories', 'request_permissions_tool', 'standalone_web_search',
];
/** 이것들은 꺼진 것을 확인해야 보낸다 (unified_exec 는 shell_tool 아래 구현이라 shell_tool 로 본다) */
export const MUST_BE_OFF: readonly string[] = ['shell_tool', 'view_image', 'image_generation', 'browser_use', 'computer_use', 'apps', 'plugins', 'multi_agent', 'code_mode_host', 'hooks'];

const CONFIG = ['-c', 'approval_policy="never"', '-c', 'web_search="disabled"', '-c', 'project_doc_max_bytes=0'];

/** `codex features list` 줄: 이름 · 단계 · 켜짐. 없어진(removed) 기능은 끌 수도 없어 뺀다 */
export function readFeatures(stdout: string): Map<string, boolean> {
  const m = new Map<string, boolean>();
  for (const line of stdout.split(/\r?\n/)) {
    const hit = line.match(/^(\S+)\s+(.*\S)\s+(true|false)\s*$/);
    if (hit && hit[2] !== 'removed') m.set(hit[1], hit[3] === 'true');
  }
  return m;
}

/** 프로그램마다 한 번: 끌 기능 목록을 정하고 꺼지는지 확인 */
const safety = new Map<string, Promise<string[]>>();
export function forgetCodexSafety(): void { safety.clear(); }

/** 같은 자리에 새 판이 깔리면(npm 업데이트) 다시 확인하도록 파일 수정 시각까지 키에 넣는다 */
function programKey(program: Program): string {
  const mtime = (f: string) => { try { return statSync(f).mtimeMs; } catch { return 0; } };
  return JSON.stringify([program.command, program.lead, [program.command, ...program.lead].map(mtime), program.env ?? {}]);
}

/** 한 요청을 취소해도 같이 기다리던 다른 요청의 확인은 계속된다: 확인은 자기 시간 제한만 따르고, 기다림만 요청 신호로 끊는다 */
function untilAborted<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((res, rej) => {
    const onAbort = () => rej(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    p.then(res, rej).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

async function disableArgs(program: Program, deps: SubscriptionDeps, signal: AbortSignal): Promise<string[]> {
  const key = programKey(program);
  let p = safety.get(key);
  if (!p) {
    p = (async () => {
      const opts = { signal: AbortSignal.timeout(20_000), idleMs: 20_000, baseEnv: deps.baseEnv, spawn: deps.spawn };
      const known = readFeatures((await runProgram(program, ['features', 'list'], opts)).stdout);
      if (!known.has('shell_tool')) throw new SubscriptionError('needs-update', 'codex', { why: '셸 도구를 끄는 설정이 없음' });
      const off = TOOL_FEATURES.filter((f) => known.has(f)).flatMap((f) => ['--disable', f]);
      const after = readFeatures((await runProgram(program, ['features', 'list', ...off, ...CONFIG], opts)).stdout);
      const stillOn = MUST_BE_OFF.filter((f) => after.get(f) === true);
      if (stillOn.length) throw new SubscriptionError('unsafe-tools', 'codex', { why: `${stillOn.join('·')} 기능이 꺼지지 않음` });
      return off;
    })();
    safety.set(key, p);
    p.catch(() => safety.delete(key)); // 실패는 기억하지 않는다 (업데이트 뒤 다시 확인)
  }
  return untilAborted(p, signal);
}

export function codexArgs(o: { dir: string; model: string; disable: string[]; images: string[]; schemaFile?: string }): string[] {
  if (o.model && !MODEL_NAME.test(o.model)) throw new SubscriptionError('bad-request', 'codex', { why: '모델 이름 꼴이 아님' });
  return [
    'exec',
    ...o.images.flatMap((f) => ['--image', f]),
    '--json', '--ignore-user-config', '--ignore-rules', '--ephemeral', '--skip-git-repo-check',
    '--sandbox', 'read-only', '--color', 'never', '--cd', o.dir,
    ...CONFIG, ...o.disable,
    ...(o.model ? ['--model', o.model] : []),
    ...(o.schemaFile ? ['--output-schema', o.schemaFile] : []),
    '-',
  ];
}

/** stdin 으로 줄 글: 우리 지시 + 호출한 쪽 지시 + 대화 */
export function codexPrompt(req: Pick<ChatRequest, 'system' | 'messages' | 'json' | 'schema' | 'maxTokens'>): string {
  const parts = ['이 요청은 KorDoc AI 가 보낸 것입니다. 도구는 없습니다. 파일·명령·웹을 쓰지 말고, 받은 글만 보고 답을 글로만 쓰세요.'];
  if (req.json || req.schema) parts.push('답은 JSON 객체 하나만 쓰세요. 코드 블록·설명을 붙이지 마세요.');
  if (req.maxTokens) parts.push(`답은 대략 ${req.maxTokens} 토큰 안으로 쓰세요.`);
  if (req.system) parts.push(`<instructions>\n${req.system}\n</instructions>`);
  if (!req.messages.length) throw new SubscriptionError('bad-request', 'codex', { why: '보낼 대화가 없음' });
  const turns = (m: ChatMessage[]) => m.map((x) => `<${x.role}>\n${x.content}\n</${x.role}>`).join('\n');
  parts.push(req.messages.length === 1 ? req.messages[0].content : `<conversation>\n${turns(req.messages)}\n</conversation>\n마지막 user 말에 답하세요.`);
  return parts.join('\n\n');
}

function failureOf(text: string): FailKind {
  // 긴 문서 문장에도 토큰 수(140123 등)가 들어 있어 숫자 상태 코드보다 먼저, 상태 코드는 낱말 경계로 본다
  if (/context (window|length)|too long|maximum context|too many tokens/i.test(text)) return 'too-long';
  if (/\b401\b|unauthori[sz]ed|not logged in|log ?in again|sign in/i.test(text)) return 'signed-out';
  if (/usage limit|rate.?limit|\b429\b|quota/i.test(text)) return 'rate-limit';
  if (/overloaded|503/i.test(text)) return 'overloaded';
  if (/\b5\d\d\b|server error|internal error/i.test(text)) return 'server-error';
  if (/\b400\b|invalid_request|bad request|unsupported model|model .{0,40}not (found|supported)/i.test(text)) return 'bad-request';
  if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|network|dns|failed to connect|timed out/i.test(text)) return 'network';
  return 'failed';
}

/** 글·생각·계획·알림이 아닌 항목은 도구가 움직인 것 */
const ALLOWED_ITEMS = new Set(['agent_message', 'reasoning', 'todo_list', 'error']);
/** 화면 문장에 넣을 이름 (프로그램이 낸 원문은 넣지 않는다) */
const ITEM_LABEL: Record<string, string> = { command_execution: '명령 실행', file_change: '파일 고침', mcp_tool_call: 'MCP 도구', web_search: '웹 검색' };
const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };

type Ev = Record<string, unknown>;
const obj = (v: unknown): Ev | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Ev) : undefined);

async function ask(program: Program, cfg: CodexConfig, req: ChatRequest, timeoutMs: number, deps: SubscriptionDeps): Promise<string> {
  const disable = await disableArgs(program, deps, req.signal);
  const dir = await workDir();
  try {
    const images: string[] = [];
    for (const [i, im] of req.messages.flatMap((m) => m.images ?? []).entries()) {
      const f = join(dir, `image-${i + 1}.${EXT[im.mime] ?? 'png'}`);
      await writeFile(f, Buffer.from(im.base64, 'base64'), { mode: 0o600 });
      images.push(f);
    }
    let schemaFile: string | undefined;
    if (req.schema) {
      schemaFile = join(dir, 'schema.json');
      await writeFile(schemaFile, JSON.stringify(req.schema), { mode: 0o600 });
    }
    let answer: string | null = null;
    let done = false;
    let failed: string | null = null;
    let lastError = '';
    const r = await runProgram(program, codexArgs({ dir, model: cfg.model, disable, images, schemaFile }), {
      signal: req.signal,
      idleMs: timeoutMs * 2,
      cwd: dir,
      input: codexPrompt(req),
      baseEnv: deps.baseEnv,
      spawn: deps.spawn,
      onLine: (line) => {
        let ev: Ev;
        try { ev = JSON.parse(line); } catch { return; }
        const type = String(ev.type);
        if (type.startsWith('item.')) {
          const item = obj(ev.item);
          const kind = String(item?.type);
          if (!ALLOWED_ITEMS.has(kind)) throw new SubscriptionError('unsafe-tools', 'codex', { why: `${ITEM_LABEL[kind] ?? '도구 사용'} 항목이 나옴` });
          if (type === 'item.completed' && kind === 'agent_message' && typeof item?.text === 'string') answer = item.text; // 마지막 글이 답 (앞의 글은 진행 안내)
        } else if (type === 'error') {
          lastError = String(ev.message ?? '');
        } else if (type === 'turn.failed') {
          failed = String(obj(ev.error)?.message ?? lastError);
        } else if (type === 'turn.completed') {
          done = true;
          return 'done';
        }
      },
    });
    if (failed !== null) throw new SubscriptionError(failureOf(failed), 'codex');
    if (done) {
      const text = (answer as string | null) ?? '';
      if (!text.trim()) throw new SubscriptionError('failed', 'codex', { why: '빈 답이 옴' });
      req.onToken?.(text);
      return text;
    }
    if (/unexpected argument|unrecognized|unknown (option|flag|feature)/i.test(r.stderr)) throw new SubscriptionError('needs-update', 'codex', { why: '모르는 옵션이 있다고 함' });
    const kind = failureOf(`${lastError}\n${r.stderr}`);
    throw new SubscriptionError(kind, 'codex', kind === 'failed' ? { why: `답 없이 끝남, 종료 코드 ${r.code}` } : {});
  } finally {
    await removeDir(dir);
  }
}

export function createCodexProvider(cfg: CodexConfig, timeoutMs: number, deps: SubscriptionDeps = {}): LlmProvider {
  return {
    id: 'codex',
    isCloud: true,
    supportsVision: true,
    async chat(req) {
      assertProgramEgress('chatgpt.com', 'Codex');
      const program = await (deps.find ?? (() => findProgram('codex', { configured: cfg.cli_path })))();
      if (!program) throw new SubscriptionError('not-installed', 'codex');
      await (deps.login ?? ((p: Program) => requireSubscription('codex', p, { signal: req.signal, baseEnv: deps.baseEnv, spawn: deps.spawn })))(program);
      return ask(program, cfg, req, timeoutMs, deps);
    },
    contextTokens: async () => SUBSCRIPTION_CONTEXT_TOKENS,
  };
}

/** `codex debug models` 의 목록 중 보이게 둔 것 (모델을 부르지 않음). 맨 앞은 Codex 기본 모델 */
export function readCodexModels(stdout: string): CliModel[] {
  let list: unknown;
  try { list = obj(JSON.parse(stdout))?.models; } catch { return []; }
  if (!Array.isArray(list)) return [];
  return list
    .map(obj)
    .filter((m): m is Ev => Boolean(m && typeof m.slug === 'string' && MODEL_NAME.test(m.slug) && m.visibility === 'list'))
    .sort((a, b) => Number(a.priority ?? 999) - Number(b.priority ?? 999))
    .map((m) => ({ id: String(m.slug), label: typeof m.display_name === 'string' ? m.display_name : String(m.slug) }));
}

export async function listCodexModels(cfg: CodexConfig, signal: AbortSignal, deps: SubscriptionDeps = {}): Promise<CliModel[]> {
  const program = await (deps.find ?? (() => findProgram('codex', { configured: cfg.cli_path })))();
  if (!program) throw new SubscriptionError('not-installed', 'codex');
  assertProgramEgress('chatgpt.com', 'Codex 모델 목록'); // 목록을 받아 올 수 있다
  const r = await runProgram(program, ['debug', 'models'], { signal, idleMs: 30_000, baseEnv: deps.baseEnv, spawn: deps.spawn });
  return [{ id: '', label: '기본 모델 (Codex 기본값)' }, ...readCodexModels(r.stdout)];
}
