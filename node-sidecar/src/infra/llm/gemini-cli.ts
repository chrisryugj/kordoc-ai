/** 구독 계정 다리: 이 PC 에 깔고 Google 계정으로 로그인해 둔 Antigravity CLI(agy)로 한 번 묻고 답 받기
 *
 * Gemini CLI 는 2026-06-18 부터 개인 Google 계정(무료·AI Pro·Ultra) 요청을 받지 않아 같은 자리(provider id 'gemini-cli')를
 * Google 의 후속 CLI 인 agy 로 바꿨다. 설정 값·화면 칸은 그대로 쓴다.
 *
 * 근거: agy 1.5 공식 문서(headless: `--input-format stream-json` + `--output-format stream-json`, 줄마다 `{"event":"user",...}`,
 * 출력 init·step_update·result, `--settings` 이번 실행만의 설정, permissions 의 action(target) 거절 규칙, `agy models`).
 * 실측(Windows·1.5.0, 가장 싼 모델로 몇 번):
 * - **모델에게 알리는 도구 선언(60개: 파일·명령·브라우저·웹 검색·그림·예약·하위 에이전트)은 끌 수 없다.** 도구를 줄인 에이전트
 *   (`--agent`, frontmatter tools)도 그대로 60개였다. 그래서 Claude Code·Codex 보다 보호가 약하고, 대신 세 겹으로 막는다:
 *   1) 이번 실행만의 설정: toolPermission strict, 모든 범주(read_file·write_file·read_url·execute_url·command·unsandboxed·mcp)를 (*) 로 거절.
 *      실측: 파일 읽기·명령 실행을 시키면 "permission check failed … deny rule" 로 실제로 막힌다.
 *      규칙이 받는 범주는 이 일곱뿐이다(프로그램 안 규칙 꼴 `^(command|read_file|write_file|read_url|mcp|execute_url|unsandboxed)\(…\)$`).
 *      웹 검색(search_web)은 Google 서버가 하는 일이라 규칙으로 못 막는다(실측 1.5: search_web(*) 을 넣어도 검색이 끝까지 돈다).
 *      검색어가 가는 곳은 문서를 이미 받는 같은 Google 이고, 제3자 주소로 가는 길(read_url·execute_url)은 막혀 있다.
 *   2) 도구 단계(step_type tool·tool_name·tool_info·subagent_info)·모르는 단계·모르는 보고가 보이면 그 자리에서 프로세스 트리째 끝낸다.
 *      시작 보고의 권한 방식이 strict 가 아니어도 끝낸다. 끝내기는 비동기라 빠른 도구는 이미 돈 뒤일 수 있다:
 *      막는 것은 1) 이고, 2) 는 그다음 단계(결과를 들고 이어 가기)를 끊고 실패로 알리는 뒷정리다.
 *   3) 작업 폴더는 늘 같은 빈 폴더(파일이 없다).
 * - 대화 기록 지우기는 요청마다 표시 파일을 남겨, 엔진이 꺼지거나 죽어도 다음에 켜질 때·다음 요청 때 지운다(sweepAgyLeftovers).
 * - 입력은 stdin 의 stream-json 한 줄(`-p` 는 글을 명령줄로만 받아 쓰지 않는다). `@경로`는 펼치지 않는다(실측: 파일 내용이 붙지 않음).
 *   지시문을 따로 넣는 옵션이 없어 글 앞에 붙인다. 사용자 ~/.gemini/GEMINI.md 같은 규칙은 CLI 가 붙일 수 있다.
 * - 대화를 ~/.gemini/antigravity-cli/conversations/<id>.db 와 brain/<id>/ 에 남긴다 → 시작 보고의 conversation_id 몫만 지운다.
 * - 로그인이 없으면 질문 실행은 브라우저 로그인을 기다리며 60초 멈춘다 → 보내기 전에 `agy models`(3초쯤, 모델 안 부름)로 확인.
 * - API 키로 가는 길(modelProvider gemini + GEMINI_API_KEY)은 막는다: 키 변수는 넘기지 않고 modelProvider 를 비우며, 유료 크레딧(useG1Credits)은 끈다.
 */

import { randomUUID } from 'node:crypto';
import { existsSync, realpathSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertProgramEgress } from '../net-guard.js';
import { claudeSystemText, MODEL_NAME, SUBSCRIPTION_CONTEXT_TOKENS, type CliModel, type SubscriptionDeps } from './claude-code.js';
import { SubscriptionError, type FailKind } from './subscription/errors.js';
import { forgetLogins, requireSubscription, type Login } from './subscription/login.js';
import { findProgram, removeDir, runProgram, workDir, type Program, type SpawnFn } from './subscription/program.js';
import type { ChatMessage, ChatRequest, LlmProvider } from './types.js';

export interface GeminiCliConfig { model: string; cli_path: string }

/** agy 가 실제로 부르는 서버 (실측: CLI 기록) */
export const AGY_HOST = 'daily-cloudcode-pa.googleapis.com';

/** 이번 실행만의 설정 (저장되지 않는다). 키 이름은 공식 settings.json 표 */
export const AGY_SETTINGS = {
  toolPermission: 'strict',
  agentMode: '',
  artifactReviewPolicy: 'asks-for-review',
  allowNonWorkspaceAccess: false,
  enableTerminalSandbox: true,
  useG1Credits: false,
  modelProvider: '',
  disableSlashCommands: true,
  notifications: false,
  showTips: false,
  showFeedbackSurvey: false,
  permissions: {
    allow: [],
    ask: [],
    deny: ['read_file(*)', 'write_file(*)', 'read_url(*)', 'execute_url(*)', 'command(*)', 'unsandboxed(*)', 'mcp(*)'],
  },
};

/** 늘 같은 빈 작업 폴더 (CLI 가 작업 폴더마다 최근 대화를 기억한다) */
const CWD_NAME = 'kordoc-agy-cwd';
/** 받아들이는 단계 (공식 문서의 관찰 값 중 도구가 아닌 것) */
const SAFE_STEPS = new Set(['user_input', 'agent_response', 'checkpoint']);
const KNOWN_EVENTS = new Set(['init', 'step_update', 'result']);
const CONVERSATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Gemini CLI 때 고를 수 있던 이름 (예전 판에서 저장한 값). agy 는 모르는 모델이면 실패하므로 기본 모델로 */
const OLD_GEMINI_MODELS = new Set(['auto', 'pro', 'flash', 'flash-lite', 'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite']);
export const agyModel = (m: string) => (OLD_GEMINI_MODELS.has(m.trim()) ? '' : m.trim());

export function agyArgs(o: { settings: string; model: string }): string[] {
  if (o.model && !MODEL_NAME.test(o.model)) throw new SubscriptionError('bad-request', 'gemini-cli', { why: '모델 이름 꼴이 아님' });
  return [
    '--input-format', 'stream-json', '--output-format', 'stream-json',
    '--settings', o.settings, '--disable-slash-commands',
    ...(o.model ? ['--model', o.model] : []),
  ];
}

async function fixedCwd(): Promise<string> {
  const d = join(tmpdir(), CWD_NAME);
  await mkdir(d, { recursive: true });
  return d;
}

const agyHome = (env: NodeJS.ProcessEnv = process.env) => join((process.platform === 'win32' ? env.USERPROFILE : env.HOME) || homedir(), '.gemini', 'antigravity-cli');

/** 지금 이 엔진에서 도는 agy 요청 수 (최근 대화로 찾기는 혼자 돌 때만: 다른 요청의 대화를 지우지 않게) */
let running = 0;

/** 이 실행의 대화 기록만 지운다 (사용자의 다른 대화는 건드리지 않는다).
 *  시작 보고의 id 가 없을 때만(시작 보고 전에 끝남) CLI 가 우리 작업 폴더에 묶어 둔 최근 대화로 찾는다:
 *  id 가 있는데도 이걸 보면 동시에 도는 다른 요청의 대화를 지울 수 있다.
 *  돌려주는 값: 지울 것이 다 없어졌다 (못 찾았으면 true, 잠겨서 남았으면 false) */
export async function forgetAgyConversation(id: string | null, cwd: string, env: NodeJS.ProcessEnv = process.env, o: { guess?: boolean } = {}): Promise<boolean> {
  const base = agyHome(env);
  let c = id;
  if (!c && (o.guess ?? running <= 1)) {
    try {
      const last = JSON.parse(await readFile(join(base, 'cache', 'last_conversations.json'), 'utf-8')) as Record<string, unknown>;
      // macOS /var → /private/var, Windows 짧은 이름(8.3) 때문에 실제 경로로도 견준다
      let real = cwd;
      try { real = realpathSync.native(cwd); } catch { /* 없으면 그대로 */ }
      const names = new Set([cwd, real].map((p) => p.toLowerCase()));
      const mine = Object.entries(last).find(([k]) => names.has(k.toLowerCase()))?.[1];
      if (typeof mine === 'string') c = mine;
    } catch { /* 없으면 그만 */ }
  }
  if (!c || !CONVERSATION_ID.test(c)) return true;
  // 백신 검사·CLI 의 파일 잠금이 잠깐 걸려도 지워지게 (글 전체가 든 파일이다)
  const gone = { force: true, maxRetries: 5, retryDelay: 200 };
  const files = ['', '-wal', '-shm', '-journal'].map((f) => join(base, 'conversations', `${c}.db${f}`));
  for (const f of files) await rm(f, gone).catch(() => {});
  const brain = join(base, 'brain', c);
  await rm(brain, { ...gone, recursive: true }).catch(() => {});
  return ![...files, brain].some((f) => existsSync(f));
}

/** 지울 대화 표시: 요청마다 파일 하나({id}). 엔진이 꺼지거나 죽어 finally 가 못 돌아도 다음에 켜질 때·다음 요청 때 지운다 */
// 시험은 KORDOC_AGY_PENDING_DIR 로 따로 둔다 (진짜 표시를 건드리지 않게)
const pendingDir = (env: NodeJS.ProcessEnv = process.env) => join(env.KORDOC_AGY_PENDING_DIR || tmpdir(), 'kordoc-agy-pending');
const mine = new Set<string>();
/** 이보다 오래된 표시만 지우고 내려놓는다 (주인 잃은 agy 가 아직 돌며 다시 쓸 수 있어서) */
const PENDING_SETTLE_MS = 30 * 60_000;

async function markPending(name: string, id: string | null, env?: NodeJS.ProcessEnv): Promise<void> {
  await mkdir(pendingDir(env), { recursive: true });
  await writeFile(join(pendingDir(env), name), JSON.stringify({ id }), { mode: 0o600 });
}

/** 남은 대화 기록 청소 (엔진 시작·agy 요청마다). 돌려주는 값: 지운 표시 수 */
export async function sweepAgyLeftovers(env: NodeJS.ProcessEnv = process.env, now = Date.now()): Promise<number> {
  let names: string[];
  try { names = await readdir(pendingDir(env)); } catch { return 0; }
  let done = 0;
  for (const name of names) {
    if (mine.has(name)) continue;
    const file = join(pendingDir(env), name);
    try {
      const { id } = JSON.parse(await readFile(file, 'utf-8')) as { id: string | null };
      // id 를 받기 전에 끊겼으면 우리 작업 폴더의 최근 대화로 (다른 요청이 돌지 않을 때만)
      const clean = await forgetAgyConversation(typeof id === 'string' ? id : null, join(tmpdir(), CWD_NAME), env, { guess: running === 0 });
      if (clean && now - (await stat(file)).mtimeMs > PENDING_SETTLE_MS) { await rm(file, { force: true }); done++; }
    } catch { await rm(file, { force: true }).catch(() => {}); }
  }
  return done;
}

/** stdin 한 줄: 지시문과 대화를 사용자 말 하나로. 맨 앞이 / 면 슬래시 명령이 되므로 늘 머리말로 시작 */
export function agyInput(messages: ChatMessage[], system: string): string {
  const last = messages.at(-1);
  if (!last || last.role !== 'user') throw new SubscriptionError('bad-request', 'gemini-cli', { why: '마지막 말이 사용자 말이 아님' });
  if (messages.some((m) => m.images?.length)) throw new SubscriptionError('bad-request', 'gemini-cli', { why: '그림은 보낼 수 없음' });
  const body = messages.length === 1
    ? last.content
    : `<conversation>\n${messages.map((m) => `<${m.role}>\n${m.content}\n</${m.role}>`).join('\n')}\n</conversation>\n마지막 user 말에 답하세요.`;
  const content = `[KorDoc AI 요청]\n<instructions>\n${system}\n</instructions>\n\n${body}`;
  return `${JSON.stringify({ event: 'user', message: { content } })}\n`;
}

const AUTH = /authentication (required|failed)|please sign in|sign in to|not (logged|signed) in|UNAUTHENTICATED|invalid_grant|\b401\b/i;

function failureOf(text: string): FailKind {
  if (/exceeds the maximum number of tokens|input token count|context (window|length)|too long|too many tokens/i.test(text)) return 'too-long';
  if (AUTH.test(text)) return 'signed-out';
  if (/quota|exhausted|RESOURCE_EXHAUSTED|rate.?limit|\b429\b/i.test(text)) return 'rate-limit';
  if (/\b503\b|UNAVAILABLE|overloaded/i.test(text)) return 'overloaded';
  if (/\b5\d\d\b|INTERNAL|server error/i.test(text)) return 'server-error';
  if (/unknown model|model .{0,40}not (found|available|supported)|\b400\b|INVALID_ARGUMENT|\b404\b|NOT_FOUND/i.test(text)) return 'bad-request';
  if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|getaddrinfo|network|dial tcp|no such host/i.test(text)) return 'network';
  return 'failed';
}

/** Go flag 꾸러미의 모르는 옵션 문장 */
const BAD_FLAG = /flag provided but not defined|unknown flag/i;

type Ev = Record<string, unknown>;
const obj = (v: unknown): Ev | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Ev) : undefined);

async function ask(program: Program, cfg: GeminiCliConfig, req: ChatRequest, timeoutMs: number, deps: SubscriptionDeps): Promise<string> {
  const input = agyInput(req.messages, claudeSystemText(req));
  const env = deps.baseEnv ?? process.env;
  const dir = await workDir();
  const cwd = await fixedCwd();
  // 앞서 엔진이 꺼지며 못 지운 기록부터 (기다리지 않는다)
  if (!running) void sweepAgyLeftovers(env).catch(() => {});
  const pending = `${randomUUID()}.json`;
  mine.add(pending);
  running++;
  let marked: Promise<void> = markPending(pending, null, env).catch(() => {});
  let conversation: string | null = null;
  try {
    const settings = join(dir, 'settings.json');
    await writeFile(settings, JSON.stringify(AGY_SETTINGS), { mode: 0o600 });
    let answer = '';
    let sawInit = false;
    let result: { ok: boolean; response: string; error: string } | null = null;
    const r = await runProgram(program, agyArgs({ settings, model: agyModel(cfg.model) }), {
      signal: req.signal,
      idleMs: timeoutMs,
      cwd,
      input,
      baseEnv: deps.baseEnv,
      spawn: deps.spawn,
      extraEnv: { TEMP: dir, TMP: dir, TMPDIR: dir },
      onLine: (line) => {
        let parsed: unknown;
        try { parsed = JSON.parse(line); } catch { return; } // 알림 같은 글 줄
        const ev = obj(parsed);
        if (!ev) return;
        const type = String(ev.event ?? '');
        // 아는 보고는 셋뿐 (공식 문서·실측). 이름이 바뀐 새 보고(도구일 수 있다)나 event 가 없는 줄(예전 Gemini CLI 를 가리키는 경로)은 끝낸다
        if (!KNOWN_EVENTS.has(type)) throw new SubscriptionError('unsafe-tools', 'gemini-cli', { why: `모르는 보고(${type.slice(0, 30) || 'event 없음'})` });
        if (type === 'init') {
          const init = obj(ev.init);
          if (typeof ev.conversation_id === 'string') {
            conversation = ev.conversation_id;
            marked = marked.then(() => markPending(pending, conversation, env)).catch(() => {});
          }
          if (init?.permission_mode !== 'strict') throw new SubscriptionError('unsafe-tools', 'gemini-cli', { why: '도구 거절 설정이 먹지 않음' });
          sawInit = true;
          return;
        }
        if (!sawInit) throw new SubscriptionError('unsafe-tools', 'gemini-cli', { why: '시작 보고 전에 답이 옴' });
        if (type === 'step_update') {
          const s = obj(ev.step_update) ?? {};
          if (s.tool_name || s.tool_info || s.subagent_info || !SAFE_STEPS.has(String(s.step_type))) {
            throw new SubscriptionError('unsafe-tools', 'gemini-cli', { why: '도구를 쓰려 함' });
          }
          if (s.step_type === 'agent_response' && typeof s.text_delta === 'string' && s.text_delta) {
            answer += s.text_delta;
            req.onToken?.(s.text_delta);
          }
          return;
        }
        if (type === 'result') {
          const res = obj(ev.result) ?? {};
          result = { ok: res.status === 'SUCCESS', response: typeof res.response === 'string' ? res.response : '', error: String(res.error ?? '') };
          return 'done';
        }
      },
    });
    const res = result as { ok: boolean; response: string; error: string } | null;
    if (res?.ok) {
      const text = (res.response || answer).replace(/\n+$/, '');
      if (!text.trim()) throw new SubscriptionError('failed', 'gemini-cli', { why: '빈 답이 옴' });
      return text;
    }
    if (BAD_FLAG.test(r.stderr)) throw new SubscriptionError('needs-update', 'gemini-cli', { why: '모르는 옵션이 있다고 함' });
    const kind = failureOf(`${res?.error ?? ''}\n${r.stderr}`);
    // 1분 기억한 "로그인됨"을 버려 다음 요청이 60초 로그인 기다림에 빠지지 않고 바로 확인하게
    if (kind === 'signed-out') forgetLogins();
    throw new SubscriptionError(kind, 'gemini-cli', kind === 'failed' ? { why: res ? '답을 받지 못함' : `답 없이 끝남, 종료 코드 ${r.code}` } : {});
  } finally {
    await removeDir(dir);
    const clean = await forgetAgyConversation(conversation, cwd, env);
    running--;
    mine.delete(pending);
    await marked;
    // 잠겨서 남았으면 표시를 두어 다음 청소가 다시 지운다
    if (clean) await rm(join(pendingDir(env), pending), { force: true }).catch(() => {});
  }
}

export function createGeminiCliProvider(cfg: GeminiCliConfig, timeoutMs: number, deps: SubscriptionDeps = {}): LlmProvider {
  return {
    id: 'gemini-cli',
    isCloud: true,
    supportsVision: false,
    async chat(req) {
      assertProgramEgress(AGY_HOST, 'Antigravity CLI');
      const program = await (deps.find ?? (() => findProgram('gemini-cli', { configured: cfg.cli_path })))();
      if (!program) throw new SubscriptionError('not-installed', 'gemini-cli');
      // 로그인이 없으면 질문 실행이 브라우저 로그인을 60초 기다리므로 먼저 확인 (agy models, 1분 기억)
      await (deps.login ?? ((p: Program) => requireSubscription('gemini-cli', p, { signal: req.signal, baseEnv: deps.baseEnv, spawn: deps.spawn })))(program);
      return ask(program, cfg, req, timeoutMs, deps);
    },
    contextTokens: async () => SUBSCRIPTION_CONTEXT_TOKENS,
  };
}

/** `agy models` 의 줄: "<id>\t<이름>" */
export function parseAgyModels(stdout: string): CliModel[] {
  const out: CliModel[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const m = line.match(/^(\S+)\t(.+)$/);
    if (m && MODEL_NAME.test(m[1])) out.push({ id: m[1], label: m[2].trim().slice(0, 80) });
  }
  return out;
}

/** 로그인 확인: `agy models`. 모델은 부르지 않는다. 로그인돼 있으면 목록(종료 0), 아니면 "Please sign in"(종료 1). 계정 파일은 열지 않는다 */
export async function readAgyLogin(program: Program, o: { signal: AbortSignal; idleMs: number; baseEnv?: NodeJS.ProcessEnv; spawn?: SpawnFn }): Promise<Login | null> {
  const r = await runProgram(program, ['models'], { ...o, cwd: await fixedCwd() });
  const text = `${r.stdout}\n${r.stderr}`;
  if (AUTH.test(text)) return { signedIn: false };
  // 목록 꼴이 바뀌거나 비어 있어도 끝까지 됐으면 로그인돼 있다 (로그인이 없으면 "Please sign in" 으로 1)
  if (r.code === 0) return { signedIn: true, method: 'subscription' };
  if (BAD_FLAG.test(text) || /unknown (sub)?command/i.test(text)) return null;
  const kind = failureOf(text);
  throw new SubscriptionError(kind, 'gemini-cli', kind === 'failed' ? { why: `상태 확인이 종료 코드 ${r.code}로 끝남` } : {});
}

const DEFAULT_MODEL: CliModel = { id: '', label: '기본 모델 (CLI가 고름)' };

/** 고를 수 있는 모델: 계정이 쓸 수 있는 목록(`agy models`). 못 읽으면 기본 모델만 */
export async function listGeminiCliModels(cfg: GeminiCliConfig, signal: AbortSignal, deps: SubscriptionDeps = {}): Promise<CliModel[]> {
  const program = await (deps.find ?? (() => findProgram('gemini-cli', { configured: cfg.cli_path })))().catch(() => null);
  if (!program) return [DEFAULT_MODEL];
  assertProgramEgress(AGY_HOST, 'Antigravity CLI 모델 목록');
  try {
    const r = await runProgram(program, ['models'], { signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]), idleMs: 30_000, cwd: await fixedCwd(), baseEnv: deps.baseEnv, spawn: deps.spawn });
    return [DEFAULT_MODEL, ...(r.code === 0 ? parseAgyModels(r.stdout) : [])];
  } catch (e) {
    if (signal.aborted) throw e;
    return [DEFAULT_MODEL];
  }
}
