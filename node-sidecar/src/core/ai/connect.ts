/** AI 연결 화면 돕기 — 구독 프로그램(Claude Code·Codex) 설치·로그인 상태와 모델 목록, 이 PC 의 로컬 모델 서버 찾기
 *
 * 폐쇄망 모드거나 기관이 구독 연결을 막았으면 프로그램을 아예 띄우지 않는다.
 * 로그인 확인·모델 목록도 프로그램이 인터넷에 나갈 수 있어 통신 기록에 남긴다(보안 화면은 적게 세기보다 많이 센다).
 */

import type { LocalModelServer, SubscriptionStatus } from '../../types/rpc-contract.js';
import { getSettings } from '../../infra/config.js';
import { assertProgramEgress } from '../../infra/net-guard.js';
import { listClaudeCodeModels, type CliModel } from '../../infra/llm/claude-code.js';
import { listCodexModels } from '../../infra/llm/codex.js';
import { findLocalServers } from '../../infra/llm/local-servers.js';
import { LOGIN_COMMAND, type SubscriptionProviderId } from '../../infra/llm/subscription/messages.js';
import { detectSubscriptionLogin } from '../../infra/llm/subscription/status.js';

const PROVIDERS: SubscriptionProviderId[] = ['claude-code', 'codex'];
const EGRESS: Record<SubscriptionProviderId, [string, string]> = {
  'claude-code': ['api.anthropic.com', 'Claude Code 로그인 확인'],
  codex: ['chatgpt.com', 'Codex 로그인 확인'],
};

export function isSubscriptionProvider(v: unknown): v is SubscriptionProviderId {
  return v === 'claude-code' || v === 'codex';
}

/** 띄우지 말아야 하면 그 까닭 */
function blocked(): Pick<SubscriptionStatus, 'state' | 'message'> | null {
  const s = getSettings();
  if (s.privacy.offline) return { state: 'offline', message: '폐쇄망 모드에서는 구독 계정을 쓸 수 없습니다. 이 PC의 로컬 모델 서버나 내장 모델을 고르세요.' };
  if (s.policy?.locked.includes('ai.allow_subscription') && !s.ai.allow_subscription) {
    return { state: 'disabled', message: '기관에서 구독 계정 연결을 막았습니다. 다른 AI 연결을 고르세요.' };
  }
  return null;
}

const cliPath = (p: SubscriptionProviderId) => getSettings().ai[p === 'codex' ? 'codex' : 'claude_code'].cli_path;

export async function subscriptionStatus(params: { provider?: unknown }): Promise<{ statuses: SubscriptionStatus[] }> {
  const list = isSubscriptionProvider(params.provider) ? [params.provider] : PROVIDERS;
  const stop = blocked();
  if (stop) return { statuses: list.map((provider) => ({ provider, login_command: LOGIN_COMMAND[provider], ...stop })) };
  const statuses = await Promise.all(list.map((provider) => {
    assertProgramEgress(...EGRESS[provider]);
    return detectSubscriptionLogin(provider, { configuredPath: cliPath(provider) });
  }));
  return { statuses };
}

export async function subscriptionModels(params: { provider?: unknown }, signal: AbortSignal): Promise<{ models: CliModel[] }> {
  if (!isSubscriptionProvider(params.provider)) throw new Error('구독 프로그램을 고르세요 (claude-code 또는 codex).');
  const stop = blocked();
  if (stop) throw new Error(stop.message);
  const { ai } = getSettings();
  const models = params.provider === 'codex'
    ? await listCodexModels(ai.codex, AbortSignal.any([signal, AbortSignal.timeout(30_000)]))
    : await listClaudeCodeModels(ai.claude_code, AbortSignal.any([signal, AbortSignal.timeout(15_000)]));
  return { models };
}

export async function localServers(signal: AbortSignal): Promise<{ servers: LocalModelServer[] }> {
  return { servers: await findLocalServers({ signal }) };
}
