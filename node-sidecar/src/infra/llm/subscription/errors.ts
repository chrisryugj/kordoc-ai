/** 구독 프로그램(Claude Code·Codex) 실패 → 할 일까지 적은 한국어 문장
 *
 * 프로그램이 찍은 영어 원문·계정 정보는 문장에 넣지 않는다(why 는 우리가 고른 짧은 까닭만).
 */

export type SubscriptionProviderId = 'claude-code' | 'codex';

export const PROGRAM_LABEL: Record<SubscriptionProviderId, string> = { 'claude-code': 'Claude Code', codex: 'Codex' };
/** 터미널에서 칠 로그인 명령 */
export const LOGIN_COMMAND: Record<SubscriptionProviderId, string> = { 'claude-code': 'claude', codex: 'codex login' };
const UPDATE_COMMAND: Record<SubscriptionProviderId, string> = { 'claude-code': 'claude update', codex: 'codex update' };

export type FailKind =
  | 'signed-out' | 'metered' | 'not-installed' | 'needs-update' | 'rate-limit' | 'overloaded' | 'server-error'
  | 'network' | 'too-long' | 'bad-request' | 'timeout' | 'unsafe-tools' | 'failed';

export interface FailDetail {
  /** 짧은 까닭 (우리가 쓴 한국어, 원문 금지) */
  why?: string;
  /** 사용량 한도가 풀리는 시각 (ms) */
  resetsAt?: number;
  /** 시간 제한 (초) */
  seconds?: number;
}

const hhmm = (ms: number) => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

function sentence(kind: FailKind, p: SubscriptionProviderId, d: FailDetail): string {
  const name = PROGRAM_LABEL[p];
  const why = d.why ? `(${d.why})` : '';
  switch (kind) {
    case 'signed-out': return `${name}에 로그인되어 있지 않습니다. 터미널에서 ${LOGIN_COMMAND[p]} 명령을 실행해 구독 계정으로 로그인한 뒤 다시 시도하세요.`;
    case 'metered': return `${name}가 구독이 아닌 방식(쓴 만큼 요금을 내는 API 키 등)으로 로그인돼 있어 보내지 않았습니다. ${LOGIN_COMMAND[p]} 명령으로 구독 계정에 다시 로그인하거나, API 키를 쓰려면 설정 › AI 연결에서 해당 서비스 칸을 고르세요.`;
    case 'not-installed': return `이 PC에서 ${name}를 찾지 못했습니다. ${name}를 설치하고 로그인한 뒤 다시 시도하세요.`;
    case 'needs-update': return `${name} 버전이 낮아 안전 설정을 걸 수 없습니다${why}. 터미널에서 ${UPDATE_COMMAND[p]} 를 실행한 뒤 다시 시도하세요.`;
    case 'rate-limit': return `${name} 구독 사용량 한도에 닿았습니다. ${d.resetsAt ? `${hhmm(d.resetsAt)}부터 다시 쓸 수 있습니다.` : '잠시 뒤 다시 시도하세요.'}`;
    case 'overloaded': return `${name} 서버가 붐빕니다. 잠시 뒤 다시 시도하세요.`;
    case 'server-error': return `${name} 서버에 오류가 났습니다. 잠시 뒤 다시 시도하세요.`;
    case 'network': return `${name}가 인터넷에 연결하지 못했습니다. 네트워크와 프록시 설정을 확인하세요.`;
    case 'too-long': return `문서가 너무 깁니다. ${name}가 한 번에 받는 양을 넘었습니다. 문서를 나눠 보내거나 범위를 줄이세요.`;
    case 'bad-request': return `${name}가 요청을 받지 않았습니다${why}. 설정 › AI 연결에서 모델 칸을 비워 기본 모델로 해 보세요.`;
    case 'timeout': return `${name}가 ${d.seconds ?? 0}초 동안 응답하지 않아 멈췄습니다. 다시 시도하거나 설정 › AI 연결에서 시간 제한을 늘리세요.`;
    case 'unsafe-tools': return `${name}에 켜진 도구가 보여서 멈췄습니다${why}. ${UPDATE_COMMAND[p]} 로 최신 버전을 깔고 다시 시도하고, 계속되면 다른 AI 연결을 고르세요.`;
    case 'failed': return `${name} 실행이 실패했습니다${why}. 다시 시도하고, 계속되면 터미널에서 ${name}가 열리는지 확인하세요.`;
  }
}

export class SubscriptionError extends Error {
  override name = 'SubscriptionError';
  constructor(readonly kind: FailKind, readonly provider: SubscriptionProviderId, readonly detail: FailDetail = {}) {
    super(sentence(kind, provider, detail));
  }
}

export function abortError(): DOMException {
  return new DOMException('취소했습니다.', 'AbortError');
}
