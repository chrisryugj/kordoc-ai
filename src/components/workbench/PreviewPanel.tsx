/**
 * PreviewPanel — 워크벤치 중앙 캔버스 (KorDoc Studio Phase R2 / rhwp 인라인 편집).
 *
 * rhwp WASM 문서를 SVG로 렌더하고, 그 위에 직접 커서를 찍어 타이핑한다.
 * 좌표 변환: 클릭(clientX/Y) → svg.getBoundingClientRect() + viewBox 비율 →
 * 페이지 좌표 → rhwp.hitTest. 커서는 rhwp.getCursorRect를 역변환해 그린다.
 *
 * 1차: 영문/숫자/기호 + Backspace/Delete/화살표 (한글 IME는 후속 — hidden input).
 * 채우기 탭 라벨 강조/역점프는 유지한다.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { useDocumentSession } from "../../contexts/DocumentSession";
import { annotateLabels } from "../../lib/svg-annotate";

interface PreviewPanelProps {
  /** 채우기 탭 활성 — 양식 라벨을 어노테이션해 필드↔미리보기 연동 */
  labelMode: boolean;
  /** 양식 필드 라벨 목록 (채우기 폼) */
  labels: string[];
  /** 포커스된 필드 라벨 — 해당 라벨을 미리보기에서 강조·스크롤 */
  focusedLabel: string;
}

/** rhwp 문서 논리 커서 위치 */
interface Caret {
  sec: number;
  para: number;
  off: number;
}

export function PreviewPanel({ labelMode, labels, focusedLabel }: PreviewPanelProps) {
  const {
    page, setPage, pageCount, docVersion, loading, renderPage, findLabelPage,
    rhwpReady, rhwpHitTest, rhwpCursorRect, rhwpParagraphLength, rhwpInsertText, rhwpDeleteText,
  } = useDocumentSession();

  const previewRef = useRef<HTMLDivElement>(null);
  /** IME 입력 버퍼 — 한글 조합을 여기서 받아 compositionend에 삽입한다 */
  const imeRef = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);
  const [svg, setSvg] = useState("");
  const [renderError, setRenderError] = useState("");
  const [cursor, setCursor] = useState<Caret | null>(null);
  const [caretPos, setCaretPos] = useState<{ x: number; y: number; h: number } | null>(null);

  // 페이지/문서/어노테이션 변경 시 렌더 — 채우기 탭이면 라벨 어노테이션 추가
  useEffect(() => {
    if (loading) return;
    let cancelled = false;
    setRenderError("");
    (async () => {
      try {
        const out = await renderPage(page);
        const final = labelMode && labels.length > 0 ? annotateLabels(out, labels) : out;
        if (!cancelled) setSvg(final);
      } catch (e) {
        if (!cancelled) setRenderError(`미리보기 렌더 실패: ${e}`);
      }
    })();
    return () => { cancelled = true; };
  }, [page, docVersion, loading, renderPage, labelMode, labels]);

  // 포커스된 양식 필드 ↔ 미리보기 라벨 강조 + 스크롤(역점프). 없으면 라벨 페이지로 전환.
  useEffect(() => {
    const root = previewRef.current;
    if (!root) return;
    const matches = Array.from(root.querySelectorAll<SVGTextElement>("text[data-kd-label]"));
    matches.forEach((el) => {
      const hit = !!focusedLabel && el.getAttribute("data-kd-label") === focusedLabel;
      el.style.fill = hit ? "var(--color-accent)" : "";
      el.style.fontWeight = hit ? "bold" : "";
    });
    if (!focusedLabel) return;
    const first = matches.find((el) => el.getAttribute("data-kd-label") === focusedLabel);
    if (first) { first.scrollIntoView({ behavior: "smooth", block: "center" }); return; }
    const target = findLabelPage(focusedLabel);
    if (target >= 0 && target !== page) setPage(() => target);
  }, [focusedLabel, svg, findLabelPage, page, setPage]);

  // 미리보기 클릭 → 페이지 좌표 변환 → rhwp.hitTest → 커서 설정
  const handleClick = useCallback((e: React.MouseEvent) => {
    const root = previewRef.current;
    const el = root?.querySelector("svg") as SVGSVGElement | null;
    if (!root || !el) return;
    const rect = el.getBoundingClientRect();
    const vb = el.viewBox.baseVal;
    if (!vb || vb.width === 0 || rect.width === 0) return;
    const px = (e.clientX - rect.left) * (vb.width / rect.width);
    const py = (e.clientY - rect.top) * (vb.height / rect.height);
    const hit = rhwpHitTest(page, px, py);
    if (hit) {
      setCursor({ sec: hit.sectionIndex, para: hit.paragraphIndex, off: hit.charOffset });
      imeRef.current?.focus();
    }
  }, [page, rhwpHitTest]);

  // 커서 화면 좌표 계산 — 커서/편집(docVersion)/렌더(svg) 변경 시 재계산
  useEffect(() => {
    if (!cursor) { setCaretPos(null); return; }
    const root = previewRef.current;
    const el = root?.querySelector("svg") as SVGSVGElement | null;
    if (!root || !el) { setCaretPos(null); return; }
    const cr = rhwpCursorRect(cursor.sec, cursor.para, cursor.off);
    if (!cr) { setCaretPos(null); return; }
    const rect = el.getBoundingClientRect();
    const vb = el.viewBox.baseVal;
    if (!vb || vb.width === 0) { setCaretPos(null); return; }
    const sx = rect.width / vb.width;
    const sy = rect.height / vb.height;
    const rootRect = root.getBoundingClientRect();
    setCaretPos({
      x: (rect.left - rootRect.left) + root.scrollLeft + cr.x * sx,
      y: (rect.top - rootRect.top) + root.scrollTop + cr.y * sy,
      h: cr.height * sy,
    });
  }, [cursor, docVersion, svg, rhwpCursorRect]);

  // 커서 위치에 문자열 삽입 (영문/한글 공통) + 커서 전진
  const commitText = useCallback((text: string) => {
    if (!cursor || !text) return;
    const { sec, para, off } = cursor;
    if (rhwpInsertText(sec, para, off, text)) setCursor({ sec, para, off: off + text.length });
  }, [cursor, rhwpInsertText]);

  // 제어키(삭제/이동). 일반 문자·한글은 onInput/onCompositionEnd가 담당.
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (composingRef.current || !cursor || e.ctrlKey || e.metaKey || e.altKey) return;
    const { sec, para, off } = cursor;
    if (e.key === "Backspace") {
      e.preventDefault();
      if (off > 0 && rhwpDeleteText(sec, para, off - 1, 1)) setCursor({ sec, para, off: off - 1 });
    } else if (e.key === "Delete") {
      e.preventDefault();
      rhwpDeleteText(sec, para, off, 1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      if (off > 0) setCursor({ sec, para, off: off - 1 });
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      if (off < rhwpParagraphLength(sec, para)) setCursor({ sec, para, off: off + 1 });
    } else if (e.key === "Enter") {
      e.preventDefault(); // 문단 나누기는 후속 단계 — 줄바꿈이 버퍼에 누적되지 않게 차단
    }
  }, [cursor, rhwpDeleteText, rhwpParagraphLength]);

  // 영문/숫자/기호 — IME 조합이 아닐 때만 (한글은 onCompositionEnd가 처리)
  const handleInput = useCallback((e: React.FormEvent<HTMLTextAreaElement>) => {
    if (composingRef.current) return;
    const data = (e.nativeEvent as InputEvent).data;
    if (data) commitText(data);
    if (imeRef.current) imeRef.current.value = "";
  }, [commitText]);

  // 한글 등 IME 조합 완성 시 삽입
  const handleCompositionEnd = useCallback((e: React.CompositionEvent<HTMLTextAreaElement>) => {
    composingRef.current = false;
    if (e.data) commitText(e.data);
    if (imeRef.current) imeRef.current.value = "";
  }, [commitText]);

  const goPage = useCallback((updater: (p: number) => number) => {
    setCursor(null);
    setPage(updater);
  }, [setPage]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden" style={{ backgroundColor: "var(--color-bg-secondary)" }}>
      {/* 미리보기 캔버스 — 클릭해 커서 찍고 타이핑 */}
      <div
        ref={previewRef}
        className="kd-editor relative flex-1 overflow-auto px-8 py-6 outline-none"
        onClick={handleClick}
      >
        {renderError ? (
          <p className="ts-2xs text-center mt-8" style={{ color: "var(--color-error)" }}>{renderError}</p>
        ) : svg ? (
          <div
            className="kd-preview mx-auto rounded-md"
            style={{ maxWidth: 880, backgroundColor: "white", boxShadow: "var(--shadow-xl)" }}
            // rhwp WASM SVG (로컬 신뢰 소스)
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        ) : (
          <div className="flex items-center justify-center gap-2 mt-16" style={{ color: "var(--color-text-muted)" }}>
            <Loader2 size={16} className="animate-spin" /> <span className="ts-2xs">렌더링 중...</span>
          </div>
        )}

        {/* 인라인 커서 */}
        {caretPos && (
          <div
            className="kd-caret"
            style={{
              position: "absolute", left: caretPos.x, top: caretPos.y, height: caretPos.h,
              width: 2, backgroundColor: "var(--color-accent)", pointerEvents: "none",
            }}
          />
        )}

        {/* IME 입력 버퍼 — 커서 위치에 숨겨 한글 후보창이 커서 근처에 뜨게 한다 */}
        <textarea
          ref={imeRef}
          aria-hidden
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          style={{
            position: "absolute",
            left: caretPos?.x ?? -9999,
            top: caretPos?.y ?? -9999,
            height: caretPos?.h ?? 16,
            width: 1, padding: 0, margin: 0, border: "none", outline: "none",
            resize: "none", overflow: "hidden", opacity: 0,
            background: "transparent", caretColor: "transparent",
            whiteSpace: "nowrap", pointerEvents: "none",
          }}
          onKeyDown={handleKeyDown}
          onInput={handleInput}
          onCompositionStart={() => { composingRef.current = true; }}
          onCompositionEnd={handleCompositionEnd}
        />
      </div>

      {/* 하단 페이지 내비 */}
      <div
        className="flex items-center justify-center gap-3 py-2 shrink-0"
        style={{ borderTop: "1px solid var(--color-border)", backgroundColor: "var(--color-bg-primary)" }}
      >
        <button onClick={() => goPage((p) => Math.max(0, p - 1))} disabled={page === 0} className="p-1 rounded hover-bg-tertiary disabled:opacity-30" aria-label="이전 페이지">
          <ChevronLeft size={15} style={{ color: "var(--color-text-secondary)" }} />
        </button>
        <span className="ts-2xs tabular-nums" style={{ color: "var(--color-text-muted)" }}>
          {pageCount > 0 ? `${page + 1} / ${pageCount}` : "—"}
        </span>
        <button onClick={() => goPage((p) => Math.min(pageCount - 1, p + 1))} disabled={page >= pageCount - 1} className="p-1 rounded hover-bg-tertiary disabled:opacity-30" aria-label="다음 페이지">
          <ChevronRight size={15} style={{ color: "var(--color-text-secondary)" }} />
        </button>
        <span className="ts-2xs ml-2" style={{ color: "var(--color-text-muted)" }}>
          {rhwpReady ? (cursor ? "편집 중 · 클릭해 커서 이동" : "클릭해 편집") : "읽기 전용"}
        </span>
      </div>
    </div>
  );
}
