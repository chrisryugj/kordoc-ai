import { useState, useEffect, useRef } from "react";
import type { PipelineStep, PipelineProgress } from "../../types/pipeline";
import { formatElapsed } from "../../utils/format";

interface StatusBarProps {
  step: PipelineStep;
  progress: PipelineProgress;
}

const ACTIVE_STEPS: PipelineStep[] = ["converting"];

const stepMeta: Record<PipelineStep, { label: string; color: string }> = {
  idle:       { label: "대기 중",    color: "var(--color-text-muted)" },
  import:     { label: "파일 선택",  color: "var(--color-accent)" },
  converting: { label: "변환 중",    color: "var(--color-warning)" },
  complete:   { label: "완료",       color: "var(--color-success)" },
};

export function StatusBar({ step, progress }: StatusBarProps) {
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isActive = ACTIVE_STEPS.includes(step);

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

  const [displayMsg, setDisplayMsg] = useState("");
  const [msgVisible, setMsgVisible] = useState(false);
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!progress.message) return;
    if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
    setDisplayMsg(progress.message);
    setMsgVisible(true);
    if (!isActive) {
      fadeTimerRef.current = setTimeout(() => setMsgVisible(false), 5000);
    }
    return () => { if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current); };
  }, [progress.message, isActive]);

  useEffect(() => {
    if (step === "idle") { setDisplayMsg(""); setMsgVisible(false); }
  }, [step]);

  const { label, color } = stepMeta[step];
  const pct = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : null;

  return (
    <div
      role="status"
      aria-label="상태 표시줄"
      className="h-6 flex items-center justify-between px-4 shrink-0 select-none"
      style={{
        backgroundColor: "var(--color-bg-tertiary)",
        borderTop: "1px solid var(--color-border)",
        color: "var(--color-text-muted)",
        fontSize: "0.65rem",
      }}
    >
      <div className="flex items-center gap-3 min-w-0 shrink-0">
        <span className="flex items-center gap-1.5">
          <span
            className="w-1.5 h-1.5 rounded-full shrink-0 inline-block"
            style={{
              backgroundColor: color,
              boxShadow: isActive ? `0 0 4px ${color}` : "none",
              animation: isActive ? "pulse 1.5s infinite" : "none",
            }}
          />
          <span style={{ color, fontWeight: 500 }}>{label}</span>
        </span>
        {pct !== null && isActive && (
          <span style={{ color: "var(--color-text-muted)" }}>{progress.current}/{progress.total} ({pct}%)</span>
        )}
        {isActive && elapsed > 0 && (
          <span style={{ color: "var(--color-text-muted)" }}>{formatElapsed(elapsed)}</span>
        )}
      </div>

      <div
        className="ml-4 truncate text-right max-w-[55%] transition-opacity duration-700"
        style={{ opacity: msgVisible ? 0.7 : 0 }}
      >
        {displayMsg}
      </div>
    </div>
  );
}
