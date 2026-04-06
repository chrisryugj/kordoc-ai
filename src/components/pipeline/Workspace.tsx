import { useCallback, useState, useEffect, useRef } from "react";
import {
  Upload, FileText, X, FolderOpen, Trash2,
  Scan, Sparkles, GitCompareArrows,
  Table, ClipboardList, FileOutput, Merge, ShieldCheck, AlertTriangle, Wifi,
  ArrowRight,
} from "lucide-react";
import { Button } from "../ui/Button";
import { Badge, getFileTypeBadgeVariant } from "../ui/Badge";
import type { ImportedFile, PipelineAction, MergeMode, SummarizeLength, SummarizeStyle, SummarizeOptions, FormExtractOptions, FieldCandidate, ConvertOptions } from "../../types/pipeline";
import { detectFileType, SUPPORTED_EXT_RE } from "../../utils/fileType";
import { MergeOrderDialog } from "./MergeOrderDialog";
import { FormFieldSelector } from "./FormFieldSelector";

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
  { action: "diff", label: "문서 비교", desc: "두 문서 차이점 비교", icon: <GitCompareArrows size={18} />, color: "#059669", needsApi: false, minFiles: 2, maxFiles: 2, fileTypes: [] },
  { action: "merge_files", label: "문서 병합", desc: "여러 문서를 하나로", icon: <Merge size={18} />, color: "#D97706", needsApi: false, minFiles: 2, maxFiles: 0, fileTypes: [] },
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
      className="group flex items-center gap-3 p-3 rounded-lg text-left transition-all"
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
        className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
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
  onAction: (action: PipelineAction, actionOptions?: { mergeMode?: MergeMode; orderedFiles?: ImportedFile[]; summarizeOptions?: SummarizeOptions; formExtractOptions?: FormExtractOptions; convertOptions?: ConvertOptions }) => void;
  sidecarCall: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
  onBrowse: () => void;
  onBrowseFolder: () => void;
  apiKeySet: boolean;
  aiMode: "online" | "offline";
  onToggleMode: () => void;
  onOpenSettings: () => void;
  sidecarReady: boolean;
  sidecarError?: string;
}

export function Workspace({
  files, onFilesChange, onAction, onBrowse, onBrowseFolder,
  apiKeySet, aiMode, onToggleMode, onOpenSettings, sidecarReady, sidecarError, sidecarCall,
}: WorkspaceProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; path: string } | null>(null);
  const [modeConfirm, setModeConfirm] = useState<{ action: PipelineAction; label: string } | null>(null);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [summarizeOpen, setSummarizeOpen] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);
  const [formFieldOpen, setFormFieldOpen] = useState(false);
  const [formCandidates, setFormCandidates] = useState<FieldCandidate[]>([]);
  const [formCandidatesLoading, setFormCandidatesLoading] = useState(false);
  const pendingActionRef = useRef<PipelineAction | null>(null);

  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("contextmenu", close);
    return () => { window.removeEventListener("click", close); window.removeEventListener("contextmenu", close); };
  }, [ctxMenu]);

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

  /** 동일 네이티브 포맷 감지 (hwpx/xlsx/docx/pdf) */
  const detectUniformFormat = useCallback((f: ImportedFile[]): string | null => {
    if (f.length < 2) return null;
    const nativeTypes = new Set(["hwpx", "xlsx", "docx", "pdf"]);
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
      <div className="sidebar-header px-8 flex-col justify-center" style={{ borderBottom: "1px solid var(--color-border)" }}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-bold text-display" style={{ color: "var(--color-text-primary)", letterSpacing: "-0.02em", fontSize: "1.125rem" }}>
              모든 문서, 하나로 읽다
            </h2>
            <p className="ts-xs mt-0.5" style={{ color: "var(--color-text-muted)" }}>
              HWP · HWPX · PDF · XLSX · DOCX · TXT — 변환 · 추출 · 비교 · AI 분석
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {!apiKeySet && (
              <button
                onClick={onOpenSettings}
                className="flex items-center gap-1.5 ts-2xs px-2.5 py-1 rounded-md font-semibold"
                style={{ color: "var(--color-warning)", backgroundColor: "var(--color-warning-subtle)" }}
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

      <div className="flex-1 overflow-y-auto px-8 pb-8 pt-6 content-area">
        {/* ── 1. 파일 영역 ── */}
        {!hasFiles ? (
          /* 파일 없음: 큰 드롭존 */
          <div
            className={`drop-zone ${isDragOver ? "drop-zone--active" : ""} flex flex-col items-center justify-center gap-3 py-12 cursor-pointer mb-6`}
            onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={handleDrop}
            onContextMenu={(e) => e.preventDefault()}
            onClick={(e) => { if (e.target === e.currentTarget || (e.target as HTMLElement).closest(".drop-zone")) onBrowse(); }}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onBrowse(); } }}
          >
            <div
              className="w-14 h-14 rounded-2xl flex items-center justify-center"
              style={{ backgroundColor: "var(--color-accent-subtle)" }}
            >
              <Upload size={28} style={{ color: isDragOver ? "var(--color-accent)" : "var(--color-text-muted)" }} />
            </div>
            <div className="text-center">
              <p className="ts-sm font-semibold" style={{ color: "var(--color-text-primary)" }}>
                파일을 드래그하거나 클릭하여 선택
              </p>
              <p className="ts-2xs mt-1" style={{ color: "var(--color-text-muted)" }}>
                파일을 추가하면 아래 기능이 활성화됩니다
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <Badge variant="hwp">HWP</Badge>
              <Badge variant="hwp">HWPX</Badge>
              <Badge variant="pdf">PDF</Badge>
              <Badge variant="xlsx">XLSX</Badge>
              <Badge variant="txt">DOCX</Badge>
              <Badge variant="txt">TXT</Badge>
            </div>
            <Button
              variant="secondary" size="sm"
              onClick={(e) => { e.stopPropagation(); onBrowseFolder(); }}
              className="mt-1"
            >
              <span className="flex items-center gap-1.5"><FolderOpen size={14} /> 폴더 선택</span>
            </Button>
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
              <button onClick={() => onFilesChange([])} className="ts-2xs font-medium px-2 py-0.5 rounded" style={{ color: "var(--color-text-muted)" }}>
                전체 삭제
              </button>
            </div>
            <div className="space-y-1 max-h-[160px] overflow-y-auto">
              {files.map((file) => (
                <div
                  key={file.path}
                  className="flex items-center gap-2.5 px-3 py-1.5 rounded-md"
                  style={{ backgroundColor: "var(--color-bg-tertiary)" }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setCtxMenu({ x: Math.min(e.clientX, window.innerWidth - 168), y: Math.min(e.clientY, window.innerHeight - 60), path: file.path });
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
              <div
                className="fixed z-50 rounded-lg shadow-lg py-1 min-w-[140px]"
                role="menu"
                style={{ top: ctxMenu.y, left: ctxMenu.x, backgroundColor: "var(--color-bg-secondary)", border: "1px solid var(--color-border)" }}
              >
                <button
                  role="menuitem" autoFocus
                  className="w-full text-left px-3 py-1.5 ts-xs flex items-center gap-2 transition-colors"
                  style={{ color: "var(--color-error)" }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = "var(--color-bg-tertiary)"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = "transparent"; }}
                  onClick={() => { removeFile(ctxMenu.path); setCtxMenu(null); }}
                >
                  <Trash2 size={13} /> 목록에서 제거
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── 2. 기능 그리드 ── */}
        <div>
          {/* 로컬 기능 */}
          <div className="flex items-center justify-between mb-3">
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
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-2 mb-5">
            {localActions.map((a) => {
              const { ok, reason } = getAvailability(a, files, apiKeySet);
              const needsFiles = !ok && files.length === 0 && !reason;
              return (
                <ActionCard key={a.action} a={a} ok={ok} reason={reason} needsFiles={needsFiles} onClick={() => handleActionClick(a.action)} />
              );
            })}
          </div>

          {/* AI 기능 */}
          <div className="flex items-center gap-2 mb-3">
            <h3 className="ts-xs font-semibold" style={{ color: "var(--color-text-primary)" }}>AI 기능</h3>
            <span className="ts-2xs px-1.5 py-0.5 rounded" style={{ backgroundColor: "var(--color-accent-subtle)", color: "var(--color-accent)" }}>
              Gemini API
            </span>
            {aiMode === "offline" && (
              <span className="ts-2xs" style={{ color: "var(--color-text-muted)" }}>· 오프라인 — 실행 시 전환 확인</span>
            )}
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
            {aiActions.map((a) => {
              const { ok, reason } = getAvailability(a, files, apiKeySet);
              const needsFiles = !ok && files.length === 0 && !reason;
              return (
                <ActionCard key={a.action} a={a} ok={ok} reason={reason} needsFiles={needsFiles} onClick={() => handleActionClick(a.action)} />
              );
            })}
          </div>
        </div>
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
          onConfirm={(orderedFiles, mergeMode) => {
            setMergeOpen(false);
            onAction("merge_files", { mergeMode, orderedFiles });
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
  { value: "action", label: "조치 추출", desc: "할 일 · 담당 · 기한만 추출" },
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
