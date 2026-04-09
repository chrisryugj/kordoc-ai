import { useState, useEffect, useCallback } from "react";
import {
  Merge, Scissors, FileOutput, FileText, Check, X, FolderOpen,
} from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { Button } from "../ui/Button";
import { Badge, getFileTypeBadgeVariant } from "../ui/Badge";
import type {
  ImportedFile, PdfUtilsOptions, PdfUtilMode, PdfExtractMode, PdfSplitMode,
} from "../../types/pipeline";

interface PdfToolsDialogProps {
  files: ImportedFile[];
  sidecarCall: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
  onConfirm: (options: PdfUtilsOptions) => void;
  onCancel: () => void;
}

const MODES: { id: PdfUtilMode; label: string; desc: string; icon: React.ReactNode; color: string; minFiles: number }[] = [
  { id: "merge", label: "병합", desc: "여러 PDF → 하나", icon: <Merge size={16} />, color: "#D97706", minFiles: 2 },
  { id: "split", label: "분할", desc: "하나 → 여러 개", icon: <Scissors size={16} />, color: "#7C3AED", minFiles: 1 },
  { id: "extract", label: "추출", desc: "페이지 넣기/빼기", icon: <FileOutput size={16} />, color: "#059669", minFiles: 1 },
];

// ── 페이지 선택 그리드 ──

function PageGrid({ pageCount, selected, onToggle, onSelectAll, onDeselectAll, color }: {
  pageCount: number;
  selected: Set<number>;
  onToggle: (page: number) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  color: string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="ts-2xs font-semibold" style={{ color: "var(--color-text-muted)" }}>
          페이지 선택 <span className="font-normal">({selected.size}/{pageCount})</span>
        </p>
        <div className="flex gap-1.5">
          <button
            onClick={onSelectAll}
            className="ts-2xs px-2 py-0.5 rounded font-medium transition-colors"
            style={{ color, backgroundColor: `color-mix(in srgb, ${color} 8%, transparent)` }}
          >
            전체 선택
          </button>
          <button
            onClick={onDeselectAll}
            className="ts-2xs px-2 py-0.5 rounded font-medium transition-colors"
            style={{ color: "var(--color-text-muted)", backgroundColor: "var(--color-bg-tertiary)" }}
          >
            전체 해제
          </button>
        </div>
      </div>
      <div
        className="grid gap-1.5 overflow-y-auto pr-1"
        style={{
          gridTemplateColumns: "repeat(auto-fill, minmax(36px, 1fr))",
          maxHeight: "160px",
        }}
      >
        {Array.from({ length: pageCount }, (_, i) => {
          const page = i + 1;
          const isSelected = selected.has(page);
          return (
            <button
              key={page}
              onClick={() => onToggle(page)}
              className="relative flex items-center justify-center rounded-md ts-2xs font-semibold transition-all"
              style={{
                height: "32px",
                backgroundColor: isSelected ? `color-mix(in srgb, ${color} 15%, transparent)` : "var(--color-bg-tertiary)",
                border: `1.5px solid ${isSelected ? color : "var(--color-border-subtle)"}`,
                color: isSelected ? color : "var(--color-text-muted)",
                cursor: "pointer",
              }}
            >
              {page}
              {isSelected && (
                <div
                  className="absolute top-0.5 right-0.5 w-2.5 h-2.5 rounded-full flex items-center justify-center"
                  style={{ backgroundColor: color }}
                >
                  <Check size={7} style={{ color: "white" }} />
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── 메인 다이얼로그 ──

export function PdfToolsDialog({ files, sidecarCall, onConfirm, onCancel }: PdfToolsDialogProps) {
  const pdfFiles = files.filter((f) => f.type === "pdf");
  const [mode, setMode] = useState<PdfUtilMode | null>(null);
  const [targetIdx, setTargetIdx] = useState(0);
  const [splitMode, setSplitMode] = useState<PdfSplitMode>("each");
  const [extractMode, setExtractMode] = useState<PdfExtractMode>("include");

  // 내보내기 폴더
  const [outputDir, setOutputDir] = useState<string>("");

  // 페이지 선택 상태
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [pageLoading, setPageLoading] = useState(false);
  const [selectedPages, setSelectedPages] = useState<Set<number>>(new Set());

  const targetFile = pdfFiles[targetIdx];

  // 파일 or 모드 변경 시 페이지 수 조회
  useEffect(() => {
    if (!targetFile || mode === "merge") {
      setPageCount(null);
      setSelectedPages(new Set());
      return;
    }
    let cancelled = false;
    setPageLoading(true);
    setPageCount(null);
    setSelectedPages(new Set());
    sidecarCall("pdf_page_count", { file: targetFile.path })
      .then((res) => {
        if (cancelled) return;
        const r = res as { page_count: number };
        setPageCount(r.page_count);
      })
      .catch(() => { if (!cancelled) setPageCount(null); })
      .finally(() => { if (!cancelled) setPageLoading(false); });
    return () => { cancelled = true; };
  }, [targetFile?.path, mode, sidecarCall]);

  const togglePage = useCallback((page: number) => {
    setSelectedPages((prev) => {
      const next = new Set(prev);
      if (next.has(page)) next.delete(page);
      else next.add(page);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    if (!pageCount) return;
    setSelectedPages(new Set(Array.from({ length: pageCount }, (_, i) => i + 1)));
  }, [pageCount]);

  const deselectAll = useCallback(() => setSelectedPages(new Set()), []);

  // 선택된 페이지를 "1,3,5-7" 형식으로 변환
  const selectedToRangeStr = useCallback((): string => {
    const sorted = [...selectedPages].sort((a, b) => a - b);
    if (sorted.length === 0) return "";
    const ranges: string[] = [];
    let start = sorted[0], end = sorted[0];
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i] === end + 1) { end = sorted[i]; }
      else { ranges.push(start === end ? `${start}` : `${start}-${end}`); start = sorted[i]; end = sorted[i]; }
    }
    ranges.push(start === end ? `${start}` : `${start}-${end}`);
    return ranges.join(",");
  }, [selectedPages]);

  const canConfirm = (() => {
    if (!mode) return false;
    if (mode === "merge") return pdfFiles.length >= 2;
    if (mode === "split") return !!targetFile && (splitMode === "each" || selectedPages.size > 0);
    if (mode === "extract") return !!targetFile && selectedPages.size > 0;
    return false;
  })();

  const handleBrowseOutputDir = useCallback(async () => {
    try {
      const selected = await open({ directory: true, multiple: false });
      if (!selected) return;
      setOutputDir(Array.isArray(selected) ? selected[0] : selected);
    } catch { /* 취소 */ }
  }, []);

  const handleConfirm = () => {
    if (!mode) return;
    const opts: PdfUtilsOptions = { mode };
    if (mode !== "merge") opts.targetFile = targetFile;
    if (mode === "split") {
      opts.splitMode = splitMode;
      if (splitMode === "range") opts.pages = selectedToRangeStr();
    }
    if (mode === "extract") {
      opts.extractMode = extractMode;
      opts.pages = selectedToRangeStr();
    }
    if (outputDir) opts.outputDir = outputDir;
    onConfirm(opts);
  };

  // 모드별 색상
  const activeColor = mode === "merge" ? "#D97706" : mode === "split" ? "#7C3AED" : "#059669";

  // extract 결과 미리보기 텍스트
  const previewText = (() => {
    if (mode !== "extract" || !pageCount || selectedPages.size === 0) return null;
    if (extractMode === "include") {
      return `${selectedPages.size}페이지를 뽑아서 새 PDF로 만듭니다`;
    }
    const remaining = pageCount - selectedPages.size;
    if (remaining <= 0) return "모든 페이지가 제외됩니다 — 최소 1페이지 남겨주세요";
    return `${selectedPages.size}페이지를 빼고 ${remaining}페이지로 새 PDF를 만듭니다`;
  })();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: "var(--color-backdrop)" }}
      onClick={onCancel}
    >
      <div
        className="card p-6 mx-4 space-y-4"
        style={{ maxWidth: "32rem", width: "100%" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center"
            style={{ backgroundColor: "color-mix(in srgb, #EF4444 12%, transparent)" }}
          >
            <FileText size={20} style={{ color: "#EF4444" }} />
          </div>
          <div>
            <h3 className="ts-sm font-bold" style={{ color: "var(--color-text-primary)" }}>
              PDF 도구
            </h3>
            <p className="ts-2xs" style={{ color: "var(--color-text-muted)" }}>
              PDF {pdfFiles.length}개 선택됨
            </p>
          </div>
        </div>

        {/* 모드 선택 */}
        <div className="space-y-2">
          <p className="ts-2xs font-semibold" style={{ color: "var(--color-text-muted)" }}>작업 선택</p>
          <div className="grid grid-cols-3 gap-2">
            {MODES.map((m) => {
              const disabled = pdfFiles.length < m.minFiles;
              const selected = mode === m.id;
              return (
                <button
                  key={m.id}
                  disabled={disabled}
                  onClick={() => setMode(m.id)}
                  className="flex flex-col items-center gap-1.5 p-3 rounded-lg transition-all"
                  style={{
                    backgroundColor: selected ? `color-mix(in srgb, ${m.color} 10%, transparent)` : "var(--color-bg-tertiary)",
                    border: `1.5px solid ${selected ? m.color : "var(--color-border-subtle)"}`,
                    opacity: disabled ? 0.4 : 1,
                    cursor: disabled ? "default" : "pointer",
                  }}
                >
                  <div style={{ color: selected ? m.color : "var(--color-text-muted)" }}>{m.icon}</div>
                  <div className="ts-2xs font-semibold" style={{ color: "var(--color-text-primary)" }}>{m.label}</div>
                  <div className="ts-2xs" style={{ color: "var(--color-text-muted)", fontSize: "0.675rem" }}>
                    {disabled ? `PDF ${m.minFiles}개 이상` : m.desc}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* 분할/추출: 대상 파일 선택 */}
        {mode && mode !== "merge" && pdfFiles.length > 1 && (
          <div className="space-y-2">
            <p className="ts-2xs font-semibold" style={{ color: "var(--color-text-muted)" }}>대상 파일</p>
            <div className="space-y-1 max-h-24 overflow-y-auto">
              {pdfFiles.map((f, i) => (
                <button
                  key={f.path}
                  onClick={() => setTargetIdx(i)}
                  className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-left transition-all"
                  style={{
                    backgroundColor: targetIdx === i ? "var(--color-accent-subtle)" : "var(--color-bg-tertiary)",
                    border: `1px solid ${targetIdx === i ? "var(--color-accent)" : "transparent"}`,
                  }}
                >
                  <Badge variant={getFileTypeBadgeVariant(f.name)}>PDF</Badge>
                  <span className="ts-xs truncate" style={{ color: "var(--color-text-primary)" }}>{f.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 분할 옵션 */}
        {mode === "split" && (
          <div className="space-y-2">
            <p className="ts-2xs font-semibold" style={{ color: "var(--color-text-muted)" }}>분할 방식</p>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setSplitMode("each")}
                className="p-2.5 rounded-lg text-left transition-all"
                style={{
                  backgroundColor: splitMode === "each" ? "color-mix(in srgb, #7C3AED 8%, transparent)" : "var(--color-bg-tertiary)",
                  border: `1.5px solid ${splitMode === "each" ? "#7C3AED" : "var(--color-border-subtle)"}`,
                }}
              >
                <div className="ts-2xs font-semibold" style={{ color: "var(--color-text-primary)" }}>1페이지씩</div>
                <div className="ts-2xs" style={{ color: "var(--color-text-muted)", fontSize: "0.675rem" }}>
                  각 페이지를 별도 PDF로
                </div>
              </button>
              <button
                onClick={() => setSplitMode("range")}
                className="p-2.5 rounded-lg text-left transition-all"
                style={{
                  backgroundColor: splitMode === "range" ? "color-mix(in srgb, #7C3AED 8%, transparent)" : "var(--color-bg-tertiary)",
                  border: `1.5px solid ${splitMode === "range" ? "#7C3AED" : "var(--color-border-subtle)"}`,
                }}
              >
                <div className="ts-2xs font-semibold" style={{ color: "var(--color-text-primary)" }}>선택 분할</div>
                <div className="ts-2xs" style={{ color: "var(--color-text-muted)", fontSize: "0.675rem" }}>
                  선택한 페이지만 분리
                </div>
              </button>
            </div>
          </div>
        )}

        {/* 추출 옵션 */}
        {mode === "extract" && (
          <div className="space-y-2">
            <p className="ts-2xs font-semibold" style={{ color: "var(--color-text-muted)" }}>추출 방식</p>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setExtractMode("include")}
                className="p-2.5 rounded-lg text-left transition-all"
                style={{
                  backgroundColor: extractMode === "include" ? "color-mix(in srgb, #059669 8%, transparent)" : "var(--color-bg-tertiary)",
                  border: `1.5px solid ${extractMode === "include" ? "#059669" : "var(--color-border-subtle)"}`,
                }}
              >
                <div className="ts-2xs font-semibold" style={{ color: "var(--color-text-primary)" }}>포함</div>
                <div className="ts-2xs" style={{ color: "var(--color-text-muted)", fontSize: "0.675rem" }}>
                  선택 페이지만 추출
                </div>
              </button>
              <button
                onClick={() => setExtractMode("exclude")}
                className="p-2.5 rounded-lg text-left transition-all"
                style={{
                  backgroundColor: extractMode === "exclude" ? "color-mix(in srgb, #059669 8%, transparent)" : "var(--color-bg-tertiary)",
                  border: `1.5px solid ${extractMode === "exclude" ? "#059669" : "var(--color-border-subtle)"}`,
                }}
              >
                <div className="ts-2xs font-semibold" style={{ color: "var(--color-text-primary)" }}>제외</div>
                <div className="ts-2xs" style={{ color: "var(--color-text-muted)", fontSize: "0.675rem" }}>
                  선택 페이지 빼고 나머지
                </div>
              </button>
            </div>
          </div>
        )}

        {/* 페이지 선택 그리드 (split range / extract) */}
        {mode && mode !== "merge" && (mode === "extract" || (mode === "split" && splitMode === "range")) && (
          pageLoading ? (
            <div className="flex items-center justify-center py-6 gap-2">
              <div className="w-4 h-4 border-2 rounded-full animate-spin" style={{ borderColor: activeColor, borderTopColor: "transparent" }} />
              <span className="ts-2xs" style={{ color: "var(--color-text-muted)" }}>페이지 정보 로딩 중...</span>
            </div>
          ) : pageCount ? (
            <PageGrid
              pageCount={pageCount}
              selected={selectedPages}
              onToggle={togglePage}
              onSelectAll={selectAll}
              onDeselectAll={deselectAll}
              color={activeColor}
            />
          ) : (
            <div className="flex items-center justify-center py-4 gap-2">
              <X size={14} style={{ color: "var(--color-error)" }} />
              <span className="ts-2xs" style={{ color: "var(--color-error)" }}>페이지 정보를 가져올 수 없습니다</span>
            </div>
          )
        )}

        {/* 미리보기 텍스트 */}
        {previewText && (
          <p className="ts-2xs px-3 py-2 rounded-md" style={{
            backgroundColor: extractMode === "exclude" && pageCount && pageCount - selectedPages.size <= 0
              ? "var(--color-error-subtle, color-mix(in srgb, var(--color-error) 8%, transparent))"
              : `color-mix(in srgb, ${activeColor} 6%, transparent)`,
            color: extractMode === "exclude" && pageCount && pageCount - selectedPages.size <= 0
              ? "var(--color-error)"
              : activeColor,
          }}>
            {previewText}
          </p>
        )}

        {/* 내보내기 폴더 */}
        {mode && (
          <div className="space-y-1.5">
            <p className="ts-2xs font-semibold" style={{ color: "var(--color-text-muted)" }}>내보내기 폴더</p>
            <div className="flex items-center gap-2">
              <button
                onClick={handleBrowseOutputDir}
                className="group flex-1 flex items-center gap-2 px-3 py-2 rounded-lg text-left transition-all cursor-pointer"
                style={{ backgroundColor: "var(--color-bg-tertiary)" }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--color-bg-secondary)"; e.currentTarget.style.boxShadow = `0 0 0 1px ${activeColor}40`; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "var(--color-bg-tertiary)"; e.currentTarget.style.boxShadow = "none"; }}
              >
                <FolderOpen size={13} style={{ color: outputDir ? activeColor : "var(--color-text-muted)" }} />
                <span className="ts-2xs truncate" style={{ color: outputDir ? "var(--color-text-primary)" : "var(--color-text-muted)" }}>
                  {outputDir ? outputDir.split(/[/\\]/).slice(-2).join("\\") : "원본 파일 위치"}
                </span>
                <span className="ts-2xs font-medium ml-auto shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: activeColor }}>
                  변경
                </span>
              </button>
              {outputDir && (
                <button
                  onClick={() => setOutputDir("")}
                  className="p-1 rounded shrink-0 transition-colors"
                  style={{ color: "var(--color-text-muted)" }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = "var(--color-error)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = "var(--color-text-muted)"; }}
                  title="초기화"
                >
                  <X size={13} />
                </button>
              )}
            </div>
          </div>
        )}

        {/* 버튼 */}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" size="sm" onClick={onCancel}>취소</Button>
          <Button
            size="sm"
            onClick={handleConfirm}
            disabled={!canConfirm || (mode === "extract" && extractMode === "exclude" && pageCount != null && pageCount - selectedPages.size <= 0)}
          >
            <span className="flex items-center gap-1.5">
              {mode === "merge" && <><Merge size={14} /> 병합</>}
              {mode === "split" && <><Scissors size={14} /> 분할</>}
              {mode === "extract" && <><FileOutput size={14} /> 추출</>}
              {!mode && "작업 선택"}
            </span>
          </Button>
        </div>
      </div>
    </div>
  );
}
