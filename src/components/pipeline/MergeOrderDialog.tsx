import { useState, useCallback } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  GripVertical, ChevronUp, ChevronDown, X,
  Merge, FileOutput, FileText, FolderOpen,
} from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { Button } from "../ui/Button";
import { Badge, getFileTypeBadgeVariant } from "../ui/Badge";
import type { ImportedFile, MergeMode } from "../../types/pipeline";

// ── Sortable item ──

function SortableFileItem({
  file, index, total, onMoveUp, onMoveDown, onRemove,
}: {
  file: ImportedFile;
  index: number;
  total: number;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
}) {
  const {
    attributes, listeners, setNodeRef, transform, transition, isDragging,
  } = useSortable({ id: file.path });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : undefined,
    opacity: isDragging ? 0.85 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      className="flex items-center gap-2 px-3 py-2 rounded-lg transition-shadow"
      {...attributes}
      style={{
        ...style,
        backgroundColor: isDragging ? "var(--color-bg-secondary)" : "var(--color-bg-tertiary)",
        boxShadow: isDragging ? "0 4px 12px rgba(0,0,0,.12)" : undefined,
      }}
    >
      {/* 드래그 핸들 */}
      <button
        {...listeners}
        className="p-0.5 rounded cursor-grab active:cursor-grabbing shrink-0"
        style={{ color: "var(--color-text-muted)" }}
        tabIndex={-1}
        aria-label="드래그하여 순서 변경"
      >
        <GripVertical size={16} />
      </button>

      {/* 번호 */}
      <span
        className="w-5 h-5 rounded-md flex items-center justify-center ts-2xs font-bold shrink-0"
        style={{ backgroundColor: "color-mix(in srgb, #D97706 15%, transparent)", color: "#D97706" }}
      >
        {index + 1}
      </span>

      {/* 파일 타입 뱃지 */}
      <Badge variant={getFileTypeBadgeVariant(file.name)}>{file.type.toUpperCase()}</Badge>

      {/* 파일명 */}
      <span className="ts-xs flex-1 truncate" style={{ color: "var(--color-text-primary)" }}>
        {file.name}
      </span>

      {/* 수동 이동 버튼 */}
      <div className="flex items-center gap-0.5 shrink-0">
        <button
          onClick={onMoveUp}
          disabled={index === 0}
          className="p-0.5 rounded transition-colors"
          style={{
            color: index === 0 ? "var(--color-text-disabled)" : "var(--color-text-secondary)",
            cursor: index === 0 ? "default" : "pointer",
          }}
          aria-label="위로 이동"
        >
          <ChevronUp size={14} />
        </button>
        <button
          onClick={onMoveDown}
          disabled={index === total - 1}
          className="p-0.5 rounded transition-colors"
          style={{
            color: index === total - 1 ? "var(--color-text-disabled)" : "var(--color-text-secondary)",
            cursor: index === total - 1 ? "default" : "pointer",
          }}
          aria-label="아래로 이동"
        >
          <ChevronDown size={14} />
        </button>
      </div>

      {/* 제거 */}
      <button
        onClick={onRemove}
        disabled={total <= 2}
        className="p-0.5 rounded transition-colors shrink-0"
        style={{
          color: total <= 2 ? "var(--color-text-disabled)" : "var(--color-text-muted)",
          cursor: total <= 2 ? "default" : "pointer",
        }}
        aria-label={`${file.name} 제거`}
      >
        <X size={13} />
      </button>
    </div>
  );
}

// ── Dialog ──

interface MergeOrderDialogProps {
  files: ImportedFile[];
  uniformType: string | null;
  outputDir: string;
  onConfirm: (orderedFiles: ImportedFile[], mergeMode: MergeMode, outputDir?: string) => void;
  onCancel: () => void;
}

export function MergeOrderDialog({ files, uniformType, outputDir: globalOutputDir, onConfirm, onCancel }: MergeOrderDialogProps) {
  const [items, setItems] = useState<ImportedFile[]>(() => [...files]);
  const [mergeMode, setMergeMode] = useState<MergeMode>(uniformType ? "native" : "markdown");
  const [localOutputDir, setLocalOutputDir] = useState("");

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setItems((prev) => {
        const oldIndex = prev.findIndex((f) => f.path === active.id);
        const newIndex = prev.findIndex((f) => f.path === over.id);
        return arrayMove(prev, oldIndex, newIndex);
      });
    }
  }, []);

  const moveUp = (idx: number) => {
    if (idx <= 0) return;
    setItems((prev) => arrayMove(prev, idx, idx - 1));
  };

  const moveDown = (idx: number) => {
    setItems((prev) => {
      if (idx >= prev.length - 1) return prev;
      return arrayMove(prev, idx, idx + 1);
    });
  };

  const removeItem = (idx: number) => {
    setItems((prev) => {
      if (prev.length <= 2) return prev;
      return prev.filter((_, i) => i !== idx);
    });
  };

  const handleBrowseOutputDir = useCallback(async () => {
    try {
      const selected = await open({ directory: true, multiple: false });
      if (!selected) return;
      setLocalOutputDir(Array.isArray(selected) ? selected[0] : selected);
    } catch { /* 취소 */ }
  }, []);

  const effectiveDir = localOutputDir || globalOutputDir;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: "var(--color-backdrop)" }}
      onClick={onCancel}
    >
      <div
        className="card p-6 mx-4 space-y-5"
        style={{ maxWidth: "28rem", width: "100%" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center"
            style={{ backgroundColor: "color-mix(in srgb, #D97706 12%, transparent)" }}
          >
            <Merge size={20} style={{ color: "#D97706" }} />
          </div>
          <div>
            <h3 className="ts-sm font-bold" style={{ color: "var(--color-text-primary)" }}>
              문서 병합
            </h3>
            <p className="ts-2xs" style={{ color: "var(--color-text-muted)" }}>
              순서를 드래그하여 정하세요 · {items.length}개 파일
            </p>
          </div>
        </div>

        {/* 파일 순서 리스트 */}
        <div
          className="space-y-1.5 overflow-y-auto pr-1"
          style={{ maxHeight: "280px" }}
        >
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={items.map((f) => f.path)}
              strategy={verticalListSortingStrategy}
            >
              {items.map((file, idx) => (
                <SortableFileItem
                  key={file.path}
                  file={file}
                  index={idx}
                  total={items.length}
                  onMoveUp={() => moveUp(idx)}
                  onMoveDown={() => moveDown(idx)}
                  onRemove={() => removeItem(idx)}
                />
              ))}
            </SortableContext>
          </DndContext>
        </div>

        {/* 병합 방식 선택 — 동일 네이티브 포맷일 때만 */}
        {uniformType && (
          <div className="space-y-2">
            <p className="ts-2xs font-semibold" style={{ color: "var(--color-text-muted)" }}>
              병합 방식
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button
                className="flex items-center gap-2 p-2.5 rounded-lg text-left transition-all"
                style={{
                  backgroundColor: mergeMode === "native" ? "color-mix(in srgb, #D97706 8%, transparent)" : "var(--color-bg-tertiary)",
                  border: `1.5px solid ${mergeMode === "native" ? "#D97706" : "var(--color-border-subtle)"}`,
                }}
                onClick={() => setMergeMode("native")}
              >
                <FileOutput size={15} style={{ color: mergeMode === "native" ? "#D97706" : "var(--color-text-muted)" }} />
                <div>
                  <div className="ts-2xs font-semibold" style={{ color: "var(--color-text-primary)" }}>
                    서식 유지
                  </div>
                  <div className="ts-2xs" style={{ color: "var(--color-text-muted)", fontSize: "0.675rem" }}>
                    {uniformType.toUpperCase()} 그대로
                  </div>
                </div>
              </button>
              <button
                className="flex items-center gap-2 p-2.5 rounded-lg text-left transition-all"
                style={{
                  backgroundColor: mergeMode === "markdown" ? "var(--color-accent-subtle)" : "var(--color-bg-tertiary)",
                  border: `1.5px solid ${mergeMode === "markdown" ? "var(--color-accent)" : "var(--color-border-subtle)"}`,
                }}
                onClick={() => setMergeMode("markdown")}
              >
                <FileText size={15} style={{ color: mergeMode === "markdown" ? "var(--color-accent)" : "var(--color-text-muted)" }} />
                <div>
                  <div className="ts-2xs font-semibold" style={{ color: "var(--color-text-primary)" }}>
                    마크다운
                  </div>
                  <div className="ts-2xs" style={{ color: "var(--color-text-muted)", fontSize: "0.675rem" }}>
                    텍스트 변환
                  </div>
                </div>
              </button>
            </div>
          </div>
        )}

        {/* 내보내기 폴더 */}
        <div className="space-y-1.5">
          <p className="ts-2xs font-semibold" style={{ color: "var(--color-text-muted)" }}>내보내기 폴더</p>
          <div className="flex items-center gap-2">
            <button
              onClick={handleBrowseOutputDir}
              className="group flex-1 flex items-center gap-2 px-3 py-2 rounded-lg text-left transition-all cursor-pointer"
              style={{ backgroundColor: "var(--color-bg-tertiary)" }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--color-bg-secondary)"; e.currentTarget.style.boxShadow = "0 0 0 1px #D9770640"; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "var(--color-bg-tertiary)"; e.currentTarget.style.boxShadow = "none"; }}
            >
              <FolderOpen size={13} style={{ color: effectiveDir ? "#D97706" : "var(--color-text-muted)" }} />
              <span className="ts-2xs truncate" style={{ color: effectiveDir ? "var(--color-text-primary)" : "var(--color-text-muted)" }}>
                {effectiveDir
                  ? `${effectiveDir.split(/[/\\]/).slice(-2).join("\\")}${!localOutputDir && globalOutputDir ? " (전역)" : ""}`
                  : "원본 파일 위치"
                }
              </span>
              <span className="ts-2xs font-medium ml-auto shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: "#D97706" }}>
                변경
              </span>
            </button>
            {localOutputDir && (
              <button
                onClick={() => setLocalOutputDir("")}
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

        {/* 버튼 */}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" size="sm" onClick={onCancel}>취소</Button>
          <Button
            size="sm"
            onClick={() => onConfirm(items, mergeMode, localOutputDir || undefined)}
            disabled={items.length < 2}
          >
            <span className="flex items-center gap-1.5">
              <Merge size={14} /> 병합 시작
            </span>
          </Button>
        </div>
      </div>
    </div>
  );
}
