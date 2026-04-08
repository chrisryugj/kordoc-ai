/** RPC 메서드 라우팅 + 화이트리���트 + cancel 관리 + 동시성 제한 */

import { RPC_ERRORS, type RpcHandler } from './protocol.js';
import { logger } from '../infra/logger.js';

/** 파일 I/O + AI API를 동반하는 무거운 메서드 (동시성 제한 대상) */
const HEAVY_METHODS = new Set([
  'convert', 'convert_batch', 'ocr', 'summarize',
  'diff', 'form_extract', 'form_extract_candidates', 'form_extract_batch',
  'extract_tables', 'generate_hwpx',
  'merge_files', 'pdf_extract_pages', 'inspect_document',
]);

/** 최대 동시 실행 수 (Python 이전 구현의 max_workers=2와 동일) */
const MAX_CONCURRENT = 2;
/** 세마포어 큐 최대 대기 수 — 초과 시 즉시 에러 반환 */
const MAX_QUEUE_SIZE = 10;

export class RpcRouter {
  private methods = new Map<string, RpcHandler>();
  /** 활성 요청의 AbortController (cancel용) */
  private active = new Map<number | string, AbortController>();
  /** id 없는 요청에 고유 키 부�� */
  private nextAnonymousId = 0;
  /** 무거운 메서드 동시 실행 세마포어 */
  private heavyRunning = 0;
  private heavyQueue: Array<() => void> = [];

  /** 메서드 등록 */
  register(name: string, handler: RpcHandler): void {
    this.methods.set(name, handler);
  }

  /** 등록된 메서드 목록 */
  listMethods(): string[] {
    return [...this.methods.keys()];
  }

  /** 세마포어 acquire: 동시 실행 수 제한 + 큐 크기 제한 + abort 연동 */
  private acquireSlot(signal?: AbortSignal): Promise<void> {
    if (this.heavyRunning < MAX_CONCURRENT) {
      this.heavyRunning++;
      return Promise.resolve();
    }
    if (this.heavyQueue.length >= MAX_QUEUE_SIZE) {
      return Promise.reject(new Error(`처리 대기열이 가득 찼습니다 (최대 ${MAX_QUEUE_SIZE}). 잠시 후 다시 시도하세요.`));
    }
    return new Promise<void>((resolve, reject) => {
      const entry = () => resolve();
      this.heavyQueue.push(entry);

      // abort 시 큐에서 제거 + reject로 데드락 방지
      if (signal) {
        const onAbort = () => {
          const idx = this.heavyQueue.indexOf(entry);
          if (idx !== -1) this.heavyQueue.splice(idx, 1);
          reject(new DOMException('Request cancelled while queued', 'AbortError'));
        };
        if (signal.aborted) { onAbort(); return; }
        signal.addEventListener('abort', onAbort, { once: true });
      }
    });
  }

  /** 세마포어 release */
  private releaseSlot(): void {
    if (this.heavyQueue.length > 0) {
      const next = this.heavyQueue.shift()!;
      next();
    } else {
      this.heavyRunning--;
    }
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

    const isHeavy = HEAVY_METHODS.has(method);
    if (isHeavy) await this.acquireSlot(ac.signal);

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
      if (isHeavy) this.releaseSlot();
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
