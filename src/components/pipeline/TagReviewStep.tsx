import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { CheckCircle2, Tag, ChevronDown, RefreshCw, Info, Eye, X, Loader2, ExternalLink } from "lucide-react";
import { Button } from "../ui/Button";
import { Badge } from "../ui/Badge";
import type { ImportedFile, PageTag } from "../../types/pipeline";

// 태거(_DEFAULT_THEMES)와 일치하는 테마 목록
const ALL_THEMES = [
  "학급수 및 학생수", "각종 면적", "사업 유형", "사업 기간",
  "설계발주방식", "사업비 내역", "스페이스 프로그램", "설문조사 결과", "기타",
];

const themeColors: Record<string, string> = {
  "학급수 및 학생수": "#7C3AED",
  "각종 면적": "#2563EB",
  "사업 유형": "#D97706",
  "사업 기간": "#059669",
  "설계발주방식": "#DC2626",
  "사업비 내역": "#0284C7",
  "스페이스 프로그램": "#9333EA",
  "설문조사 결과": "#CA8A04",
  "기타": "#6B7280",
};

interface TagReviewStepProps {
  tags: PageTag[];
  onTagsChange: (tags: PageTag[]) => void;
  onConfirm: () => void;
  onBack: () => void;
  onRetag?: () => void;
  logs?: string[];
  themes?: string[];
  files?: ImportedFile[];
  sidecarCall?: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
}

interface PreviewModal {
  tag: PageTag;
  imgData: string | null;
  loading: boolean;
}

interface ContextMenuState {
  x: number;
  y: number;
  tagIdx: number;
  tag: PageTag;
}

export function TagReviewStep({ tags, onTagsChange, onConfirm, onBack, onRetag, logs, themes: themeProp, files, sidecarCall }: TagReviewStepProps) {
  const activeThemes = themeProp ?? ALL_THEMES;
  const themes = [...new Set(tags.map((t) => t.theme))].sort((a, b) =>
    ALL_THEMES.indexOf(a) - ALL_THEMES.indexOf(b)
  );
  const confirmedCount = tags.filter((t) => t.confirmed).length;
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [previewModal, setPreviewModal] = useState<PreviewModal | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [showLogs, setShowLogs] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);
  const thumbnailCache = useRef(new Map<string, string>());

  useEffect(() => {
    if (showLogs) logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs?.length, showLogs]);

  // ESC로 모달/컨텍스트 메뉴 닫기
  useEffect(() => {
    if (!previewModal && !contextMenu) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setPreviewModal(null); setContextMenu(null); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [previewModal, contextMenu]);

  // 컨텍스트 메뉴 외부 클릭 닫기
  useEffect(() => {
    if (!contextMenu) return;
    const handler = () => setContextMenu(null);
    window.addEventListener("click", handler);
    return () => window.removeEventListener("click", handler);
  }, [contextMenu]);

  const handleOpenFile = useCallback(async (tag: PageTag) => {
    const file = files?.find((f) => f.name === tag.sourceFile);
    if (!file?.path || !sidecarCall) return;
    try {
      await sidecarCall("open_file", { path: file.path });
    } catch { /* non-critical */ }
  }, [files, sidecarCall]);

  const handlePreview = useCallback(async (tag: PageTag) => {
    const cacheKey = `${tag.sourceFile}:${tag.pageNum}`;
    // 이미 캐시에 있으면 바로 표시
    if (thumbnailCache.current.has(cacheKey)) {
      setPreviewModal({ tag, imgData: thumbnailCache.current.get(cacheKey)!, loading: false });
      return;
    }
    // PDF가 아닌 경우 또는 sidecarCall 없으면 snippet 표시
    const file = files?.find((f) => f.name === tag.sourceFile);
    if (!sidecarCall || !file || !file.path.toLowerCase().endsWith(".pdf")) {
      setPreviewModal({ tag, imgData: null, loading: false });
      return;
    }
    setPreviewModal({ tag, imgData: null, loading: true });
    try {
      const resp = await sidecarCall("get_thumbnails", {
        pdf_path: file.path,
        start_page: tag.pageNum - 1,
        max_pages: 1,
        dpi: 130,
      }) as { thumbnails: { pageNum: number; data: string }[] };
      const data = resp.thumbnails?.[0]?.data ?? null;
      if (data) thumbnailCache.current.set(cacheKey, data);
      setPreviewModal({ tag, imgData: data, loading: false });
    } catch {
      setPreviewModal({ tag, imgData: null, loading: false });
    }
  }, [files, sidecarCall]);

  // O(1) tag index lookup (avoids O(n^2) findIndex per tag)
  // 키: sourceFile:pageNum:theme — AI가 동일 조합을 두 번 반환하면 경고 후 첫 번째를 유지
  const tagIndexMap = useMemo(() => {
    const map = new Map<string, number>();
    tags.forEach((t, i) => {
      const key = `${t.sourceFile}:${t.pageNum}:${t.theme}`;
      if (map.has(key)) {
        // 중복 태그 — 첫 번째를 유지, 나머지 무시
      } else {
        map.set(key, i);
      }
    });
    return map;
  }, [tags]);

  const allConfirmed = confirmedCount === tags.length && tags.length > 0;
  const toggleAll = () => {
    onTagsChange(tags.map((t) => ({ ...t, confirmed: !allConfirmed })));
  };

  const toggleTag = (idx: number) => {
    const updated = [...tags];
    updated[idx] = { ...updated[idx], confirmed: !updated[idx].confirmed };
    onTagsChange(updated);
  };

  const changeTheme = (idx: number, newTheme: string) => {
    const updated = [...tags];
    updated[idx] = { ...updated[idx], theme: newTheme, confirmed: true };
    onTagsChange(updated);
    setEditingIdx(null);
  };

  return (
    <div className="p-6 animate-fade-in space-y-6">
      {/* 흐름 안내 */}
      <div
        className="rounded-lg px-4 py-3 ts-xs space-y-2"
        style={{ backgroundColor: "var(--color-bg-secondary)", border: "1px solid var(--color-border)" }}
      >
        <div className="flex items-center gap-1.5 font-semibold" style={{ color: "var(--color-accent)" }}>
          <Info size={13} /> 이 단계에서 하는 일
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1" style={{ color: "var(--color-text-secondary)" }}>
          <div>· 태그 클릭 → ✓ 확인 / 해제</div>
          <div>· 오른쪽 ▾ → 테마 변경</div>
          <div>· 확인된 페이지 → 테마별 PDF 분리</div>
          <div>· 전체 문서 텍스트 → 분석 보고서 생성</div>
        </div>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="ts-lg font-semibold flex items-center gap-2">
            <Tag size={20} style={{ color: "var(--color-accent)" }} />
            AI 태그 검토
          </h3>
          <p className="ts-sm mt-1" style={{ color: "var(--color-text-muted)" }}>
            {confirmedCount}/{tags.length}개 확인됨 — 확인된 페이지만 추출됩니다
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={onBack}>← 이전</Button>
          {onRetag && (
            <Button variant="secondary" size="sm" onClick={onRetag} title="AI 태깅만 다시 실행">
              <span className="flex items-center gap-1.5">
                <RefreshCw size={13} /> 재태깅
              </span>
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={toggleAll}>
            {allConfirmed ? "전체 해제" : "전체 확인"}
          </Button>
          <Button size="sm" onClick={onConfirm} disabled={confirmedCount === 0}>
            추출 진행 →
          </Button>
        </div>
      </div>

      {/* 로그 패널 (토글) */}
      {logs && logs.length > 0 && (
        <div className="card p-3">
          <button
            className="w-full flex items-center justify-between ts-xs font-semibold"
            style={{ color: "var(--color-text-secondary)" }}
            onClick={() => setShowLogs((v) => !v)}
          >
            <span>실행 로그 ({logs.length})</span>
            <ChevronDown size={14} style={{ transform: showLogs ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 150ms" }} />
          </button>
          {showLogs && (
            <div
              className="mt-2 max-h-[150px] overflow-y-auto space-y-0.5 text-mono ts-2xs p-2 rounded"
              style={{ backgroundColor: "var(--color-bg-primary)" }}
            >
              {logs.map((log, i) => (
                <div key={i} style={{ color: log.includes("⚠️") || log.includes("ERROR") ? "var(--color-error)" : "var(--color-text-muted)" }}>
                  {log}
                </div>
              ))}
              <div ref={logEndRef} />
            </div>
          )}
        </div>
      )}

      {/* Tags by theme */}
      {tags.length === 0 ? (
        <div className="card p-10 text-center">
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4"
            style={{ backgroundColor: "var(--color-warning-subtle)" }}
          >
            <Tag size={28} style={{ color: "var(--color-warning)", opacity: 0.7 }} />
          </div>
          <h4 className="ts-md font-semibold mb-1" style={{ color: "var(--color-text-primary)" }}>
            태그가 없습니다
          </h4>
          <p className="ts-sm mb-5" style={{ color: "var(--color-text-muted)", maxWidth: 320, margin: "0 auto", wordBreak: "keep-all" }}>
            AI 태깅 결과가 비어있습니다. 문서를 다시 처리하거나, 엑셀 기반 추출로 진행하세요.
          </p>
          <div className="flex justify-center gap-2">
            <Button variant="secondary" onClick={onBack}>← 이전</Button>
            <Button onClick={onConfirm} disabled>추출 진행 →</Button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {themes.map((theme) => {
            const themeTags = tags.filter((t) => t.theme === theme);
            const color = themeColors[theme] ?? "var(--color-text-muted)";
            return (
              <div key={theme} className="card p-4">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
                  <span className="ts-sm font-semibold">{theme}</span>
                  <Badge variant="secondary">{themeTags.length}페이지</Badge>
                </div>
                <div className="flex flex-wrap gap-2">
                  {themeTags.map((tag) => {
                    const tagIdx = tagIndexMap.get(`${tag.sourceFile}:${tag.pageNum}:${tag.theme}`) ?? -1;
                    if (tagIdx < 0) return null;
                    const isEditing = editingIdx === tagIdx;
                    return (
                      // outer: relative 기준점 (overflow 없음 — 드롭다운이 벗어나야 함)
                      <div
                        key={`${tag.sourceFile}-${tag.pageNum}`}
                        className="relative group"
                        onContextMenu={(e) => {
                          e.preventDefault();
                          setContextMenu({ x: e.clientX, y: e.clientY, tagIdx, tag });
                          setEditingIdx(null);
                        }}
                      >
                        {/* 분할 버튼 + eye: flex row */}
                        <div className="flex items-center gap-0.5">
                          {/* 분할 버튼: overflow-hidden으로 rounded-md 시각 클리핑 */}
                          <div
                            className="flex rounded-md overflow-hidden ts-xs font-medium"
                            style={{
                              border: `1px solid ${tag.confirmed ? color : "var(--color-border)"}`,
                              backgroundColor: tag.confirmed ? `color-mix(in srgb, ${color} 10%, transparent)` : "var(--color-bg-tertiary)",
                            }}
                          >
                            {/* 좌측: 클릭 → 확인 토글 (1-click fast action) */}
                            <button
                              onClick={() => toggleTag(tagIdx)}
                              className="flex items-center gap-1 px-2.5 py-1 transition-opacity hover:opacity-80"
                              style={{ color: tag.confirmed ? color : "var(--color-text-muted)" }}
                              title={tag.confirmed ? "클릭하여 확인 취소" : "클릭하여 확인"}
                            >
                              {tag.confirmed && <CheckCircle2 size={12} />}
                              {tag.sourceFile} p.{tag.pageNum}
                              {tag.confidence > 0 && (
                                <span className="opacity-60">{Math.round(tag.confidence * 100)}%</span>
                              )}
                            </button>
                            {/* 우측: chevron → 테마 변경 드롭다운 */}
                            <button
                              onClick={(e) => { e.stopPropagation(); setEditingIdx(isEditing ? null : tagIdx); }}
                              className="flex items-center px-1.5 border-l transition-colors hover:opacity-80"
                              style={{
                                color: "var(--color-text-muted)",
                                borderColor: tag.confirmed ? color : "var(--color-border)",
                              }}
                              title="테마 변경"
                            >
                              <ChevronDown
                                size={10}
                                style={{ transform: isEditing ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 150ms" }}
                              />
                            </button>
                          </div>
                          {/* eye: 그룹 호버 시 표시 — PDF면 썸네일, 그 외엔 snippet */}
                          <button
                            onClick={(e) => { e.stopPropagation(); handlePreview(tag); setEditingIdx(null); }}
                            className="flex items-center justify-center w-5 h-5 rounded transition-all opacity-0 group-hover:opacity-60 hover:!opacity-100"
                            style={{ color: "var(--color-text-muted)" }}
                            title="페이지 미리보기"
                          >
                            <Eye size={10} />
                          </button>
                        </div>

                        {/* 드롭다운: outer div 기준 absolute (overflow-hidden 밖) */}
                        {isEditing && (
                          <>
                            <div className="fixed inset-0 z-10" aria-hidden="true" onClick={() => setEditingIdx(null)} />
                            <div
                              className="absolute top-full mt-1 z-20 rounded-lg shadow-lg py-1 min-w-[160px]"
                              style={{
                                // 카드 우측 끝 근처면 right-anchor, 그 외엔 left-anchor
                                left: 0,
                                right: "auto",
                                backgroundColor: "var(--color-bg-secondary)",
                                border: "1px solid var(--color-border)",
                              }}
                              ref={(el) => {
                                if (!el) return;
                                const rect = el.getBoundingClientRect();
                                if (rect.right > window.innerWidth - 8) {
                                  el.style.left = "auto";
                                  el.style.right = "0";
                                }
                              }}
                            >
                              <p className="px-3 py-0.5 ts-2xs" style={{ color: "var(--color-text-muted)" }}>테마 변경</p>
                              {activeThemes.map((t) => (
                                <button
                                  key={t}
                                  onClick={() => changeTheme(tagIdx, t)}
                                  className="w-full text-left px-3 py-1.5 ts-xs transition-colors flex items-center gap-2"
                                  style={{
                                    color: t === tag.theme ? themeColors[t] ?? "var(--color-text-primary)" : "var(--color-text-secondary)",
                                    backgroundColor: t === tag.theme ? "var(--color-bg-tertiary)" : "transparent",
                                  }}
                                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = "var(--color-bg-tertiary)"; }}
                                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = t === tag.theme ? "var(--color-bg-tertiary)" : "transparent"; }}
                                >
                                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: themeColors[t] ?? "#6B7280" }} />
                                  {t}
                                </button>
                              ))}
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 우클릭 컨텍스트 메뉴 */}
      {contextMenu && (
        <div
          className="fixed z-50 rounded-lg shadow-lg py-1 min-w-[140px]"
          style={{
            left: contextMenu.x,
            top: contextMenu.y,
            backgroundColor: "var(--color-bg-secondary)",
            border: "1px solid var(--color-border)",
          }}
          ref={(el) => {
            if (!el) return;
            const rect = el.getBoundingClientRect();
            if (rect.right > window.innerWidth - 8) el.style.left = `${contextMenu.x - rect.width}px`;
            if (rect.bottom > window.innerHeight - 8) el.style.top = `${contextMenu.y - rect.height}px`;
          }}
        >
          <button
            onClick={() => { toggleTag(contextMenu.tagIdx); setContextMenu(null); }}
            className="w-full text-left px-3 py-1.5 ts-xs flex items-center gap-2 transition-colors"
            style={{ color: "var(--color-text-secondary)" }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = "var(--color-bg-tertiary)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = "transparent"; }}
          >
            <CheckCircle2 size={12} />
            {contextMenu.tag.confirmed ? "확인 해제" : "확인"}
          </button>
          <button
            onClick={() => { handlePreview(contextMenu.tag); setContextMenu(null); }}
            className="w-full text-left px-3 py-1.5 ts-xs flex items-center gap-2 transition-colors"
            style={{ color: "var(--color-text-secondary)" }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = "var(--color-bg-tertiary)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = "transparent"; }}
          >
            <Eye size={12} />
            미리보기
          </button>
          <button
            onClick={() => { handleOpenFile(contextMenu.tag); setContextMenu(null); }}
            className="w-full text-left px-3 py-1.5 ts-xs flex items-center gap-2 transition-colors"
            style={{ color: "var(--color-text-secondary)" }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = "var(--color-bg-tertiary)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = "transparent"; }}
          >
            <ExternalLink size={12} />
            따로 열기
          </button>
        </div>
      )}

      {/* 페이지 미리보기 모달 */}
      {previewModal && (
        <>
          <div className="fixed inset-0 z-50 bg-black/60" onClick={() => setPreviewModal(null)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6" onClick={() => setPreviewModal(null)}>
            <div
              className="relative flex flex-col rounded-xl shadow-2xl overflow-hidden max-w-2xl w-full max-h-[90vh]"
              style={{ backgroundColor: "var(--color-bg-secondary)", border: "1px solid var(--color-border)" }}
              onClick={(e) => e.stopPropagation()}
            >
              <div
                className="flex items-center justify-between px-4 py-2.5 shrink-0"
                style={{ borderBottom: "1px solid var(--color-border)" }}
              >
                <span className="ts-sm font-semibold">
                  {previewModal.tag.sourceFile} — p.{previewModal.tag.pageNum}
                  <span className="ml-2 ts-xs font-normal" style={{ color: "var(--color-text-muted)" }}>
                    {previewModal.tag.theme}
                  </span>
                </span>
                <button
                  onClick={() => setPreviewModal(null)}
                  className="flex items-center justify-center w-6 h-6 rounded transition-opacity hover:opacity-70"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  <X size={14} />
                </button>
              </div>
              <div className="overflow-auto p-4 flex items-center justify-center min-h-[200px]">
                {previewModal.loading ? (
                  <Loader2 size={28} className="animate-spin" style={{ color: "var(--color-accent)" }} />
                ) : previewModal.imgData ? (
                  <img
                    src={`data:image/png;base64,${previewModal.imgData}`}
                    alt={`${previewModal.tag.sourceFile} p.${previewModal.tag.pageNum}`}
                    className="max-w-full rounded"
                  />
                ) : previewModal.tag.snippet ? (
                  <pre
                    className="w-full ts-xs whitespace-pre-wrap text-left"
                    style={{ color: "var(--color-text-secondary)", fontFamily: "var(--font-mono, monospace)" }}
                  >
                    {previewModal.tag.snippet}
                  </pre>
                ) : (
                  <p className="ts-sm" style={{ color: "var(--color-text-muted)" }}>미리보기를 불러올 수 없습니다</p>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
