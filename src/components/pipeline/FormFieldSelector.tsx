import { useState, useEffect, useCallback } from "react";
import { ClipboardList, Plus, Sparkles } from "lucide-react";
import { Button } from "../ui/Button";
import type { FormExtractOptions, FieldCandidate } from "../../types/pipeline";

interface FormFieldSelectorProps {
  candidates: FieldCandidate[];
  loading: boolean;
  fileCount: number;
  apiKeySet: boolean;
  onConfirm: (opts: FormExtractOptions) => void;
  onCancel: () => void;
}

export function FormFieldSelector({
  candidates, loading, fileCount, apiKeySet, onConfirm, onCancel,
}: FormFieldSelectorProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [useAi, setUseAi] = useState(false);
  const [customField, setCustomField] = useState("");

  // 초기: 모든 후보 선택
  useEffect(() => {
    if (candidates.length > 0) {
      setSelected(new Set(candidates.map((c) => c.label)));
    }
  }, [candidates]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onCancel]);

  const toggleField = useCallback((label: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    const allLabels = candidates.map((c) => c.label);
    setSelected((prev) => prev.size === allLabels.length ? new Set() : new Set(allLabels));
  }, [candidates]);

  const addCustomField = useCallback(() => {
    const trimmed = customField.trim();
    if (!trimmed) return;
    setSelected((prev) => new Set(prev).add(trimmed));
    setCustomField("");
  }, [customField]);

  const handleConfirm = useCallback(() => {
    if (selected.size === 0) return;
    onConfirm({ selectedFields: [...selected], useAi });
  }, [selected, useAi, onConfirm]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: "var(--color-backdrop)" }}
      onClick={onCancel}
    >
      <div
        className="card p-5 mx-4 space-y-4 animate-fade-in"
        style={{ width: "min(480px, calc(100vw - 48px))", maxHeight: "calc(100vh - 96px)", display: "flex", flexDirection: "column" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ backgroundColor: "color-mix(in srgb, #2563EB 10%, transparent)" }}>
            <ClipboardList size={20} style={{ color: "#2563EB" }} />
          </div>
          <div>
            <h3 className="ts-sm font-bold" style={{ color: "var(--color-text-primary)" }}>양식 추출</h3>
            <p className="ts-2xs" style={{ color: "var(--color-text-muted)" }}>
              {fileCount}개 파일에서 추출할 필드를 선택하세요
            </p>
          </div>
        </div>

        {/* 필드 목록 */}
        {loading ? (
          <div className="flex items-center justify-center py-8 gap-2">
            <div className="w-4 h-4 border-2 rounded-full animate-spin" style={{ borderColor: "var(--color-accent)", borderTopColor: "transparent" }} />
            <span className="ts-xs" style={{ color: "var(--color-text-muted)" }}>필드 후보 분석 중...</span>
          </div>
        ) : (
          <div className="space-y-2" style={{ flex: 1, minHeight: 0 }}>
            {/* 전체 선택 */}
            <div className="flex items-center justify-between">
              <label className="ts-2xs font-semibold" style={{ color: "var(--color-text-muted)" }}>
                추출 필드 ({selected.size}/{candidates.length})
              </label>
              <button
                type="button"
                onClick={toggleAll}
                className="ts-2xs font-medium"
                style={{ color: "var(--color-accent)", cursor: "pointer", background: "none", border: "none" }}
              >
                {selected.size === candidates.length ? "전체 해제" : "전체 선택"}
              </button>
            </div>

            {/* 체크박스 리스트 */}
            <div
              className="space-y-0.5 overflow-y-auto rounded-md p-2"
              style={{ backgroundColor: "var(--color-bg-tertiary)", maxHeight: 240, border: "1px solid var(--color-border)" }}
            >
              {candidates.map((c) => (
                <label
                  key={c.label}
                  className="flex items-center gap-2.5 px-2 py-1.5 rounded-md transition-colors"
                  style={{ cursor: "pointer", backgroundColor: selected.has(c.label) ? "var(--color-accent-subtle)" : "transparent" }}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(c.label)}
                    onChange={() => toggleField(c.label)}
                    className="accent-[var(--color-accent)]"
                  />
                  <span className="ts-xs flex-1" style={{ color: "var(--color-text-primary)" }}>{c.label}</span>
                  <span className="ts-2xs" style={{ color: "var(--color-text-muted)" }}>
                    {c.source === "table" ? "표" : "본문"}{c.count > 1 ? ` ×${c.count}` : ""}
                  </span>
                </label>
              ))}
              {candidates.length === 0 && (
                <p className="ts-xs text-center py-4" style={{ color: "var(--color-text-muted)" }}>
                  자동 인식된 필드가 없습니다. 아래에서 직접 추가하세요.
                </p>
              )}
            </div>

            {/* 직접 추가 */}
            <div className="flex gap-1.5">
              <input
                type="text"
                value={customField}
                onChange={(e) => setCustomField(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCustomField(); } }}
                placeholder="필드명 직접 추가..."
                className="flex-1 px-3 py-1.5 rounded-md ts-xs"
                style={{
                  backgroundColor: "var(--color-bg-secondary)",
                  border: "1px solid var(--color-border)",
                  color: "var(--color-text-primary)",
                  outline: "none",
                }}
              />
              <Button variant="ghost" size="sm" onClick={addCustomField} disabled={!customField.trim()}>
                <Plus size={14} />
              </Button>
            </div>
          </div>
        )}

        {/* AI 토글 */}
        <div
          className="flex items-center justify-between px-3 py-2.5 rounded-md"
          style={{ backgroundColor: "var(--color-bg-tertiary)", border: "1px solid var(--color-border)" }}
        >
          <div className="flex items-center gap-2">
            <Sparkles size={14} style={{ color: useAi ? "var(--color-accent)" : "var(--color-text-muted)" }} />
            <div>
              <span className="ts-xs font-medium" style={{ color: "var(--color-text-primary)" }}>AI 정밀 추출</span>
              <p className="ts-2xs" style={{ color: "var(--color-text-muted)" }}>Gemini로 값을 더 정확하게 추출</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setUseAi(!useAi)}
            className="relative w-9 h-5 rounded-full transition-colors"
            style={{
              backgroundColor: useAi ? "var(--color-accent)" : "var(--color-border)",
              cursor: !apiKeySet && !useAi ? "not-allowed" : "pointer",
              opacity: !apiKeySet && !useAi ? 0.5 : 1,
            }}
            disabled={!apiKeySet && !useAi}
            title={!apiKeySet ? "API 키를 먼저 설정하세요" : undefined}
          >
            <div
              className="absolute top-0.5 w-4 h-4 rounded-full transition-transform"
              style={{
                backgroundColor: "white",
                transform: useAi ? "translateX(18px)" : "translateX(2px)",
              }}
            />
          </button>
        </div>

        {useAi && (
          <p className="ts-2xs px-3 py-2 rounded-md" style={{ backgroundColor: "var(--color-warning-subtle)", color: "var(--color-warning)", lineHeight: 1.5 }}>
            문서 내용이 Gemini API로 전송됩니다. 민감한 문서는 주의하세요.
          </p>
        )}

        {/* 버튼 */}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" size="sm" onClick={onCancel}>취소</Button>
          <Button size="sm" onClick={handleConfirm} disabled={selected.size === 0 || loading}>
            <span className="flex items-center gap-1.5">
              <ClipboardList size={14} />
              {fileCount > 1 ? `${fileCount}개 파일 추출` : "추출 시작"}
            </span>
          </Button>
        </div>
      </div>
    </div>
  );
}
