/** JSON-RPC notification 발송 (progress·AI 토큰 스트림)
 *
 * 요청 id 는 라우터가 AsyncLocalStorage 에 실어 두므로 핸들러가 넘기지 않아도 된다.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import type { JsonRpcNotification } from '../rpc/protocol.js';
import type { ProgressData } from '../types/index.js';

/** id = JSON-RPC id(Rust 가 매김), stream = 프론트가 params.__stream 으로 붙인 호출 표지 */
export const requestContext = new AsyncLocalStorage<{ id: number | string | null; stream?: string }>();

export function sendNotification(method: string, params: Record<string, unknown>): void {
  const notification: JsonRpcNotification = { jsonrpc: '2.0', method, params };
  // 짝 없는 서로게이트는 U+FFFD 로 (main.ts writeResponse 와 같은 이유)
  process.stdout.write(JSON.stringify(notification, (_k, v: unknown) => (typeof v === 'string' ? (v as string & { toWellFormed(): string }).toWellFormed() : v)) + '\n');
}

function currentId(explicit?: number | string): number | string | null | undefined {
  return explicit ?? requestContext.getStore()?.id;
}

/** progress notification — request_id 로 동시 요청 구분 */
export function sendProgress(data: ProgressData, requestId?: number | string): void {
  const id = currentId(requestId);
  const stream = requestContext.getStore()?.stream;
  sendNotification('progress', {
    current: data.current,
    total: data.total,
    message: data.message,
    ...(id != null && { request_id: id }),
    ...(stream && { stream }),
  });
}

/** AI 응답 토큰 조각 — 프론트가 실시간으로 이어 붙임 */
export function sendToken(text: string): void {
  const id = currentId();
  const stream = requestContext.getStore()?.stream;
  sendNotification('ai_token', { text, ...(id != null && { request_id: id }), ...(stream && { stream }) });
}
