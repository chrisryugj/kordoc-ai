import { useEffect, useRef, useState } from "react";
import { XCircle, Loader2 } from "lucide-react";
import { Button } from "../ui/Button";
import type { PipelineProgress, PipelineStep } from "../../types/pipeline";

interface OcrProgressStepProps {
  progress: PipelineProgress;
  onCancel: () => void;
  logs: string[];
  step?: PipelineStep;
}

const stepTitles: Partial<Record<PipelineStep, string>> = {
  converting: "문서 변환 중",
};

function formatElapsed(s: number) {
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}분 ${s % 60}초` : `${s}초`;
}

export function OcrProgressStep({ progress, onCancel, logs, step }: OcrProgressStepProps) {
  const isIndeterminate = progress.total <= 0;
  const pct = isIndeterminate ? 0 : Math.round((progress.current / progress.total) * 100);
  const title = (step && stepTitles[step]) || "처리 중";
  const logEndRef = useRef<HTMLDivElement>(null);
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setElapsed(0);
    timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs.length]);

  return (
    <div className="p-6 animate-fade-in space-y-6">
      <div className="card p-6" onContextMenu={(e) => e.preventDefault()}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <Loader2 size={20} className="animate-spin" style={{ color: "var(--color-accent)" }} />
            <h3 className="ts-lg font-semibold">{title}</h3>
          </div>
          <Button variant="danger" size="sm" onClick={onCancel}>
            <span className="flex items-center gap-1.5">
              <XCircle size={14} /> 취소
            </span>
          </Button>
        </div>

        <div className="progress-bar mb-2" role="progressbar" aria-valuenow={isIndeterminate ? undefined : pct} aria-valuemin={0} aria-valuemax={100} aria-label={title}>
          <div
            className={`progress-bar-fill${isIndeterminate ? " progress-bar-indeterminate" : ""}`}
            style={isIndeterminate ? undefined : { width: `${pct}%` }}
          />
        </div>
        <div className="flex justify-between ts-sm" style={{ color: "var(--color-text-muted)" }} aria-live="polite">
          <span>{progress.message}</span>
          <span className="flex items-center gap-3 shrink-0 ml-2">
            <span style={{ color: "var(--color-text-muted)" }}>{formatElapsed(elapsed)}</span>
            {!isIndeterminate && <span>{pct}%</span>}
          </span>
        </div>
      </div>

      {logs.length > 0 && (
        <div className="card p-4">
          <h4 className="ts-sm font-semibold mb-2" style={{ color: "var(--color-text-secondary)" }}>실행 로그</h4>
          <div
            className="max-h-[200px] overflow-y-auto space-y-0.5 text-mono ts-2xs p-3 rounded"
            style={{ backgroundColor: "var(--color-bg-primary)" }}
          >
            {logs.map((log, i) => (
              <div key={i} style={{ color: log.includes("ERROR") ? "var(--color-error)" : log.includes("✓") ? "var(--color-success)" : "var(--color-text-muted)" }}>
                {log}
              </div>
            ))}
            <div ref={logEndRef} />
          </div>
        </div>
      )}
    </div>
  );
}
