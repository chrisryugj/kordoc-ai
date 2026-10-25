/** 구독 로그인 상태: 프로그램 자신의 답(`claude auth status --json`·`codex login status`)만 읽는다.
 * 계정 파일은 열지 않고, 답에 든 이메일·조직 이름은 옮기지 않는다(쓰는 값은 로그인 여부·방식·요금제 이름뿐).
 */

import type { SubscriptionStatus } from '../../../types/rpc-contract.js';
import { LOGIN_COMMAND, PROGRAM_LABEL, SubscriptionError, type SubscriptionProviderId } from './errors.js';
import { runProgram, type Program, type SpawnFn } from './program.js';

export interface Login {
  signedIn: boolean;
  /** subscription: 구독 · metered: 쓴 만큼 요금(API 키·다른 클라우드) · unknown: 모름 */
  method?: 'subscription' | 'metered' | 'unknown';
  plan?: string;
}

/** `claude auth status --json` */
export function readClaudeAuth(stdout: string): Login | null {
  let j: Record<string, unknown>;
  try { j = JSON.parse(stdout.trim()); } catch { return null; }
  if (typeof j?.loggedIn !== 'boolean') return null;
  if (!j.loggedIn) return { signedIn: false };
  const firstParty = j.apiProvider === undefined || j.apiProvider === 'firstParty';
  if (!firstParty || /api.?key/i.test(String(j.authMethod))) return { signedIn: true, method: 'metered' };
  if (j.authMethod === 'claude.ai') {
    return typeof j.subscriptionType === 'string' && /^[a-z0-9_-]{1,32}$/i.test(j.subscriptionType)
      ? { signedIn: true, method: 'subscription', plan: j.subscriptionType }
      : { signedIn: true, method: 'subscription' };
  }
  return { signedIn: true, method: 'unknown' };
}

/** `codex login status` (stdout·stderr 어느 쪽에든 한 줄) */
export function readCodexLogin(text: string): Login | null {
  if (/not logged in/i.test(text)) return { signedIn: false };
  if (/logged in using chatgpt/i.test(text)) return { signedIn: true, method: 'subscription' };
  // API 키·클라우드 계정(Bedrock·Azure·워크로드 신원 등)은 쓴 만큼 요금
  if (/logged in using .*(api key|bedrock|azure|vertex|workload|identity)/i.test(text)) return { signedIn: true, method: 'metered' };
  if (/logged in/i.test(text)) return { signedIn: true, method: 'unknown' };
  return null;
}

const STATUS_ARGS: Record<SubscriptionProviderId, string[]> = { 'claude-code': ['auth', 'status', '--json'], codex: ['login', 'status'] };
const STATUS_TIMEOUT_MS = 20_000;
/** 쓸 수 있다고 확인한 결과만 1분 기억한다 (로그인 안 됨·종량제는 고친 뒤 바로 다시 확인되게 기억하지 않는다) */
const CACHE_MS = 60_000;

export type LoginReport = Omit<SubscriptionStatus, 'path'>;

export interface CheckOptions { signal?: AbortSignal; baseEnv?: NodeJS.ProcessEnv; spawn?: SpawnFn }

const cache = new Map<string, { at: number; report: LoginReport }>();
export function forgetLogins(): void { cache.clear(); }

async function ask(program: Program, args: string[], o: CheckOptions) {
  const signal = AbortSignal.any([o.signal ?? new AbortController().signal, AbortSignal.timeout(STATUS_TIMEOUT_MS)]);
  return runProgram(program, args, { signal, idleMs: STATUS_TIMEOUT_MS, baseEnv: o.baseEnv, spawn: o.spawn });
}

/** 설치·로그인 상태 (프로그램을 두 번 띄운다: 버전, 로그인) */
export async function checkLogin(provider: SubscriptionProviderId, program: Program | null, o: CheckOptions = {}): Promise<LoginReport> {
  const base = { provider, login_command: LOGIN_COMMAND[provider] };
  if (!program) return { ...base, state: 'not-installed', message: new SubscriptionError('not-installed', provider).message };
  const key = JSON.stringify([provider, program.command, program.lead, program.env ?? {}]);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.report;
  let report: LoginReport;
  try {
    const v = await ask(program, ['--version'], o);
    const version = (v.stdout + v.stderr).match(/\d+\.\d+\.\d+/)?.[0];
    const s = await ask(program, STATUS_ARGS[provider], o);
    const login = provider === 'claude-code' ? readClaudeAuth(s.stdout) : readCodexLogin(`${s.stdout}\n${s.stderr}`);
    const ver = version ? { version } : {};
    if (!login) {
      report = { ...base, ...ver, state: 'needs-update', message: new SubscriptionError('needs-update', provider, { why: '로그인 상태를 알려 주지 않음' }).message };
    } else if (!login.signedIn) {
      report = { ...base, ...ver, state: 'signed-out', message: new SubscriptionError('signed-out', provider).message };
    } else if (login.method === 'metered') {
      report = { ...base, ...ver, state: 'metered', message: new SubscriptionError('metered', provider).message };
    } else if (login.method === 'unknown') {
      report = { ...base, ...ver, state: 'unknown-login', message: `${PROGRAM_LABEL[provider]}에 로그인돼 있지만 구독 계정인지 확인하지 못했습니다. 쓸 수는 있습니다. 쓴 만큼 요금이 나가는 방식이면 ${LOGIN_COMMAND[provider]} 명령으로 구독 계정에 다시 로그인하세요.` };
    } else {
      report = { ...base, ...ver, state: 'ready', ...(login.plan ? { plan: login.plan } : {}) };
    }
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError' && o.signal?.aborted) throw e;
    const kind = e instanceof SubscriptionError ? e.kind : 'failed';
    return { ...base, state: kind === 'not-installed' ? 'not-installed' : 'error', message: e instanceof SubscriptionError ? e.message : new SubscriptionError('failed', provider, { why: '상태 확인이 끝나지 않음' }).message };
  }
  if (report.state === 'ready' || report.state === 'unknown-login') cache.set(key, { at: Date.now(), report });
  return report;
}

/** 보내기 직전: 구독(또는 모르는 방식)으로 로그인돼 있어야 한다 */
export async function requireSubscription(provider: SubscriptionProviderId, program: Program, o: CheckOptions = {}): Promise<void> {
  const r = await checkLogin(provider, program, o);
  if (r.state === 'ready' || r.state === 'unknown-login') return;
  if (r.state === 'signed-out' || r.state === 'metered' || r.state === 'not-installed' || r.state === 'needs-update') {
    throw new SubscriptionError(r.state, provider, r.state === 'needs-update' ? { why: '로그인 상태를 알려 주지 않음' } : {});
  }
  throw new SubscriptionError('failed', provider, { why: '로그인 상태를 확인하지 못함' });
}
