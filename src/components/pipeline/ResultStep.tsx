import { CheckCircle2, FolderOpen, RotateCcw, AlertTriangle, Tag } from "lucide-react";
import { useState, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "../ui/Button";
import { Badge } from "../ui/Badge";
import type { PipelineResult } from "../../types/pipeline";

type SidecarCallFn = (method: string, params?: Record<string, unknown>) => Promise<unknown>;

interface ResultStepProps {
  result: PipelineResult | null;
  onReset: () => void;
  onOpenFolder: () => void;
  onReviewTags?: () => void;
  sidecarCall?: SidecarCallFn;
}

export function ResultStep({ result, onReset, onOpenFolder, onReviewTags, sidecarCall }: ResultStepProps) {
  const [reportContent, setReportContent] = useState<string | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [showReport, setShowReport] = useState(false);

  // 리포트 로드 — 부모로부터 받은 sidecarCall 사용 (중복 인스턴스 방지)
  useEffect(() => {
    if (!result || !sidecarCall) return;
    if (showReport && !reportContent) {
      setReportLoading(true);
      sidecarCall("read_report", { output_dir: result.outputPath })
        .then((resp: unknown) => {
          if (resp && typeof resp === "object" && "content" in resp) {
            setReportContent((resp as Record<string, unknown>).content as string);
            setReportError(null);
          }
        })
        .catch((err: unknown) => {
          const errorMsg = err instanceof Error ? err.message : String(err);
          setReportError(errorMsg);
          setReportContent(null);
        })
        .finally(() => setReportLoading(false));
    }
  }, [showReport, reportContent, sidecarCall, result?.outputPath]);

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

        <h3 className="ts-xl font-bold mb-2">처리 완료</h3>

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
          {onReviewTags && (
            <Button variant="secondary" onClick={onReviewTags}>
              <span className="flex items-center gap-1.5">
                <Tag size={16} /> 태그 재검토
              </span>
            </Button>
          )}
          <Button variant="ghost" onClick={onReset}>
            <span className="flex items-center gap-1.5">
              <RotateCcw size={16} /> 새로 시작
            </span>
          </Button>
          <Button
            variant={showReport ? "primary" : "secondary"}
            onClick={() => setShowReport(!showReport)}
          >
            {showReport ? "리포트 닫기" : "통합분석리포트 보기"}
          </Button>
        </div>
      </div>

      {/* Markdown Report Viewer */}
      {showReport && (
        <div className="card p-6">
          <h4 className="ts-sm font-semibold mb-4">통합 분석 리포트</h4>
          {reportLoading && (
            <div className="text-center py-8" style={{ color: "var(--color-text-muted)" }}>
              <div className="inline-block w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin mb-2" />
              <p>리포트를 로드 중입니다...</p>
            </div>
          )}
          {reportError && (
            <div className="px-4 py-3 rounded-lg bg-red-50" style={{ color: "var(--color-error)" }}>
              리포트를 읽을 수 없습니다: {reportError}
            </div>
          )}
          {reportContent && !reportLoading && (
            <div
              className="prose prose-sm max-w-none overflow-auto max-h-[600px] rounded-lg p-4"
              style={{
                backgroundColor: "var(--color-bg-tertiary)",
                borderRadius: "8px"
              }}
            >
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  h1: ({ ...props }) => <h1 style={{ fontSize: "1.5em", fontWeight: "bold", marginTop: "0.8em", marginBottom: "0.4em" }} {...props} />,
                  h2: ({ ...props }) => <h2 style={{ fontSize: "1.3em", fontWeight: "bold", marginTop: "0.7em", marginBottom: "0.3em" }} {...props} />,
                  h3: ({ ...props }) => <h3 style={{ fontSize: "1.1em", fontWeight: "bold", marginTop: "0.6em", marginBottom: "0.2em" }} {...props} />,
                  p: ({ ...props }) => <p style={{ marginBottom: "1em", lineHeight: "1.6" }} {...props} />,
                  ul: ({ ...props }) => <ul style={{ marginLeft: "1.5em", marginBottom: "1em", listStyleType: "disc" }} {...props} />,
                  ol: ({ ...props }) => <ol style={{ marginLeft: "1.5em", marginBottom: "1em", listStyleType: "decimal" }} {...props} />,
                  li: ({ ...props }) => <li style={{ marginBottom: "0.3em" }} {...props} />,
                  table: ({ ...props }) => <table style={{ borderCollapse: "collapse", width: "100%", marginBottom: "1em" }} {...props} />,
                  th: ({ ...props }) => <th style={{ border: "1px solid #ddd", padding: "0.5em", backgroundColor: "var(--color-bg-secondary)", fontWeight: "bold" }} {...props} />,
                  td: ({ ...props }) => <td style={{ border: "1px solid #ddd", padding: "0.5em" }} {...props} />,
                  code: ({ ...props }) => <code style={{ backgroundColor: "var(--color-bg-secondary)", padding: "0.2em 0.4em", borderRadius: "3px", fontFamily: "monospace", fontSize: "0.9em" }} {...props} />,
                  pre: ({ ...props }) => <pre style={{ backgroundColor: "var(--color-bg-secondary)", padding: "1em", borderRadius: "4px", overflow: "auto", marginBottom: "1em" }} {...props} />,
                }}
              >
                {reportContent}
              </ReactMarkdown>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
