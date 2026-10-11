import { useCallback, useRef, useState } from "react";
import { errorText, isAbort, type Progress } from "../lib/rpc";

export interface TaskCtx {
  signal: AbortSignal;
  onProgress: (p: Progress) => void;
}

/** 한 번에 하나씩 도는 사이드카 작업 — 진행 중·오류·결과·진행률·취소를 한데 묶는다 */
export function useTask<T>() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<T | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const ctrl = useRef<AbortController | null>(null);

  const run = useCallback(async (fn: (ctx: TaskCtx) => Promise<T>): Promise<T | null> => {
    ctrl.current?.abort();
    const ac = new AbortController();
    ctrl.current = ac;
    setBusy(true);
    setError("");
    setProgress(null);
    try {
      const r = await fn({ signal: ac.signal, onProgress: setProgress });
      if (ctrl.current === ac) setResult(r);
      return r;
    } catch (e) {
      if (ctrl.current === ac) setError(isAbort(e) ? "멈췄습니다" : errorText(e));
      return null;
    } finally {
      if (ctrl.current === ac) {
        setBusy(false);
        ctrl.current = null;
      }
    }
  }, []);

  const cancel = useCallback(() => ctrl.current?.abort(), []);
  const reset = useCallback(() => { setResult(null); setError(""); setProgress(null); }, []);

  return { busy, error, result, progress, run, cancel, reset, setResult };
}
