import { useState, useEffect } from "react";
import { CheckCircle2, FolderOpen, RotateCcw, AlertTriangle, ArrowLeft, Terminal, X, FileText, FileOutput, Merge, Copy, Check, ShieldCheck, CircleX, TriangleAlert, Lightbulb, ChevronDown, ChevronRight, List, Image } from "lucide-react";
import { Button } from "../ui/Button";
import { Badge } from "../ui/Badge";
import { Tooltip } from "../ui/Tooltip";
import { MarkdownViewer } from "../ui/MarkdownViewer";
import { formatElapsed } from "../../utils/format";
import type { PipelineResult, ImportedFile } from "../../types/pipeline";

interface ResultStepProps {
  result: PipelineResult | null;
  files: ImportedFile[];
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
      const badgeStyle = "display:inline-block;padding:1px 7px;border-radius:4px;font-size:0.65em;font-weight:400;background:var(--color-bg-tertiary);color:var(--color-text-muted);vertical-align:middle;margin-left:6px";
      return tables.map((t) => {
        const title = t.caption || `표 ${t.index + 1}`;
        const badges: string[] = [];
        if (t.page != null) badges.push(`<span style="${badgeStyle}">${t.page}p</span>`);
        badges.push(`<span style="${badgeStyle}">${t.rows}×${t.cols}</span>`);
        const footnotesBlock = Array.isArray(t.footnotes) && t.footnotes.length > 0
          ? "\n\n" + t.footnotes.map(n => `> *${n}*`).join("\n>\n")
          : "";
        return `#### ${title} ${badges.join("")}\n\n${t.markdown}${footnotesBlock}`;
      }).join("\n\n---\n\n");
    }
  }

  // summarize — 요약 결과를 마크다운으로 표시
  if (typeof d.summary === "string" && d.summary.length > 0) {
    const parts: string[] = [];
    const styleLabelMap: Record<string, string> = { standard: "일반 요약", briefing: "보고용", review: "검토용", action: "조치 추출" };
    const styleLabel = typeof d.style === "string" && styleLabelMap[d.style] ? ` · ${styleLabelMap[d.style]}` : "";
    const ratio = d.original_length != null && Number(d.original_length) > 0
      ? ` (${Math.round(Number(d.summary_length) / Number(d.original_length) * 100)}%)`
      : "";
    if (d.original_length != null) {
      parts.push(`> 원문 ${Number(d.original_length).toLocaleString()}자 → 요약 ${Number(d.summary_length).toLocaleString()}자${ratio}${styleLabel}\n`);
    }
    parts.push(d.summary as string);
    return parts.join("\n");
  }

  // form_extract_batch — 배치 결과를 테이블로
  if (Array.isArray(d.results) && d.total != null && d.succeeded != null) {
    const results = d.results as Array<{ file: string; fields: Array<{ label: string; value: string }>; error?: string }>;
    const parts: string[] = [];

    parts.push(`> **${d.total}**개 파일 · 성공 **${d.succeeded}** · 실패 **${Number(d.failed ?? 0)}**`);
    if (outputFileName(d)) parts[0] += ` · CSV: ${outputFileName(d)}`;
    parts.push("");

    if (results.length > 0 && results[0].fields?.length > 0) {
      // 필드명 헤더
      const headers = results[0].fields.map((f) => f.label);
      parts.push(`| 파일명 | ${headers.map((h) => h.replace(/\|/g, "\\|")).join(" | ")} |`);
      parts.push(`|--------|${headers.map(() => "------").join("|")}|`);

      for (const r of results) {
        if (r.error) {
          parts.push(`| ${r.file.replace(/\|/g, "\\|")} | ${headers.map(() => "오류").join(" | ")} |`);
        } else {
          const fieldMap = new Map(r.fields.map((f) => [f.label, f.value]));
          const values = headers.map((h) => (fieldMap.get(h) ?? "").replace(/\|/g, "\\|").replace(/\n/g, " "));
          parts.push(`| ${r.file.replace(/\|/g, "\\|")} | ${values.join(" | ")} |`);
        }
      }
    } else {
      parts.push("추출된 데이터가 없습니다.");
    }

    return parts.join("\n");
  }

  // form_extract — 양식 필드를 마크다운 테이블로 (단일 파일, 하위 호환)
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

  return null;
}

// ── InspectViewer (K팀장) ──

type IssueSeverity = "error" | "warning" | "suggestion";
type IssueCategory = "logic" | "number" | "date" | "terminology" | "typo" | "reference";

interface DocumentIssue {
  category: IssueCategory;
  severity: IssueSeverity;
  location: string;
  description: string;
  original?: string;
  suggestion?: string;
}

interface InspectData {
  success: boolean;
  document_title?: string;
  issues: DocumentIssue[];
  summary: string;
  total_issues: number;
}

function isInspectData(data: unknown): data is InspectData {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  return Array.isArray(d.issues) && typeof d.summary === "string" && typeof d.total_issues === "number";
}

const CATEGORY_LABELS: Record<IssueCategory, string> = {
  logic: "논리 구조",
  number: "숫자/금액",
  date: "날짜/기간",
  terminology: "용어 일관성",
  typo: "오탈자/맞춤법",
  reference: "내부 참조",
};

const SEVERITY_CONFIG: Record<IssueSeverity, { label: string; icon: React.ReactNode; color: string; bg: string; border: string }> = {
  error: {
    label: "오류",
    icon: <CircleX size={13} />,
    color: "var(--color-error)",
    bg: "color-mix(in srgb, var(--color-error) 8%, transparent)",
    border: "color-mix(in srgb, var(--color-error) 20%, transparent)",
  },
  warning: {
    label: "경고",
    icon: <TriangleAlert size={13} />,
    color: "var(--color-warning)",
    bg: "color-mix(in srgb, var(--color-warning) 8%, transparent)",
    border: "color-mix(in srgb, var(--color-warning) 20%, transparent)",
  },
  suggestion: {
    label: "제안",
    icon: <Lightbulb size={13} />,
    color: "var(--color-accent)",
    bg: "color-mix(in srgb, var(--color-accent) 8%, transparent)",
    border: "color-mix(in srgb, var(--color-accent) 20%, transparent)",
  },
};

function InspectViewer({ data }: { data: InspectData }) {
  const [copied, setCopied] = useState(false);
  const [activeCategory, setActiveCategory] = useState<IssueCategory | null>(null);

  const issues = data.issues ?? [];
  const filtered = activeCategory ? issues.filter(i => i.category === activeCategory) : issues;
  const errorCount = issues.filter(i => i.severity === "error").length;
  const warningCount = issues.filter(i => i.severity === "warning").length;
  const suggestionCount = issues.filter(i => i.severity === "suggestion").length;

  const categoryGroups = Object.keys(CATEGORY_LABELS).filter(
    cat => issues.some(i => i.category === cat)
  ) as IssueCategory[];

  const handleCopy = async () => {
    const lines = [
      data.document_title ? `# ${data.document_title}` : "# K팀장 검토 결과",
      "",
      `> ${data.summary}`,
      "",
      `총 ${issues.length}건 (오류 ${errorCount}, 경고 ${warningCount}, 제안 ${suggestionCount})`,
      "",
      ...filtered.map(issue => [
        `## [${SEVERITY_CONFIG[issue.severity].label}] ${CATEGORY_LABELS[issue.category]}`,
        `**위치:** ${issue.location}`,
        `**내용:** ${issue.description}`,
        issue.original ? `**원문:** ${issue.original}` : "",
        issue.suggestion ? `**제안:** ${issue.suggestion}` : "",
        "",
      ].filter(Boolean).join("\n")),
    ].join("\n");
    await navigator.clipboard.writeText(lines);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex flex-col min-h-0 flex-1">
      {/* 액션바 */}
      <div
        className="flex items-center justify-between px-5 py-2.5 shrink-0"
        style={{ borderBottom: "1px solid var(--color-border)" }}
      >
        <div className="flex items-center gap-2">
          <ShieldCheck size={14} style={{ color: "var(--color-error)" }} />
          <span className="ts-sm font-semibold" style={{ color: "var(--color-text-primary)" }}>
            K팀장 검토
          </span>
          {data.document_title && (
            <span className="ts-2xs" style={{ color: "var(--color-text-muted)" }}>— {data.document_title}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Tooltip content="결과를 클립보드에 복사">
          <button
            type="button"
            onClick={handleCopy}
            className="flex items-center gap-1.5 ts-2xs px-3 py-1.5 rounded-md font-medium transition-colors"
            style={{
              color: copied ? "var(--color-success)" : "var(--color-text-primary)",
              backgroundColor: copied ? "var(--color-success-subtle)" : "var(--color-bg-tertiary)",
              border: `1px solid ${copied ? "color-mix(in srgb, var(--color-success) 30%, transparent)" : "var(--color-border)"}`,
            }}
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
            {copied ? "복사됨" : "복사"}
          </button>
          </Tooltip>
        </div>
      </div>

      {/* 요약 */}
      <div
        className="px-5 py-3 shrink-0"
        style={{ borderBottom: "1px solid var(--color-border)", backgroundColor: "var(--color-bg-secondary)" }}
      >
        <p className="ts-xs" style={{ color: "var(--color-text-secondary)" }}>{data.summary}</p>
        <div className="flex items-center gap-3 mt-2">
          {errorCount > 0 && (
            <span className="flex items-center gap-1 ts-2xs font-semibold" style={{ color: "var(--color-error)" }}>
              <CircleX size={11} /> 오류 {errorCount}
            </span>
          )}
          {warningCount > 0 && (
            <span className="flex items-center gap-1 ts-2xs font-semibold" style={{ color: "var(--color-warning)" }}>
              <TriangleAlert size={11} /> 경고 {warningCount}
            </span>
          )}
          {suggestionCount > 0 && (
            <span className="flex items-center gap-1 ts-2xs font-semibold" style={{ color: "var(--color-accent)" }}>
              <Lightbulb size={11} /> 제안 {suggestionCount}
            </span>
          )}
          {issues.length === 0 && (
            <span className="ts-2xs" style={{ color: "var(--color-success)" }}>검토 사항 없음 — 문제가 발견되지 않았습니다</span>
          )}
        </div>
      </div>

      {/* 카테고리 필터 */}
      {categoryGroups.length > 1 && (
        <div
          className="flex items-center gap-1.5 px-5 py-2 shrink-0 overflow-x-auto"
          style={{ borderBottom: "1px solid var(--color-border)" }}
        >
          <button
            type="button"
            onClick={() => setActiveCategory(null)}
            className="ts-2xs px-2.5 py-1 rounded-full font-medium transition-colors shrink-0"
            style={{
              backgroundColor: !activeCategory ? "var(--color-accent)" : "var(--color-bg-tertiary)",
              color: !activeCategory ? "white" : "var(--color-text-muted)",
            }}
          >
            전체 {issues.length}
          </button>
          {categoryGroups.map(cat => (
            <button
              key={cat}
              type="button"
              onClick={() => setActiveCategory(activeCategory === cat ? null : cat)}
              className="ts-2xs px-2.5 py-1 rounded-full font-medium transition-colors shrink-0"
              style={{
                backgroundColor: activeCategory === cat ? "var(--color-accent)" : "var(--color-bg-tertiary)",
                color: activeCategory === cat ? "white" : "var(--color-text-muted)",
              }}
            >
              {CATEGORY_LABELS[cat]} {issues.filter(i => i.category === cat).length}
            </button>
          ))}
        </div>
      )}

      {/* 이슈 목록 */}
      <div className="flex-1 overflow-y-auto min-h-0 p-4 flex flex-col gap-2">
        {filtered.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="ts-sm" style={{ color: "var(--color-text-muted)" }}>해당 카테고리에 검토 사항이 없습니다</p>
          </div>
        ) : (
          filtered.map((issue, idx) => {
            const sev = SEVERITY_CONFIG[issue.severity];
            return (
              <div
                key={idx}
                className="rounded-lg p-3.5"
                style={{ backgroundColor: sev.bg, border: `1px solid ${sev.border}` }}
              >
                <div className="flex items-start gap-2.5">
                  <span className="mt-0.5 shrink-0" style={{ color: sev.color }}>{sev.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="ts-2xs font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: sev.border, color: sev.color }}>
                        {sev.label}
                      </span>
                      <span className="ts-2xs px-1.5 py-0.5 rounded" style={{ backgroundColor: "var(--color-bg-tertiary)", color: "var(--color-text-muted)" }}>
                        {CATEGORY_LABELS[issue.category]}
                      </span>
                      <span className="ts-2xs" style={{ color: "var(--color-text-muted)" }}>{issue.location}</span>
                    </div>
                    <p className="ts-xs" style={{ color: "var(--color-text-primary)" }}>{issue.description}</p>
                    {issue.original && (
                      <p className="ts-2xs mt-1.5 px-2 py-1 rounded font-mono" style={{ backgroundColor: "var(--color-bg-primary)", color: "var(--color-text-secondary)" }}>
                        원문: {issue.original}
                      </p>
                    )}
                    {issue.suggestion && (
                      <p className="ts-2xs mt-1" style={{ color: "var(--color-text-secondary)" }}>
                        → {issue.suggestion}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
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

// ── 셀 단위 변경 건수 집계 ──

type ChangeKind = "spacing" | "punctuation" | "partial_add" | "partial_del" | "partial_edit" | "content" | "added" | "removed";
interface ChangeEntry { before: string; after: string; kind: ChangeKind }

/** before/after 비교해서 변경 유형 판별 */
function classifyChange(before: string, after: string): ChangeKind {
  if (!before) return "added";
  if (!after) return "removed";

  // 공백 제거 후 동일 → 띄어쓰기 변경
  const bTrim = before.replace(/\s+/g, "");
  const aTrim = after.replace(/\s+/g, "");
  if (bTrim === aTrim) return "spacing";

  // 문자·숫자만 추출 후 동일 → 문장부호/특수문자 변경
  const strip = (s: string) => s.replace(/[^\p{L}\p{N}]/gu, "");
  if (strip(before) === strip(after)) return "punctuation";

  // 한쪽이 다른 쪽을 포함 → 내용 추가/삭제
  if (aTrim.includes(bTrim) && bTrim.length > 3) return "partial_add";
  if (bTrim.includes(aTrim) && aTrim.length > 3) return "partial_del";

  // 공통 접두사+접미사가 전체의 60% 이상 → 일부 수정
  const minLen = Math.min(before.length, after.length);
  if (minLen > 5) {
    let prefix = 0;
    while (prefix < minLen && before[prefix] === after[prefix]) prefix++;
    let suffix = 0;
    while (suffix < minLen - prefix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix++;
    const commonRatio = (prefix + suffix) / Math.max(before.length, after.length);
    if (commonRatio >= 0.5) return "partial_edit";
  }

  return "content";
}

const KIND_LABEL: Record<ChangeKind, string> = {
  spacing: "띄어쓰기",
  punctuation: "문장부호",
  partial_add: "내용 추가",
  partial_del: "내용 삭제",
  partial_edit: "일부 수정",
  content: "내용 변경",
  added: "추가",
  removed: "삭제",
};
const KIND_COLOR: Record<ChangeKind, string> = {
  spacing: "var(--color-text-muted)",
  punctuation: "var(--color-text-muted)",
  partial_add: "var(--color-success)",
  partial_del: "var(--color-error)",
  partial_edit: "var(--color-warning)",
  content: "var(--color-warning)",
  added: "var(--color-success)",
  removed: "var(--color-error)",
};

function collectChanges(diffs: BlockDiff[]): { totalChanges: number; entries: ChangeEntry[] } {
  let totalChanges = 0;
  const entries: ChangeEntry[] = [];

  for (const d of diffs) {
    if (d.type === "unchanged") continue;

    // 테이블: 실제 셀만 카운트 (covered placeholder 제외)
    if (d.cellDiffs) {
      // before 또는 after 테이블에서 skip set 구축
      const spanSkip = new Set<string>();
      const refTable = d.before?.table ?? d.after?.table;
      if (refTable) {
        for (let ri = 0; ri < refTable.cells.length; ri++) {
          for (let ci = 0; ci < refTable.cells[ri].length; ci++) {
            const c = refTable.cells[ri][ci];
            if (c.rowSpan > 1 || c.colSpan > 1) {
              for (let dr = 0; dr < c.rowSpan; dr++) {
                for (let dc = 0; dc < c.colSpan; dc++) {
                  if (dr === 0 && dc === 0) continue;
                  spanSkip.add(`${ri + dr},${ci + dc}`);
                }
              }
            }
          }
        }
      }

      for (let ri = 0; ri < d.cellDiffs.length; ri++) {
        for (let ci = 0; ci < d.cellDiffs[ri].length; ci++) {
          if (spanSkip.has(`${ri},${ci}`)) continue; // covered 셀 건너뛰기
          const cell = d.cellDiffs[ri][ci];
          if (cell.type === "unchanged") continue;
          totalChanges++;
          const b = cell.before ?? "";
          const a = cell.after ?? "";
          if (b || a) entries.push({ before: b, after: a, kind: classifyChange(b, a) });
        }
      }
      continue;
    }

    // 텍스트 블록
    totalChanges++;
    const b = d.before?.text ?? "";
    const a = d.after?.text ?? "";
    if (b || a) entries.push({ before: b, after: a, kind: classifyChange(b, a) });
  }

  // 빈 문자열 엔트리 제거, 긴 텍스트 생략
  return {
    totalChanges,
    entries: entries.filter(e => e.before.trim() || e.after.trim()).slice(0, 20),
  };
}

// ── 테이블 렌더러 ──

function MiniTable({ table, cellDiffs, side }: {
  table: IRTable;
  cellDiffs?: CellDiff[][];
  side: "left" | "right";
}) {
  // rowSpan/colSpan으로 가려진 셀 위치를 skip set으로 관리
  const skip = new Set<string>();

  return (
    <table className="w-full ts-2xs" style={{ borderCollapse: "collapse" }}>
      <tbody>
        {table.cells.map((row, ri) => (
          <tr key={ri}>
            {row.map((cell, ci) => {
              // covered 셀이면 렌더링 건너뛰기
              if (skip.has(`${ri},${ci}`)) return null;

              // 이 셀이 차지하는 영역을 skip에 등록
              if (cell.rowSpan > 1 || cell.colSpan > 1) {
                for (let dr = 0; dr < cell.rowSpan; dr++) {
                  for (let dc = 0; dc < cell.colSpan; dc++) {
                    if (dr === 0 && dc === 0) continue;
                    skip.add(`${ri + dr},${ci + dc}`);
                  }
                }
              }

              const cd = cellDiffs?.[ri]?.[ci];
              const isChanged = cd && cd.type !== "unchanged";
              const text = side === "left" ? (cd?.before ?? cell.text) : (cd?.after ?? cell.text);
              const otherText = side === "left" ? cd?.after : cd?.before;

              return (
                <td
                  key={ci}
                  colSpan={cell.colSpan > 1 ? cell.colSpan : undefined}
                  rowSpan={cell.rowSpan > 1 ? cell.rowSpan : undefined}
                  title={isChanged && otherText ? `${side === "left" ? "수정본" : "원본"}: ${otherText}` : undefined}
                  style={{
                    border: "1px solid var(--color-border)",
                    padding: "0.25em 0.5em",
                    backgroundColor: isChanged
                      ? (side === "left" ? "rgba(239,68,68,0.15)" : "rgba(34,197,94,0.15)")
                      : "transparent",
                    fontWeight: ri === 0 && table.hasHeader ? 600 : "normal",
                    color: "var(--color-text-secondary)",
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

/** 블록 내용 렌더링 */
function BlockContent({ block, cellDiffs, side }: {
  block: DiffBlock | null | undefined;
  cellDiffs?: CellDiff[][];
  side: "left" | "right";
}) {
  if (!block) return null;
  if (block.table) return <MiniTable table={block.table} cellDiffs={cellDiffs} side={side} />;
  return <span style={{ color: "var(--color-text-secondary)" }}>{block.text ?? `[${block.type}]`}</span>;
}

// ── DiffRow 빌더 ──

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
      i++; continue;
    }
    if (d.type === "modified") {
      rows.push({ key: `m-${i}`, leftBlock: d.before ?? null, rightBlock: d.after ?? null, type: "modified", cellDiffs: d.cellDiffs });
      i++; continue;
    }

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

function DiffViewer({ diffs }: { diffs: BlockDiff[] }) {
  const [showUnchanged, setShowUnchanged] = useState(true);

  const { totalChanges, entries } = collectChanges(diffs);
  const allRows = buildRows(diffs);
  const hasUnchanged = allRows.some(r => r.type === "unchanged");

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

  return (
    <div className="card flex-1 flex flex-col overflow-hidden min-h-0">
      {/* 헤더 */}
      <div className="flex items-center justify-between px-5 py-3 shrink-0" style={{ borderBottom: "1px solid var(--color-border)" }}>
        <div className="flex items-center gap-3">
          <span className="font-bold ts-sm" style={{ color: "var(--color-text-primary)" }}>문서 변경 비교</span>
          <span className="px-1.5 py-0.5 rounded ts-2xs" style={{ backgroundColor: "var(--color-accent-subtle)", color: "var(--color-accent)" }}>
            {totalChanges}건 변경
          </span>
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

      {/* 변경 내역 요약 */}
      {entries.length > 0 && (
        <div className="px-5 py-3 shrink-0 space-y-1 overflow-y-auto" style={{ borderBottom: "1px solid var(--color-border)", backgroundColor: "var(--color-bg-tertiary)", maxHeight: 200 }}>
          <p className="ts-2xs font-semibold" style={{ color: "var(--color-text-muted)" }}>변경 내역</p>
          {entries.map((e, i) => (
            <div key={i} className="ts-2xs flex items-start gap-1.5" style={{ color: "var(--color-text-secondary)" }}>
              <span className="px-1 py-0.5 rounded shrink-0 mt-px" style={{ backgroundColor: `color-mix(in srgb, ${KIND_COLOR[e.kind]} 15%, transparent)`, color: KIND_COLOR[e.kind], fontSize: "0.65rem" }}>
                {KIND_LABEL[e.kind]}
              </span>
              {e.kind === "removed" && (
                <span className="break-all" style={{ color: "var(--color-error)", textDecoration: "line-through" }}>{e.before}</span>
              )}
              {e.kind === "added" && (
                <span className="break-all" style={{ color: "var(--color-success)" }}>{e.after}</span>
              )}
              {e.kind !== "removed" && e.kind !== "added" && (
                <span className="break-all">
                  <span style={{ color: "var(--color-error)", textDecoration: "line-through" }}>{e.before}</span>
                  <span style={{ color: "var(--color-text-muted)", margin: "0 0.3em" }}>→</span>
                  <span style={{ color: "var(--color-success)" }}>{e.after}</span>
                </span>
              )}
            </div>
          ))}
          {totalChanges > entries.length && (
            <p className="ts-2xs" style={{ color: "var(--color-text-muted)" }}>…외 {totalChanges - entries.length}건</p>
          )}
        </div>
      )}

      {/* 컬럼 헤더 */}
      <div className="grid grid-cols-2 shrink-0" style={{ borderBottom: "2px solid var(--color-border)" }}>
        <div className="px-5 py-2 ts-xs font-bold text-center" style={{ color: "var(--color-text-primary)", borderRight: "1px solid var(--color-border)" }}>
          원본
        </div>
        <div className="px-5 py-2 ts-xs font-bold text-center" style={{ color: "var(--color-text-primary)" }}>
          수정본
        </div>
      </div>

      {/* 본문 — 배경색 없음, 변경 셀만 하이라이트 */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {totalChanges === 0 ? (
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

            // 모든 행: 배경 없음, 변경은 셀/텍스트 레벨에서만 표시
            const isChanged = row.type !== "unchanged";

            return (
              <div key={row.key} className="grid grid-cols-2" style={{ borderBottom: "1px solid var(--color-border)" }}>
                {/* 원본 */}
                <div className="px-5 py-2.5 ts-sm" style={{
                  borderRight: "1px solid var(--color-border)",
                  borderLeft: isChanged && row.leftBlock ? "3px solid var(--color-error)" : "3px solid transparent",
                }}>
                  {row.leftBlock ? (
                    <BlockContent block={row.leftBlock} cellDiffs={row.cellDiffs} side="left" />
                  ) : row.type === "added" ? (
                    <span className="ts-2xs italic" style={{ color: "var(--color-text-muted)", opacity: 0.4 }}>(추가됨)</span>
                  ) : <span>{"\u00A0"}</span>}
                </div>
                {/* 수정본 */}
                <div className="px-5 py-2.5 ts-sm" style={{
                  borderLeft: isChanged && row.rightBlock ? "3px solid var(--color-success)" : "none",
                }}>
                  {row.rightBlock ? (
                    <BlockContent block={row.rightBlock} cellDiffs={row.cellDiffs} side="right" />
                  ) : row.type === "removed" ? (
                    <span className="ts-2xs italic" style={{ color: "var(--color-text-muted)", opacity: 0.4 }}>(삭제됨)</span>
                  ) : <span>{"\u00A0"}</span>}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ── 목차 패널 ──

interface OutlineItem { level: number; text: string; pageNumber?: number }

function OutlinePanel({ outline }: { outline: OutlineItem[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="card shrink-0" style={{ overflow: "hidden" }}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-4 py-2.5 text-left"
        style={{ backgroundColor: "var(--color-bg-secondary)" }}
      >
        <List size={13} style={{ color: "var(--color-text-muted)" }} />
        <span className="ts-xs font-semibold flex-1" style={{ color: "var(--color-text-primary)" }}>
          목차 <span className="font-normal" style={{ color: "var(--color-text-muted)" }}>({outline.length})</span>
        </span>
        {open ? <ChevronDown size={13} style={{ color: "var(--color-text-muted)" }} /> : <ChevronRight size={13} style={{ color: "var(--color-text-muted)" }} />}
      </button>
      {open && (
        <div className="px-4 pb-3 pt-1 space-y-0.5 max-h-48 overflow-y-auto" style={{ borderTop: "1px solid var(--color-border)" }}>
          {outline.map((item, i) => (
            <div
              key={i}
              className="ts-xs py-0.5 truncate"
              style={{
                paddingLeft: `${(item.level - 1) * 16 + 4}px`,
                color: item.level === 1 ? "var(--color-text-primary)" : "var(--color-text-secondary)",
                fontWeight: item.level === 1 ? 600 : 400,
              }}
            >
              {item.pageNumber != null && (
                <span className="ts-2xs mr-1.5" style={{ color: "var(--color-text-muted)" }}>{item.pageNumber}p</span>
              )}
              {item.text}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── 파싱 경고 패널 ──

function ParseWarningsPanel({ warnings, imageCount }: { warnings: string[]; imageCount?: number }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="card shrink-0" style={{ overflow: "hidden" }}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-4 py-2 text-left"
        style={{ backgroundColor: "color-mix(in srgb, var(--color-warning) 5%, var(--color-bg-secondary))" }}
      >
        <AlertTriangle size={12} style={{ color: "var(--color-warning)" }} />
        <span className="ts-xs font-semibold flex-1" style={{ color: "var(--color-warning)" }}>
          파싱 경고 {warnings.length}건
        </span>
        {imageCount != null && imageCount > 0 && (
          <span className="flex items-center gap-1 ts-2xs mr-2" style={{ color: "var(--color-text-muted)" }}>
            <Image size={11} /> 이미지 {imageCount}개
          </span>
        )}
        {open ? <ChevronDown size={12} style={{ color: "var(--color-text-muted)" }} /> : <ChevronRight size={12} style={{ color: "var(--color-text-muted)" }} />}
      </button>
      {open && (
        <div className="px-4 pb-3 pt-2 space-y-1 max-h-36 overflow-y-auto" style={{ borderTop: "1px solid color-mix(in srgb, var(--color-warning) 20%, transparent)" }}>
          {warnings.map((w, i) => (
            <p key={i} className="ts-2xs" style={{ color: "var(--color-text-secondary)" }}>· {w}</p>
          ))}
        </div>
      )}
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
        style={{ width: "min(860px, calc(100vw - 48px))", maxHeight: "calc(100vh - 64px)" }}
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
          <div className="rounded-md p-4 space-y-1 text-mono ts-2xs" style={{ backgroundColor: "var(--color-bg-primary)" }}>
            {logs.map((log, i) => (
              <div
                key={i}
                className="break-all py-0.5"
                style={{
                  color: log.includes("ERROR") ? "var(--color-error)"
                    : log.includes("완료") ? "var(--color-success)"
                    : "var(--color-text-muted)",
                  borderBottom: "1px solid color-mix(in srgb, var(--color-border) 30%, transparent)",
                  lineHeight: 1.5,
                }}
              >
                <span className="ts-2xs mr-2 select-none" style={{ color: "var(--color-text-muted)", opacity: 0.4 }}>{String(i + 1).padStart(2, " ")}</span>
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

export function ResultStep({ result, files, onReset, onBack, onOpenFolder, onSummarize, isSummarizing, logs, elapsed }: ResultStepProps) {
  const [logsOpen, setLogsOpen] = useState(false);
  if (!result) return null;

  const hasLogs = logs && logs.length > 0;
  const diffData = extractDiff(result.data);
  const inspectData = !diffData && isInspectData(result.data) ? result.data : null;
  const markdown = diffData || inspectData ? null : extractMarkdown(result.data);

  // convert/ocr 결과에서 추가 데이터 추출
  const d = result.data as Record<string, unknown> | undefined;
  const outline = markdown && Array.isArray(d?.outline) && (d!.outline as unknown[]).length > 1
    ? (d!.outline as OutlineItem[])
    : null;
  const metadata = markdown ? d?.metadata as Record<string, unknown> | undefined : undefined;
  const parseWarnings = markdown && Array.isArray(d?.warnings) && (d!.warnings as unknown[]).length > 0
    ? (d!.warnings as string[])
    : null;
  const imageCount = markdown && typeof d?.image_count === "number" ? d.image_count : 0;

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
            {files.length > 0 && (
              <p className="ts-2xs mt-1 truncate" style={{ color: "var(--color-text-muted)" }}>
                {files.length === 1
                  ? files[0].name
                  : files.length === 2
                    ? `${files[0].name} ↔ ${files[1].name}`
                    : `${files[0].name} 외 ${files.length - 1}개`}
              </p>
            )}
            {metadata && (
              <p className="ts-2xs mt-0.5" style={{ color: "var(--color-text-muted)" }}>
                {[
                  metadata.title as string | undefined,
                  metadata.author as string | undefined,
                  metadata.createdAt ? new Date(metadata.createdAt as string).toLocaleDateString("ko-KR") : null,
                  typeof metadata.pageCount === "number" ? `${metadata.pageCount}p` : null,
                  metadata.version as string | undefined,
                ].filter(Boolean).join(" · ")}
              </p>
            )}
            {result.warnings.length > 0 && (
              <p className="ts-2xs mt-0.5" style={{ color: "var(--color-warning)" }}>
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
            <Tooltip content="결과 파일이 저장된 폴더를 엽니다">
            <Button variant="secondary" size="sm" onClick={onOpenFolder}>
              <span className="flex items-center gap-1.5"><FolderOpen size={14} /> 폴더 열기</span>
            </Button>
            </Tooltip>
            <Tooltip content="파일 유지하고 다른 작업 선택">
            <Button variant="ghost" size="sm" onClick={onBack}>
              <span className="flex items-center gap-1.5"><ArrowLeft size={14} /> 다른 작업</span>
            </Button>
            </Tooltip>
            <Tooltip content="모든 파일 초기화하고 처음부터">
            <Button variant="ghost" size="sm" onClick={onReset}>
              <span className="flex items-center gap-1.5"><RotateCcw size={14} /> 새로 시작</span>
            </Button>
            </Tooltip>
          </div>
        </div>
      </div>

      {/* Side-by-side diff 뷰 */}
      {diffData && (
        <DiffViewer diffs={diffData.diffs} />
      )}

      {/* K팀장 검토 뷰어 */}
      {inspectData && (
        <div className="card flex-1 overflow-hidden min-h-0 flex flex-col">
          <InspectViewer data={inspectData} />
        </div>
      )}

      {/* 마크다운 결과 — convert, ocr, extract_tables, summarize, form_extract */}
      {!diffData && !inspectData && markdown && (
        <>
          {outline && <OutlinePanel outline={outline} />}
          <MarkdownViewer
            markdown={markdown}
            onSummarize={onSummarize ? () => onSummarize(markdown) : undefined}
            isSummarizing={isSummarizing}
            fillHeight
          />
          {parseWarnings && <ParseWarningsPanel warnings={parseWarnings} imageCount={imageCount} />}
        </>
      )}

      {/* 비-마크다운 결과 — merge_files, generate_hwpx */}
      {!diffData && !inspectData && !markdown && result.data != null && (
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
