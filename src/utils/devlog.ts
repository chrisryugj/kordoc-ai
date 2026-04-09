/** Dev 터미널 로거 — Vite HMR 스타일로 RPC 호출 로그 출력 */

const IS_DEV = import.meta.env.DEV;
const ENDPOINT = "/__devlog";

type LogLevel = "start" | "ok" | "error" | "warn" | "info";

function send(level: LogLevel, method: string, message: string, elapsed?: string): void {
  if (!IS_DEV) return;
  fetch(ENDPOINT, {
    method: "POST",
    body: JSON.stringify({ level, method, message, elapsed }),
  }).catch(() => {});
}

/** RPC 호출 시작 */
export function devLogStart(method: string, detail?: string): void {
  send("start", method, detail ?? "호출 시작");
}

/** RPC 호출 성공 */
export function devLogOk(method: string, detail: string, ms?: number): void {
  send("ok", method, detail, ms != null ? `${ms}ms` : undefined);
}

/** RPC 호출 실패 */
export function devLogError(method: string, error: string): void {
  send("error", method, error);
}

/** 일반 정보 */
export function devLogInfo(message: string): void {
  send("info", "", message);
}

/** RPC 호출 래퍼 — 자동 시작/성공/실패 로깅 */
export function withDevLog<T>(
  method: string,
  fn: () => Promise<T>,
  detail?: string,
): Promise<T> {
  if (!IS_DEV) return fn();

  const start = performance.now();
  devLogStart(method, detail);

  return fn().then(
    (result) => {
      const ms = Math.round(performance.now() - start);
      devLogOk(method, detail ?? "완료", ms);
      return result;
    },
    (err) => {
      devLogError(method, err instanceof Error ? err.message : String(err));
      throw err;
    },
  );
}
