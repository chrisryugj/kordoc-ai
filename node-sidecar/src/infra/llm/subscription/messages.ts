/** 구독 프로그램 실패의 종류와 화면 문장 — 무엇이 막혔는지 + 무엇을 하면 되는지
 *
 * 종류(kind)는 이음오피스 ai-provider 의 AiRunErrorKind(Apache-2.0, 커밋 9bda9ac)에서 가져왔고, 문장은 새로 썼다.
 * 프로그램이 찍은 글자(계정 이메일·조직 이름이 섞일 수 있음)는 문장에 넣지 않는다.
 * 줄표 금지·영어 원문 금지(core/errors.ts 의 toAiError 가 영어 오류를 일반 문장으로 바꿔 버린다).
 */

export type SubscriptionProviderId = 'claude-code' | 'codex';

export const PROGRAM_LABEL: Record<SubscriptionProviderId, string> = { 'claude-code': 'Claude Code', codex: 'Codex' };

/** 화면에 보일 로그인 명령 (터미널에서 사용자가 직접 친다. 앱은 로그인 정보를 읽거나 만들지 않는다) */
export const LOGIN_COMMAND: Record<SubscriptionProviderId, string> = { 'claude-code': 'claude', codex: 'codex login' };

const INSTALL: Record<SubscriptionProviderId, string> = {
  'claude-code': 'Claude Code 설치 안내(code.claude.com)대로 설치하고',
  codex: 'Codex 설치 안내(developers.openai.com/codex)대로 설치하고',
};
const ACCOUNT: Record<SubscriptionProviderId, string> = {
  'claude-code': '터미널에서 claude 명령을 실행해 구독 계정(Claude Pro·Max 등)으로 로그인한 뒤',
  codex: '터미널에서 codex login 명령을 실행해 ChatGPT 계정으로 로그인한 뒤',
};
const UPDATE: Record<SubscriptionProviderId, string> = {
  'claude-code': '터미널에서 claude update 명령으로 올린 뒤',
  codex: 'Codex를 설치 안내대로 다시 설치해 최신으로 올린 뒤',
};
/** 도구·MCP 가 끼어들 수 있는 사용자 설정 파일 */
const CONFIG_FILE: Record<SubscriptionProviderId, string> = {
  'claude-code': '~/.claude/settings.json·.mcp.json',
  codex: '~/.codex/config.toml',
};

export type CliErrorKind =
  | 'not-installed' | 'signed-out' | 'metered' | 'needs-update' | 'rate-limit'
  | 'overloaded' | 'server-error' | 'network' | 'too-long' | 'bad-request' | 'timeout' | 'unsafe-tools' | 'failed';

/** 구독 프로그램 실패. message 는 화면에 그대로 보일 한국어 */
export class CliRunError extends Error {
  constructor(readonly kind: CliErrorKind, readonly provider: SubscriptionProviderId, lead?: string, opts: { resetsAt?: number; seconds?: number } = {}) {
    super(cliMessage(kind, provider, lead, opts));
  }
}

function clock(ms: number): string {
  const d = new Date(ms);
  const sameDay = new Date().toDateString() === d.toDateString();
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return sameDay ? hm : `${d.getMonth() + 1}월 ${d.getDate()}일 ${hm}`;
}

export function cliMessage(kind: CliErrorKind, provider: SubscriptionProviderId, lead?: string, opts: { resetsAt?: number; seconds?: number } = {}): string {
  const name = PROGRAM_LABEL[provider];
  const cmd = LOGIN_COMMAND[provider];
  switch (kind) {
    case 'not-installed':
      return `${lead ?? `${name} 프로그램을 찾지 못했습니다.`} ${INSTALL[provider]} ${ACCOUNT[provider]} 다시 시도하세요. 흔하지 않은 곳에 설치했으면 정보통신 담당자가 기관 배포 설정으로 프로그램 위치를 정해 줄 수 있습니다.`;
    case 'signed-out':
      return `${name}에 로그인되어 있지 않습니다. ${ACCOUNT[provider]} 다시 시도하세요.`;
    case 'metered':
      return `${name}가 구독이 아니라 쓴 만큼 요금이 나가는 방식(API 키 등)으로 로그인되어 있어 보내지 않았습니다. ${ACCOUNT[provider]} 다시 시도하세요. 키로 쓰려면 설정 > AI 연결의 인터넷 AI 서비스 칸에 API 키를 넣으세요.`;
    case 'needs-update':
      return `${lead ?? `${name} 버전이 낮아 이 앱과 맞지 않습니다.`} ${UPDATE[provider]} 다시 시도하세요.`;
    case 'rate-limit':
      return `${name} 구독 사용량 한도에 걸렸습니다. ${opts.resetsAt ? `${clock(opts.resetsAt)}부터 다시 쓸 수 있습니다.` : '잠시 뒤 다시 시도하세요.'}`;
    case 'overloaded':
      return `${name} 쪽 서버가 붐벼 답하지 못했습니다. 잠시 뒤 다시 시도하세요.`;
    case 'server-error':
      return `${name} 쪽 서버에 오류가 나 답하지 못했습니다. 잠시 뒤 다시 시도하세요.`;
    case 'network':
      return `${name}가 인터넷에 연결하지 못했습니다. 네트워크 연결을 확인하고 다시 시도하세요.`;
    case 'too-long':
      return `문서가 너무 깁니다. ${name}가 한 번에 읽을 수 있는 길이를 넘었습니다. 문서를 나누거나 범위를 줄여 다시 시도하세요.`;
    case 'bad-request':
      return `${name}가 요청을 받지 않았습니다${lead ? ` (${lead})` : ''}. 설정 > AI 연결에서 모델을 비우거나(기본 모델) 다른 모델로 바꾼 뒤 다시 시도하세요.`;
    case 'timeout':
      return `${name}가 ${opts.seconds ?? 0}초 동안 응답하지 않아 멈췄습니다. 잠시 뒤 다시 시도하세요. 계속되면 터미널에서 ${cmd} 명령을 실행해 정상 동작하는지 확인하세요.`;
    case 'unsafe-tools':
      return `${name}가 파일·명령 도구를 쓸 수 있는 상태여서 멈추고 답을 쓰지 않았습니다${lead ? ` (${lead})` : ''}. ${CONFIG_FILE[provider]} 에 켜 둔 MCP 서버·플러그인이 끼어들었을 수 있으니 끄고, ${UPDATE[provider]} 다시 시도하세요.`;
    default:
      return `${lead ?? `${name}가 답하지 못했습니다.`} 다시 시도하세요. 계속되면 터미널에서 ${cmd} 명령을 실행해 정상 동작하는지 확인하세요.`;
  }
}

/** 취소 — 라우터가 AbortError 를 취소로 처리한다 */
export function cancelledError(): Error {
  return new DOMException('요청을 취소했습니다', 'AbortError');
}
