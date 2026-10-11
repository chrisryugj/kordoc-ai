/** 엔진을 멈추게 하는 무거운 작업을 작업자 스레드에서 돌린다
 *
 * kordoc(pdf.js)은 800쪽 PDF 를 읽는 20초 동안 이벤트 루프를 놓지 않아(실측) 그사이 취소·미리보기·AI 글자 흘리기를 못 받는다.
 * rhwp 는 큰 문서를 여는 동안 엔진을 멈추고, 다 쓴 뒤에도 WASM 메모리를 돌려주지 않는다(98MB 문서 한 번에 284 → 634MB).
 * 작업자에서 돌리면 주 스레드는 계속 요청을 받고, 취소하면 작업자를 끝내 바로 멈추며, 메모리도 작업자와 함께 놓는다.
 *
 * 작업자는 엔진 시작 파일(main.ts 가 알려 준 dist/bundle.mjs 나 dist/main.js)을 한 번 더 띄우고,
 * 각 모듈이 registerJob 으로 등록해 둔 일을 한다. 시작 파일을 모르면(테스트처럼 main.ts 를 거치지 않을 때) 같은 스레드에서 돈다.
 */

import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';

export interface JobPort {
  /** 주 스레드로 보낸다 (진행률·쪽) */
  send(value: unknown): void;
  /** 주 스레드가 다음을 달라고 할 때까지 기다린다 (쪽을 앞질러 쌓아 두지 않게) */
  next(): Promise<void>;
}

export interface JobHandle<R> {
  result: Promise<R>;
  /** 받는 쪽이 다음을 달라고 알린다 */
  next(): void;
  /** 받는 쪽이 그만 받는다 (작업자를 끝낸다) */
  stop(): void;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Handler = (data: any, port: JobPort) => Promise<unknown>;

const jobs = new Map<string, Handler>();
let entry: URL | undefined;

export function registerJob(kind: string, handler: Handler): void {
  jobs.set(kind, handler);
}

/** main.ts 가 시작할 때 자기 파일 주소를 알려 준다 */
export function setWorkerEntry(url: URL): void {
  entry = url;
}

export function runJob<R>(kind: string, data: unknown, opts: { signal?: AbortSignal; onMessage?: (value: never) => void } = {}): JobHandle<R> {
  const handler = jobs.get(kind)!;
  if (!entry) {
    let wake: (() => void) | undefined;
    const port: JobPort = { send: (v) => opts.onMessage?.(v as never), next: () => new Promise((r) => { wake = r; }) };
    return { result: handler(data, port) as Promise<R>, next: () => { const w = wake; wake = undefined; w?.(); }, stop: () => {} };
  }

  // stdout 은 JSON-RPC 통로라 작업자의 출력(라이브러리 경고 등)은 모두 stderr 로
  const worker = new Worker(entry, { workerData: { job: kind, data }, stdout: true, stderr: true });
  worker.stdout.pipe(process.stderr);
  worker.stderr.pipe(process.stderr);
  let settle: ((fn: () => void) => void) | undefined;
  const result = new Promise<R>((resolve, reject) => {
    let settled = false;
    const onAbort = () => settle!(() => reject(opts.signal!.reason ?? new DOMException('작업을 취소했습니다', 'AbortError')));
    settle = (fn) => {
      if (!settled) {
        settled = true;
        opts.signal?.removeEventListener('abort', onAbort);
        fn();
      }
      void worker.terminate();
    };
    worker.on('message', (m: { type: string; value?: unknown; message?: string; code?: string }) => {
      if (m.type === 'done') settle!(() => resolve(m.value as R));
      else if (m.type === 'fail') settle!(() => reject(Object.assign(new Error(m.message), m.code ? { code: m.code } : {})));
      else opts.onMessage?.(m.value as never);
    });
    worker.on('error', (err) => settle!(() => reject(err)));
    worker.on('exit', () => settle!(() => reject(new Error('문서 처리 작업이 도중에 멈췄습니다. 메모리가 부족했을 수 있습니다. 다른 프로그램을 닫거나 문서를 나눠 다시 시도하세요.'))));
    if (opts.signal?.aborted) onAbort();
    else opts.signal?.addEventListener('abort', onAbort, { once: true });
  });
  return { result, next: () => worker.postMessage('next'), stop: () => settle!(() => {}) };
}

// 작업자 쪽: 시작 파일의 모든 모듈이 등록을 마친 뒤 시작한다
if (!isMainThread && workerData?.job) {
  setImmediate(() => {
    const { job, data } = workerData as { job: string; data: unknown };
    let wake: (() => void) | undefined;
    parentPort!.on('message', () => { const w = wake; wake = undefined; w?.(); });
    const port: JobPort = {
      send: (value) => parentPort!.postMessage({ type: 'msg', value }),
      next: () => new Promise((r) => { wake = r; }),
    };
    jobs.get(job)!(data, port).then(
      (value) => parentPort!.postMessage({ type: 'done', value }),
      (err: unknown) => parentPort!.postMessage({ type: 'fail', message: err instanceof Error ? err.message : String(err), code: (err as { code?: unknown })?.code }),
    );
  });
}
