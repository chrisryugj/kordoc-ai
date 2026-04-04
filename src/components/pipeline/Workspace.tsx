import { useCallback, useState, useEffect } from "react";
import {
  Upload, FileText, X, FolderOpen, Trash2,
  Scan, Sparkles, GitCompareArrows,
  Table, ClipboardList, FileOutput, Merge, Receipt, AlertTriangle,
} from "lucide-react";
import { Button } from "../ui/Button";
import { Badge, getFileTypeBadgeVariant } from "../ui/Badge";
import type { ImportedFile, PipelineAction } from "../../types/pipeline";
import { detectFileType, SUPPORTED_EXT_RE } from "../../utils/fileType";

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
  { action: "form_extract", label: "양식 추출", desc: "신청서/보고서 필드 추출", icon: <ClipboardList size={18} />, color: "#2563EB", needsApi: false, minFiles: 1, maxFiles: 1, fileTypes: [] },
  { action: "diff", label: "문서 비교", desc: "두 문서 차이점 비교", icon: <GitCompareArrows size={18} />, color: "#059669", needsApi: false, minFiles: 2, maxFiles: 2, fileTypes: [] },
  { action: "merge_files", label: "문서 병합", desc: "여러 문서를 하나로", icon: <Merge size={18} />, color: "#D97706", needsApi: false, minFiles: 2, maxFiles: 0, fileTypes: [] },
  { action: "generate_hwpx", label: "HWPX 생성", desc: "마크다운 → 한글 문서", icon: <FileOutput size={18} />, color: "#059669", needsApi: false, minFiles: 1, maxFiles: 1, fileTypes: ["txt", "md"] },
  { action: "ocr", label: "AI OCR", desc: "이미지 PDF 텍스트 인식", icon: <Scan size={18} />, color: "#7C3AED", needsApi: true, minFiles: 1, maxFiles: 1, fileTypes: ["pdf"] },
  { action: "summarize", label: "AI 요약", desc: "문서 핵심 내용 요약", icon: <Sparkles size={18} />, color: "#2563EB", needsApi: true, minFiles: 1, maxFiles: 1, fileTypes: [] },
  { action: "scan_receipt", label: "영수증 스캔", desc: "영수증 → 구조화 데이터", icon: <Receipt size={18} />, color: "#D97706", needsApi: true, minFiles: 1, maxFiles: 1, fileTypes: ["pdf"] },
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

// ── 사이즈 포맷 ──

function formatSize(bytes: number): string {
  if (bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// ── Props ──

interface WorkspaceProps {
  files: ImportedFile[];
  onFilesChange: (files: ImportedFile[]) => void;
  onAction: (action: PipelineAction) => void;
  onBrowse: () => void;
  onBrowseFolder: () => void;
  apiKeySet: boolean;
  onOpenSettings: () => void;
  sidecarReady: boolean;
  sidecarError?: string;
}

export function Workspace({
  files, onFilesChange, onAction, onBrowse, onBrowseFolder,
  apiKeySet, onOpenSettings, sidecarReady, sidecarError,
}: WorkspaceProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; path: string } | null>(null);

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

  const hasFiles = files.length > 0;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-8 pt-6 pb-4">
        <div className="flex items-center justify-between mb-1">
          <h2 className="ts-lg font-bold text-display" style={{ color: "var(--color-text-primary)" }}>
            문서 작업
          </h2>
          <div className="flex items-center gap-3">
            {/* Sidecar status */}
            <div className="flex items-center gap-2 ts-2xs" style={{ color: "var(--color-text-muted)" }}>
              {sidecarError ? (
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: "var(--color-error)" }} />
              ) : !sidecarReady ? (
                <div className="w-3 h-3 border-2 rounded-full animate-spin" style={{ borderColor: "var(--color-warning)", borderTopColor: "transparent" }} />
              ) : (
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: "var(--color-success)" }} />
              )}
              <span>{sidecarError ? "엔진 오류" : sidecarReady ? "준비 완료" : "시작 중..."}</span>
            </div>
            {!apiKeySet && (
              <button
                onClick={onOpenSettings}
                className="flex items-center gap-1.5 ts-2xs px-2.5 py-1 rounded-md font-semibold"
                style={{ color: "var(--color-warning)", backgroundColor: "var(--color-warning-subtle)" }}
              >
                <AlertTriangle size={12} /> API 키 설정
              </button>
            )}
          </div>
        </div>
        <p className="ts-2xs" style={{ color: "var(--color-text-muted)" }}>
          파일을 추가하고 원하는 작업을 선택하세요
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-8 pb-8">
        {/* Drop Zone — compact */}
        <div
          className={`drop-zone ${isDragOver ? "drop-zone--active" : ""} flex items-center gap-4 px-5 py-4 cursor-pointer mb-4`}
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
            className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
            style={{ backgroundColor: "var(--color-accent-subtle)" }}
          >
            <Upload size={20} style={{ color: isDragOver ? "var(--color-accent)" : "var(--color-text-muted)" }} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="ts-sm font-medium" style={{ color: "var(--color-text-primary)" }}>
              {hasFiles ? "파일 추가하기" : "HWP/HWPX/PDF/XLSX 파일을 드래그하거나 클릭"}
            </p>
            {!hasFiles && (
              <div className="flex gap-1.5 mt-1">
                <Badge variant="hwp">HWP</Badge>
                <Badge variant="hwp">HWPX</Badge>
                <Badge variant="pdf">PDF</Badge>
                <Badge variant="xlsx">XLSX</Badge>
              </div>
            )}
          </div>
          <Button
            variant="secondary" size="sm"
            onClick={(e) => { e.stopPropagation(); onBrowseFolder(); }}
          >
            <span className="flex items-center gap-1.5">
              <FolderOpen size={14} /> 폴더
            </span>
          </Button>
        </div>

        {/* File list — compact */}
        {hasFiles && (
          <div className="mb-6">
            <div className="flex items-center justify-between mb-2">
              <h3 className="ts-xs font-semibold" style={{ color: "var(--color-text-primary)" }}>
                선택된 파일 ({files.length})
              </h3>
              <button
                onClick={() => onFilesChange([])}
                className="ts-2xs font-medium px-2 py-0.5 rounded transition-colors"
                style={{ color: "var(--color-text-muted)" }}
              >
                전체 삭제
              </button>
            </div>
            <div className="space-y-1 max-h-[180px] overflow-y-auto">
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

            {/* Context menu */}
            {ctxMenu && (
              <div
                className="fixed z-50 rounded-lg shadow-lg py-1 min-w-[140px]"
                role="menu"
                style={{ top: ctxMenu.y, left: ctxMenu.x, backgroundColor: "var(--color-bg-secondary)", border: "1px solid var(--color-border)" }}
              >
                <button
                  role="menuitem"
                  autoFocus
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

        {/* Action Grid — always visible */}
        <div>
          <h3 className="ts-xs font-semibold mb-3" style={{ color: "var(--color-text-primary)" }}>
            {hasFiles ? "어떤 작업을 할까요?" : "사용 가능한 기능"}
          </h3>

          {/* 로컬 기능 */}
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-2 mb-4">
            {ACTIONS.filter((a) => !a.needsApi).map((a) => {
              const { ok, reason } = getAvailability(a, files, apiKeySet);
              const needsFiles = !ok && files.length === 0 && !reason;
              return (
                <button
                  key={a.action}
                  onClick={() => ok && onAction(a.action)}
                  disabled={!ok}
                  className="flex items-start gap-3 p-3 rounded-lg text-left transition-all"
                  style={{
                    backgroundColor: ok ? "var(--color-bg-secondary)" : "var(--color-bg-tertiary)",
                    opacity: ok ? 1 : needsFiles ? 0.6 : 0.4,
                    border: "1px solid var(--color-border)",
                    cursor: ok ? "pointer" : "default",
                  }}
                  title={reason}
                  onMouseEnter={(e) => { if (ok) e.currentTarget.style.borderColor = a.color; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--color-border)"; }}
                >
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                    style={{ backgroundColor: `color-mix(in srgb, ${a.color} 10%, transparent)`, color: ok ? a.color : "var(--color-text-muted)" }}
                  >
                    {a.icon}
                  </div>
                  <div className="min-w-0">
                    <div className="ts-xs font-semibold truncate" style={{ color: ok ? "var(--color-text-primary)" : "var(--color-text-muted)" }}>
                      {a.label}
                    </div>
                    <div className="ts-2xs mt-0.5" style={{ color: ok ? "var(--color-text-muted)" : reason ? "var(--color-error)" : "var(--color-text-muted)" }}>
                      {ok ? a.desc : reason || a.desc}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* AI 기능 */}
          <div className="flex items-center gap-2 mb-3">
            <h3 className="ts-xs font-semibold" style={{ color: "var(--color-text-primary)" }}>AI 기능</h3>
            <span className="ts-2xs px-1.5 py-0.5 rounded" style={{ backgroundColor: "var(--color-accent-subtle)", color: "var(--color-accent)" }}>
              Gemini API
            </span>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
            {ACTIONS.filter((a) => a.needsApi).map((a) => {
              const { ok, reason } = getAvailability(a, files, apiKeySet);
              const needsFiles = !ok && files.length === 0 && !reason;
              return (
                <button
                  key={a.action}
                  onClick={() => ok && onAction(a.action)}
                  disabled={!ok}
                  className="flex items-start gap-3 p-3 rounded-lg text-left transition-all"
                  style={{
                    backgroundColor: ok ? "var(--color-bg-secondary)" : "var(--color-bg-tertiary)",
                    opacity: ok ? 1 : needsFiles ? 0.6 : 0.4,
                    border: "1px solid var(--color-border)",
                    cursor: ok ? "pointer" : "default",
                  }}
                  title={reason}
                  onMouseEnter={(e) => { if (ok) e.currentTarget.style.borderColor = a.color; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--color-border)"; }}
                >
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                    style={{ backgroundColor: `color-mix(in srgb, ${a.color} 10%, transparent)`, color: ok ? a.color : "var(--color-text-muted)" }}
                  >
                    {a.icon}
                  </div>
                  <div className="min-w-0">
                    <div className="ts-xs font-semibold truncate" style={{ color: ok ? "var(--color-text-primary)" : "var(--color-text-muted)" }}>
                      {a.label}
                    </div>
                    <div className="ts-2xs mt-0.5" style={{ color: ok ? "var(--color-text-muted)" : reason ? "var(--color-error)" : "var(--color-text-muted)" }}>
                      {ok ? a.desc : reason || a.desc}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
