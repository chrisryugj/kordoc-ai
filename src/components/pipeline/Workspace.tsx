import { useCallback, useState, useEffect, useRef } from "react";
import {
  Upload, FileText, X, FolderOpen, Trash2, Copy, ExternalLink,
  Scan, Sparkles, GitCompareArrows,
  Table, ClipboardList, FileOutput, Merge, ShieldCheck, AlertTriangle, Wifi,
  ArrowRight, Scissors, PenLine,
} from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { Button } from "../ui/Button";
import { Badge, getFileTypeBadgeVariant } from "../ui/Badge";
import { Tooltip } from "../ui/Tooltip";
import { ContextMenu } from "../ui/ContextMenu";
import type { ImportedFile, PipelineAction, MergeMode, SummarizeLength, SummarizeStyle, SummarizeOptions, FormExtractOptions, FieldCandidate, ConvertOptions, PdfUtilsOptions } from "../../types/pipeline";
import { detectFileType, SUPPORTED_EXT_RE } from "../../utils/fileType";
import { MergeOrderDialog } from "./MergeOrderDialog";
import { PdfToolsDialog } from "./PdfToolsDialog";
import { FormFieldSelector } from "./FormFieldSelector";
import { FillWizard } from "../fill/FillWizard";
import { Plug } from "lucide-react";

// ── Action 정의 ──

interface ActionDef {
  action: PipelineAction;
  label: string;
  desc: string;
  icon: React.ReactNode;
  color: string;
  needsApi: boolean;
  minFiles: number;
  maxFiles: number;
  fileTypes: string[];
}

const ACTIONS: ActionDef[] = [
  { action: "convert", label: "마크다운 변환", desc: "HWP/PDF → 마크다운", icon: <FileText size={18} />, color: "var(--color-accent)", needsApi: false, minFiles: 1, maxFiles: 0, fileTypes: ["hwp", "hwpx", "pdf"] },
  { action: "extract_tables", label: "표 추출", desc: "문서에서 표만 추출", icon: <Table size={18} />, color: "#7C3AED", needsApi: false, minFiles: 1, maxFiles: 1, fileTypes: [] },
  { action: "form_extract", label: "양식 추출", desc: "문서에서 필드 배치 추출", icon: <ClipboardList size={18} />, color: "#2563EB", needsApi: false, minFiles: 1, maxFiles: 0, fileTypes: [] },
  { action: "form_fill", label: "양식 채우기", desc: "자동 폼 + 미리보기 — 서식 그대로", icon: <PenLine size={18} />, color: "#0891B2", needsApi: false, minFiles: 1, maxFiles: 1, fileTypes: ["hwpx"] },
  { action: "diff", label: "문서 비교", desc: "두 문서 차이점 비교", icon: <GitCompareArrows size={18} />, color: "#059669", needsApi: false, minFiles: 2, maxFiles: 2, fileTypes: [] },
  { action: "merge_files", label: "문서 병합", desc: "여러 문서를 하나로", icon: <Merge size={18} />, color: "#D97706", needsApi: false, minFiles: 2, maxFiles: 0, fileTypes: [] },
  { action: "pdf_utils", label: "PDF 도구", desc: "병합 · 분할 · 추출", icon: <Scissors size={18} />, color: "#EF4444", needsApi: false, minFiles: 1, maxFiles: 0, fileTypes: ["pdf"] },
  { action: "generate_hwpx", label: "HWPX 생성", desc: "마크다운 → 한글 문서", icon: <FileOutput size={18} />, color: "#059669", needsApi: false, minFiles: 1, maxFiles: 1, fileTypes: ["txt", "md"] },
  { action: "ocr", label: "AI OCR", desc: "이미지/PDF 텍스트 인식", icon: <Scan size={18} />, color: "#7C3AED", needsApi: true, minFiles: 1, maxFiles: 1, fileTypes: ["pdf", "png", "jpg", "gif", "webp"] },
  { action: "summarize", label: "AI 요약", desc: "문서 핵심 내용 요약", icon: <Sparkles size={18} />, color: "#2563EB", needsApi: true, minFiles: 1, maxFiles: 1, fileTypes: [] },
  { action: "inspect_document", label: "K팀장 검토", desc: "논리 구조·숫자·날짜·오탈자 전체 정합성 검사", icon: <ShieldCheck size={18} />, color: "#DC2626", needsApi: true, minFiles: 1, maxFiles: 1, fileTypes: [] },
];

function getAvailability(a: ActionDef, files: ImportedFile[], apiKeySet: boolean): { ok: boolean; reason?: string } {
  if (a.needsApi && !apiKeySet) return { ok: false, reason: "API 키 필요" };
  if (files.length < a.minFiles) return { ok: false, reason: files.length === 0 ? undefined : `파일 ${a.minFiles}개 이상 필요` };
  if (a.maxFiles > 0 && files.length > a.maxFiles) return { ok: false, reason: `파일 ${a.maxFiles}개만 선택` };
  if (a.fileTypes.length > 0) {
    const supported = files.every((f) => a.fileTypes.includes(f.type));
    if (!supported) return { ok: false, reason: `${a.fileTypes.join("/")} 파일만` };
  }
  return { ok: true };
}

function formatSize(bytes: number): string {
  if (bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// ── ActionCard ──

function ActionCard({ a, ok, reason, needsFiles, onClick }: {
  a: ActionDef; ok: boolean; reason?: string; needsFiles: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={() => ok && onClick()}
      disabled={!ok}
      className="group flex items-center gap-2.5 p-2.5 rounded-lg text-left transition-all"
      style={{
        backgroundColor: ok ? "var(--color-bg-secondary)" : "var(--color-bg-tertiary)",
        opacity: ok ? 1 : needsFiles ? 0.55 : 0.4,
        border: `1px solid ${ok ? "var(--color-border)" : "var(--color-border-subtle)"}`,
        cursor: ok ? "pointer" : "default",
      }}
      title={reason}
      onMouseEnter={(e) => { if (ok) e.currentTarget.style.borderColor = a.color; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = ok ? "var(--color-border)" : "var(--color-border-subtle)"; }}
    >
      <div
        className="w-8 h-8 rounded-md flex items-center justify-center shrink-0"
        style={{ backgroundColor: `color-mix(in srgb, ${a.color} ${ok ? "12%" : "5%"}, transparent)`, color: ok ? a.color : "var(--color-text-muted)" }}
      >
        {a.icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="ts-xs font-semibold truncate" style={{ color: ok ? "var(--color-text-primary)" : "var(--color-text-muted)" }}>
          {a.label}
        </div>
        <div className="ts-2xs mt-0.5" style={{ color: reason ? "var(--color-error)" : "var(--color-text-muted)" }}>
          {reason || a.desc}
        </div>
      </div>
      {ok && (
        <ArrowRight size={14} className="shrink-0 opacity-0 group-hover:opacity-60 transition-opacity" style={{ color: a.color }} />
      )}
    </button>
  );
}

// ── Props ──

interface WorkspaceProps {
  files: ImportedFile[];
  onFilesChange: (files: ImportedFile[]) => void;
  onAction: (action: PipelineAction, actionOptions?: { outputDir?: string; mergeMode?: MergeMode; orderedFiles?: ImportedFile[]; summarizeOptions?: SummarizeOptions; formExtractOptions?: FormExtractOptions; convertOptions?: ConvertOptions; pdfUtilsOptions?: PdfUtilsOptions }) => void;
  sidecarCall: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
  onBrowse: () => void;
  onBrowseFolder: () => void;
  apiKeySet: boolean;
  aiMode: "online" | "offline";
  onToggleMode: () => void;
  onOpenSettings: () => void;
  sidecarReady: boolean;
  sidecarError?: string;
  showToast: (msg: string, type: "success" | "error" | "info" | "loading") => void;
  onOpenMcpSetup: () => void;
  outputDir: string;
  onOutputDirChange: (dir: string) => void;
}

export function Workspace({
  files, onFilesChange, onAction, onBrowse, onBrowseFolder,
  apiKeySet, aiMode, onToggleMode, onOpenSettings, sidecarReady, sidecarError, sidecarCall, showToast,
  onOpenMcpSetup, outputDir, onOutputDirChange,
}: WorkspaceProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; path: string } | null>(null);
  const [modeConfirm, setModeConfirm] = useState<{ action: PipelineAction; label: string } | null>(null);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [summarizeOpen, setSummarizeOpen] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);
  const [formFieldOpen, setFormFieldOpen] = useState(false);
  const [fillWizardOpen, setFillWizardOpen] = useState(false);
  const [pdfToolsOpen, setPdfToolsOpen] = useState(false);
  const [formCandidates, setFormCandidates] = useState<FieldCandidate[]>([]);
  const [formCandidatesLoading, setFormCandidatesLoading] = useState(false);
  const pendingActionRef = useRef<PipelineAction | null>(null);

  const handleBrowseOutputDir = useCallback(async () => {
    try {
      const selected = await open({ directory: true, multiple: false });
      if (!selected) return;
      onOutputDirChange(Array.isArray(selected) ? selected[0] : selected);
    } catch { /* 취소 */ }
  }, [onOutputDirChange]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const droppedFiles = Array.from(e.dataTransfer.files);
    if (droppedFiles.length === 0 || '__TAURI_INTERNALS__' in window) return;
    const existingPaths = new Set(files.map((f) => f.path));
    const newFiles: ImportedFile[] = droppedFiles
      .filter((f) => SUPPORTED_EXT_RE.test(f.name))
      .map((f) => ({ path: (f as File & { path?: string }).path ?? f.name, name: f.name, size: f.size, type: detectFileType(f.name) }))
      .filter((f) => !existingPaths.has(f.path));
    if (newFiles.length > 0) onFilesChange([...files, ...newFiles]);
  }, [files, onFilesChange]);

  const removeFile = (path: string) => onFilesChange(files.filter((f) => f.path !== path));

  /** 동일 네이티브 포맷 감지 (hwp/hwpx/xlsx/docx/pdf, hwp+hwpx 혼합도 허용) */
  const detectUniformFormat = useCallback((f: ImportedFile[]): string | null => {
    if (f.length < 2) return null;
    const nativeTypes = new Set(["hwp", "hwpx", "xlsx", "docx", "pdf"]);
    const types = new Set(f.map((file) => file.type));
    // hwp+hwpx 혼합 → hwpx로 통일 (한/글 COM이 둘 다 처리)
    const isHwpMix = types.size <= 2 && [...types].every((t) => t === "hwp" || t === "hwpx");
    if (isHwpMix) return "hwpx";
    const first = f[0].type;
    if (!nativeTypes.has(first)) return null;
    return f.every((file) => file.type === first) ? first : null;
  }, []);

  const handleActionClick = useCallback((action: PipelineAction) => {
    const def = ACTIONS.find((a) => a.action === action);
    if (def?.needsApi && aiMode === "offline") {
      pendingActionRef.current = action;
      setModeConfirm({ action, label: def.label });
      return;
    }
    // convert: 페이지 범위 옵션 다이얼로그
    if (action === "convert") {
      setConvertOpen(true);
      return;
    }
    // merge: 항상 순서/방식 선택 다이얼로그 표시
    if (action === "merge_files") {
      setMergeOpen(true);
      return;
    }
    // summarize: 옵션 선택 다이얼로그
    if (action === "summarize") {
      setSummarizeOpen(true);
      return;
    }
    // pdf_utils: PDF 도구 다이얼로그
    if (action === "pdf_utils") {
      setPdfToolsOpen(true);
      return;
    }
    // form_fill: 양식 채우기 작업대 (자체 사이드카 호출 — 파이프라인 비경유)
    if (action === "form_fill") {
      setFillWizardOpen(true);
      return;
    }
    // form_extract: 필드 후보 fetch → 선택 다이얼로그
    if (action === "form_extract") {
      setFormFieldOpen(true);
      setFormCandidatesLoading(true);
      setFormCandidates([]);
      sidecarCall("form_extract_candidates", { input_path: files[0].path })
        .then((res) => {
          const r = res as { candidates?: FieldCandidate[] };
          setFormCandidates(r.candidates ?? []);
        })
        .catch(() => setFormCandidates([]))
        .finally(() => setFormCandidatesLoading(false));
      return;
    }
    onAction(action);
  }, [aiMode, onAction, files, detectUniformFormat]);

  const handleConfirmSwitch = useCallback(() => {
    onToggleMode();
    const action = pendingActionRef.current;
    setModeConfirm(null);
    pendingActionRef.current = null;
    if (action) {
      if (action === "summarize") {
        setTimeout(() => setSummarizeOpen(true), 50);
      } else {
        setTimeout(() => onAction(action), 50);
      }
    }
  }, [onToggleMode, onAction]);

  const hasFiles = files.length > 0;
  const localActions = ACTIONS.filter((a) => !a.needsApi);
  const aiActions = ACTIONS.filter((a) => a.needsApi);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="workspace-header sidebar-header px-8 flex-col justify-center">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="workspace-header-bar" />
            <div>
              <h2 className="font-bold text-display" style={{ color: "var(--color-text-primary)", letterSpacing: "-0.02em", fontSize: "1.125rem" }}>
                모든 문서, 하나로 읽다
              </h2>
              <p className="ts-xs mt-0.5" style={{ color: "var(--color-text-muted)", letterSpacing: "0.02em" }}>
                HWP · HWPX · PDF · XLSX · DOCX · TXT — 변환 · 추출 · 비교 · AI 분석
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {!apiKeySet && (
              <button
                onClick={onOpenSettings}
                className="flex items-center gap-1.5 ts-2xs px-2.5 py-1 rounded-md font-semibold"
                style={{ color: "var(--color-warning)", backgroundColor: "var(--color-warning-subtle)", transition: "all var(--transition-fast)" }}
                onMouseEnter={e => { e.currentTarget.style.boxShadow = "0 2px 8px rgba(234,179,8,0.2)"; e.currentTarget.style.filter = "brightness(1.08)"; }}
                onMouseLeave={e => { e.currentTarget.style.boxShadow = "none"; e.currentTarget.style.filter = "none"; }}
              >
                <AlertTriangle size={12} /> API 키 설정
              </button>
            )}
            {sidecarError ? (
              <div className="flex items-center gap-1.5 ts-2xs" style={{ color: "var(--color-error)" }}>
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: "var(--color-error)" }} />
                엔진 오류
              </div>
            ) : !sidecarReady ? (
              <div className="flex items-center gap-1.5 ts-2xs" style={{ color: "var(--color-text-muted)" }}>
                <div className="w-3 h-3 border-2 rounded-full animate-spin" style={{ borderColor: "var(--color-warning)", borderTopColor: "transparent" }} />
                시작 중...
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 pb-6 pt-5 content-area">
        <div style={{ maxWidth: 820, margin: "0 auto" }}>
        {/* ── 1. 파일 영역 ── */}
        {!hasFiles ? (
          /* 파일 없음: 드래그 영역 + 인라인 버튼 */
          <div
            className={`drop-zone ${isDragOver ? "drop-zone--active" : ""} flex flex-col items-center justify-center gap-2 py-7 mb-5 cursor-pointer`}
            onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={handleDrop}
            onContextMenu={(e) => e.preventDefault()}
            onClick={(e) => { if (!(e.target as HTMLElement).closest(".browse-btn")) onBrowse(); }}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onBrowse(); } }}
          >
            <div className="drop-zone-icon w-10 h-10 rounded-xl flex items-center justify-center">
              <Upload size={20} />
            </div>
            <div className="text-center">
              <p className="ts-sm font-semibold" style={{ color: "var(--color-text-primary)" }}>
                파일을 여기에 드래그
              </p>
              <div className="flex items-center justify-center gap-1 mt-1">
                <Badge variant="hwp">HWP</Badge>
                <Badge variant="hwp">HWPX</Badge>
                <Badge variant="pdf">PDF</Badge>
                <Badge variant="xlsx">XLSX</Badge>
                <Badge variant="txt">DOCX</Badge>
                <Badge variant="txt">TXT</Badge>
              </div>
            </div>
            <div className="flex items-center gap-2 mt-1">
              <button onClick={(e) => { e.stopPropagation(); onBrowse(); }} className="browse-btn flex items-center gap-1.5 ts-xs font-medium px-3 py-1.5 rounded-lg">
                <FileText size={14} style={{ color: "var(--color-accent)" }} /> 파일 선택
              </button>
              <button onClick={(e) => { e.stopPropagation(); onBrowseFolder(); }} className="browse-btn flex items-center gap-1.5 ts-xs font-medium px-3 py-1.5 rounded-lg">
                <FolderOpen size={14} style={{ color: "var(--color-warning)" }} /> 폴더 선택
              </button>
            </div>
          </div>
        ) : (
          /* 파일 있음: 컴팩트 드롭존 + 파일 리스트 */
          <div className="mb-6">
            <div
              className={`drop-zone ${isDragOver ? "drop-zone--active" : ""} flex items-center gap-4 px-4 py-3 cursor-pointer mb-3`}
              onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={handleDrop}
              onContextMenu={(e) => e.preventDefault()}
              onClick={(e) => { if (e.target === e.currentTarget || (e.target as HTMLElement).closest(".drop-zone")) onBrowse(); }}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onBrowse(); } }}
            >
              <Upload size={18} style={{ color: "var(--color-text-muted)" }} />
              <span className="ts-xs" style={{ color: "var(--color-text-muted)" }}>파일 추가</span>
              <div className="flex-1" />
              <Button variant="secondary" size="sm" onClick={(e) => { e.stopPropagation(); onBrowseFolder(); }}>
                <span className="flex items-center gap-1.5"><FolderOpen size={13} /> 폴더</span>
              </Button>
            </div>

            <div className="flex items-center justify-between mb-2">
              <h3 className="ts-xs font-semibold" style={{ color: "var(--color-text-primary)" }}>
                선택된 파일 ({files.length})
              </h3>
              <Tooltip content="목록의 모든 파일을 제거합니다">
                <button onClick={() => onFilesChange([])} className="ts-2xs font-medium px-2 py-0.5 rounded" style={{ color: "var(--color-text-muted)" }}>
                  전체 삭제
                </button>
              </Tooltip>
            </div>
            <div className="space-y-1 max-h-[160px] overflow-y-auto">
              {files.map((file) => (
                <div
                  key={file.path}
                  className="flex items-center gap-2.5 px-3 py-1.5 rounded-md"
                  style={{ backgroundColor: "var(--color-bg-tertiary)" }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setCtxMenu({ x: e.clientX, y: e.clientY, path: file.path });
                  }}
                >
                  <Badge variant={getFileTypeBadgeVariant(file.name)}>{file.type.toUpperCase()}</Badge>
                  <span className="ts-xs flex-1 truncate" style={{ color: "var(--color-text-primary)" }}>{file.name}</span>
                  <span className="ts-2xs" style={{ color: "var(--color-text-muted)" }}>{formatSize(file.size)}</span>
                  <button onClick={() => removeFile(file.path)} className="p-0.5 rounded hover-bg-tertiary" aria-label={`${file.name} 삭제`}>
                    <X size={13} style={{ color: "var(--color-text-muted)" }} />
                  </button>
                </div>
              ))}
            </div>

            {ctxMenu && (
              <ContextMenu
                position={{ x: ctxMenu.x, y: ctxMenu.y }}
                onClose={() => setCtxMenu(null)}
                items={[
                  { label: "경로 복사", icon: <Copy size={13} />, onClick: () => { navigator.clipboard.writeText(ctxMenu.path).then(() => showToast("경로가 복사되었습니다", "success")); } },
                  { label: "파일 열기", icon: <ExternalLink size={13} />, onClick: () => { sidecarCall("open_file", { path: ctxMenu.path }).catch(() => showToast("파일을 열 수 없습니다", "error")); } },
                  { type: "separator" as const },
                  { label: "목록에서 제거", icon: <Trash2 size={13} />, danger: true, onClick: () => removeFile(ctxMenu.path) },
                ]}
              />
            )}
          </div>
        )}

        {/* ── 내보내기 폴더 바 ── */}
        {hasFiles && (
          <div className="flex items-center gap-2 mb-5">
            <span className="ts-2xs font-semibold shrink-0" style={{ color: "var(--color-text-muted)" }}>내보내기</span>
            <button
              onClick={handleBrowseOutputDir}
              className="group flex items-center gap-2 px-3 py-1.5 rounded-md text-left transition-all cursor-pointer"
              style={{ backgroundColor: "var(--color-bg-tertiary)" }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--color-bg-secondary)"; e.currentTarget.style.boxShadow = "0 0 0 1px var(--color-border)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "var(--color-bg-tertiary)"; e.currentTarget.style.boxShadow = "none"; }}
            >
              <FolderOpen size={13} style={{ color: outputDir ? "var(--color-accent)" : "var(--color-text-muted)" }} />
              <span className="ts-2xs" style={{ color: outputDir ? "var(--color-text-primary)" : "var(--color-text-muted)" }}>
                {outputDir ? outputDir.split(/[/\\]/).slice(-2).join("\\") : "원본 파일 위치"}
              </span>
              <span className="ts-2xs font-medium opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: "var(--color-accent)" }}>
                변경
              </span>
            </button>
            {outputDir && (
              <button
                onClick={() => onOutputDirChange("")}
                className="p-1 rounded transition-colors"
                style={{ color: "var(--color-text-muted)" }}
                onMouseEnter={(e) => { e.currentTarget.style.color = "var(--color-error)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = "var(--color-text-muted)"; }}
                title="초기화"
              >
                <X size={13} />
              </button>
            )}
          </div>
        )}

        {/* ── 2. 기능 그리드 ── */}
        <div>
          {/* 로컬 기능 */}
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <h3 className="ts-xs font-semibold" style={{ color: "var(--color-text-primary)" }}>
                {hasFiles ? "어떤 작업을 할까요?" : "로컬 기능"}
              </h3>
              <span className="ts-2xs px-1.5 py-0.5 rounded" style={{ backgroundColor: "var(--color-success-subtle)", color: "var(--color-success)" }}>
                오프라인 · 문서 보안 안심
              </span>
            </div>
            {!hasFiles && (
              <span className="ts-2xs" style={{ color: "var(--color-text-muted)" }}>
                파일을 추가하면 활성화됩니다
              </span>
            )}
          </div>
          <div className="grid grid-cols-3 gap-1.5 mb-4">
            {localActions.map((a) => {
              const { ok, reason } = getAvailability(a, files, apiKeySet);
              const needsFiles = !ok && files.length === 0 && !reason;
              return (
                <ActionCard key={a.action} a={a} ok={ok} reason={reason} needsFiles={needsFiles} onClick={() => handleActionClick(a.action)} />
              );
            })}
          </div>

          {/* AI 기능 */}
          <div className="flex items-center gap-2 mb-2">
            <h3 className="ts-xs font-semibold" style={{ color: "var(--color-text-primary)" }}>AI 기능</h3>
            <span className="ts-2xs px-1.5 py-0.5 rounded" style={{ backgroundColor: "var(--color-accent-subtle)", color: "var(--color-accent)" }}>
              Gemini API
            </span>
            {aiMode === "offline" && (
              <span className="ts-2xs" style={{ color: "var(--color-text-muted)" }}>· 오프라인 — 실행 시 전환 확인</span>
            )}
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {aiActions.map((a) => {
              const { ok, reason } = getAvailability(a, files, apiKeySet);
              const needsFiles = !ok && files.length === 0 && !reason;
              return (
                <ActionCard key={a.action} a={a} ok={ok} reason={reason} needsFiles={needsFiles} onClick={() => handleActionClick(a.action)} />
              );
            })}
          </div>

          {/* MCP 연결 배너 */}
          {!hasFiles && (
            <button
              onClick={onOpenMcpSetup}
              className="group w-full flex items-center gap-2.5 mt-3 px-3 py-2 rounded-lg text-left transition-all"
              style={{
                backgroundColor: "var(--color-bg-secondary)",
                border: "1px solid var(--color-border)",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--color-accent)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--color-border)"; }}
            >
              <Plug size={15} style={{ color: "var(--color-accent)" }} className="shrink-0" />
              <span className="ts-xs font-medium flex-1" style={{ color: "var(--color-text-secondary)" }}>
                AI 도구에 kordoc MCP 연결
              </span>
              <span className="ts-2xs" style={{ color: "var(--color-text-muted)" }}>
                Claude · Cursor · VS Code
              </span>
              <ArrowRight size={12} className="shrink-0 opacity-0 group-hover:opacity-60 transition-opacity" style={{ color: "var(--color-accent)" }} />
            </button>
          )}
        </div>
        </div>{/* max-width wrapper end */}
      </div>

      {/* 오프라인 → 온라인 전환 확인 */}
      {modeConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ backgroundColor: "var(--color-backdrop)" }}
          onClick={() => { setModeConfirm(null); pendingActionRef.current = null; }}
        >
          <div className="card p-6 max-w-sm mx-4 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ backgroundColor: "var(--color-accent-subtle)" }}>
                <Wifi size={20} style={{ color: "var(--color-accent)" }} />
              </div>
              <div>
                <h3 className="ts-sm font-bold" style={{ color: "var(--color-text-primary)" }}>온라인 모드 전환</h3>
                <p className="ts-2xs" style={{ color: "var(--color-text-muted)" }}>현재 오프라인 모드입니다</p>
              </div>
            </div>
            <p className="ts-sm" style={{ color: "var(--color-text-secondary)", lineHeight: 1.6 }}>
              <strong>{modeConfirm.label}</strong> 기능은 Gemini API가 필요합니다.<br />
              온라인 모드로 전환하고 실행할까요?
            </p>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" size="sm" onClick={() => { setModeConfirm(null); pendingActionRef.current = null; }}>취소</Button>
              <Button size="sm" onClick={handleConfirmSwitch}>
                <span className="flex items-center gap-1.5"><Wifi size={14} /> 전환 후 실행</span>
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* 병합 순서/방식 선택 */}
      {mergeOpen && (
        <MergeOrderDialog
          files={files}
          uniformType={detectUniformFormat(files)}
          outputDir={outputDir}
          onConfirm={(orderedFiles, mergeMode, mergeOutputDir) => {
            setMergeOpen(false);
            onAction("merge_files", { mergeMode, orderedFiles, ...(mergeOutputDir ? { outputDir: mergeOutputDir } : {}) });
          }}
          onCancel={() => setMergeOpen(false)}
        />
      )}

      {/* 변환 옵션 (페이지 범위) */}
      {convertOpen && (
        <ConvertOptionsDialog
          fileCount={files.length}
          onConfirm={(opts) => { setConvertOpen(false); onAction("convert", { convertOptions: opts }); }}
          onCancel={() => setConvertOpen(false)}
        />
      )}

      {/* 요약 옵션 선택 */}
      {summarizeOpen && (
        <SummarizeOptionsDialog
          fileName={files[0]?.name}
          onConfirm={(opts) => {
            setSummarizeOpen(false);
            onAction("summarize", { summarizeOptions: opts });
          }}
          onCancel={() => setSummarizeOpen(false)}
        />
      )}

      {/* PDF 도구 */}
      {pdfToolsOpen && (
        <PdfToolsDialog
          files={files}
          sidecarCall={sidecarCall}
          onConfirm={(opts) => {
            setPdfToolsOpen(false);
            onAction("pdf_utils", { pdfUtilsOptions: opts });
          }}
          onCancel={() => setPdfToolsOpen(false)}
        />
      )}

      {/* 양식 채우기 작업대 (KorDoc Studio) */}
      {fillWizardOpen && files[0] && (
        <FillWizard
          file={files[0]}
          sidecarCall={sidecarCall}
          outputDir={outputDir}
          showToast={showToast}
          onClose={() => setFillWizardOpen(false)}
          onOpenFolder={(p) => { void sidecarCall("open_folder", { path: p.replace(/[\\/][^\\/]+$/, "") }).catch(() => showToast(`저장 경로: ${p}`, "info")); }}
        />
      )}

      {/* 양식 추출 필드 선택 */}
      {formFieldOpen && (
        <FormFieldSelector
          candidates={formCandidates}
          loading={formCandidatesLoading}
          fileCount={files.length}
          apiKeySet={apiKeySet}
          onConfirm={(opts) => {
            setFormFieldOpen(false);
            onAction("form_extract", { formExtractOptions: opts });
          }}
          onCancel={() => setFormFieldOpen(false)}
        />
      )}
    </div>
  );
}

// ── 요약 옵션 다이얼로그 ──

const STYLE_OPTIONS: { value: SummarizeStyle; label: string; desc: string }[] = [
  { value: "standard", label: "일반 요약", desc: "배경 · 핵심 · 조치사항으로 정리" },
  { value: "briefing", label: "보고용", desc: "결론 먼저, 상급자 보고에 최적" },
  { value: "review", label: "검토용", desc: "쟁점 · 리스크 중심 정리" },
  { value: "action", label: "할 일 정리", desc: "할 일 · 담당 · 기한만 추출" },
];

const LENGTH_OPTIONS: { value: SummarizeLength; label: string }[] = [
  { value: "short", label: "짧게" },
  { value: "medium", label: "보통" },
  { value: "long", label: "상세" },
];

function ConvertOptionsDialog({ fileCount, onConfirm, onCancel }: {
  fileCount: number;
  onConfirm: (opts: ConvertOptions) => void;
  onCancel: () => void;
}) {
  const [pages, setPages] = useState("");

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
      if (e.key === "Enter") onConfirm({ pages: pages.trim() || undefined });
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onCancel, onConfirm, pages]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: "var(--color-backdrop)" }}
      onClick={onCancel}
    >
      <div className="card p-5 mx-4 space-y-4 animate-fade-in" style={{ width: "min(380px, calc(100vw - 48px))" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ backgroundColor: "var(--color-accent-subtle)" }}>
            <FileText size={20} style={{ color: "var(--color-accent)" }} />
          </div>
          <div>
            <h3 className="ts-sm font-bold" style={{ color: "var(--color-text-primary)" }}>마크다운 변환</h3>
            <p className="ts-2xs" style={{ color: "var(--color-text-muted)" }}>{fileCount}개 파일</p>
          </div>
        </div>

        <div>
          <label className="ts-2xs font-semibold mb-1.5 block" style={{ color: "var(--color-text-muted)" }}>
            페이지 범위 <span className="font-normal">(생략 시 전체)</span>
          </label>
          <input
            type="text"
            autoFocus
            placeholder="예: 1-3 · 1,5,7 · 2-4,8"
            value={pages}
            onChange={(e) => setPages(e.target.value)}
            className="w-full px-3 py-2 rounded-md ts-sm"
            style={{
              backgroundColor: "var(--color-bg-tertiary)",
              border: "1px solid var(--color-border)",
              color: "var(--color-text-primary)",
              outline: "none",
            }}
          />
          <p className="ts-2xs mt-1.5" style={{ color: "var(--color-text-muted)" }}>
            PDF: 정확한 페이지 단위 · HWP/HWPX: 섹션 단위
          </p>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" size="sm" onClick={onCancel}>취소</Button>
          <Button size="sm" onClick={() => onConfirm({ pages: pages.trim() || undefined })}>
            변환 시작
          </Button>
        </div>
      </div>
    </div>
  );
}

function SummarizeOptionsDialog({ fileName, onConfirm, onCancel }: {
  fileName?: string;
  onConfirm: (opts: SummarizeOptions) => void;
  onCancel: () => void;
}) {
  const [style, setStyle] = useState<SummarizeStyle>("standard");
  const [length, setLength] = useState<SummarizeLength>("medium");

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: "var(--color-backdrop)" }}
      onClick={onCancel}
    >
      <div className="card p-5 mx-4 space-y-4 animate-fade-in" style={{ width: "min(420px, calc(100vw - 48px))" }} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ backgroundColor: "color-mix(in srgb, #2563EB 10%, transparent)" }}>
            <Sparkles size={20} style={{ color: "#2563EB" }} />
          </div>
          <div>
            <h3 className="ts-sm font-bold" style={{ color: "var(--color-text-primary)" }}>AI 요약</h3>
            {fileName && <p className="ts-2xs truncate" style={{ color: "var(--color-text-muted)", maxWidth: 280 }}>{fileName}</p>}
          </div>
        </div>

        {/* 요약 유형 */}
        <div>
          <label className="ts-2xs font-semibold mb-2 block" style={{ color: "var(--color-text-muted)" }}>요약 유형</label>
          <div className="grid grid-cols-2 gap-1.5">
            {STYLE_OPTIONS.map((s) => (
              <button
                key={s.value}
                type="button"
                onClick={() => setStyle(s.value)}
                className="text-left px-3 py-2 rounded-md transition-all"
                style={{
                  backgroundColor: style === s.value ? "var(--color-accent-subtle)" : "var(--color-bg-tertiary)",
                  border: `1.5px solid ${style === s.value ? "var(--color-accent)" : "var(--color-border)"}`,
                  cursor: "pointer",
                }}
              >
                <div className="ts-xs font-semibold" style={{ color: style === s.value ? "var(--color-accent)" : "var(--color-text-primary)" }}>
                  {s.label}
                </div>
                <div className="ts-2xs mt-0.5" style={{ color: "var(--color-text-muted)" }}>{s.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* 분량 */}
        <div>
          <label className="ts-2xs font-semibold mb-2 block" style={{ color: "var(--color-text-muted)" }}>분량</label>
          <div className="flex gap-1.5">
            {LENGTH_OPTIONS.map((l) => (
              <button
                key={l.value}
                type="button"
                onClick={() => setLength(l.value)}
                className="flex-1 px-3 py-1.5 rounded-md ts-xs font-medium transition-all"
                style={{
                  backgroundColor: length === l.value ? "var(--color-accent-subtle)" : "var(--color-bg-tertiary)",
                  border: `1.5px solid ${length === l.value ? "var(--color-accent)" : "var(--color-border)"}`,
                  color: length === l.value ? "var(--color-accent)" : "var(--color-text-secondary)",
                  cursor: "pointer",
                }}
              >
                {l.label}
              </button>
            ))}
          </div>
        </div>

        {/* 보안 안내 */}
        <p className="ts-2xs px-3 py-2 rounded-md" style={{ backgroundColor: "var(--color-warning-subtle)", color: "var(--color-warning)", lineHeight: 1.5 }}>
          문서 내용이 Gemini API로 전송됩니다. 민감한 문서는 주의하세요.
        </p>

        {/* 버튼 */}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" size="sm" onClick={onCancel}>취소</Button>
          <Button size="sm" onClick={() => onConfirm({ style, length })}>
            <span className="flex items-center gap-1.5"><Sparkles size={14} /> 요약 시작</span>
          </Button>
        </div>
      </div>
    </div>
  );
}
