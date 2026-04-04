import { useState, useEffect } from "react";
import { CheckCircle2, FolderOpen, RotateCcw, AlertTriangle, ArrowLeft, Terminal, X, FileText, FileOutput, Merge, Copy, Check } from "lucide-react";
import { Button } from "../ui/Button";
import { Badge } from "../ui/Badge";
import { MarkdownViewer } from "../ui/MarkdownViewer";
import { formatElapsed } from "../../utils/format";
import type { PipelineResult } from "../../types/pipeline";

interface ResultStepProps {
  result: PipelineResult | null;
  onReset: () => void;
  onBack: () => void;
  onOpenFolder: () => void;
  onSummarize?: (markdown: string) => void;
  isSummarizing?: boolean;
  logs?: string[];
  elapsed?: number;
}

// ── 유틸 ──

function outputFileName(d: Record<string, unknown>): string | null {
  if (typeof d.output_path === "string" && d.output_path) {
    return d.output_path.split(/[/\\]/).pop() ?? null;
  }
  return null;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// ── ResultPreview: 마크다운으로 변환 안 되는 결과용 (merge, generate_hwpx) ──

function ResultPreview({ data }: { data: unknown }) {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;

  // merge_files — 병합 완료
  if (d.file_count != null && d.total_length != null) {
    const failed = Array.isArray(d.failed_files) ? d.failed_files as string[] : [];
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-4">
        <div className="w-14 h-14 rounded-full flex items-center justify-center" style={{ backgroundColor: "var(--color-success-subtle)" }}>
          <Merge size={24} style={{ color: "var(--color-success)" }} />
        </div>
        <div className="text-center">
          <p className="ts-sm font-semibold" style={{ color: "var(--color-text-primary)" }}>
            {Number(d.file_count)}개 파일 병합 완료
          </p>
          <p className="ts-2xs mt-1" style={{ color: "var(--color-text-muted)" }}>
            총 {Number(d.total_length).toLocaleString()}자
          </p>
          {outputFileName(d) && (
            <p className="ts-2xs mt-1" style={{ color: "var(--color-text-muted)" }}>
              저장: {outputFileName(d)}
            </p>
          )}
        </div>
        {failed.length > 0 && (
          <div className="rounded-md p-3 ts-2xs w-full max-w-sm" style={{ backgroundColor: "var(--color-warning-subtle)", color: "var(--color-warning)" }}>
            실패: {failed.map(f => f.split(/[/\\]/).pop()).join(", ")}
          </div>
        )}
      </div>
    );
  }

  // generate_hwpx — HWPX 생성 완료
  if (d.size != null && typeof d.output_path === "string") {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-4">
        <div className="w-14 h-14 rounded-full flex items-center justify-center" style={{ backgroundColor: "var(--color-accent-subtle)" }}>
          <FileOutput size={24} style={{ color: "var(--color-accent)" }} />
        </div>
        <div className="text-center">
          <p className="ts-sm font-semibold" style={{ color: "var(--color-text-primary)" }}>HWPX 파일 생성 완료</p>
          <p className="ts-2xs mt-1" style={{ color: "var(--color-text-muted)" }}>
            {outputFileName(d)} ({formatBytes(Number(d.size))})
          </p>
        </div>
      </div>
    );
  }

  return null;
}

// ── extractMarkdown: 결과를 마크다운으로 변환 ──

function extractMarkdown(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;

  // convert / ocr — markdown 필드
  if (typeof d.markdown === "string" && d.markdown.length > 0) return d.markdown as string;

  // extract_tables — 테이블 마크다운 합치기
  if (Array.isArray(d.tables) && d.table_count != null) {
    const tables = d.tables as { markdown: string; index: number; page?: number; caption?: string; rows: number; cols: number; footnotes?: string[] }[];
    if (tables.length > 0) {
      return tables.map((t) => {
        const title = t.caption || `표 ${t.index + 1}`;
        const meta = [t.page != null ? `${t.page}페이지` : "", `${t.rows}행 × ${t.cols}열`].filter(Boolean).join(" · ");
        const footnotesBlock = Array.isArray(t.footnotes) && t.footnotes.length > 0
          ? "\n\n" + t.footnotes.map(n => `> *${n}*`).join("\n>\n")
          : "";
        return `#### ${title}\n\n> ${meta}\n\n${t.markdown}${footnotesBlock}`;
      }).join("\n\n---\n\n");
    }
  }

  // summarize — 요약 결과를 마크다운으로 표시
  if (typeof d.summary === "string" && d.summary.length > 0) {
    const parts: string[] = [];
    if (d.original_length != null) {
      parts.push(`> 원문 ${Number(d.original_length).toLocaleString()}자 → 요약 ${Number(d.summary_length).toLocaleString()}자\n`);
    }
    parts.push(d.summary as string);
    return parts.join("\n");
  }

  // form_extract — 양식 필드를 마크다운 테이블로
  if (Array.isArray(d.fields) && d.confidence != null) {
    const fields = d.fields as { label?: string; value?: string; type?: string }[];
    const confidence = Math.round(Number(d.confidence) * 100);
    const parts: string[] = [];

    parts.push(`> 양식 필드 **${fields.length}**개 · 신뢰도 **${confidence}%**`);
    if (outputFileName(d)) parts[0] += ` · 저장: ${outputFileName(d)}`;
    parts.push("");

    if (fields.length > 0) {
      parts.push("| 필드명 | 값 | 유형 |");
      parts.push("|--------|-----|------|");
      for (const f of fields) {
        const label = (f.label ?? "-").replace(/\|/g, "\\|");
        const value = (f.value ?? "-").replace(/\|/g, "\\|");
        const type = f.type ?? "";
        parts.push(`| ${label} | ${value} | ${type} |`);
      }
    } else {
      parts.push("양식 필드를 찾지 못했습니다.");
    }

    return parts.join("\n");
  }

  // scan_receipt — 영수증을 마크다운으로
  if (Array.isArray(d.items) && (d.raw_text != null || d.total != null || d.store_name != null)) {
    const items = d.items as { name?: string; amount?: number; quantity?: number }[];
    const parts: string[] = [];

    const headerParts: string[] = [];
    if (typeof d.store_name === "string" && d.store_name) headerParts.push(`**${d.store_name}**`);
    if (typeof d.date === "string" && d.date) headerParts.push(d.date);
    if (headerParts.length > 0) {
      parts.push(`> ${headerParts.join(" · ")}`);
      if (outputFileName(d)) parts[0] += ` · 저장: ${outputFileName(d)}`;
      parts.push("");
    }

    if (items.length > 0) {
      parts.push("| 항목 | 수량 | 금액 |");
      parts.push("|------|-----:|-----:|");
      for (const item of items) {
        const name = (item.name ?? "-").replace(/\|/g, "\\|");
        const qty = item.quantity ?? "-";
        const amt = item.amount != null ? Number(item.amount).toLocaleString() : "-";
        parts.push(`| ${name} | ${qty} | ${amt} |`);
      }
      if (d.total != null) {
        parts.push("");
        parts.push(`**합계: ${Number(d.total).toLocaleString()}원**`);
      }
    } else {
      parts.push("영수증 항목을 추출하지 못했습니다.");
      if (typeof d.raw_text === "string" && d.raw_text.length > 0) {
        parts.push("\n---\n");
        parts.push("#### 원본 텍스트\n");
        parts.push("```");
        parts.push(d.raw_text.slice(0, 2000));
        parts.push("```");
      }
    }

    return parts.join("\n");
  }

  return null;
}

// ── diff 데이터 감지 + DiffViewer ──

interface IRCell { text: string; colSpan: number; rowSpan: number }
interface IRTable { rows: number; cols: number; cells: IRCell[][]; hasHeader: boolean }
interface CellDiff { type: "added" | "removed" | "modified" | "unchanged"; before?: string; after?: string }

interface DiffBlock {
  type: string;
  text?: string;
  level?: number;
  table?: IRTable;
}

interface BlockDiff {
  type: "added" | "removed" | "modified" | "unchanged";
  before?: DiffBlock;
  after?: DiffBlock;
  cellDiffs?: CellDiff[][];
  similarity?: number;
}

interface DiffStats { added: number; removed: number; modified: number; unchanged: number }

function extractDiff(data: unknown): { stats: DiffStats; diffs: BlockDiff[] } | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (d.stats != null && Array.isArray(d.diffs)) {
    return { stats: d.stats as DiffStats, diffs: d.diffs as BlockDiff[] };
  }
  return null;
}

// ── 테이블 렌더러 ──

/** 테이블을 컴팩트 HTML 테이블로 렌더링 */
function MiniTable({ table, cellDiffs, side }: {
  table: IRTable;
  cellDiffs?: CellDiff[][];
  side: "left" | "right";
}) {
  return (
    <table className="w-full ts-2xs" style={{ borderCollapse: "collapse" }}>
      <tbody>
        {table.cells.map((row, ri) => (
          <tr key={ri}>
            {row.map((cell, ci) => {
              const cd = cellDiffs?.[ri]?.[ci];
              const isChanged = cd && cd.type !== "unchanged";
              const text = side === "left" ? (cd?.before ?? cell.text) : (cd?.after ?? cell.text);

              return (
                <td
                  key={ci}
                  colSpan={cell.colSpan > 1 ? cell.colSpan : undefined}
                  rowSpan={cell.rowSpan > 1 ? cell.rowSpan : undefined}
                  style={{
                    border: "1px solid var(--color-border)",
                    padding: "0.25em 0.5em",
                    backgroundColor: isChanged
                      ? (side === "left" ? "rgba(239,68,68,0.12)" : "rgba(34,197,94,0.12)")
                      : "transparent",
                    fontWeight: ri === 0 && table.hasHeader ? 600 : "normal",
                    color: isChanged ? "var(--color-text-primary)" : "var(--color-text-secondary)",
                  }}
                >
                  {text}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** 블록 내용 렌더링 — 텍스트 또는 테이블 */
function BlockContent({ block, cellDiffs, side, highlight }: {
  block: DiffBlock | null | undefined;
  cellDiffs?: CellDiff[][];
  side: "left" | "right";
  highlight: boolean;
}) {
  if (!block) return null;

  if (block.table) {
    return <MiniTable table={block.table} cellDiffs={cellDiffs} side={side} />;
  }

  return (
    <span style={{ color: highlight ? "var(--color-text-primary)" : "var(--color-text-muted)" }}>
      {block.text ?? `[${block.type}]`}
    </span>
  );
}

// ── DiffRow 빌더 — removed/added 페어링 ──

interface DiffRow {
  key: string;
  leftBlock: DiffBlock | null;
  rightBlock: DiffBlock | null;
  type: "unchanged" | "modified" | "added" | "removed" | "paired";
  cellDiffs?: CellDiff[][];
}

function buildRows(diffs: BlockDiff[]): DiffRow[] {
  const rows: DiffRow[] = [];
  let i = 0;

  while (i < diffs.length) {
    const d = diffs[i];

    if (d.type === "unchanged") {
      rows.push({ key: `u-${i}`, leftBlock: d.before ?? null, rightBlock: d.after ?? null, type: "unchanged" });
      i++;
      continue;
    }

    if (d.type === "modified") {
      rows.push({ key: `m-${i}`, leftBlock: d.before ?? null, rightBlock: d.after ?? null, type: "modified", cellDiffs: d.cellDiffs });
      i++;
      continue;
    }

    // 연속 removed/added를 모아서 페어링
    const removedBuf: { block: DiffBlock; idx: number }[] = [];
    const addedBuf: { block: DiffBlock; idx: number }[] = [];
    while (i < diffs.length && (diffs[i].type === "removed" || diffs[i].type === "added")) {
      if (diffs[i].type === "removed" && diffs[i].before) removedBuf.push({ block: diffs[i].before!, idx: i });
      else if (diffs[i].type === "added" && diffs[i].after) addedBuf.push({ block: diffs[i].after!, idx: i });
      i++;
    }

    const pairCount = Math.max(removedBuf.length, addedBuf.length);
    for (let p = 0; p < pairCount; p++) {
      const hasLeft = p < removedBuf.length;
      const hasRight = p < addedBuf.length;
      rows.push({
        key: `p-${removedBuf[p]?.idx ?? addedBuf[p]?.idx}`,
        leftBlock: hasLeft ? removedBuf[p].block : null,
        rightBlock: hasRight ? addedBuf[p].block : null,
        type: hasLeft && hasRight ? "paired" : hasLeft ? "removed" : "added",
      });
    }
  }

  return rows;
}

// ── DiffViewer ──

function DiffViewer({ stats, diffs }: { stats: DiffStats; diffs: BlockDiff[] }) {
  const [showUnchanged, setShowUnchanged] = useState(true);
  const changedCount = stats.added + stats.removed + stats.modified;
  const allRows = buildRows(diffs);
  const hasUnchanged = stats.unchanged > 0;

  // 변경만 보기: 연속 unchanged를 접힌 행으로 대체
  const visibleRows = showUnchanged
    ? allRows
    : (() => {
        const filtered: (DiffRow | { key: string; type: "collapsed"; count: number })[] = [];
        let collapseCount = 0;
        let collapseKey = 0;
        for (const row of allRows) {
          if (row.type === "unchanged") {
            if (collapseCount === 0) collapseKey = filtered.length;
            collapseCount++;
          } else {
            if (collapseCount > 0) {
              filtered.push({ key: `c-${collapseKey}`, type: "collapsed", count: collapseCount });
              collapseCount = 0;
            }
            filtered.push(row);
          }
        }
        if (collapseCount > 0) filtered.push({ key: `c-${collapseKey}`, type: "collapsed", count: collapseCount });
        return filtered;
      })();

  const leftBg = (t: string) => t === "removed" || t === "paired" ? "rgba(239,68,68,0.06)" : t === "modified" ? "rgba(239,68,68,0.04)" : "transparent";
  const rightBg = (t: string) => t === "added" || t === "paired" ? "rgba(34,197,94,0.06)" : t === "modified" ? "rgba(34,197,94,0.04)" : "transparent";

  return (
    <div className="card flex-1 flex flex-col overflow-hidden min-h-0">
      {/* 헤더 */}
      <div className="flex items-center justify-between px-5 py-3 shrink-0" style={{ borderBottom: "2px solid var(--color-border)" }}>
        <div className="flex items-center gap-3">
          <span className="font-bold ts-sm" style={{ color: "var(--color-text-primary)" }}>문서 변경 비교</span>
          <div className="flex items-center gap-2 ts-2xs">
            {stats.modified > 0 && <span className="px-1.5 py-0.5 rounded" style={{ backgroundColor: "var(--color-warning-subtle)", color: "var(--color-warning)" }}>{stats.modified} 수정</span>}
            {stats.added > 0 && <span className="px-1.5 py-0.5 rounded" style={{ backgroundColor: "rgba(34,197,94,0.1)", color: "var(--color-success)" }}>{stats.added} 추가</span>}
            {stats.removed > 0 && <span className="px-1.5 py-0.5 rounded" style={{ backgroundColor: "rgba(239,68,68,0.1)", color: "var(--color-error)" }}>{stats.removed} 삭제</span>}
            {stats.unchanged > 0 && <span style={{ color: "var(--color-text-muted)" }}>{stats.unchanged} 동일</span>}
          </div>
        </div>
        {hasUnchanged && (
          <button
            type="button"
            onClick={() => setShowUnchanged(!showUnchanged)}
            className="ts-2xs px-2.5 py-1 rounded-md font-medium transition-colors"
            style={{
              color: showUnchanged ? "var(--color-text-muted)" : "var(--color-accent)",
              backgroundColor: showUnchanged ? "var(--color-bg-tertiary)" : "var(--color-accent-subtle)",
            }}
          >
            {showUnchanged ? "변경만 보기" : "전체 보기"}
          </button>
        )}
      </div>

      {/* 컬럼 헤더 */}
      <div className="grid grid-cols-2 shrink-0" style={{ borderBottom: "2px solid var(--color-border)", backgroundColor: "var(--color-bg-tertiary)" }}>
        <div className="px-5 py-2 ts-xs font-bold text-center" style={{ color: "var(--color-text-primary)", borderRight: "1px solid var(--color-border)" }}>
          원본
        </div>
        <div className="px-5 py-2 ts-xs font-bold text-center" style={{ color: "var(--color-text-primary)" }}>
          수정본
        </div>
      </div>

      {/* 본문 */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {changedCount === 0 ? (
          <div className="flex items-center justify-center py-12">
            <p className="ts-sm" style={{ color: "var(--color-text-muted)" }}>두 문서가 동일합니다</p>
          </div>
        ) : (
          visibleRows.map((row) => {
            if ("count" in row) {
              return (
                <div key={row.key} className="px-4 py-1 text-center ts-2xs"
                  style={{ backgroundColor: "var(--color-bg-tertiary)", color: "var(--color-text-muted)", borderBottom: "1px solid var(--color-border)" }}>
                  ··· 동일 {row.count}블록 ···
                </div>
              );
            }

            if (row.type === "unchanged") {
              return (
                <div key={row.key} className="grid grid-cols-2" style={{ borderBottom: "1px solid var(--color-border)" }}>
                  <div className="px-5 py-2.5 ts-sm" style={{ color: "var(--color-text-muted)", borderRight: "1px solid var(--color-border)" }}>
                    <BlockContent block={row.leftBlock} side="left" highlight={false} />
                  </div>
                  <div className="px-5 py-2.5 ts-sm" style={{ color: "var(--color-text-muted)" }}>
                    <BlockContent block={row.rightBlock} side="right" highlight={false} />
                  </div>
                </div>
              );
            }

            const isLeft = row.type === "removed" || row.type === "paired" || row.type === "modified";
            const isRight = row.type === "added" || row.type === "paired" || row.type === "modified";

            return (
              <div key={row.key} className="grid grid-cols-2" style={{ borderBottom: "1px solid var(--color-border)" }}>
                {/* 원본 */}
                <div className="px-5 py-2.5 ts-sm" style={{
                  backgroundColor: leftBg(row.type),
                  borderRight: "1px solid var(--color-border)",
                  borderLeft: isLeft ? "3px solid var(--color-error)" : "3px solid transparent",
                }}>
                  {row.leftBlock ? (
                    <BlockContent block={row.leftBlock} cellDiffs={row.cellDiffs} side="left" highlight={isLeft} />
                  ) : (
                    <span className="ts-2xs italic" style={{ color: "var(--color-text-muted)", opacity: 0.4 }}>
                      {row.type === "added" ? "(추가)" : "\u00A0"}
                    </span>
                  )}
                </div>
                {/* 수정본 */}
                <div className="px-5 py-2.5 ts-sm" style={{
                  backgroundColor: rightBg(row.type),
                  borderLeft: isRight ? "3px solid var(--color-success)" : "none",
                }}>
                  {row.rightBlock ? (
                    <BlockContent block={row.rightBlock} cellDiffs={row.cellDiffs} side="right" highlight={isRight} />
                  ) : (
                    <span className="ts-2xs italic" style={{ color: "var(--color-text-muted)", opacity: 0.4 }}>
                      {row.type === "removed" ? "(삭제)" : "\u00A0"}
                    </span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ── 실행 로그 모달 ──

function LogModal({ logs, onClose }: { logs: string[]; onClose: () => void }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(logs.join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: "var(--color-backdrop)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="card flex flex-col mx-6 my-8 animate-fade-in"
        style={{ width: "min(720px, calc(100vw - 48px))", maxHeight: "calc(100vh - 64px)" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 shrink-0" style={{ borderBottom: "1px solid var(--color-border)" }}>
          <span className="flex items-center gap-2 ts-sm font-semibold" style={{ color: "var(--color-text-primary)" }}>
            <Terminal size={15} /> 실행 로그
            <span className="ts-2xs font-normal" style={{ color: "var(--color-text-muted)" }}>{logs.length}건</span>
          </span>
          <div className="flex items-center gap-2">
            <button type="button" onClick={handleCopy} className="flex items-center gap-1 px-2 py-1 rounded-md ts-2xs hover-bg-tertiary" style={{ color: "var(--color-text-muted)" }}>
              {copied ? <><Check size={12} /> 복사됨</> : <><Copy size={12} /> 복사</>}
            </button>
            <button type="button" onClick={onClose} className="p-1 rounded-md hover-bg-tertiary" style={{ color: "var(--color-text-muted)" }}>
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Log content */}
        <div className="flex-1 overflow-y-auto p-4 min-h-0">
          <div className="rounded-md p-4 space-y-0.5 text-mono ts-2xs" style={{ backgroundColor: "var(--color-bg-primary)" }}>
            {logs.map((log, i) => (
              <div
                key={i}
                style={{
                  color: log.includes("ERROR") ? "var(--color-error)"
                    : log.includes("완료") ? "var(--color-success)"
                    : "var(--color-text-muted)",
                }}
              >
                {log}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── 메인 컴포넌트 ──

export function ResultStep({ result, onReset, onBack, onOpenFolder, onSummarize, isSummarizing, logs, elapsed }: ResultStepProps) {
  const [logsOpen, setLogsOpen] = useState(false);
  if (!result) return null;

  const hasLogs = logs && logs.length > 0;
  const diffData = extractDiff(result.data);
  const markdown = diffData ? null : extractMarkdown(result.data);

  return (
    <div className="flex-1 flex flex-col overflow-hidden p-6 gap-4 animate-fade-in">
      {/* Summary Bar */}
      <div className="card p-4 shrink-0">
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
            {hasLogs && (
              <Button variant="ghost" size="sm" onClick={() => setLogsOpen(true)}>
                <span className="flex items-center gap-1.5"><Terminal size={14} /> 로그 ({logs.length})</span>
              </Button>
            )}
            <Button variant="secondary" size="sm" onClick={onOpenFolder}>
              <span className="flex items-center gap-1.5"><FolderOpen size={14} /> 폴더 열기</span>
            </Button>
            <Button variant="ghost" size="sm" onClick={onBack}>
              <span className="flex items-center gap-1.5"><ArrowLeft size={14} /> 다른 작업</span>
            </Button>
            <Button variant="ghost" size="sm" onClick={onReset}>
              <span className="flex items-center gap-1.5"><RotateCcw size={14} /> 새로 시작</span>
            </Button>
          </div>
        </div>
      </div>

      {/* Side-by-side diff 뷰 */}
      {diffData && (
        <DiffViewer stats={diffData.stats} diffs={diffData.diffs} />
      )}

      {/* 마크다운 결과 — convert, ocr, extract_tables, summarize, form_extract, scan_receipt */}
      {!diffData && markdown && (
        <MarkdownViewer
          markdown={markdown}
          onSummarize={onSummarize ? () => onSummarize(markdown) : undefined}
          isSummarizing={isSummarizing}
          fillHeight
        />
      )}

      {/* 비-마크다운 결과 — merge_files, generate_hwpx */}
      {!diffData && !markdown && result.data != null && (
        <div className="card flex-1 flex items-center justify-center min-h-0">
          <ResultPreview data={result.data} />
        </div>
      )}

      {/* 결과 데이터 없는 경우 (fallback) */}
      {!markdown && result.data == null && (
        <div className="card flex-1 flex items-center justify-center min-h-0">
          <div className="flex flex-col items-center gap-3 py-12">
            <FileText size={32} style={{ color: "var(--color-text-muted)" }} />
            <p className="ts-sm" style={{ color: "var(--color-text-muted)" }}>처리가 완료되었습니다</p>
          </div>
        </div>
      )}

      {/* 실행 로그 모달 */}
      {logsOpen && hasLogs && (
        <LogModal logs={logs} onClose={() => setLogsOpen(false)} />
      )}
    </div>
  );
}
