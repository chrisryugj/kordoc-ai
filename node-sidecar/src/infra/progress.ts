/** JSON-RPC notification 발송 (progress) */

import type { JsonRpcNotification } from '../rpc/protocol.js';
import type { ProgressData } from '../types/index.js';

/** stdout에 JSON-RPC notification 쓰기 */
export function sendNotification(method: string, params: Record<string, unknown>): void {
  const notification: JsonRpcNotification = {
    jsonrpc: '2.0',
    method,
    params,
  };
  process.stdout.write(JSON.stringify(notification) + '\n');
}

/** progress notification 헬퍼 — request_id로 동시 요청 구분 */
export function sendProgress(data: ProgressData, requestId?: number | string): void {
  sendNotification('progress', {
    current: data.current,
    total: data.total,
    message: data.message,
    ...(requestId != null && { request_id: requestId }),
  });
}
