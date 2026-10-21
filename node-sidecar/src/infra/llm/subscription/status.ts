/** 구독 프로그램 연결 상태 — 설치됐나, 로그인했나, 구독인가(쓴 만큼 요금인가)를 프로그램 자신의 답으로
 *
 * 이음오피스 packages/ai-provider/src/subscription/status.ts(Apache-2.0, 커밋 9bda9ac)에서 옮김.
 * 바꾼 곳: 계정 이메일·요금제 외 값은 아예 읽지 않음(화면에 계정을 보이지 않는다), Codex app-server 의
 * account/read 대조는 뺌(실행 직전 확인은 codex.ts 가 한다), 상태 문장은 한국어 할 일 안내로,
 * 실행 직전 로그인 확인(assertSubscriptionLogin)과 10분 기억을 더함.
 *
 * 로그인 정보(~/.codex/auth.json, Claude 자격 증명 저장소)는 읽지 않는다. 프로그램이 찍은 글자는 정해 둔 값과
 * 대조만 하고 상태·오류·로그 어디에도 옮기지 않는다(계정·조직 이름이 섞일 수 있음).
 */

import { cliMessage, CliRunError, LOGIN_COMMAND, PROGRAM_LABEL, type SubscriptionProviderId } from './messages.js';
import { locateSubscriptionProgram, type LocateOptions, type SubscriptionProgram } from './locate.js';
import { runSubscriptionProgram, type CommandResult } from './process.js';

/** ready: 구독 로그인 · unknown-login: 로그인했지만 방식 모름(경고 후 허용) · metered: 쓴 만큼 요금(실행 거절) */
export type SubscriptionState = 'ready' | 'unknown-login' | 'metered' | 'signed-out' | 'not-installed' | 'needs-update' | 'error';

export interface SubscriptionDetection {
  provider: SubscriptionProviderId;
  state: SubscriptionState;
  version?: string;
  /** 프로그램이 밝힌 요금제 (max·plus 같은 식별자 모양일 때만) */
  plan?: string;
  /** 준비되지 않았을 때 할 일 */
  message?: string;
  /** 터미널에서 칠 로그인 명령 */
  login_command: string;
  /** 찾은 프로그램 위치 (화면에 읽기 전용으로) */
  path?: string;
}

/** 이 버전부터 initialize 의 systemPrompt 를 받는다 (이음오피스 SUBSCRIPTION_MIN_VERSIONS) */
export const MIN_VERSIONS: Record<SubscriptionProviderId, string | null> = { 'claude-code': '2.1.248', codex: null };

export const STATUS_TIMEOUT_MS = 20_000;

type Login = { signedIn: false } | { signedIn: true; method: 'subscription' | 'metered' | 'unknown'; plan?: string };

function planLabel(v: unknown): string | undefined {
  return typeof v === 'string' && /^[a-z][a-z0-9_-]{0,31}$/i.test(v) ? v : undefined;
}

/** `claude auth status --json` — loggedIn·authMethod·apiProvider·subscriptionType 만 읽는다 */
export function parseClaudeAuthStatus(stdout: string): Login | null {
  const start = stdout.indexOf('{');
  const end = stdout.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let o: Record<string, unknown>;
  try { o = JSON.parse(stdout.slice(start, end + 1)); } catch { return null; }
  if (!o || typeof o !== 'object' || typeof o.loggedIn !== 'boolean') return null;
  if (!o.loggedIn) return { signedIn: false };
  const otherBackend = typeof o.apiProvider === 'string' && o.apiProvider !== '' && o.apiProvider !== 'firstParty';
  if (['api_key', 'api_key_helper', 'third_party'].includes(String(o.authMethod)) || otherBackend) return { signedIn: true, method: 'metered' };
  const plan = planLabel(o.subscriptionType);
  if (o.authMethod === 'claude.ai' && o.apiProvider === 'firstParty' && plan) return { signedIn: true, method: 'subscription', plan };
  return { signedIn: true, method: 'unknown' };
}

/** `codex login status` 의 한 줄 — 알려진 줄과 대조만 (API 키 줄의 가린 키도 옮기지 않는다) */
export function parseCodexLoginStatus(output: string): Login | null {
  if (/\bNot logged in\b/i.test(output)) return { signedIn: false };
  const m = /\bLogged in using ([^\r\n]*)/i.exec(output);
  if (!m) return null;
  const how = m[1].trim().toLowerCase();
  if (/^chatgpt\b/.test(how)) return { signedIn: true, method: 'subscription' };
  if (/^(an )?api key\b/.test(how) || /^amazon bedrock\b/.test(how) || /^workload identity\b/.test(how)) return { signedIn: true, method: 'metered' };
  return { signedIn: true, method: 'unknown' };
}

export function versionAtLeast(version: string, minimum: string): boolean {
  const have = version.split('.').map(Number);
  const need = minimum.split('.').map(Number);
  for (let i = 0; i < need.length; i++) {
    const d = (have[i] ?? 0) - (need[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return true;
}

const parseVersion = (s: string) => /\d+\.\d+\.\d+/.exec(s)?.[0];
const UNKNOWN_COMMAND = /unknown (command|option)|unrecognized (subcommand|option)|unexpected argument/i;

export interface DetectOptions {
  configuredPath?: string;
  timeoutMs?: number;
  /** 화면이 그만두면 확인 명령도 끝낸다 */
  signal?: AbortSignal;
  locate?: (provider: SubscriptionProviderId, opts?: LocateOptions) => Promise<SubscriptionProgram | null>;
  run?: (program: SubscriptionProgram, args: string[], opts: { signal: AbortSignal; timeoutMs: number }) => Promise<CommandResult>;
}

function result(provider: SubscriptionProviderId, state: SubscriptionState, extra: Partial<SubscriptionDetection> = {}): SubscriptionDetection {
  const out: SubscriptionDetection = { provider, state, login_command: LOGIN_COMMAND[provider], ...extra };
  if (!out.message) {
    const name = PROGRAM_LABEL[provider];
    if (state === 'signed-out' || state === 'metered' || state === 'not-installed') out.message = cliMessage(state, provider);
    else if (state === 'needs-update') {
      const min = MIN_VERSIONS[provider];
      out.message = cliMessage('needs-update', provider, extra.version && min ? `${name} ${extra.version} 은 버전이 낮습니다(${min} 이상 필요).` : undefined);
    }
    else if (state === 'unknown-login') out.message = `${name}에 로그인되어 있지만 구독 계정인지 확인하지 못했습니다. 구독이 아니면 쓴 만큼 요금이 나갈 수 있습니다. 확실히 하려면 터미널에서 ${LOGIN_COMMAND[provider]} 명령으로 구독 계정에 다시 로그인하세요.`;
  }
  return out;
}

async function inspect(provider: SubscriptionProviderId, opts: DetectOptions, signal: AbortSignal, timeoutMs: number): Promise<SubscriptionDetection> {
  const name = PROGRAM_LABEL[provider];
  const program = await (opts.locate ?? locateSubscriptionProgram)(provider, { configuredPath: opts.configuredPath }).catch(() => null);
  if (!program) return result(provider, 'not-installed');
  const run = opts.run ?? runSubscriptionProgram;
  const ask = (args: string[]) => run(program, args, { signal, timeoutMs });
  let version: string | undefined;
  let status: CommandResult;
  try {
    version = parseVersion((await ask(['--version'])).stdout);
    const min = MIN_VERSIONS[provider];
    if (min && !version) return result(provider, 'error', { message: `${name}가 버전을 알려 주지 않았습니다. 터미널에서 ${LOGIN_COMMAND[provider]} 명령이 실행되는지 확인하세요.` });
    if (min && version && !versionAtLeast(version, min)) return result(provider, 'needs-update', { version });
    status = await ask(provider === 'claude-code' ? ['auth', 'status', '--json'] : ['login', 'status']);
  } catch (err) {
    const code = (err as { code?: unknown })?.code;
    const why = typeof code === 'string' && /^E[A-Z0-9_]{1,30}$/.test(code) ? ` (${code})` : '';
    return result(provider, 'error', { ...(version ? { version } : {}), message: `${name}를 실행하지 못했습니다${why}. 터미널에서 ${LOGIN_COMMAND[provider]} 명령이 실행되는지 확인하세요.` });
  }
  const login = provider === 'claude-code' ? parseClaudeAuthStatus(status.stdout) : parseCodexLoginStatus(`${status.stderr}\n${status.stdout}`);
  const v = version ? { version } : {};
  if (!login) {
    if (UNKNOWN_COMMAND.test(`${status.stderr}\n${status.stdout}`)) return result(provider, 'needs-update', v);
    return result(provider, 'error', { ...v, message: `${name}가 로그인 상태를 알려 주지 않았습니다(종료 코드 ${status.code ?? '없음'}). 터미널에서 ${LOGIN_COMMAND[provider]} 명령을 실행해 확인하세요.` });
  }
  if (!login.signedIn) return result(provider, 'signed-out', v);
  if (login.method === 'subscription') return result(provider, 'ready', { ...v, ...(login.plan ? { plan: login.plan } : {}) });
  return result(provider, login.method === 'metered' ? 'metered' : 'unknown-login', v);
}

/** 한 프로그램의 상태. 거절하지 않는다 — 실패·시간 초과도 error 상태로 */
export async function detectSubscriptionLogin(provider: SubscriptionProviderId, opts: DetectOptions = {}): Promise<SubscriptionDetection> {
  const timeoutMs = opts.timeoutMs ?? STATUS_TIMEOUT_MS;
  const ctl = new AbortController();
  const onAbort = () => ctl.abort();
  opts.signal?.addEventListener('abort', onAbort, { once: true });
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<SubscriptionDetection>((r) => {
    timer = setTimeout(() => r(result(provider, 'error', { message: `${PROGRAM_LABEL[provider]}가 ${Math.round(timeoutMs / 1000)}초 안에 답하지 않았습니다. 잠시 뒤 다시 확인하세요.` })), timeoutMs);
  });
  try {
    return await Promise.race([
      inspect(provider, opts, ctl.signal, timeoutMs).catch(() => result(provider, 'error', { message: `${PROGRAM_LABEL[provider]} 상태를 확인하지 못했습니다. 잠시 뒤 다시 확인하세요.` })),
      deadline,
    ]);
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onAbort);
    ctl.abort(); // 남은 확인 명령을 끝낸다
  }
}

// ── 실행 직전 로그인 확인 — 구독이 아닌 로그인으로 요금이 나가는 일을 막는다 (이음오피스 결정 0002) ──

const LOGIN_TTL_MS = 10 * 60_000;
/** 확인 자체가 안 될 때(시간 초과 등)는 실행에 맡기되, 요청마다 20초씩 다시 묻지 않게 잠깐 기억 */
const ERROR_TTL_MS = 60_000;
const loginCache = new Map<string, { at: number; state: SubscriptionState }>();

export function clearLoginCache(): void {
  loginCache.clear();
}

/** ready·unknown-login 이면 통과(10분 기억), 로그아웃·종량제·낡은 버전이면 할 일을 적은 오류. 확인 자체가 안 되면 실행에 맡긴다 */
export async function assertSubscriptionLogin(provider: SubscriptionProviderId, program: SubscriptionProgram, detect: typeof detectSubscriptionLogin = detectSubscriptionLogin): Promise<void> {
  const key = `${provider}|${program.command}|${program.prefixArgs.join(' ')}`;
  const hit = loginCache.get(key);
  if (hit && Date.now() - hit.at < (hit.state === 'error' ? ERROR_TTL_MS : LOGIN_TTL_MS)) return;
  const d = await detect(provider, { locate: async () => program });
  if (d.state === 'ready' || d.state === 'unknown-login' || d.state === 'error') { loginCache.set(key, { at: Date.now(), state: d.state }); return; }
  if (d.state === 'signed-out' || d.state === 'metered') throw new CliRunError(d.state, provider);
  if (d.state === 'needs-update') throw new CliRunError('needs-update', provider);
}
