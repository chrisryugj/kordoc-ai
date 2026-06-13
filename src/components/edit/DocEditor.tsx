/**
 * DocEditor — 클릭-편집 작업대 (KorDoc Studio Phase C).
 *
 * rhwp SVG 미리보기에서 문단/표 셀을 클릭해 텍스트를 바로 수정한다.
 * 사이드카 edit_* 세션(kordoc HwpxSession) 경유 — 원본 바이트 보존 패치.
 *
 * - capability 잠금 시각화: 편집 불가 블록은 흐리게 + 클릭 시 사유 토스트
 * - undo/redo: 사이드카 바이트 스냅샷 (Ctrl+Z / Ctrl+Y)
 * - 30초 자동저장: 변경 후 30초 뒤 `{원본명}_편집.hwpx`로 저장
 *
 * v1 제약: 텍스트가 있는 문단/셀만 클릭 대상 (빈 셀 채우기는 FillWizard 담당),
 * 페이지 경계에 걸린 문단은 시퀀스 매칭 실패로 클릭 불가할 수 있음.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  X, SquarePen, Undo2, Redo2, Save, Lock, Loader2, AlertTriangle,
  ChevronLeft, ChevronRight, FolderOpen,
} from "lucide-react";
import { Button } from "../ui/Button";
import { initRhwp, openRhwpDocument, b64ToBytes, type RhwpDoc } from "../../lib/rhwp";
import { annotateBlocks, type BlockAnnotation } from "../../lib/svg-annotate";
import type { ImportedFile } from "../../types/pipeline";

// ── 사이드카 응답 타입 (node-sidecar/src/core/edit과 동기) ──

interface EditCellView {
  text: string;
  rowSpan: number;
  colSpan: number;
}

interface EditBlockView {
  index: number;
  type: string;
  text?: string;
  level?: number;
  table?: { rows: number; cols: number; cells: Array<Array<EditCellView | null>> };
}

interface CellCapability {
  editable: boolean;
  reason?: string;
}

interface BlockCapabilityInfo {
  capability: "text" | "cell-text" | "locked";
  reason?: string;
  cells?: CellCapability[][];
}

interface EditStateRes {
  success: boolean;
  session_id: string;
  blocks: EditBlockView[];
  capabilities: BlockCapabilityInfo[];
  can_undo: boolean;
  can_redo: boolean;
  doc_b64?: string;
  error?: string;
}

interface EditPatchRes extends EditStateRes {
  applied: number;
  skipped: Array<{ reason: string; detail?: string }>;
}

/** 열린 인라인 편집기 상태 — 미리보기 위 팝오버 */
interface EditingState {
  block: number;
  cell?: { row: number; col: number };
  value: string;
  /** 미리보기 컨테이너 기준 좌표 */
  x: number;
  y: number;
}

interface DocEditorProps {
  file: ImportedFile;
  sidecarCall: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
  outputDir: string;
  showToast: (msg: string, type: "success" | "error" | "info" | "loading") => void;
  onClose: () => void;
  onOpenFolder: (path: string) => void;
}

export function DocEditor({ file, sidecarCall, outputDir, showToast, onClose, onOpenFolder }: DocEditorProps) {
  // ── 세션/문서 상태 ──
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [blocks, setBlocks] = useState<EditBlockView[]>([]);
  const [caps, setCaps] = useState<BlockCapabilityInfo[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [busy, setBusy] = useState<"" | "patch" | "undo" | "redo" | "save">("");
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  // ── 미리보기 상태 ──
  const docB64Ref = useRef<string | null>(null);
  const rhwpDocRef = useRef<RhwpDoc | null>(null);
  const [wasmOk, setWasmOk] = useState<boolean | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [page, setPage] = useState(0);
  const [docVersion, setDocVersion] = useState(0);
  const [svg, setSvg] = useState("");
  const [renderError, setRenderError] = useState("");
  const previewRef = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [hoverKey, setHoverKey] = useState("");
  const [showLocks, setShowLocks] = useState(false);

  const savePath = useMemo(() => {
    const stem = file.name.replace(/\.[^.]+$/, "");
    const dir = outputDir || file.path.replace(/[\\/][^\\/]+$/, "");
    return `${dir}\\${stem}_편집.hwpx`;
  }, [file, outputDir]);

  // ── 어노테이션 목록 — 텍스트 있는 문단/셀만 클릭 대상 ──
  const annotations = useMemo<BlockAnnotation[]>(() => {
    const out: BlockAnnotation[] = [];
    for (const b of blocks) {
      const cap = caps[b.index];
      if (!cap) continue;
      if ((b.type === "paragraph" || b.type === "heading") && b.text?.trim()) {
        out.push({ block: b.index, text: b.text, locked: cap.capability !== "text" });
      } else if (b.type === "table" && b.table) {
        for (let r = 0; r < b.table.rows; r++) {
          for (let c = 0; c < b.table.cols; c++) {
            const cell = b.table.cells[r]?.[c];
            if (!cell?.text.trim()) continue;
            const editable = cap.capability === "cell-text" && cap.cells?.[r]?.[c]?.editable === true;
            out.push({ block: b.index, cell: { row: r, col: c }, text: cell.text, locked: !editable });
          }
        }
      }
    }
    return out;
  }, [blocks, caps]);

  // ── 렌더 (프론트 WASM 우선, 실패 시 사이드카 render_preview) ──
  const renderPage = useCallback(async (pageNum: number) => {
    setRenderError("");
    try {
      if (rhwpDocRef.current) {
        setSvg(annotateBlocks(rhwpDocRef.current.renderPageSvg(pageNum), annotations));
        return;
      }
      if (!docB64Ref.current) return;
      const res = await sidecarCall("render_preview", { doc_b64: docB64Ref.current, pages: [pageNum] }) as
        { success: boolean; page_count: number; pages: Array<{ page: number; svg: string }> };
      if (res.success && res.pages[0]) {
        setPageCount(res.page_count);
        setSvg(annotateBlocks(res.pages[0].svg, annotations));
      }
    } catch (e) {
      setRenderError(`미리보기 렌더 실패: ${e}`);
    }
  }, [annotations, sidecarCall]);

  /** 새 문서 바이트로 미리보기 교체 */
  const loadPreviewDoc = useCallback(async (b64: string) => {
    docB64Ref.current = b64;
    const ok = wasmOk ?? await initRhwp();
    if (wasmOk === null) setWasmOk(ok);
    if (ok) {
      try {
        rhwpDocRef.current?.free();
        rhwpDocRef.current = null;
        const doc = openRhwpDocument(b64ToBytes(b64));
        rhwpDocRef.current = doc;
        setPageCount(doc.pageCount);
      } catch (e) {
        console.warn("[DocEditor] rhwp 문서 열기 실패 — 사이드카 폴백:", e);
        rhwpDocRef.current = null;
      }
    }
    setDocVersion((v) => v + 1);
  }, [wasmOk]);

  /** edit_* 응답 공통 반영 */
  const applyState = useCallback(async (res: EditStateRes) => {
    setBlocks(res.blocks);
    setCaps(res.capabilities);
    setCanUndo(res.can_undo);
    setCanRedo(res.can_redo);
    if (res.doc_b64) await loadPreviewDoc(res.doc_b64);
  }, [loadPreviewDoc]);

  // ── 초기 로드: edit_open ──
  useEffect(() => {
    let cancelled = false;
    let openedId = "";
    (async () => {
      try {
        const res = await sidecarCall("edit_open", { input_path: file.path }) as EditStateRes;
        if (cancelled) return;
        if (!res.success) { setLoadError(res.error || "문서 열기 실패"); return; }
        openedId = res.session_id;
        setSessionId(res.session_id);
        await applyState(res);
      } catch (e) {
        if (!cancelled) setLoadError(String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      if (openedId) void sidecarCall("edit_close", { session_id: openedId }).catch(() => {});
      rhwpDocRef.current?.free();
      rhwpDocRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.path]);

  // 페이지/문서/어노테이션 변경 시 렌더
  useEffect(() => {
    if (!loading) void renderPage(page);
  }, [page, docVersion, loading, renderPage]);

  // ── 저장 (수동 + 30초 자동) ──
  const doSave = useCallback(async (auto: boolean) => {
    if (!sessionId) return;
    setBusy("save");
    try {
      await sidecarCall("edit_save", { session_id: sessionId, output_path: savePath });
      setDirty(false);
      setSavedAt(new Date());
      if (!auto) showToast(`저장 완료: ${savePath}`, "success");
    } catch (e) {
      showToast(`저장 실패: ${e}`, "error");
    } finally {
      setBusy("");
    }
  }, [sessionId, savePath, sidecarCall, showToast]);

  // 변경 후 30초 뒤 자동저장 — dirty가 유지되는 동안 1회
  useEffect(() => {
    if (!dirty) return;
    const t = setTimeout(() => void doSave(true), 30_000);
    return () => clearTimeout(t);
  }, [dirty, doSave]);

  // ── 패치/undo/redo ──
  const doPatch = useCallback(async () => {
    if (!editing || !sessionId) return;
    setBusy("patch");
    try {
      const edit = editing.cell
        ? { blockIndex: editing.block, cells: [{ row: editing.cell.row, col: editing.cell.col, text: editing.value }] }
        : { blockIndex: editing.block, newText: editing.value };
      const res = await sidecarCall("edit_patch", { session_id: sessionId, edits: [edit] }) as EditPatchRes;
      if (!res.success) {
        showToast(res.error || "편집 적용 실패", "error");
        return;
      }
      if (res.applied === 0) {
        const why = res.skipped[0]?.reason;
        showToast(why ? `적용 안 됨: ${why}` : "변경 없음", why ? "error" : "info");
      } else {
        setDirty(true);
      }
      await applyState(res);
      setEditing(null);
    } catch (e) {
      showToast(`편집 실패: ${e}`, "error");
    } finally {
      setBusy("");
    }
  }, [editing, sessionId, sidecarCall, showToast, applyState]);

  const doHistory = useCallback(async (kind: "undo" | "redo") => {
    if (!sessionId) return;
    setBusy(kind);
    setEditing(null);
    try {
      const res = await sidecarCall(`edit_${kind}`, { session_id: sessionId }) as EditStateRes;
      if (!res.success) { showToast(res.error || `${kind} 실패`, "error"); return; }
      setDirty(true);
      await applyState(res);
    } catch (e) {
      showToast(`${kind === "undo" ? "되돌리기" : "다시 실행"} 실패: ${e}`, "error");
    } finally {
      setBusy("");
    }
  }, [sessionId, sidecarCall, showToast, applyState]);

  // ── 닫기: 미저장 변경은 저장 후 종료 ──
  const handleClose = useCallback(async () => {
    if (dirty && sessionId) {
      await doSave(true);
      showToast(`변경사항 저장됨: ${savePath}`, "info");
    }
    onClose();
  }, [dirty, sessionId, doSave, savePath, showToast, onClose]);

  // ── 키보드: Ctrl+Z / Ctrl+Y / Ctrl+S, Esc ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setEditing(null); return; }
      if (!e.ctrlKey || busy !== "") return;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey && canUndo && !editing) { e.preventDefault(); void doHistory("undo"); }
      else if ((k === "y" || (k === "z" && e.shiftKey)) && canRedo && !editing) { e.preventDefault(); void doHistory("redo"); }
      else if (k === "s") { e.preventDefault(); void doSave(false); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, canUndo, canRedo, editing, doHistory, doSave]);

  // ── 미리보기 클릭 → 인라인 편집기 ──
  const handlePreviewClick = useCallback((e: React.MouseEvent) => {
    const target = (e.target as Element).closest?.("[data-kd-block]");
    if (!target) { setEditing(null); return; }
    const blockIndex = parseInt(target.getAttribute("data-kd-block") ?? "", 10);
    if (Number.isNaN(blockIndex)) return;
    const cap = caps[blockIndex];
    const block = blocks.find((b) => b.index === blockIndex);
    if (!cap || !block) return;

    const cellAttr = target.getAttribute("data-kd-cell");
    const cell = cellAttr ? { row: parseInt(cellAttr.split(",")[0], 10), col: parseInt(cellAttr.split(",")[1], 10) } : undefined;

    // 잠금 사유 안내
    if (cell) {
      const cc = cap.cells?.[cell.row]?.[cell.col];
      if (cap.capability !== "cell-text" || !cc?.editable) {
        showToast(`편집 불가: ${cc?.reason || cap.reason || "지원하지 않는 영역"}`, "info");
        return;
      }
    } else if (cap.capability !== "text") {
      showToast(`편집 불가: ${cap.reason || "지원하지 않는 영역"}`, "info");
      return;
    }

    // 팝오버 좌표 — 미리보기 컨테이너 기준
    const root = previewRef.current;
    if (!root) return;
    const rect = root.getBoundingClientRect();
    const x = Math.min(e.clientX - rect.left + root.scrollLeft, root.scrollWidth - 360);
    const y = e.clientY - rect.top + root.scrollTop + 14;

    const value = cell ? (block.table?.cells[cell.row]?.[cell.col]?.text ?? "") : (block.text ?? "");
    setEditing({ block: blockIndex, cell, value, x: Math.max(8, x), y });
  }, [blocks, caps, showToast]);

  // hover 하이라이트 — 같은 편집 단위(블록 또는 셀)의 모든 글자
  const handlePreviewMove = useCallback((e: React.MouseEvent) => {
    const target = (e.target as Element).closest?.("[data-kd-block]");
    if (!target) { setHoverKey(""); return; }
    const key = `${target.getAttribute("data-kd-block")}${target.getAttribute("data-kd-cell") ? ":" + target.getAttribute("data-kd-cell") : ""}`;
    setHoverKey(key);
  }, []);

  useEffect(() => {
    const root = previewRef.current;
    if (!root) return;
    root.querySelectorAll<SVGTextElement>("text[data-kd-block]").forEach((el) => {
      const key = `${el.getAttribute("data-kd-block")}${el.getAttribute("data-kd-cell") ? ":" + el.getAttribute("data-kd-cell") : ""}`;
      const hit = key === hoverKey && !el.hasAttribute("data-kd-locked");
      el.style.fill = hit ? "var(--color-accent)" : "";
    });
  }, [hoverKey, svg]);

  // 잠금 시각화 — 편집 가능: 밑줄 점선, 잠금: 흐리게
  useEffect(() => {
    const root = previewRef.current;
    if (!root) return;
    root.querySelectorAll<SVGTextElement>("text[data-kd-locked]").forEach((el) => {
      el.style.opacity = showLocks ? "0.4" : "";
    });
    root.querySelectorAll<SVGTextElement>("text[data-kd-block]:not([data-kd-locked])").forEach((el) => {
      el.style.textDecoration = showLocks ? "underline dotted" : "";
    });
  }, [showLocks, svg]);

  const editableCount = useMemo(() => annotations.filter((a) => !a.locked).length, [annotations]);

  // ── 렌더 ──
  return (
    <div className="fixed inset-0 z-50 flex flex-col" style={{ backgroundColor: "var(--color-bg-primary)" }}>
      {/* 헤더 + 툴바 */}
      <div className="flex items-center gap-3 px-5 py-3 shrink-0" style={{ borderBottom: "1px solid var(--color-border)" }}>
        <div className="w-8 h-8 rounded-md flex items-center justify-center" style={{ backgroundColor: "color-mix(in srgb, #9333EA 12%, transparent)", color: "#9333EA" }}>
          <SquarePen size={16} />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="ts-sm font-bold truncate" style={{ color: "var(--color-text-primary)" }}>문서 편집 — {file.name}</h2>
          <p className="ts-2xs" style={{ color: "var(--color-text-muted)" }}>
            미리보기에서 문단·셀을 클릭해 수정 · 원본 서식 그대로
            {wasmOk === false && " · 미리보기: 엔진 렌더 (WASM 폴백)"}
          </p>
        </div>

        {/* 저장 상태 */}
        <span className="ts-2xs shrink-0" style={{ color: dirty ? "var(--color-warning)" : "var(--color-text-muted)" }}>
          {busy === "save" ? "저장 중..." : dirty ? "● 저장 안 됨 (30초 후 자동저장)" : savedAt ? `저장됨 ${savedAt.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}` : ""}
        </span>

        <div className="flex items-center gap-1 shrink-0">
          <button onClick={() => void doHistory("undo")} disabled={!canUndo || busy !== ""} className="p-1.5 rounded-md hover-bg-tertiary disabled:opacity-30" aria-label="되돌리기 (Ctrl+Z)" title="되돌리기 (Ctrl+Z)">
            <Undo2 size={15} style={{ color: "var(--color-text-secondary)" }} />
          </button>
          <button onClick={() => void doHistory("redo")} disabled={!canRedo || busy !== ""} className="p-1.5 rounded-md hover-bg-tertiary disabled:opacity-30" aria-label="다시 실행 (Ctrl+Y)" title="다시 실행 (Ctrl+Y)">
            <Redo2 size={15} style={{ color: "var(--color-text-secondary)" }} />
          </button>
          <button
            onClick={() => setShowLocks((v) => !v)}
            className="p-1.5 rounded-md hover-bg-tertiary"
            aria-label="잠금 영역 표시"
            title="잠금 영역 표시 — 편집 가능(밑줄)/불가(흐림)"
            style={showLocks ? { backgroundColor: "var(--color-bg-tertiary)" } : undefined}
          >
            <Lock size={15} style={{ color: showLocks ? "var(--color-accent)" : "var(--color-text-secondary)" }} />
          </button>
          <Button size="sm" onClick={() => void doSave(false)} disabled={busy !== "" || !sessionId}>
            <span className="flex items-center gap-1.5">
              {busy === "save" ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} 저장
            </span>
          </Button>
          {savedAt && (
            <button onClick={() => onOpenFolder(savePath)} className="p-1.5 rounded-md hover-bg-tertiary" aria-label="저장 위치 열기" title="저장 위치 열기">
              <FolderOpen size={15} style={{ color: "var(--color-text-secondary)" }} />
            </button>
          )}
        </div>
        <button onClick={() => void handleClose()} className="p-1.5 rounded-md hover-bg-tertiary" aria-label="닫기">
          <X size={16} style={{ color: "var(--color-text-muted)" }} />
        </button>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center gap-2" style={{ color: "var(--color-text-muted)" }}>
          <Loader2 size={18} className="animate-spin" /> <span className="ts-sm">문서 분석 중...</span>
        </div>
      ) : loadError ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 px-8 text-center">
          <AlertTriangle size={28} style={{ color: "var(--color-warning)" }} />
          <p className="ts-sm" style={{ color: "var(--color-text-secondary)" }}>{loadError}</p>
          <Button variant="secondary" size="sm" onClick={onClose}>닫기</Button>
        </div>
      ) : (
        <div className="flex-1 flex flex-col overflow-hidden" style={{ backgroundColor: "var(--color-bg-secondary)" }}>
          {/* 페이지 내비 + 편집 가능 카운트 */}
          <div className="flex items-center justify-center gap-3 py-2 shrink-0">
            <button onClick={() => { setEditing(null); setPage((p) => Math.max(0, p - 1)); }} disabled={page === 0} className="p-1 rounded hover-bg-tertiary disabled:opacity-30" aria-label="이전 페이지">
              <ChevronLeft size={15} style={{ color: "var(--color-text-secondary)" }} />
            </button>
            <span className="ts-2xs" style={{ color: "var(--color-text-muted)" }}>
              {pageCount > 0 ? `${page + 1} / ${pageCount}` : "—"}
            </span>
            <button onClick={() => { setEditing(null); setPage((p) => Math.min(pageCount - 1, p + 1)); }} disabled={page >= pageCount - 1} className="p-1 rounded hover-bg-tertiary disabled:opacity-30" aria-label="다음 페이지">
              <ChevronRight size={15} style={{ color: "var(--color-text-secondary)" }} />
            </button>
            <span className="ts-2xs" style={{ color: "var(--color-text-muted)" }}>
              편집 가능 {editableCount}곳
            </span>
          </div>

          {/* 미리보기 + 인라인 편집 팝오버 */}
          <div
            ref={previewRef}
            className="kd-editor relative flex-1 overflow-auto px-6 pb-6"
            onClick={handlePreviewClick}
            onMouseMove={handlePreviewMove}
            onMouseLeave={() => setHoverKey("")}
          >
            {renderError ? (
              <p className="ts-2xs text-center mt-8" style={{ color: "var(--color-error)" }}>{renderError}</p>
            ) : svg ? (
              <div
                className="kd-preview mx-auto rounded shadow-lg"
                style={{ maxWidth: 900, backgroundColor: "white" }}
                // rhwp WASM이 생성한 SVG (로컬 신뢰 소스) — 블록 어노테이션만 후처리
                dangerouslySetInnerHTML={{ __html: svg }}
              />
            ) : (
              <div className="flex items-center justify-center gap-2 mt-12" style={{ color: "var(--color-text-muted)" }}>
                <Loader2 size={16} className="animate-spin" /> <span className="ts-2xs">렌더링 중...</span>
              </div>
            )}

            {editing && (
              <div
                className="absolute z-10 rounded-lg p-3 shadow-xl"
                style={{ left: editing.x, top: editing.y, width: 360, backgroundColor: "var(--color-bg-primary)", border: "1px solid var(--color-border)" }}
                onClick={(e) => e.stopPropagation()}
              >
                <p className="ts-2xs font-semibold mb-1.5" style={{ color: "var(--color-text-secondary)" }}>
                  {editing.cell ? `표 셀 (${editing.cell.row + 1}행 ${editing.cell.col + 1}열)` : "문단"} 수정
                </p>
                <textarea
                  autoFocus
                  value={editing.value}
                  rows={Math.min(6, Math.max(2, editing.value.split("\n").length))}
                  className="w-full px-2.5 py-2 rounded-md ts-xs resize-y"
                  style={{ backgroundColor: "var(--color-bg-tertiary)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)", outline: "none" }}
                  onChange={(e) => setEditing((s) => (s ? { ...s, value: e.target.value } : s))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey && !editing.cell) { e.preventDefault(); void doPatch(); }
                    if (e.key === "Enter" && e.ctrlKey) { e.preventDefault(); void doPatch(); }
                  }}
                />
                <div className="flex items-center justify-between mt-2">
                  <span className="ts-2xs" style={{ color: "var(--color-text-muted)" }}>
                    {editing.cell ? "Ctrl+Enter 적용" : "Enter 적용"} · Esc 취소
                  </span>
                  <div className="flex gap-1.5">
                    <Button variant="secondary" size="sm" onClick={() => setEditing(null)} disabled={busy === "patch"}>취소</Button>
                    <Button size="sm" onClick={() => void doPatch()} disabled={busy === "patch"}>
                      <span className="flex items-center gap-1">
                        {busy === "patch" && <Loader2 size={12} className="animate-spin" />} 적용
                      </span>
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
