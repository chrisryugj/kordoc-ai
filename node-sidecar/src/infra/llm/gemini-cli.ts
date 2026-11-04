/** 구독 계정 다리: 이 PC 에 깔고 Google 계정으로 로그인해 둔 Gemini CLI 로 한 번 묻고 답 받기
 *
 * 근거: Gemini CLI 공식 CLI(`-p` 헤드리스·stdin 입력, `-o stream-json`, `-m`, `--approval-mode`, 정책 엔진 `--admin-policy`·`--policy`,
 * `-e none`, `--allowed-mcp-server-names`, 시스템 설정 경로 `GEMINI_CLI_SYSTEM_SETTINGS_PATH`, 시스템 지시 파일 `GEMINI_SYSTEM_MD`, `NO_BROWSER`).
 * 실측(Windows·0.35.0, 숨은 시험 옵션 --fake-responses 로 모델을 부르지 않고 CLI 가 보낼 요청을 들여다봄):
 * - 아래 시스템 설정과 "모두 거절" 정책을 주면 요청의 도구 선언이 0개, 지시문은 우리 파일 그대로(사용자 GEMINI.md 안 붙음).
 *   둘 다 빼면 도구 8개(list_directory·read_file·grep_search·glob·google_web_search·하위 에이전트 셋)와 GEMINI.md 가 붙는다.
 *   정책만으로도, 설정만으로도 각각 0개(두 겹). 모델이 도구를 부르면 tool_use 줄이 나오고 실행은 "Tool not found"
 *   (정책이 없으면 read_file 이 실제로 파일을 연다). 그래도 tool_use·tool_result 가 보이면 바로 끝낸다.
 * - 시스템 설정은 사용자 설정(~/.gemini/settings.json)의 같은 칸을 덮는다. MCP·확장·스킬·훅·도구 탐색 명령·샌드박스·하위 에이전트를 끄고
 *   인증은 Google 로그인(oauth-personal)으로 고정·강제한다: API 키(GEMINI_API_KEY 는 넘기지 않고, CLI 가 읽는 .env 에 있어도)로는 보내지 않는다.
 *   유료 AI 크레딧은 쓰지 않는다(billing.overageStrategy never).
 * - 입력의 @경로는 CLI 가 파일을 읽어 붙인다(실측: "@C:/Windows/win.ini" 를 읽으려 하고 메일 주소의 @ 도 떼어 냄) → 글의 @ 를 \@ 로(CLI 의 이스케이프).
 *   맨 앞 / 는 슬래시 명령이라 입력은 늘 우리 머리말로 시작한다.
 * - 로그인이 없거나 풀렸으면(실측: invalid_grant) 종료 코드 41. NO_BROWSER 가 없으면 브라우저 로그인을 띄우려 한다.
 * - 대화를 ~/.gemini/tmp/<작업 폴더 이름>/chats 에 기록한다 → 늘 같은 빈 작업 폴더를 쓰고 끝나면 그 폴더 몫의 기록을 지운다.
 *   오류 보고 파일(요청 전체가 든다)은 TEMP 에 써서 TEMP 를 매번 지우는 작업 폴더로 돌린다.
 * - 글은 stdin(`-p ""` 이면 stdin 만), 지시문은 작업 폴더 파일. 명령줄에는 고정 인자·파일 경로·모델 이름만.
 */

import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertProgramEgress } from '../net-guard.js';
import { claudeSystemText, MODEL_NAME, SUBSCRIPTION_CONTEXT_TOKENS, type CliModel, type SubscriptionDeps } from './claude-code.js';
import { SubscriptionError, type FailKind } from './subscription/errors.js';
import type { Login } from './subscription/login.js';
import { findProgram, removeDir, runProgram, workDir, type Program, type SpawnFn } from './subscription/program.js';
import type { ChatMessage, ChatRequest, LlmProvider } from './types.js';

export interface GeminiCliConfig { model: string; cli_path: string }

/** 사용자 설정 위에 덮는 시스템 설정 (키 이름은 0.35 settingsSchema) */
export const GEMINI_SETTINGS = {
  security: { auth: { selectedType: 'oauth-personal', enforcedType: 'oauth-personal', useExternal: false }, disableYoloMode: true },
  admin: { secureModeEnabled: true, mcp: { enabled: false }, extensions: { enabled: false }, skills: { enabled: false } },
  tools: { core: [], allowed: [], sandbox: false, discoveryCommand: '', callCommand: '' },
  mcp: { serverCommand: '' },
  hooksConfig: { enabled: false },
  skills: { enabled: false },
  agents: { overrides: Object.fromEntries(['codebase_investigator', 'cli_help', 'generalist', 'browser_agent'].map((n) => [n, { enabled: false }])) },
  // 없는 파일 이름: GEMINI.md 같은 문맥 파일을 찾지 않는다
  context: { fileName: 'KORDOC-NO-CONTEXT-FILE.md', includeDirectoryTree: false, loadMemoryFromIncludeDirectories: false },
  experimental: { enableAgents: false, plan: false, jitContext: false },
  general: { defaultApprovalMode: 'default', enableAutoUpdate: false, enableAutoUpdateNotification: false, checkpointing: { enabled: false } },
  billing: { overageStrategy: 'never' },
  privacy: { usageStatisticsEnabled: false },
  telemetry: { enabled: false },
  ide: { enabled: false },
  useWriteTodos: false,
};

/** 정책 엔진: 모든 도구 거절 (도구 이름이 없는 규칙은 모든 도구에 걸린다) */
const DENY_ALL = '[[rule]]\ndecision = "deny"\npriority = 999\ndeny_message = "KorDoc AI: tools are disabled."\n';
/** 있지 않은 MCP 서버 이름 (이 이름만 허용 = 아무것도 허용 안 함) */
const NO_MCP = 'kordoc-no-mcp';
/** 늘 같은 빈 작업 폴더. CLI 가 폴더 이름으로 기록 자리(~/.gemini/tmp/<이름>)를 정해서 매번 새 폴더면 기록 폴더가 쌓인다 */
const CWD_NAME = 'kordoc-gemini-cwd';

export function geminiArgs(o: { dir: string; model: string }): string[] {
  if (o.model && !MODEL_NAME.test(o.model)) throw new SubscriptionError('bad-request', 'gemini-cli', { why: '모델 이름 꼴이 아님' });
  const policy = join(o.dir, 'policy.toml');
  return [
    '-p', '', '-o', 'stream-json', '--approval-mode', 'default',
    // 이 PC 에 기관 정책(시스템 정책 폴더)이 있으면 CLI 가 --admin-policy 를 무시하므로 사용자 단계에도 같은 규칙을 둔다
    '--admin-policy', policy, '--policy', policy,
    '-e', 'none', '--allowed-mcp-server-names', NO_MCP,
    ...(o.model ? ['-m', o.model] : []),
  ];
}

/** 작업 폴더에 설정·정책·지시문 파일을 쓰고, 자식에게 더할 환경 */
async function prepare(dir: string, system: string): Promise<Record<string, string>> {
  await writeFile(join(dir, 'settings.json'), JSON.stringify(GEMINI_SETTINGS), { mode: 0o600 });
  await writeFile(join(dir, 'policy.toml'), DENY_ALL, { mode: 0o600 });
  await writeFile(join(dir, 'system.md'), system, { encoding: 'utf-8', mode: 0o600 });
  return {
    GEMINI_CLI_SYSTEM_SETTINGS_PATH: join(dir, 'settings.json'),
    GEMINI_SYSTEM_MD: join(dir, 'system.md'),
    NO_BROWSER: '1',
    TEMP: dir, TMP: dir, TMPDIR: dir,
  };
}

async function fixedCwd(): Promise<string> {
  const d = join(tmpdir(), CWD_NAME);
  await mkdir(d, { recursive: true });
  return d;
}

/** 우리 작업 폴더 몫의 대화 기록을 지운다 (다른 프로젝트 기록은 건드리지 않는다). 자식의 집 폴더는 자식 환경에서 */
export async function forgetGeminiChats(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const home = (process.platform === 'win32' ? env.USERPROFILE : env.HOME) || homedir();
  const base = join(home, '.gemini', 'tmp');
  for (const d of await readdir(base).catch(() => [] as string[])) {
    if (d !== CWD_NAME && !d.startsWith(`${CWD_NAME}-`)) continue;
    const chats = join(base, d, 'chats');
    for (const f of await readdir(chats).catch(() => [] as string[])) {
      if (/^session-.*\.json$/.test(f)) await rm(join(chats, f), { force: true }).catch(() => {});
    }
  }
}

/** CLI 가 @경로로 읽지 않게 (CLI 자신의 escapeAtSymbols 와 같은 규칙) */
const escapeAt = (s: string) => s.replace(/(?<!\\)@/g, '\\@');
const unescapeAt = (s: string) => s.replace(/\\@/g, '@');

export function geminiSystemText(req: Pick<ChatRequest, 'system' | 'json' | 'schema' | 'maxTokens'>): string {
  return `${claudeSystemText(req)}\n\n받은 글의 \\@ 는 @ 를 뜻합니다. 답에는 @ 로 쓰세요.`;
}

/** stdin 으로 줄 글. 맨 앞이 / 면 슬래시 명령이 되므로 늘 머리말로 시작 */
export function geminiPrompt(messages: ChatMessage[]): string {
  const last = messages.at(-1);
  if (!last || last.role !== 'user') throw new SubscriptionError('bad-request', 'gemini-cli', { why: '마지막 말이 사용자 말이 아님' });
  if (messages.some((m) => m.images?.length)) throw new SubscriptionError('bad-request', 'gemini-cli', { why: '그림은 보낼 수 없음' });
  const body = messages.length === 1
    ? last.content
    : `<conversation>\n${messages.map((m) => `<${m.role}>\n${m.content}\n</${m.role}>`).join('\n')}\n</conversation>\n마지막 user 말에 답하세요.`;
  return `[KorDoc AI 요청]\n${escapeAt(body)}`;
}

const AUTH = /FatalAuthenticationError|UnauthorizedError|Manual authorization is required|invalid_grant|re-?authenticate|not (logged|signed) in|UNAUTHENTICATED|\b401\b/i;

function failureOf(type: string, text: string): FailKind {
  const all = `${type}\n${text}`;
  // 긴 문서 문장에도 토큰 수가 들어 있어 상태 코드보다 먼저
  if (/exceeds the maximum number of tokens|input token count|context (window|length)|too long|too many tokens/i.test(all)) return 'too-long';
  if (/enforced authentication type/i.test(all)) return 'metered';
  if (AUTH.test(all)) return 'signed-out';
  if (/QuotaError|quota|exhausted your|RESOURCE_EXHAUSTED|rate.?limit|\b429\b/i.test(all)) return 'rate-limit';
  if (/\b503\b|UNAVAILABLE|overloaded/i.test(all)) return 'overloaded';
  if (/\b5\d\d\b|INTERNAL|server error/i.test(all)) return 'server-error';
  if (/\b400\b|INVALID_ARGUMENT|\b404\b|NOT_FOUND|Requested entity was not found|model .{0,40}not (found|supported)/i.test(all)) return 'bad-request';
  if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|fetch failed|getaddrinfo|network/i.test(all)) return 'network';
  return 'failed';
}

type Ev = Record<string, unknown>;
const obj = (v: unknown): Ev | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Ev) : undefined);

async function ask(program: Program, cfg: GeminiCliConfig, req: ChatRequest, timeoutMs: number, deps: SubscriptionDeps): Promise<string> {
  const input = geminiPrompt(req.messages);
  const dir = await workDir();
  try {
    const extraEnv = await prepare(dir, geminiSystemText(req));
    let answer = '';
    let sawInit = false;
    let done = false;
    let failed: { type: string; message: string } | null = null;
    let lastError = '';
    const r = await runProgram(program, geminiArgs({ dir, model: cfg.model }), {
      signal: req.signal,
      idleMs: timeoutMs,
      cwd: await fixedCwd(),
      input,
      baseEnv: deps.baseEnv,
      spawn: deps.spawn,
      extraEnv,
      onLine: (line) => {
        let ev: Ev;
        try { ev = JSON.parse(line); } catch { return; }
        const type = String(ev.type);
        if (/tool/i.test(type)) throw new SubscriptionError('unsafe-tools', 'gemini-cli', { why: '도구를 쓰려 함' });
        if (type === 'init') { sawInit = true; return; }
        if (!sawInit && (type === 'message' || type === 'result')) throw new SubscriptionError('unsafe-tools', 'gemini-cli', { why: '시작 보고 전에 답이 옴' });
        if (type === 'message') {
          if (ev.role === 'assistant' && typeof ev.content === 'string') {
            const t = unescapeAt(ev.content);
            answer += t;
            req.onToken?.(t);
          }
          return;
        }
        if (type === 'error') { if (ev.severity === 'error') lastError = String(ev.message ?? ''); return; }
        if (type === 'result') {
          if (ev.status === 'success') done = true;
          else failed = { type: String(obj(ev.error)?.type ?? ''), message: String(obj(ev.error)?.message ?? lastError) };
          return 'done';
        }
      },
    });
    if (failed) {
      const f = failed as { type: string; message: string };
      const kind = failureOf(f.type, f.message);
      throw new SubscriptionError(kind, 'gemini-cli', kind === 'failed' ? { why: '답을 받지 못함' } : {});
    }
    if (done) {
      if (!answer.trim()) throw new SubscriptionError('failed', 'gemini-cli', { why: '빈 답이 옴' });
      return answer;
    }
    if (/Unknown argument/i.test(r.stderr)) throw new SubscriptionError('needs-update', 'gemini-cli', { why: '모르는 옵션이 있다고 함' });
    if (r.code === 41) throw new SubscriptionError('signed-out', 'gemini-cli');
    const kind = failureOf('', `${lastError}\n${r.stderr}`);
    throw new SubscriptionError(kind, 'gemini-cli', kind === 'failed' ? { why: `답 없이 끝남, 종료 코드 ${r.code}` } : {});
  } finally {
    await removeDir(dir);
    await forgetGeminiChats(deps.baseEnv);
  }
}

export function createGeminiCliProvider(cfg: GeminiCliConfig, timeoutMs: number, deps: SubscriptionDeps = {}): LlmProvider {
  return {
    id: 'gemini-cli',
    isCloud: true,
    supportsVision: false,
    async chat(req) {
      assertProgramEgress('cloudcode-pa.googleapis.com', 'Gemini CLI');
      const program = await (deps.find ?? (() => findProgram('gemini-cli', { configured: cfg.cli_path })))();
      if (!program) throw new SubscriptionError('not-installed', 'gemini-cli');
      // 보내기 전 로그인 확인을 따로 하지 않는다: CLI 를 한 번 더 띄우는 데 15초쯤 걸리고(실측), 인증은 Google 로그인으로 강제해
      // 종량제로 갈 길이 없으며, 로그인이 풀렸으면 이 실행이 41 로 끝나 같은 안내가 나간다
      if (deps.login) await deps.login(program);
      return ask(program, cfg, req, timeoutMs, deps);
    },
    contextTokens: async () => SUBSCRIPTION_CONTEXT_TOKENS,
  };
}

/** 로그인 확인: 빈 입력으로 띄운다. CLI 는 로그인(토큰 갱신·Code Assist 확인)을 마친 뒤 "입력 없음"(종료 코드 42)으로 끝나고
 *  모델은 부르지 않는다(실측: 가짜 응답 0개로도 42). 로그인이 없거나 풀렸으면 41. 계정 파일은 열지 않는다 */
export async function readGeminiLogin(program: Program, o: { signal: AbortSignal; idleMs: number; baseEnv?: NodeJS.ProcessEnv; spawn?: SpawnFn }): Promise<Login | null> {
  const dir = await workDir();
  try {
    const extraEnv = await prepare(dir, '');
    const r = await runProgram(program, geminiArgs({ dir, model: '' }), { ...o, cwd: await fixedCwd(), input: '', extraEnv });
    if (/Unknown argument/i.test(r.stderr)) return null;
    if (r.code === 42 && /No input provided/i.test(r.stderr)) return { signedIn: true, method: 'subscription' };
    if (r.code === 41 || AUTH.test(r.stderr)) return /enforced authentication type/i.test(r.stderr) ? { signedIn: true, method: 'metered' } : { signedIn: false };
    const kind = failureOf('', r.stderr);
    throw new SubscriptionError(kind, 'gemini-cli', kind === 'failed' ? { why: `상태 확인이 종료 코드 ${r.code}로 끝남` } : {});
  } finally {
    await removeDir(dir);
  }
}

/** 고를 수 있는 모델: CLI 의 별칭(auto·pro·flash·flash-lite)과 정식 이름(0.35 config/models.js). 프로그램을 띄우지 않는다 */
export const GEMINI_MODELS: readonly CliModel[] = [
  { id: '', label: '기본 모델 (CLI가 자동으로 고름)' },
  { id: 'pro', label: 'Pro (복잡한 일, 최신 Pro)' },
  { id: 'flash', label: 'Flash (일상 작업)' },
  { id: 'flash-lite', label: 'Flash Lite (빠르고 가벼움)' },
  { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite' },
];

export async function listGeminiCliModels(_cfg: GeminiCliConfig, _signal: AbortSignal): Promise<CliModel[]> {
  return [...GEMINI_MODELS];
}
