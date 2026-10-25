/** AI 연결 화면 돕기 — 구독 프로그램(Claude Code·Codex) 설치·로그인 상태와 모델 목록, 이 PC 의 로컬 모델 서버 찾기
 *
 * 폐쇄망 모드거나 기관이 구독 연결을 막았으면 프로그램을 찾지도 띄우지도 않는다.
 * 문서 보내기를 허용하기 전(ai.allow_subscription false)에는 설치 위치만 찾고(파일 확인) 프로그램은 띄우지 않는다.
 * 로그인 확인·모델 목록도 프로그램이 인터넷에 나갈 수 있어 통신 기록에 남긴다(보안 화면은 적게 세기보다 많이 센다).
 */

import type { LocalModelServer, SubscriptionStatus } from '../../types/rpc-contract.js';
import { getSettings } from '../../infra/config.js';
import { assertProgramEgress } from '../../infra/net-guard.js';
import { listClaudeCodeModels, type CliModel } from '../../infra/llm/claude-code.js';
import { listCodexModels } from '../../infra/llm/codex.js';
import { findLocalServers } from '../../infra/llm/local-servers.js';
import { LOGIN_COMMAND, PROGRAM_LABEL, type SubscriptionProviderId } from '../../infra/llm/subscription/errors.js';
import { checkLogin } from '../../infra/llm/subscription/login.js';
import { findProgram } from '../../infra/llm/subscription/program.js';

const PROVIDERS: SubscriptionProviderId[] = ['claude-code', 'codex'];
const EGRESS: Record<SubscriptionProviderId, [string, string]> = {
  'claude-code': ['api.anthropic.com', 'Claude Code 로그인 확인'],
  codex: ['chatgpt.com', 'Codex 로그인 확인'],
};

export function isSubscriptionProvider(v: unknown): v is SubscriptionProviderId {
  return v === 'claude-code' || v === 'codex';
}

/** 찾지도 띄우지도 말아야 하면 그 까닭 */
function blocked(): Pick<SubscriptionStatus, 'state' | 'message'> | null {
  const s = getSettings();
  if (s.privacy.offline) return { state: 'offline', message: '폐쇄망 모드에서는 구독 계정을 쓸 수 없습니다. 이 PC의 로컬 모델 서버나 내장 모델을 고르세요.' };
  if (s.policy?.locked.includes('ai.allow_subscription') && !s.ai.allow_subscription) {
    return { state: 'disabled', message: '기관에서 구독 계정 연결을 막았습니다. 다른 AI 연결을 고르세요.' };
  }
  return null;
}

/** 프로그램 위치는 기관 배포 설정(정책)으로만 정한다 — config.ts 가 화면·settings.json 의 값은 버린다 */
const cliPath = (p: SubscriptionProviderId) => getSettings().ai[p === 'codex' ? 'codex' : 'claude_code'].cli_path;

async function statusOf(provider: SubscriptionProviderId, signal: AbortSignal): Promise<SubscriptionStatus> {
  const program = await findProgram(provider, { configured: cliPath(provider) }).catch(() => null);
  const base = { provider, login_command: LOGIN_COMMAND[provider] };
  if (!program) return checkLogin(provider, null);
  const path = program.entry;
  if (!getSettings().ai.allow_subscription) {
    // 허용 전에는 띄우지 않는다: 설치돼 있다는 것만
    return { ...base, state: 'installed', path, message: `${PROGRAM_LABEL[provider]}가 설치돼 있습니다. 문서 보내기를 허용하고 저장하면 로그인 상태를 확인합니다.` };
  }
  assertProgramEgress(...EGRESS[provider]);
  return { ...(await checkLogin(provider, program, { signal })), path };
}

export async function subscriptionStatus(params: { provider?: unknown }, signal: AbortSignal = new AbortController().signal): Promise<{ statuses: SubscriptionStatus[] }> {
  const list = isSubscriptionProvider(params.provider) ? [params.provider] : PROVIDERS;
  const stop = blocked();
  if (stop) return { statuses: list.map((provider) => ({ provider, login_command: LOGIN_COMMAND[provider], ...stop })) };
  return { statuses: await Promise.all(list.map((p) => statusOf(p, signal))) };
}

export async function subscriptionModels(params: { provider?: unknown }, signal: AbortSignal): Promise<{ models: CliModel[] }> {
  if (!isSubscriptionProvider(params.provider)) throw new Error('구독 프로그램을 고르세요 (claude-code 또는 codex).');
  const stop = blocked();
  if (stop) throw new Error(stop.message);
  const { ai } = getSettings();
  if (!ai.allow_subscription) throw new Error('구독 계정으로 문서 보내기를 허용하고 저장한 뒤 모델을 불러오세요.');
  const models = params.provider === 'codex'
    ? await listCodexModels(ai.codex, AbortSignal.any([signal, AbortSignal.timeout(30_000)]))
    : await listClaudeCodeModels(ai.claude_code, AbortSignal.any([signal, AbortSignal.timeout(15_000)]));
  return { models };
}

export async function localServers(signal: AbortSignal): Promise<{ servers: LocalModelServer[] }> {
  return { servers: await findLocalServers({ signal }) };
}
