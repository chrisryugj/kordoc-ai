/** AI 연결 화면 돕기 — 구독 프로그램(Claude Code·Codex·Gemini CLI) 설치·로그인 상태와 모델 목록, 이 PC 의 로컬 모델 서버 찾기
 *
 * 폐쇄망 모드거나 기관이 구독 연결을 막았으면 프로그램을 찾지도 띄우지도 않는다.
 * 문서 보내기를 허용하기 전(ai.allow_subscription false)에는 설치 위치만 찾고(파일 확인) 프로그램은 띄우지 않는다.
 * 로그인 확인·모델 목록도 프로그램이 인터넷에 나갈 수 있어 통신 기록에 남긴다(보안 화면은 적게 세기보다 많이 센다).
 */

import type { LocalModelServer, SubscriptionStatus } from '../../types/rpc-contract.js';
import { getSettings } from '../../infra/config.js';
import { assertProgramEgress } from '../../infra/net-guard.js';
import { listClaudeCodeModels, type CliModel } from '../../infra/llm/claude-code.js';
import { forgetCodexSafety, listCodexModels } from '../../infra/llm/codex.js';
import { listGeminiCliModels } from '../../infra/llm/gemini-cli.js';
import { findLocalServers } from '../../infra/llm/local-servers.js';
import { LOGIN_COMMAND, PROGRAM_LABEL, UPDATE_COMMAND, type SubscriptionProviderId } from '../../infra/llm/subscription/errors.js';
import { checkLogin, forgetLogins } from '../../infra/llm/subscription/login.js';
import { findProgram, runProgram } from '../../infra/llm/subscription/program.js';

const PROVIDERS: SubscriptionProviderId[] = ['claude-code', 'codex', 'gemini-cli'];
const EGRESS: Record<SubscriptionProviderId, [string, string]> = {
  'claude-code': ['api.anthropic.com', 'Claude Code 로그인 확인'],
  codex: ['chatgpt.com', 'Codex 로그인 확인'],
  'gemini-cli': ['cloudcode-pa.googleapis.com', 'Gemini CLI 로그인 확인'],
};
const SLOT = { 'claude-code': 'claude_code', codex: 'codex', 'gemini-cli': 'gemini_cli' } as const;

export function isSubscriptionProvider(v: unknown): v is SubscriptionProviderId {
  return v === 'claude-code' || v === 'codex' || v === 'gemini-cli';
}

/** 찾지도 띄우지도 말아야 하면 그 까닭 */
function blocked(): Pick<SubscriptionStatus, 'state' | 'message'> | null {
  const s = getSettings();
  if (s.privacy.offline) return { state: 'offline', message: '폐쇄망 모드에서는 구독 계정을 쓸 수 없습니다. 이 PC에서 돌리는 AI(켜 둔 AI 프로그램이나 내장 AI)를 고르세요.' };
  if (s.policy?.locked.includes('ai.allow_subscription') && !s.ai.allow_subscription) {
    return { state: 'disabled', message: '기관에서 구독 계정 연결을 막았습니다. 다른 AI 연결을 고르세요.' };
  }
  return null;
}

/** 프로그램 위치는 기관 배포 설정(정책)으로만 정한다 — config.ts 가 화면·settings.json 의 값은 버린다 */
const cliPath = (p: SubscriptionProviderId) => getSettings().ai[SLOT[p]].cli_path;

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
  if (!isSubscriptionProvider(params.provider)) throw new Error('구독 프로그램을 고르세요 (claude-code, codex, gemini-cli).');
  const stop = blocked();
  if (stop) throw new Error(stop.message);
  const { ai } = getSettings();
  if (!ai.allow_subscription) throw new Error('구독 계정으로 문서 보내기를 허용하고 저장한 뒤 모델을 불러오세요.');
  const models = params.provider === 'codex'
    ? await listCodexModels(ai.codex, AbortSignal.any([signal, AbortSignal.timeout(30_000)]))
    : params.provider === 'gemini-cli'
      ? await listGeminiCliModels(ai.gemini_cli, signal)
      : await listClaudeCodeModels(ai.claude_code, AbortSignal.any([signal, AbortSignal.timeout(15_000)]));
  return { models };
}

export async function localServers(signal: AbortSignal): Promise<{ servers: LocalModelServer[] }> {
  return { servers: await findLocalServers({ signal }) };
}

/** 구독 프로그램 업데이트 — 프로그램 자신의 공식 업데이트 명령(`claude update`·`codex update`)을 고정 인자로, 셸 없이 띄운다.
 *  문서는 보내지 않지만 인터넷에서 새 판을 받으니 폐쇄망·기관 차단이면 하지 않고 통신 기록에 남긴다.
 *  끝나면 판 번호를 다시 읽어 전후를 돌려준다(로그인 상태 기억은 지운다) */
export async function subscriptionUpdate(params: { provider?: unknown }, signal: AbortSignal): Promise<{ ok: boolean; before?: string; after?: string; message: string }> {
  if (!isSubscriptionProvider(params.provider)) throw new Error('구독 프로그램을 고르세요 (claude-code, codex, gemini-cli).');
  const provider = params.provider;
  const stop = blocked();
  if (stop) throw new Error(stop.message);
  // 허용 전에는 프로그램을 띄우지 않는다 (상태 확인·모델 목록과 같은 규칙)
  if (!getSettings().ai.allow_subscription) throw new Error('구독 계정으로 문서 보내기를 허용하고 저장한 뒤 업데이트하세요.');
  const program = await findProgram(provider, { configured: cliPath(provider) }).catch(() => null);
  if (!program) throw new Error(`이 PC에서 ${PROGRAM_LABEL[provider]}를 찾지 못했습니다. ${PROGRAM_LABEL[provider]}를 설치한 뒤 다시 시도하세요.`);
  if (cliPath(provider)) throw new Error(`기관 배포 설정이 ${PROGRAM_LABEL[provider]} 위치를 정해 두어 앱에서 업데이트하지 않습니다. 기관 담당자에게 업데이트를 요청하세요.`);
  const version = async () => {
    const r = await runProgram(program, ['--version'], { signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]), idleMs: 20_000 });
    return (r.stdout + r.stderr).match(/\d+\.\d+\.\d+/)?.[0];
  };
  // Gemini CLI 에는 업데이트 명령이 없다(0.35 --help). 공식 안내는 설치한 도구로 다시 까는 것: 명령은 실행하지 않고 알려만 준다
  if (provider === 'gemini-cli') {
    const before = await version().catch(() => undefined);
    const cmd = /[\\/](Cellar|homebrew)[\\/]/i.test(program.entry) ? 'brew upgrade gemini-cli' : UPDATE_COMMAND[provider];
    return { ok: false, before, after: before, message: `Gemini CLI는 앱에서 업데이트하지 않습니다. 터미널에서 ${cmd} 명령을 실행하세요${before ? ` (지금 ${before})` : ''}.` };
  }
  assertProgramEgress(provider === 'codex' ? 'Codex 업데이트 서버' : 'Claude Code 업데이트 서버', `${PROGRAM_LABEL[provider]} 업데이트`);
  const before = await version().catch(() => undefined);
  // Codex 앱에 딸린 CLI 는 스스로 업데이트하지 못한다(실측: "Could not detect the Codex installation method"). 앱이 함께 올린다
  if (provider === 'codex' && /[\\/]OpenAI[\\/]Codex[\\/]bin[\\/]/i.test(program.entry)) {
    return { ok: true, before, after: before, message: `이 Codex는 Codex 앱에 함께 깔린 것이라 Codex 앱을 업데이트하면 같이 새 판이 됩니다${before ? ` (지금 ${before})` : ''}.` };
  }
  // 받는 동안 출력이 뜸할 수 있어 넉넉히 (5분)
  const r = await runProgram(program, ['update'], { signal: AbortSignal.any([signal, AbortSignal.timeout(300_000)]), idleMs: 300_000 });
  forgetLogins();
  forgetCodexSafety();
  const after = await version().catch(() => undefined);
  const name = PROGRAM_LABEL[provider];
  if (r.code !== 0) {
    return { ok: false, before, after, message: `${name} 업데이트가 끝나지 않았습니다. 터미널에서 ${UPDATE_COMMAND[provider]} 명령을 직접 실행해 보고, 회사 PC라 막혔으면 담당자에게 요청하세요.` };
  }
  return { ok: true, before, after, message: before && after && before !== after ? `${name}를 ${before}에서 ${after}로 업데이트했습니다.` : `${name}는 이미 최신 판입니다${after ? ` (${after})` : ''}.` };
}
