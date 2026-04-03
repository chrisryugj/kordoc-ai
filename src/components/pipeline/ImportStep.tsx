import { useCallback, useState, useEffect } from "react";
import { Upload, FileText, X, FolderOpen, AlertTriangle, Trash2 } from "lucide-react";
import { Button } from "../ui/Button";
import { Badge, getFileTypeBadgeVariant } from "../ui/Badge";
import type { ImportedFile } from "../../types/pipeline";

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

export function ImportStep({ files, onFilesChange, onStartOcr, onBrowse, onBrowseFolder, apiKeySet = true, onOpenSettings }: ImportStepProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; path: string } | null>(null);

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
    // In Tauri, drag-drop provides file paths via dataTransfer
    const droppedFiles = Array.from(e.dataTransfer.files);
    const existingPaths = new Set(files.map((f) => f.path));
    const newFiles: ImportedFile[] = droppedFiles
      .filter((f) => /\.(hwp|hwpx|pdf)$/i.test(f.name))
      .map((f) => ({
        path: (f as File & { path?: string }).path ?? f.name,
        name: f.name,
        size: f.size,
        type: f.name.toLowerCase().endsWith(".pdf") ? "pdf" as const
          : f.name.toLowerCase().match(/\.hwpx?$/) ? "hwp" as const
          : "unknown" as const,
      }))
      .filter((f) => !existingPaths.has(f.path));
    if (newFiles.length > 0) {
      onFilesChange([...files, ...newFiles]);
    }
  }, [files, onFilesChange]);

  const removeFile = (path: string) => {
    onFilesChange(files.filter((f) => f.path !== path));
  };

  return (
    <div className="flex flex-col gap-6 p-6 animate-fade-in">
      {/* Drop Zone */}
      <div
        className={`drop-zone ${isDragOver ? "drop-zone--active" : ""} flex flex-col items-center justify-center gap-4 py-16 cursor-pointer`}
        onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={handleDrop}
        onContextMenu={(e) => e.preventDefault()}
        onClick={(e) => { if (e.target === e.currentTarget || (e.target as HTMLElement).closest(".drop-zone")) onBrowse?.(); }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onBrowse?.(); } }}
      >
        <Upload size={40} style={{ color: isDragOver ? "var(--color-accent)" : "var(--color-text-muted)" }} />
        <div className="text-center">
          <p className="ts-md font-medium" style={{ color: "var(--color-text-primary)" }}>
            HWP/PDF 파일을 여기에 드래그하세요
          </p>
          <p className="ts-sm mt-1" style={{ color: "var(--color-text-muted)" }}>
            또는 클릭하여 파일 선택
          </p>
        </div>
        <div className="flex gap-2">
          <Badge variant="hwp">HWP</Badge>
          <Badge variant="hwp">HWPX</Badge>
          <Badge variant="pdf">PDF</Badge>
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
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="ts-sm font-semibold" style={{ color: "var(--color-text-primary)" }}>
              선택된 파일 ({files.length})
            </h3>
            <Button variant="ghost" size="sm" onClick={() => onFilesChange([])}>
              전체 삭제
            </Button>
          </div>
          <div className="space-y-1 max-h-[300px] overflow-y-auto">
            {files.map((file, _i) => (
              <div
                key={file.path}
                className="flex items-center gap-3 px-3 py-2 rounded-md"
                style={{ backgroundColor: "var(--color-bg-tertiary)" }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  // 뷰포트 경계 클램핑: 메뉴 크기(w≈160, h≈56) 기준
                  const x = Math.min(e.clientX, window.innerWidth - 168);
                  const y = Math.min(e.clientY, window.innerHeight - 60);
                  setCtxMenu({ x, y, path: file.path });
                }}
              >
                <FileText size={16} style={{ color: "var(--color-text-muted)" }} />
                <Badge variant={getFileTypeBadgeVariant(file.name)}>
                  {file.type.toUpperCase()}
                </Badge>
                <span className="ts-sm flex-1 truncate" style={{ color: "var(--color-text-primary)" }}>
                  {file.name}
                </span>
                <span className="ts-2xs" style={{ color: "var(--color-text-muted)" }}>
                  {formatSize(file.size)}
                </span>
                <button onClick={() => removeFile(file.path)} className="p-1 rounded hover-bg-tertiary" aria-label={`${file.name} 삭제`}>
                  <X size={14} style={{ color: "var(--color-text-muted)" }} />
                </button>
              </div>
            ))}
          </div>

          {/* 파일 우클릭 컨텍스트 메뉴 */}
          {ctxMenu && (
            <div
              className="fixed z-50 rounded-lg shadow-lg py-1 min-w-[140px]"
              style={{
                top: ctxMenu.y,
                left: ctxMenu.x,
                backgroundColor: "var(--color-bg-secondary)",
                border: "1px solid var(--color-border)",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <button
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

          <div className="flex flex-col gap-3 pt-4">
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
