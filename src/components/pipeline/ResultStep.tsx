import { useState } from "react";
import { CheckCircle2, FolderOpen, RotateCcw, AlertTriangle, ChevronDown, ChevronUp, Terminal } from "lucide-react";
import { Button } from "../ui/Button";
import { Badge } from "../ui/Badge";
import { MarkdownViewer } from "../ui/MarkdownViewer";
import { formatElapsed } from "../../utils/format";
import type { PipelineResult } from "../../types/pipeline";

interface ResultStepProps {
  result: PipelineResult | null;
  onReset: () => void;
  onOpenFolder: () => void;
  onSummarize?: (markdown: string) => void;
  isSummarizing?: boolean;
  logs?: string[];
  elapsed?: number;
}

/** 액션별 결과 데이터 미리보기 (마크다운 외) */
function ResultPreview({ data }: { data: unknown }) {
  const [expanded, setExpanded] = useState(false);
  if (!data || typeof data !== "object") return null;

  const d = data as Record<string, unknown>;

  // summarize — 요약 텍스트
  if (typeof d.summary === "string") {
    const text = d.summary as string;
    const truncated = text.length > 300 && !expanded;
    return (
      <div className="text-left rounded-md p-3" style={{ backgroundColor: "var(--color-bg-tertiary)" }}>
        <div className="flex items-center justify-between mb-2">
          <h4 className="ts-xs font-semibold" style={{ color: "var(--color-accent)" }}>AI 요약 결과</h4>
          {text.length > 300 && (
            <button onClick={() => setExpanded(!expanded)} className="ts-2xs flex items-center gap-1" style={{ color: "var(--color-text-muted)" }}>
              {expanded ? <><ChevronUp size={12} /> 접기</> : <><ChevronDown size={12} /> 펼치기</>}
            </button>
          )}
        </div>
        <p className="ts-sm whitespace-pre-wrap" style={{ color: "var(--color-text-secondary)" }}>
          {truncated ? text.slice(0, 300) + "..." : text}
        </p>
        {d.original_length != null && (
          <p className="ts-2xs mt-2" style={{ color: "var(--color-text-muted)" }}>
            원문 {Number(d.original_length).toLocaleString()}자 → 요약 {Number(d.summary_length).toLocaleString()}자
          </p>
        )}
      </div>
    );
  }

  // diff — 변경 통계
  if (d.changes != null || d.additions != null || d.deletions != null) {
    return (
      <div className="text-left rounded-md p-3" style={{ backgroundColor: "var(--color-bg-tertiary)" }}>
        <h4 className="ts-xs font-semibold mb-2" style={{ color: "var(--color-accent)" }}>비교 결과</h4>
        <div className="flex gap-4 ts-sm">
          {d.additions != null && <span style={{ color: "var(--color-success)" }}>+{String(d.additions)} 추가</span>}
          {d.deletions != null && <span style={{ color: "var(--color-error)" }}>-{String(d.deletions)} 삭제</span>}
          {d.changes != null && <span style={{ color: "var(--color-warning)" }}>{String(d.changes)}건 변경</span>}
        </div>
      </div>
    );
  }

  // extract_tables — 표 미리보기
  if (d.table_count != null && Array.isArray(d.tables)) {
    const tables = d.tables as { index: number; page?: number; rows: number; cols: number; markdown: string }[];
    return (
      <div className="text-left rounded-md p-3" style={{ backgroundColor: "var(--color-bg-tertiary)" }}>
        <h4 className="ts-xs font-semibold mb-2" style={{ color: "var(--color-accent)" }}>
          표 추출 결과 — {tables.length}개
        </h4>
        {tables.length === 0 ? (
          <p className="ts-2xs" style={{ color: "var(--color-text-muted)" }}>문서에서 표를 찾지 못했습니다</p>
        ) : (
          <div className="space-y-2 max-h-[200px] overflow-y-auto">
            {tables.slice(0, 5).map((t) => (
              <div key={t.index} className="flex items-center gap-2 ts-2xs" style={{ color: "var(--color-text-muted)" }}>
                <span className="font-semibold" style={{ color: "var(--color-text-secondary)" }}>표 {t.index + 1}</span>
                {t.page != null && <span>{t.page}p</span>}
                <span>{t.rows}행 x {t.cols}열</span>
              </div>
            ))}
            {tables.length > 5 && (
              <p className="ts-2xs" style={{ color: "var(--color-text-muted)" }}>...외 {tables.length - 5}개</p>
            )}
          </div>
        )}
        {typeof d.output_path === "string" && d.output_path && (
          <p className="ts-2xs mt-2" style={{ color: "var(--color-text-muted)" }}>
            저장: {d.output_path.split(/[/\\]/).pop()}
          </p>
        )}
      </div>
    );
  }

  // form_extract — 양식 필드
  if (Array.isArray(d.fields) && d.confidence != null) {
    const fields = d.fields as { label?: string; value?: string; type?: string }[];
    const confidence = Math.round(Number(d.confidence) * 100);
    return (
      <div className="text-left rounded-md p-3" style={{ backgroundColor: "var(--color-bg-tertiary)" }}>
        <div className="flex items-center justify-between mb-2">
          <h4 className="ts-xs font-semibold" style={{ color: "var(--color-accent)" }}>양식 필드 — {fields.length}개</h4>
          <span className="ts-2xs" style={{ color: confidence >= 70 ? "var(--color-success)" : "var(--color-warning)" }}>
            신뢰도 {confidence}%
          </span>
        </div>
        {fields.length === 0 ? (
          <p className="ts-2xs" style={{ color: "var(--color-text-muted)" }}>양식 필드를 찾지 못했습니다</p>
        ) : (
          <table className="w-full ts-2xs">
            <thead><tr style={{ color: "var(--color-text-muted)" }}><th className="text-left pb-1">필드명</th><th className="text-left pb-1">값</th></tr></thead>
            <tbody>
              {fields.slice(0, 10).map((f, i) => (
                <tr key={i} style={{ color: "var(--color-text-secondary)" }}>
                  <td className="py-0.5 font-medium">{f.label ?? "-"}</td>
                  <td className="py-0.5">{f.value ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {fields.length > 10 && <p className="ts-2xs mt-1" style={{ color: "var(--color-text-muted)" }}>...외 {fields.length - 10}개</p>}
        {typeof d.output_path === "string" && d.output_path && (
          <p className="ts-2xs mt-2" style={{ color: "var(--color-text-muted)" }}>저장: {d.output_path.split(/[/\\]/).pop()}</p>
        )}
      </div>
    );
  }

  // scan_receipt — 영수증
  if (Array.isArray(d.items)) {
    const items = d.items as { name?: string; amount?: number; quantity?: number }[];
    if (items.length === 0) return null;
    return (
      <div className="text-left rounded-md p-3" style={{ backgroundColor: "var(--color-bg-tertiary)" }}>
        <h4 className="ts-xs font-semibold mb-2" style={{ color: "var(--color-accent)" }}>영수증 항목</h4>
        <table className="w-full ts-2xs">
          <thead><tr style={{ color: "var(--color-text-muted)" }}><th className="text-left pb-1">항목</th><th className="text-right pb-1">수량</th><th className="text-right pb-1">금액</th></tr></thead>
          <tbody>
            {items.slice(0, 20).map((item, i) => (
              <tr key={i} style={{ color: "var(--color-text-secondary)" }}>
                <td className="py-0.5">{item.name ?? "-"}</td>
                <td className="text-right py-0.5">{item.quantity ?? "-"}</td>
                <td className="text-right py-0.5">{item.amount != null ? Number(item.amount).toLocaleString() : "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {d.total != null && (
          <p className="ts-xs font-semibold mt-2 text-right" style={{ color: "var(--color-text-primary)" }}>합계: {Number(d.total).toLocaleString()}원</p>
        )}
      </div>
    );
  }

  return null;
}

/** 결과에서 마크다운 텍스트 추출 (convert, ocr, extract_tables 등) */
function extractMarkdown(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;

  // convert / ocr — markdown 필드
  if (typeof d.markdown === "string" && d.markdown.length > 0) return d.markdown as string;

  // extract_tables — 테이블 마크다운 합치기
  if (Array.isArray(d.tables) && d.table_count != null) {
    const tables = d.tables as { markdown: string; index: number; page?: number; caption?: string; rows: number; cols: number }[];
    if (tables.length > 0) {
      return tables.map((t) => {
        const title = t.caption || `표 ${t.index + 1}`;
        const meta = [t.page != null ? `${t.page}페이지` : "", `${t.rows}행 × ${t.cols}열`].filter(Boolean).join(" · ");
        return `#### ${title}\n\n> ${meta}\n\n${t.markdown}`;
      }).join("\n\n---\n\n");
    }
  }

  return null;
}

export function ResultStep({ result, onReset, onOpenFolder, onSummarize, isSummarizing, logs, elapsed }: ResultStepProps) {
  const [logsOpen, setLogsOpen] = useState(false);
  if (!result) return null;

  const hasLogs = logs && logs.length > 0;
  const markdown = extractMarkdown(result.data);

  return (
    <div className="p-6 animate-fade-in space-y-4">
      {/* Summary Bar — compact */}
      <div className="card p-4">
        <div className="flex items-center gap-4">
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
            style={{ backgroundColor: result.failCount === 0 ? "var(--color-success-subtle)" : "var(--color-warning-subtle)" }}
          >
            {result.failCount === 0 ? (
              <CheckCircle2 size={20} style={{ color: "var(--color-success)" }} />
            ) : (
              <AlertTriangle size={20} style={{ color: "var(--color-warning)" }} />
            )}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="ts-sm font-bold" style={{ color: "var(--color-text-primary)" }}>처리 완료</span>
              <Badge variant="success">{result.successCount}건 성공</Badge>
              {result.failCount > 0 && <Badge variant="danger">{result.failCount}건 실패</Badge>}
              {elapsed != null && elapsed > 0 && (
                <span className="ts-2xs" style={{ color: "var(--color-text-muted)" }}>{formatElapsed(elapsed)}</span>
              )}
            </div>
            {result.warnings.length > 0 && (
              <p className="ts-2xs mt-1" style={{ color: "var(--color-warning)" }}>
                {result.warnings[0]}{result.warnings.length > 1 ? ` 외 ${result.warnings.length - 1}건` : ""}
              </p>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Button variant="secondary" size="sm" onClick={onOpenFolder}>
              <span className="flex items-center gap-1.5"><FolderOpen size={14} /> 폴더 열기</span>
            </Button>
            <Button variant="ghost" size="sm" onClick={onReset}>
              <span className="flex items-center gap-1.5"><RotateCcw size={14} /> 새로 시작</span>
            </Button>
          </div>
        </div>
      </div>

      {/* Markdown Viewer — convert/ocr/extract_tables 결과 */}
      {markdown && (
        <MarkdownViewer
          markdown={markdown}
          onSummarize={onSummarize ? () => onSummarize(markdown) : undefined}
          isSummarizing={isSummarizing}
          maxHeight={450}
        />
      )}

      {/* 비-마크다운 결과 프리뷰 (summarize, diff, form_extract, scan_receipt) */}
      {!markdown && result.data != null && (
        <div className="card p-4">
          <ResultPreview data={result.data} />
        </div>
      )}

      {/* 실행 로그 */}
      {hasLogs && (
        <div className="card">
          <button
            type="button"
            className="w-full flex items-center justify-between px-4 py-3 ts-xs font-semibold"
            style={{ color: "var(--color-text-muted)" }}
            onClick={() => setLogsOpen(!logsOpen)}
          >
            <span className="flex items-center gap-2">
              <Terminal size={13} /> 실행 로그 ({logs.length})
            </span>
            {logsOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
          {logsOpen && (
            <div className="max-h-[200px] overflow-y-auto text-mono ts-2xs px-4 pb-3">
              <div className="p-3 rounded space-y-0.5" style={{ backgroundColor: "var(--color-bg-primary)" }}>
                {logs.map((log, i) => (
                  <div key={i} style={{ color: log.includes("ERROR") ? "var(--color-error)" : log.includes("완료") ? "var(--color-success)" : "var(--color-text-muted)" }}>
                    {log}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
