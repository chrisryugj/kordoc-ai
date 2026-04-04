/** RPC 메서드 라우팅 + 화이트리스트 + cancel 관리 */

import { RPC_ERRORS, type RpcHandler } from './protocol.js';
import { logger } from '../infra/logger.js';

export class RpcRouter {
  private methods = new Map<string, RpcHandler>();
  /** 활성 요청의 AbortController (cancel용) */
  private active = new Map<number | string, AbortController>();
  /** id 없는 요청에 고유 키 부여 */
  private nextAnonymousId = 0;

  /** 메서드 등록 */
  register(name: string, handler: RpcHandler): void {
    this.methods.set(name, handler);
  }

  /** 등록된 메서드 목록 */
  listMethods(): string[] {
    return [...this.methods.keys()];
  }

  /** 메서드 디스패치 */
  async dispatch(
    method: string,
    params: Record<string, unknown>,
    id?: number | string | null,
  ): Promise<{ result?: unknown; error?: { code: number; message: string } }> {
    // cancel은 특수 처리
    if (method === 'cancel') {
      return this.handleCancel(params);
    }

    const handler = this.methods.get(method);
    if (!handler) {
      return { error: { code: RPC_ERRORS.METHOD_NOT_FOUND, message: `Method not found: ${method}` } };
    }

    const ac = new AbortController();
    const reqId = id ?? `__anon_${this.nextAnonymousId++}__`;
    this.active.set(reqId, ac);

    try {
      const result = await handler(params, ac.signal);
      return { result };
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return { error: { code: RPC_ERRORS.INTERNAL_ERROR, message: 'Request cancelled' } };
      }
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`[rpc] ${method} error: ${message}`);
      return { error: { code: RPC_ERRORS.INTERNAL_ERROR, message } };
    } finally {
      this.active.delete(reqId);
    }
  }

  /** 활성 요청 취소 */
  private handleCancel(params: Record<string, unknown>): { result: unknown } {
    const targetId = params.id;
    if (targetId != null) {
      const ac = this.active.get(targetId as string | number);
      if (ac) {
        ac.abort();
        logger.info(`[rpc] cancelled request ${targetId}`);
        return { result: { cancelled: targetId } };
      }
      return { result: { cancelled: null, message: 'No active request with that id' } };
    }
    // id 없으면 전체 취소
    let count = 0;
    for (const [, ac] of this.active) {
      ac.abort();
      count++;
    }
    logger.info(`[rpc] cancelled all ${count} active requests`);
    return { result: { cancelled_all: count } };
  }
}
