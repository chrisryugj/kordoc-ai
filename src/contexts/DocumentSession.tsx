/**
 * DocumentSession — 문서 워크벤치의 단일 상태 소스 (KorDoc Studio Phase R / W1).
 *
 * 기존 DocEditor가 컴포넌트 내부에 묶고 있던 두 덩어리를 Context로 승격한다:
 *  - 편집 세션 상태: 사이드카 edit_*(kordoc HwpxSession) — blocks/capabilities/undo·redo/dirty
 *  - 미리보기 상태: rhwp WASM 문서 인스턴스 + 페이지 + 문서 바이트(폴백용 b64)
 *
 * 채우기/편집/AI/변환 도구 패널이 한 문서 인스턴스를 공유하도록 하는 게 목적
 * (모달마다 재파싱·재렌더하던 구조 제거). DOM 시각화(클릭/hover/잠금 표시)는
 * 미리보기를 직접 들고 있는 PreviewPanel에 남기고, 여기서는 데이터·액션만 노출한다.
 *
 * v1 제약(DocEditor와 동일): HWPX 전용, 텍스트가 있는 문단/셀만 편집 대상.
 */

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode,
} from "react";
import {
  initRhwp, openRhwpDocument, b64ToBytes,
  type RhwpDoc, type HitResult, type CursorRect,
} from "../lib/rhwp";
import { annotateBlocks, svgHasLabel, type BlockAnnotation } from "../lib/svg-annotate";
import type { ImportedFile } from "../types/pipeline";

// ── 사이드카 응답 타입 (node-sidecar/src/core/edit과 동기) ──

export interface EditCellView {
  text: string;
  rowSpan: number;
  colSpan: number;
}

export interface EditBlockView {
  index: number;
  type: string;
  text?: string;
  level?: number;
  table?: { rows: number; cols: number; cells: Array<Array<EditCellView | null>> };
}

export interface CellCapability {
  editable: boolean;
  reason?: string;
}

export interface BlockCapabilityInfo {
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

/** PreviewPanel이 보내는 편집 단위 — 문단 통째 또는 표 셀 1개 */
export type SessionEdit =
  | { block: number; newText: string }
  | { block: number; cell: { row: number; col: number }; text: string };

export interface PatchOutcome {
  ok: boolean;
  applied: number;
  /** 적용 0건일 때 사용자 안내용 사유 */
  skippedReason?: string;
  error?: string;
}

type Busy = "" | "patch" | "undo" | "redo" | "save" | "fill";

interface DocumentSessionValue {
  file: ImportedFile;
  showToast: (msg: string, type: "success" | "error" | "info" | "loading") => void;
  sidecarCall: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
  outputDir: string;
  // 세션 상태
  loading: boolean;
  loadError: string;
  sessionId: string;
  blocks: EditBlockView[];
  caps: BlockCapabilityInfo[];
  canUndo: boolean;
  canRedo: boolean;
  busy: Busy;
  dirty: boolean;
  savedAt: Date | null;
  savePath: string;
  // 미리보기 상태
  pageCount: number;
  page: number;
  setPage: (updater: (p: number) => number) => void;
  wasmOk: boolean | null;
  /** 문서 바이트가 교체될 때마다 증가 — PreviewPanel 재렌더 신호 */
  docVersion: number;
  /** 잠금 영역 시각화 토글 (툴바 ↔ 미리보기 공유) */
  showLocks: boolean;
  setShowLocks: (updater: (v: boolean) => boolean) => void;
  // 파생
  annotations: BlockAnnotation[];
  editableCount: number;
  // 액션
  /** 현재 페이지의 어노테이션 적용 SVG 반환 (rhwp 우선, 실패 시 사이드카 폴백) */
  renderPage: (pageNum: number) => Promise<string>;
  patch: (edit: SessionEdit) => Promise<PatchOutcome>;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  save: (auto: boolean) => Promise<void>;
  /** 새 바이트로 편집 세션을 재오픈 — 채우기 결과를 편집 세션에 수렴(미리보기·blocks·변환 공유) */
  reopenSession: (b64: string) => Promise<boolean>;
  /** 현재 문서 바이트(base64) — 변환 등에 편집 세션 현재 상태를 인메모리로 사용 */
  getDocB64: () => string | null;
  /** 라벨이 있는 페이지 번호 반환 (rhwp 미리보기 한정, 없으면 -1) — 채우기 필드 포커스 시 페이지 점프 */
  findLabelPage: (label: string) => number;
  // ── rhwp 인메모리 편집 (KorDoc Studio Phase R2 — 한/글급 인라인 편집) ──
  /** rhwp 사용 가능 여부 (WASM 미리보기 인스턴스 존재) */
  rhwpReady: boolean;
  /** 페이지 픽셀 좌표 → 문서 논리 위치 (미리보기 클릭) */
  rhwpHitTest: (page: number, x: number, y: number) => HitResult | null;
  /** 논리 위치 → 페이지 픽셀 좌표 (커서 그리기) */
  rhwpCursorRect: (sec: number, para: number, off: number) => CursorRect | null;
  /** 문단 글자 수 (커서 경계) */
  rhwpParagraphLength: (sec: number, para: number) => number;
  /** 커서 위치에 텍스트 삽입 — 성공 시 dirty + 재렌더 */
  rhwpInsertText: (sec: number, para: number, off: number, text: string) => boolean;
  /** 텍스트 삭제 — 성공 시 dirty + 재렌더 */
  rhwpDeleteText: (sec: number, para: number, off: number, count: number) => boolean;
}

const Ctx = createContext<DocumentSessionValue | null>(null);

export function useDocumentSession(): DocumentSessionValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useDocumentSession은 <DocumentSessionProvider> 안에서만 사용할 수 있습니다");
  return v;
}

interface ProviderProps {
  file: ImportedFile;
  sidecarCall: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
  outputDir: string;
  showToast: (msg: string, type: "success" | "error" | "info" | "loading") => void;
  children: ReactNode;
}

export function DocumentSessionProvider({ file, sidecarCall, outputDir, showToast, children }: ProviderProps) {
  // 세션
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [blocks, setBlocks] = useState<EditBlockView[]>([]);
  const [caps, setCaps] = useState<BlockCapabilityInfo[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [busy, setBusy] = useState<Busy>("");
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  // 미리보기
  const docB64Ref = useRef<string | null>(null);
  const rhwpDocRef = useRef<RhwpDoc | null>(null);
  const [wasmOk, setWasmOk] = useState<boolean | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [page, setPageState] = useState(0);
  const [docVersion, setDocVersion] = useState(0);
  const [showLocks, setShowLocksState] = useState(false);

  const setPage = useCallback((updater: (p: number) => number) => setPageState(updater), []);
  const setShowLocks = useCallback((updater: (v: boolean) => boolean) => setShowLocksState(updater), []);

  const savePath = useMemo(() => {
    const stem = file.name.replace(/\.[^.]+$/, "");
    const dir = outputDir || file.path.replace(/[\\/][^\\/]+$/, "");
    return `${dir}\\${stem}_편집.hwpx`;
  }, [file, outputDir]);

  // 텍스트가 있는 문단/셀만 클릭 대상 — 잠금 여부 부착
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

  const editableCount = useMemo(() => annotations.filter((a) => !a.locked).length, [annotations]);

  // 새 문서 바이트로 미리보기 교체 (rhwp 인스턴스 재구성)
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
        console.warn("[DocumentSession] rhwp 문서 열기 실패 — 사이드카 폴백:", e);
        rhwpDocRef.current = null;
      }
    }
    setDocVersion((v) => v + 1);
  }, [wasmOk]);

  // edit_* 응답 공통 반영
  const applyState = useCallback(async (res: EditStateRes) => {
    setBlocks(res.blocks);
    setCaps(res.capabilities);
    setCanUndo(res.can_undo);
    setCanRedo(res.can_redo);
    if (res.doc_b64) await loadPreviewDoc(res.doc_b64);
  }, [loadPreviewDoc]);

  // 어노테이션 적용 SVG 반환 — rhwp 우선, 실패 시 사이드카 render_preview
  const renderPage = useCallback(async (pageNum: number): Promise<string> => {
    if (rhwpDocRef.current) {
      return annotateBlocks(rhwpDocRef.current.renderPageSvg(pageNum), annotations);
    }
    if (!docB64Ref.current) return "";
    const res = await sidecarCall("render_preview", { doc_b64: docB64Ref.current, pages: [pageNum] }) as
      { success: boolean; page_count: number; pages: Array<{ page: number; svg: string }> };
    if (res.success && res.pages[0]) {
      setPageCount(res.page_count);
      return annotateBlocks(res.pages[0].svg, annotations);
    }
    return "";
  }, [annotations, sidecarCall]);

  // 초기 로드: edit_open
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

  // 저장 (수동 + 자동)
  const save = useCallback(async (auto: boolean) => {
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
    const t = setTimeout(() => void save(true), 30_000);
    return () => clearTimeout(t);
  }, [dirty, save]);

  // 패치
  const patch = useCallback(async (edit: SessionEdit): Promise<PatchOutcome> => {
    if (!sessionId) return { ok: false, applied: 0, error: "세션이 없습니다" };
    setBusy("patch");
    try {
      const payload = "cell" in edit
        ? { blockIndex: edit.block, cells: [{ row: edit.cell.row, col: edit.cell.col, text: edit.text }] }
        : { blockIndex: edit.block, newText: edit.newText };
      const res = await sidecarCall("edit_patch", { session_id: sessionId, edits: [payload] }) as EditPatchRes;
      if (!res.success) return { ok: false, applied: 0, error: res.error || "편집 적용 실패" };
      if (res.applied > 0) setDirty(true);
      await applyState(res);
      return { ok: true, applied: res.applied, skippedReason: res.skipped[0]?.reason };
    } catch (e) {
      return { ok: false, applied: 0, error: String(e) };
    } finally {
      setBusy("");
    }
  }, [sessionId, sidecarCall, applyState]);

  const history = useCallback(async (kind: "undo" | "redo") => {
    if (!sessionId) return;
    setBusy(kind);
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

  const undo = useCallback(() => history("undo"), [history]);
  const redo = useCallback(() => history("redo"), [history]);

  const getDocB64 = useCallback(() => docB64Ref.current, []);

  // 라벨이 있는 페이지 탐색 — rhwp 미리보기 인스턴스로 페이지별 SVG를 훑는다(동기).
  // 사이드카 폴백(rhwp 없음)에선 페이지 위치를 알 수 없어 -1.
  const findLabelPage = useCallback((label: string): number => {
    const doc = rhwpDocRef.current;
    if (!doc) return -1;
    for (let p = 0; p < pageCount; p++) {
      try {
        if (svgHasLabel(doc.renderPageSvg(p), label)) return p;
      } catch { /* 렌더 실패 페이지 건너뜀 */ }
    }
    return -1;
  }, [pageCount]);

  // ── rhwp 인메모리 편집 (Phase R2) ──
  const rhwpReady = useMemo(() => rhwpDocRef.current !== null, [docVersion, wasmOk]);

  const rhwpHitTest = useCallback(
    (page: number, x: number, y: number): HitResult | null => rhwpDocRef.current?.hitTest(page, x, y) ?? null, []);
  const rhwpCursorRect = useCallback(
    (sec: number, para: number, off: number): CursorRect | null => rhwpDocRef.current?.getCursorRect(sec, para, off) ?? null, []);
  const rhwpParagraphLength = useCallback(
    (sec: number, para: number): number => rhwpDocRef.current?.getParagraphLength(sec, para) ?? 0, []);

  // 편집 공통 — rhwp 인스턴스 직접 변경 후 dirty/페이지수/재렌더 신호
  const rhwpApplyEdit = useCallback((fn: (doc: RhwpDoc) => boolean): boolean => {
    const doc = rhwpDocRef.current;
    if (!doc) return false;
    let ok = false;
    try { ok = fn(doc); } catch (e) { console.warn("[rhwp edit] 실패:", e); return false; }
    if (ok) {
      setDirty(true);
      setPageCount(doc.refreshPageCount());
      setDocVersion((v) => v + 1);
    }
    return ok;
  }, []);

  const rhwpInsertText = useCallback(
    (sec: number, para: number, off: number, text: string): boolean =>
      rhwpApplyEdit((d) => d.insertText(sec, para, off, text)), [rhwpApplyEdit]);
  const rhwpDeleteText = useCallback(
    (sec: number, para: number, off: number, count: number): boolean =>
      rhwpApplyEdit((d) => d.deleteText(sec, para, off, count)), [rhwpApplyEdit]);

  // 채움 결과 바이트로 편집 세션 재오픈 — 채우기↔편집 일관성(플랜 결정 2)
  const reopenSession = useCallback(async (b64: string): Promise<boolean> => {
    setBusy("fill");
    try {
      const prevId = sessionId;
      const res = await sidecarCall("edit_open", { doc_b64: b64 }) as EditStateRes;
      if (!res.success) { showToast(res.error || "세션 재오픈 실패", "error"); return false; }
      if (prevId) void sidecarCall("edit_close", { session_id: prevId }).catch(() => {});
      setSessionId(res.session_id);
      await applyState(res);
      setDirty(true);
      return true;
    } catch (e) {
      showToast(`세션 동기화 실패: ${e}`, "error");
      return false;
    } finally {
      setBusy("");
    }
  }, [sessionId, sidecarCall, showToast, applyState]);

  const value: DocumentSessionValue = {
    file, showToast, sidecarCall, outputDir,
    loading, loadError, sessionId, blocks, caps, canUndo, canRedo, busy, dirty, savedAt, savePath,
    pageCount, page, setPage, wasmOk, docVersion, showLocks, setShowLocks,
    annotations, editableCount,
    renderPage, patch, undo, redo, save, reopenSession, getDocB64, findLabelPage,
    rhwpReady, rhwpHitTest, rhwpCursorRect, rhwpParagraphLength, rhwpInsertText, rhwpDeleteText,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
