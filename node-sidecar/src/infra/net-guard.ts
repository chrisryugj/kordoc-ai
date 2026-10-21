/** 폐쇄망 모드 통신 관문 — 앱이 밖으로 나가는 모든 요청은 여기를 지난다
 *
 * 폐쇄망 모드면 사설·루프백 주소(기관 내부 LLM 서버, 이 PC 의 Ollama)만 허용한다.
 * 호스트 이름은 DNS 로 풀어 실제 주소로 판정한다(내부 DNS 이름도 사설 주소면 통과).
 */

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { getSettings } from './config.js';

/** kordoc 엔진의 외부 통신(모델 다운로드 등)도 같이 막도록 env 동기화 */
export function syncOfflineEnv(): void {
  if (getSettings().privacy.offline) process.env.KORDOC_OFFLINE = '1';
  else delete process.env.KORDOC_OFFLINE;
}

export function isPrivateAddress(addr: string): boolean {
  const a = addr.toLowerCase().replace(/^\[|\]$/g, '');
  if (a === '::1') return true;
  if (a.startsWith('::ffff:')) return isPrivateAddress(a.slice(7));
  if (isIP(a) === 6) return a.startsWith('fc') || a.startsWith('fd') || a.startsWith('fe80');
  const p = a.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => Number.isNaN(n))) return false;
  return (
    p[0] === 127 ||
    p[0] === 10 ||
    (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
    (p[0] === 192 && p[1] === 168) ||
    (p[0] === 100 && p[1] >= 64 && p[1] <= 127) // CGNAT — 기관 내부망에서 흔함
  );
}

export class OfflineBlockedError extends Error {
  constructor(target: string) {
    super(`폐쇄망 모드라 외부 주소(${target})로 보낼 수 없습니다. 설정에서 폐쇄망 모드를 끄거나 내부 주소를 쓰세요.`);
  }
}

// ── 외부 통신 기록 — 앱이 밖으로 나가려 한 시도를 전부 남긴다 (보안 화면·심사 시연용) ──

export interface NetLogEntry {
  at: string;
  host: string;
  /** 이 PC 밖(인터넷)인지 — 사설·루프백 주소는 false */
  external: boolean;
  allowed: boolean;
}

const MAX_LOG = 300;
const netLog: NetLogEntry[] = [];
let externalTotal = 0;

function record(host: string, external: boolean, allowed: boolean): void {
  netLog.push({ at: new Date().toISOString(), host, external, allowed });
  if (netLog.length > MAX_LOG) netLog.shift();
  if (external && allowed) externalTotal += 1;
}

/** 최근 기록과, 이번 실행에서 실제로 인터넷으로 나간 횟수 */
export function netLogSnapshot(): { entries: NetLogEntry[]; external_sent: number } {
  return { entries: [...netLog].reverse(), external_sent: externalTotal };
}

async function isExternalHost(host: string): Promise<boolean> {
  if (host === 'localhost') return false;
  const bare = host.replace(/^\[|\]$/g, '');
  if (isIP(bare)) return !isPrivateAddress(bare);
  const addrs = await lookup(host, { all: true }).catch(() => []);
  return addrs.length === 0 || addrs.some((x) => !isPrivateAddress(x.address));
}

/** 이 앱이 띄운 구독 프로그램(Claude Code·Codex)이 인터넷으로 나가기 전에 호출 — 기록을 남기고, 폐쇄망 모드면 throw.
 *  프로그램이 실제로 어느 주소로 가는지는 앱이 볼 수 없어, 그 회사의 대표 주소에 프로그램 이름을 붙여 적고 늘 외부로 센다 */
export function assertProgramEgress(host: string, via: string): void {
  const allowed = !getSettings().privacy.offline;
  record(`${host} (${via})`, true, allowed);
  if (!allowed) throw new OfflineBlockedError(host);
}

/** 요청 전에 호출 — 기록을 남기고, 폐쇄망 모드에서 외부 주소면 throw */
export async function assertAllowed(url: string): Promise<void> {
  const host = new URL(url).hostname;
  const external = await isExternalHost(host);
  const allowed = !(external && getSettings().privacy.offline);
  record(host, external, allowed);
  if (!allowed) throw new OfflineBlockedError(host);
}
