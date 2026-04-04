import { useState, useEffect, useRef } from "react";
import type { PipelineStep } from "../types/pipeline";

/**
 * 파이프라인 경과 시간 공유 타이머.
 * converting step 동안 1초마다 카운트, idle로 돌아가면 리셋.
 */
export function useElapsed(step: PipelineStep): number {
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isActive = step === "converting";

  useEffect(() => {
    if (isActive) {
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
      if (step === "idle") setElapsed(0);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [isActive, step]);

  return elapsed;
}
