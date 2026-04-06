import { useCallback, useState, useEffect } from "react";
import { Upload, X, FolderOpen, AlertTriangle, Trash2, List, LayoutGrid } from "lucide-react";
import { Button } from "../ui/Button";
import type { ImportedFile } from "../../types/pipeline";
import { detectFileType, SUPPORTED_EXT_RE } from "../../utils/fileType";

interface ImportStepProps {
  files: ImportedFile[];
  onFilesChange: (files: ImportedFile[]) => void;
  onStartOcr: () => void;
  onBrowse?: () => void;
  onBrowseFolder?: () => void;
  apiKeySet?: boolean;
  onOpenSettings?: () => void;
}

function formatSize(bytes: number): string {
  if (bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// ── 파일 타입별 색상 + 레이블 ──
const FILE_TYPE_CONFIG: Record<string, { color: string; bg: string; label: string }> = {
  hwp:     { color: "#fff",     bg: "#1E5FAD", label: "HWP"  },
  hwpx:    { color: "#fff",     bg: "#2970C8", label: "HWPX" },
  pdf:     { color: "#fff",     bg: "#E84040", label: "PDF"  },
  xlsx:    { color: "#fff",     bg: "#1F8A4C", label: "XLSX" },
  xls:     { color: "#fff",     bg: "#1F8A4C", label: "XLS"  },
  docx:    { color: "#fff",     bg: "#2B579A", label: "DOCX" },
  txt:     { color: "#fff",     bg: "#6B7280", label: "TXT"  },
  md:      { color: "#fff",     bg: "#6B7280", label: "MD"   },
  png:     { color: "#fff",     bg: "#7C3AED", label: "PNG"  },
  jpg:     { color: "#fff",     bg: "#7C3AED", label: "JPG"  },
  gif:     { color: "#fff",     bg: "#7C3AED", label: "GIF"  },
  webp:    { color: "#fff",     bg: "#7C3AED", label: "WEBP" },
  unknown: { color: "#fff",     bg: "#9CA3AF", label: "FILE" },
};

function FileTypeIcon({ type, size = 40 }: { type: string; size?: number }) {
  const cfg = FILE_TYPE_CONFIG[type] ?? FILE_TYPE_CONFIG.unknown;
  const w = size;
  const h = Math.round(size * 1.25);
  const fold = Math.round(size * 0.28);
  const r = Math.round(size * 0.1);

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} fill="none" aria-hidden="true">
      {/* 본체 */}
      <path
        d={`M${r} 0 H${w - fold} L${w} ${fold} V${h - r} Q${w} ${h} ${w - r} ${h} H${r} Q0 ${h} 0 ${h - r} V${r} Q0 0 ${r} 0 Z`}
        fill={cfg.bg}
      />
      {/* 접힌 코너 */}
      <path
        d={`M${w - fold} 0 L${w} ${fold} H${w - fold + r} Q${w - fold} ${fold} ${w - fold} ${fold - r} Z`}
        fill="rgba(255,255,255,0.22)"
      />
      {/* 확장자 텍스트 */}
      <text
        x={w / 2}
        y={h - Math.round(h * 0.18)}
        textAnchor="middle"
        fill={cfg.color}
        fontSize={Math.round(size * 0.22)}
        fontWeight="700"
        fontFamily="system-ui, -apple-system, sans-serif"
        letterSpacing="-0.5"
      >
        {cfg.label}
      </text>
    </svg>
  );
}

// ── 그리드 카드 ──
function FileCard({
  file,
  onRemove,
  onContextMenu,
}: {
  file: ImportedFile;
  onRemove: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  return (
    <div
      className="group relative flex flex-col items-center gap-1.5 p-3 rounded-xl cursor-default select-none transition-colors"
      style={{ backgroundColor: "var(--color-bg-tertiary)" }}
      onContextMenu={onContextMenu}
      title={file.name}
    >
      {/* 삭제 버튼 (호버 시) */}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onRemove(); }}
        aria-label={`${file.name} 삭제`}
        className="absolute top-1.5 right-1.5 p-0.5 rounded-md opacity-0 group-hover:opacity-100 transition-opacity"
        style={{ backgroundColor: "var(--color-bg-secondary)", color: "var(--color-text-muted)" }}
      >
        <X size={11} />
      </button>

      <FileTypeIcon type={file.type} size={40} />

      <span
        className="ts-2xs text-center leading-tight w-full"
        style={{
          color: "var(--color-text-primary)",
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
          wordBreak: "break-all",
        }}
      >
        {file.name}
      </span>
      {file.size > 0 && (
        <span className="ts-2xs" style={{ color: "var(--color-text-muted)" }}>
          {formatSize(file.size)}
        </span>
      )}
    </div>
  );
}

// ── 리스트 행 ──
function FileRow({
  file,
  onRemove,
  onContextMenu,
}: {
  file: ImportedFile;
  onRemove: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  return (
    <div
      className="flex items-center gap-3 px-3 py-2 rounded-md"
      style={{ backgroundColor: "var(--color-bg-tertiary)" }}
      onContextMenu={onContextMenu}
    >
      <FileTypeIcon type={file.type} size={24} />
      <span className="ts-sm flex-1 truncate" style={{ color: "var(--color-text-primary)" }} title={file.name}>
        {file.name}
      </span>
      {file.size > 0 && (
        <span className="ts-2xs shrink-0" style={{ color: "var(--color-text-muted)" }}>
          {formatSize(file.size)}
        </span>
      )}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onRemove(); }}
        className="p-1 rounded hover-bg-tertiary shrink-0"
        aria-label={`${file.name} 삭제`}
      >
        <X size={14} style={{ color: "var(--color-text-muted)" }} />
      </button>
    </div>
  );
}

export function ImportStep({ files, onFilesChange, onStartOcr, onBrowse, onBrowseFolder, apiKeySet = true, onOpenSettings }: ImportStepProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; path: string } | null>(null);
  // 파일 ≤ 20이면 그리드, > 20이면 리스트 기본
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

  // 파일 수 변화 시 모드 자동 전환
  useEffect(() => {
    if (files.length > 20 && viewMode === "grid") setViewMode("list");
    if (files.length <= 20 && viewMode === "list") setViewMode("grid");
  }, [files.length]); // viewMode 의도적으로 deps 제외

  // 컨텍스트 메뉴 외부 클릭 시 닫기
  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("contextmenu", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("contextmenu", close);
    };
  }, [ctxMenu]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const droppedFiles = Array.from(e.dataTransfer.files);
    if (droppedFiles.length === 0) return;
    if ("__TAURI_INTERNALS__" in window) return;
    const existingPaths = new Set(files.map((f) => f.path));
    const newFiles: ImportedFile[] = droppedFiles
      .filter((f) => SUPPORTED_EXT_RE.test(f.name))
      .map((f) => ({
        path: (f as File & { path?: string }).path ?? f.name,
        name: f.name,
        size: f.size,
        type: detectFileType(f.name),
      }))
      .filter((f) => !existingPaths.has(f.path));
    if (newFiles.length > 0) onFilesChange([...files, ...newFiles]);
  }, [files, onFilesChange]);

  const removeFile = (path: string) => {
    onFilesChange(files.filter((f) => f.path !== path));
  };

  const openCtxMenu = (e: React.MouseEvent, path: string) => {
    e.preventDefault();
    const x = Math.min(e.clientX, window.innerWidth - 168);
    const y = Math.min(e.clientY, window.innerHeight - 60);
    setCtxMenu({ x, y, path });
  };

  return (
    <div className="flex flex-col gap-6 p-6 animate-fade-in">
      {/* Drop Zone */}
      <div
        className={`drop-zone ${isDragOver ? "drop-zone--active" : ""} flex flex-col items-center justify-center gap-4 py-14 cursor-pointer`}
        onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={handleDrop}
        onContextMenu={(e) => e.preventDefault()}
        onClick={(e) => { if (e.target === e.currentTarget || (e.target as HTMLElement).closest(".drop-zone")) onBrowse?.(); }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onBrowse?.(); } }}
      >
        <Upload size={36} style={{ color: isDragOver ? "var(--color-accent)" : "var(--color-text-muted)" }} />
        <div className="text-center">
          <p className="ts-md font-medium" style={{ color: "var(--color-text-primary)" }}>
            파일을 여기에 드래그하거나 클릭하여 선택
          </p>
          <p className="ts-xs mt-1" style={{ color: "var(--color-text-muted)" }}>
            HWP · HWPX · PDF · XLSX · 이미지
          </p>
        </div>
        {onBrowseFolder && (
          <Button variant="secondary" size="sm" onClick={(e) => { e.stopPropagation(); onBrowseFolder(); }}>
            <span className="flex items-center gap-1.5">
              <FolderOpen size={14} /> 폴더 선택
            </span>
          </Button>
        )}
      </div>

      {/* File List */}
      {files.length > 0 && (
        <div className="flex flex-col gap-3">
          {/* 헤더 */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h3 className="ts-sm font-semibold" style={{ color: "var(--color-text-primary)" }}>
                선택된 파일
              </h3>
              <span
                className="ts-2xs px-2 py-0.5 rounded-full font-medium tabular-nums"
                style={{ backgroundColor: "var(--color-accent-subtle)", color: "var(--color-accent)" }}
              >
                {files.length}
              </span>
            </div>
            <div className="flex items-center gap-1">
              {/* 뷰 토글 */}
              <button
                type="button"
                onClick={() => setViewMode("grid")}
                className="p-1.5 rounded-md transition-colors"
                title="그리드 뷰"
                style={{
                  color: viewMode === "grid" ? "var(--color-accent)" : "var(--color-text-muted)",
                  backgroundColor: viewMode === "grid" ? "var(--color-accent-subtle)" : "transparent",
                }}
              >
                <LayoutGrid size={14} />
              </button>
              <button
                type="button"
                onClick={() => setViewMode("list")}
                className="p-1.5 rounded-md transition-colors"
                title="리스트 뷰"
                style={{
                  color: viewMode === "list" ? "var(--color-accent)" : "var(--color-text-muted)",
                  backgroundColor: viewMode === "list" ? "var(--color-accent-subtle)" : "transparent",
                }}
              >
                <List size={14} />
              </button>
              <div style={{ width: 1, height: 16, backgroundColor: "var(--color-border)", margin: "0 4px" }} />
              <Button variant="ghost" size="sm" onClick={() => onFilesChange([])}>
                전체 삭제
              </Button>
            </div>
          </div>

          {/* 그리드 / 리스트 */}
          <div
            className="overflow-y-auto"
            style={{ maxHeight: viewMode === "grid" ? 340 : 320 }}
          >
            {viewMode === "grid" ? (
              <div
                className="grid gap-2"
                style={{ gridTemplateColumns: "repeat(auto-fill, minmax(108px, 1fr))" }}
              >
                {files.map((file) => (
                  <FileCard
                    key={file.path}
                    file={file}
                    onRemove={() => removeFile(file.path)}
                    onContextMenu={(e) => openCtxMenu(e, file.path)}
                  />
                ))}
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                {files.map((file) => (
                  <FileRow
                    key={file.path}
                    file={file}
                    onRemove={() => removeFile(file.path)}
                    onContextMenu={(e) => openCtxMenu(e, file.path)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* 파일 우클릭 컨텍스트 메뉴 */}
          {ctxMenu && (
            <div
              className="fixed z-50 rounded-lg shadow-lg py-1 min-w-[140px]"
              role="menu"
              aria-label="파일 컨텍스트 메뉴"
              style={{
                top: ctxMenu.y,
                left: ctxMenu.x,
                backgroundColor: "var(--color-bg-secondary)",
                border: "1px solid var(--color-border)",
              }}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => { if (e.key === "Escape") setCtxMenu(null); }}
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

          {/* 하단 액션 */}
          <div className="flex flex-col gap-3 pt-2">
            {!apiKeySet && (
              <div
                className="flex items-center gap-2 px-3 py-2.5 rounded-lg"
                style={{ backgroundColor: "var(--color-warning-subtle)", border: "1px solid var(--color-warning)" }}
              >
                <AlertTriangle size={14} style={{ color: "var(--color-warning)", flexShrink: 0 }} />
                <span className="ts-xs flex-1" style={{ color: "var(--color-warning)" }}>
                  Gemini API 키가 없습니다. AI 분석을 시작하려면 API 키를 먼저 입력해 주세요.
                </span>
                {onOpenSettings && (
                  <button
                    onClick={onOpenSettings}
                    className="ts-xs font-semibold underline whitespace-nowrap"
                    style={{ color: "var(--color-warning)" }}
                  >
                    설정 열기
                  </button>
                )}
              </div>
            )}
            <div className="flex justify-end">
              <Button size="lg" onClick={onStartOcr} disabled={!apiKeySet}>
                AI 분석 시작 →
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
