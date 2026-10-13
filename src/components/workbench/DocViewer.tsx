/** 가운데 미리보기 — 쪽 그림(보이는 쪽만) 또는 글 보기(convert)
 *
 * HWP·HWPX 쪽 그림은 rhwp(편집기·PDF 와 같은 조판, 화면 안 일꾼에서 SVG)로 그린다.
 * rhwp 가 못 열거나 쪽이 아주 많으면 엔진 렌더(render_pages, PNG)로. PDF·이미지는 엔진 렌더.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Minus, Plus, ScanText, Maximize2 } from "lucide-react";
import type { DocInfo, PagePreview } from "../../lib/contract";
import type { OpenDoc } from "../../state/app";
import { rpc, errorText } from "../../lib/rpc";
import { toRanges } from "../../lib/format";
import { useTask } from "../../hooks/useTask";
import { Button } from "../ui/Button";
import { MarkdownViewer } from "../ui/MarkdownViewer";
import { PageStack } from "../common/PageStack";
import { useRhwpPages } from "../common/useRhwpPages";
import { readBytes, rhwpWorth } from "../../lib/rhwp-preview";
import { Seg } from "../common/Field";
import { Empty, ErrorLine, Note, Working } from "../common/Status";

const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2];

/** live: 지금 문서·바로 전 문서만 쪽 그림 일꾼과 쪽 그림을 들고 있는다. 아니면 놓았다가 다시 보일 때 처음처럼 연다 */
export function DocViewer({ doc, info, scrollTo, live, onPageCount }: {
  doc: OpenDoc; info: DocInfo; scrollTo: { page: number; nonce: number } | null; live: boolean; onPageCount: (n: number) => void;
}) {
  const [mode, setMode] = useState<"pages" | "text">(info.has_layout ? "pages" : "text");
  const [pages, setPages] = useState<Record<number, PagePreview>>({});
  const [pageCount, setPageCount] = useState(info.page_count ?? 1);
  const [current, setCurrent] = useState(1);
  const [zoom, setZoom] = useState<number | "fit">("fit");
  const [renderError, setRenderError] = useState("");
  /** 암호 문서인데 쪽 모양을 못 그렸다 (rhwp·엔진 렌더가 아직 암호를 못 푼다) → 글 보기만 */
  const [pagesOff, setPagesOff] = useState(false);
  /** 쪽 그림을 누가 그리나 — null 은 아직 정하는 중 */
  const [engine, setEngine] = useState<"rhwp" | "kordoc" | null>(null);
  const rh = useRhwpPages();
  const inflight = useRef(new Set<number>());
  /** 쪽 그림을 놓을 때마다 올린다 — 그 전에 보낸 엔진 렌더 결과는 버린다 */
  const gen = useRef(0);
  const text = useTask<string>();
  const ocr = useTask<string>();
  const pw = doc.password ? { password: doc.password } : {};

  const need = useCallback(async (nums: number[]) => {
    const todo = nums.filter((n) => !inflight.current.has(n));
    if (!todo.length) return;
    todo.forEach((n) => inflight.current.add(n));
    const g = gen.current;
    const maxWidth = Math.round(Math.min(1800, 900 * (window.devicePixelRatio || 1)));
    for (let i = 0; i < todo.length; i += 4) {
      const chunk = todo.slice(i, i + 4);
      try {
        const r = await rpc("render_pages", { path: doc.path, pages: toRanges(chunk), max_width: maxWidth, ...pw });
        if (g !== gen.current) return;
        setPageCount(r.page_count);
        setPages((prev) => {
          const next = { ...prev };
          for (const p of r.pages) next[p.page] = p;
          return next;
        });
      } catch (e) {
        if (g !== gen.current) return;
        const msg = errorText(e);
        chunk.forEach((n) => inflight.current.delete(n));
        if (msg.startsWith("NO_LAYOUT")) { setMode("text"); return; }
        if (info.encrypted) { setPagesOff(true); setMode("text"); return; }
        setRenderError(msg);
        return;
      }
    }
    // doc.password 는 문서마다 고정
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.path]);

  // rhwp 로 열어 보고, 안 되면 엔진 렌더로. 살려 둘 문서에서 빠지면 일꾼(WASM)과 쪽 그림을 놓는다
  useEffect(() => {
    if (!info.has_layout || !live) return;
    const release = () => {
      gen.current++;
      rh.close();
      inflight.current.clear();
      setPages({});
      setEngine(null);
    };
    if (!rhwpWorth(info.format, info.page_count)) { setEngine("kordoc"); return release; }
    let cancelled = false;
    readBytes(doc.path)
      .then((bytes) => (cancelled ? false : rh.open(bytes, doc.password ? { password: doc.password } : undefined)))
      .then((ok) => { if (!cancelled && ok) setEngine("rhwp"); })
      .catch(() => { if (!cancelled) setEngine("kordoc"); });
    return () => { cancelled = true; release(); };
    // 문서마다, 살려 둘 때마다 (암호는 문서마다 고정)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.path, live]);

  // 쪽 그리기가 도중에 실패하면 엔진 렌더로
  useEffect(() => { if (rh.error) setEngine("kordoc"); }, [rh.error]);

  // 미리보기가 센 쪽수(rhwp 가 그리면 그 조판, 아니면 엔진 렌더)를 문서 정보에 맞춘다 (쪽수 정본 하나)
  const shownPages = engine === "rhwp" ? rh.pageCount : engine === "kordoc" && Object.keys(pages).length ? pageCount : 0;
  useEffect(() => {
    if (shownPages > 0) onPageCount(shownPages);
    // 센 값이 바뀔 때만
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownPages]);

  // 글 보기는 처음 고를 때 한 번 읽는다
  useEffect(() => {
    if (mode !== "text" || text.result != null || text.busy || text.error || ocr.result) return;
    void text.run(() => rpc("convert", { path: doc.path, format: "md", save: false, ...pw }).then((r) => r.content));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, doc.path]);

  const runOcr = () => void ocr.run(async ({ signal, onProgress }) => {
    const r = await rpc("ocr", { input_path: doc.path }, { signal, onProgress });
    setMode("text");
    return r.markdown;
  });

  const zoomStep = (dir: 1 | -1) => {
    const cur = zoom === "fit" ? 1 : zoom;
    const idx = ZOOMS.findIndex((z) => z >= cur);
    const next = ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, (idx < 0 ? ZOOMS.length - 1 : idx) + dir))];
    setZoom(next);
  };

  const markdown = ocr.result ?? text.result;

  return (
    <section className="kd-viewer" aria-label="문서 미리보기">
      <div className="kd-toolbar">
        <Seg label="보기 방식" value={mode} onChange={setMode}
          options={[{ value: "pages", label: "쪽 보기", disabled: !info.has_layout || pagesOff }, { value: "text", label: "글 보기" }]} />
        {mode === "pages" && (
          <>
            <span className="kd-small kd-muted kd-num" aria-live="polite">{current} / {engine === "rhwp" ? rh.pageCount : pageCount}쪽</span>
            <span className="kd-toolbar-gap" />
            <button type="button" className="kd-icon-btn" onClick={() => zoomStep(-1)} aria-label="작게 보기"><Minus size={15} /></button>
            <span className="kd-small kd-num kd-zoom">{zoom === "fit" ? "폭 맞춤" : `${Math.round(zoom * 100)}%`}</span>
            <button type="button" className="kd-icon-btn" onClick={() => zoomStep(1)} aria-label="크게 보기"><Plus size={15} /></button>
            <button type="button" className="kd-icon-btn" aria-pressed={zoom === "fit"} onClick={() => setZoom("fit")} aria-label="폭 맞춤"><Maximize2 size={14} /></button>
          </>
        )}
        {mode === "text" && <span className="kd-toolbar-gap" />}
      </div>

      {info.needs_ocr && !ocr.result && (
        <div className="px-4 pt-3">
          {ocr.busy ? <Working label="스캔한 쪽의 글자를 읽는 중" progress={ocr.progress} onCancel={ocr.cancel} /> : (
            <Note tone="info">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>스캔한 쪽이 있습니다. 글자를 고르거나 찾으려면 글자 읽기(OCR)를 돌리세요.</span>
                <Button size="sm" variant="secondary" onClick={runOcr}><ScanText size={13} /> 글자 읽기</Button>
              </div>
            </Note>
          )}
          <ErrorLine message={ocr.error} />
        </div>
      )}

      {mode === "pages" ? (
        renderError ? <div className="p-6"><Note tone="err">쪽 그림을 그리지 못했습니다: {renderError}</Note></div> : (
          engine === "rhwp"
            ? <PageStack pageCount={rh.pageCount} sizes={rh.sizes} pages={rh.pages} onNeed={rh.need} zoom={zoom} scrollTo={scrollTo} onCurrent={setCurrent} />
            : <PageStack pageCount={pageCount} pages={pages} onNeed={engine === "kordoc" ? need : undefined} zoom={zoom} scrollTo={scrollTo} onCurrent={setCurrent} />
        )
      ) : (
        <div className="kd-textview">
          {pagesOff && <Note tone="info">암호가 걸린 문서라 쪽 모양은 아직 보여 드리지 못합니다. 글 보기로 내용을 확인하세요.</Note>}
          {text.busy && <Empty title="글을 뽑는 중" />}
          <ErrorLine message={text.error} />
          {/* 글자 수는 정보 탭 하나로 (여기서는 세지 않는다). 글 파일(.txt·.csv)은 마크다운으로 해석하지 않고 그대로 */}
          {markdown != null && (markdown.trim() ? <MarkdownViewer markdown={markdown} fillHeight plain={!ocr.result && (info.format === "txt" || info.format === "csv")} /> : <Empty title="뽑을 글이 없습니다">그림만 있는 문서라면 글자 읽기(OCR)를 돌려 보세요.</Empty>)}
        </div>
      )}
    </section>
  );
}
