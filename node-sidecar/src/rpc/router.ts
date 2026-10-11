/** RPC 메서드 라우팅 + 화이트리���트 + cancel 관리 + 동시성 제한 */

import { RPC_ERRORS, type RpcHandler } from './protocol.js';
import { logger } from '../infra/logger.js';
import { requestContext } from '../infra/progress.js';
import { recordUsage } from '../infra/usage.js';

/** 무거운 메서드 — 등록할 때 { heavy: true } 로 표시한다 (파싱·AI 를 동반해 동시 실행 상한을 거침) */
const HEAVY_METHODS = new Set<string>();

/** 차선별 동시 실행 상한 — AI 답변이 길게 돌아도 문서 처리가 막히지 않게 차선을 나눈다 */
const LANES = { doc: 2, ai: 2 } as const;
type Lane = keyof typeof LANES;
const laneOf = (method: string): Lane => (method.startsWith('ai_') || method === 'llm_download' ? 'ai' : 'doc');
/** 차선마다 대기 상한 — 넘으면 즉시 오류 */
const MAX_QUEUE_SIZE = 10;

export class RpcRouter {
  private methods = new Map<string, RpcHandler>();
  /** 활성 요청의 AbortController (cancel용) */
  private active = new Map<number | string, AbortController>();
  /** 프론트 호출 표지(__stream) → AbortController — 프론트는 Rust 가 매긴 id 를 모르므로 이걸로 취소 */
  private streams = new Map<string, AbortController>();
  /** id 없는 요청에 고유 키 부�� */
  private nextAnonymousId = 0;
  /** 차선별 동시 실행 세마포어 */
  private running: Record<Lane, number> = { doc: 0, ai: 0 };
  private queues: Record<Lane, Array<() => void>> = { doc: [], ai: [] };

  /** 메서드 등록 — heavy: 파싱·AI 를 동반해 동시 실행 상한(세마포어)을 거칠 메서드 */
  register(name: string, handler: RpcHandler, opts?: { heavy?: boolean }): void {
    this.methods.set(name, handler);
    if (opts?.heavy) HEAVY_METHODS.add(name);
  }

  /** 등록된 메서드 목록 */
  listMethods(): string[] {
    return [...this.methods.keys()];
  }

  /** 세마포어 acquire: 차선별 동시 실행 수 제한 + 큐 크기 제한 + abort 연동 */
  private acquireSlot(lane: Lane, signal?: AbortSignal): Promise<void> {
    if (this.running[lane] < LANES[lane]) {
      this.running[lane]++;
      return Promise.resolve();
    }
    const queue = this.queues[lane];
    if (queue.length >= MAX_QUEUE_SIZE) {
      return Promise.reject(new Error(`처리 대기열이 가득 찼습니다 (최대 ${MAX_QUEUE_SIZE}). 잠시 후 다시 시도하세요.`));
    }
    return new Promise<void>((resolve, reject) => {
      const entry = () => resolve();
      queue.push(entry);
      if (signal) {
        const onAbort = () => {
          const idx = queue.indexOf(entry);
          if (idx !== -1) queue.splice(idx, 1);
          reject(new DOMException('Request cancelled while queued', 'AbortError'));
        };
        if (signal.aborted) { onAbort(); return; }
        signal.addEventListener('abort', onAbort, { once: true });
      }
    });
  }

  /** 세마포어 release — 기다리는 요청에 자리를 그대로 넘긴다 */
  private releaseSlot(lane: Lane): void {
    const next = this.queues[lane].shift();
    if (next) next();
    else this.running[lane]--;
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
    const stream = typeof params.__stream === 'string' ? params.__stream : undefined;
    if (stream) this.streams.set(stream, ac);
    delete params.__stream;

    // 작성실 실시간 미리보기는 대기열을 건너뛴다 (입력할 때마다 부른다)
    const isHeavy = HEAVY_METHODS.has(method) && !(method === 'generate_hwpx' && params.preview_only === true);
    const lane = laneOf(method);
    let acquired = false;

    try {
      // 대기열이 찼거나 기다리다 취소돼도 응답은 나가야 한다 (try 밖이면 응답 없이 끝나 앱이 시간 초과까지 기다렸다)
      if (isHeavy) { await this.acquireSlot(lane, ac.signal); acquired = true; }
      const result = await requestContext.run({ id: id ?? null, stream }, () => handler(params, ac.signal));
      try { recordUsage(method, params, result); } catch { /* 집계 실패가 작업 결과를 막지 않는다 */ }
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
      if (stream) this.streams.delete(stream);
      if (acquired) this.releaseSlot(lane);
    }
  }

  /** 활성 요청 취소 */
  private handleCancel(params: Record<string, unknown>): { result: unknown } {
    if (typeof params.stream === 'string') {
      const ac = this.streams.get(params.stream);
      ac?.abort();
      return { result: { cancelled: ac ? params.stream : null } };
    }
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
