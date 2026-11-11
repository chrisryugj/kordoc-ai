import { useCallback, useRef, useState } from "react";
import { errorText, isAbort, type Progress } from "../lib/rpc";

export interface TaskCtx {
  signal: AbortSignal;
  onProgress: (p: Progress) => void;
}

/** 한 번에 하나씩 도는 사이드카 작업 — 진행 중·오류·결과·진행률·취소를 한데 묶는다.
 *  keepOnFail: 다시 해서 실패·멈춰도 앞 결과를 남긴다. 결과가 "방금 한 일의 알림"이 아니라 화면이 계속 들고 일하는 것일 때 쓴다
 *  (사람이 고치는 표, 다음 단계 단추가 달린 결과, 상태 표시). 기본은 지운다: "저장했습니다"가 오류와 함께 보이지 않게 */
export function useTask<T>(opts: { keepOnFail?: boolean } = {}) {
  const keep = !!opts.keepOnFail;
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
      // 앞서 성공한 결과는 지운다. 남겨 두면 다시 해서 실패·멈춘 화면에 "저장했습니다"와 오류가 함께 보인다
      if (ctrl.current === ac) { if (!keep) setResult(null); setError(isAbort(e) ? "멈췄습니다" : errorText(e)); }
      return null;
    } finally {
      if (ctrl.current === ac) {
        setBusy(false);
        ctrl.current = null;
      }
    }
  }, [keep]);

  const cancel = useCallback(() => ctrl.current?.abort(), []);
  /** 처음 상태로. 도는 일이 있으면 끊는다(끊긴 일은 오류·결과를 남기지 않는다): 결과만 비우고 일을 두면
   *  비운 뒤에 옛 일의 결과나 "멈췄습니다"가 뒤늦게 나타난다 */
  const reset = useCallback(() => {
    const running = ctrl.current;
    ctrl.current = null;
    running?.abort();
    setBusy(false);
    setResult(null);
    setError("");
    setProgress(null);
  }, []);

  return { busy, error, result, progress, run, cancel, reset, setResult };
}
