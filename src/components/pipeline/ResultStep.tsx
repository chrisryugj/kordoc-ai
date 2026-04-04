import { CheckCircle2, FolderOpen, RotateCcw, AlertTriangle } from "lucide-react";
import { Button } from "../ui/Button";
import { Badge } from "../ui/Badge";
import type { PipelineResult } from "../../types/pipeline";

interface ResultStepProps {
  result: PipelineResult | null;
  onReset: () => void;
  onOpenFolder: () => void;
}

export function ResultStep({ result, onReset, onOpenFolder }: ResultStepProps) {
  if (!result) return null;

  const successRate = result.total > 0 ? Math.round((result.successCount / result.total) * 100) : 0;

  return (
    <div className="p-6 animate-fade-in space-y-6">
      {/* Summary Card */}
      <div className="card p-6 text-center">
        <div
          className="w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center"
          style={{ backgroundColor: result.failCount === 0 ? "var(--color-success-subtle)" : "var(--color-warning-subtle)" }}
        >
          {result.failCount === 0 ? (
            <CheckCircle2 size={32} style={{ color: "var(--color-success)" }} />
          ) : (
            <AlertTriangle size={32} style={{ color: "var(--color-warning)" }} />
          )}
        </div>

        <h3 className="ts-xl font-bold mb-2">변환 완료</h3>

        <div className="flex justify-center gap-4 mb-4">
          <Badge variant="success">{result.successCount}건 성공</Badge>
          {result.failCount > 0 && <Badge variant="danger">{result.failCount}건 실패</Badge>}
          <Badge variant="secondary">성공률 {successRate}%</Badge>
        </div>

        {/* Warnings */}
        {result.warnings.length > 0 && (
          <div className="mt-4 text-left rounded-md p-3" style={{ backgroundColor: "var(--color-bg-tertiary)" }}>
            <h4 className="ts-xs font-semibold mb-1" style={{ color: "var(--color-warning)" }}>경고사항</h4>
            {result.warnings.map((w, i) => (
              <p key={i} className="ts-2xs" style={{ color: "var(--color-text-muted)" }}>{w}</p>
            ))}
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-center gap-3 mt-6 flex-wrap">
          <Button variant="secondary" onClick={onOpenFolder}>
            <span className="flex items-center gap-1.5">
              <FolderOpen size={16} /> 출력 폴더 열기
            </span>
          </Button>
          <Button variant="ghost" onClick={onReset}>
            <span className="flex items-center gap-1.5">
              <RotateCcw size={16} /> 새로 시작
            </span>
          </Button>
        </div>
      </div>
    </div>
  );
}
