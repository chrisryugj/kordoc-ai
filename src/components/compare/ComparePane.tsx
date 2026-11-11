/** 나란히 비교의 한 칸 — 문서 쪽을 실제 모양으로 그리고(HWP·HWPX 는 rhwp, PDF 는 엔진 렌더) 바뀐 곳 상자를 겹친다
 *
 * 상자 좌표는 쪽 비율(엔진 compare_visual)이라 배율과 상관없다. 칸 자체가 끌어다 놓는 자리라 그 칸 문서만 바꿀 수 있다.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PagePreview, VisualMark, VisualSide } from "../../lib/contract";
import { rpc, errorText } from "../../lib/rpc";
import { baseName, formatOf, toRanges } from "../../lib/format";
import { readBytes, rhwpWorth } from "../../lib/rhwp-preview";
import { useApp } from "../../state/app";
import { PageStack } from "../common/PageStack";
import { useRhwpPages } from "../common/useRhwpPages";
import { FormatBadge } from "../common/FormatBadge";
import { Note } from "../common/Status";

export function ComparePane({ id, label, path, side, active, onPick, scrollTo, follow, onView, onLead, zoom }: {
  id: string;
  label: string;
  path: string;
  side: VisualSide;
  /** 고른 바뀜 (그 상자를 진하게) */
  active: number | null;
  onPick: (change: number) => void;
  scrollTo: { page: number; frac?: number; nonce: number } | null;
  follow: { page: number; frac: number; nonce: number } | null;
  onView: (page: number, frac: number) => void;
  /** 마우스·키보드가 이 칸에 있다 (같이 넘기기의 앞장) */
  onLead: () => void;
  zoom: number | "fit";
}) {
  const { dragTarget } = useApp();
  const rh = useRhwpPages();
  const [engine, setEngine] = useState<"rhwp" | "kordoc" | null>(null);
  const [pages, setPages] = useState<Record<number, PagePreview>>({});
  const [error, setError] = useState("");
  /** 엔진 그림으로 바꿔 그릴 때 엔진이 센 쪽 수 (rhwp 조판과 다를 수 있다) */
  const [drawn, setDrawn] = useState<number | null>(null);
  /** 쪽 번호로만 옮기는 요청 — 요청이 바뀔 때만 새 객체로 (그릴 때마다 새로 만들면 쪽 그림이 올 때마다 처음 누른 쪽으로 끌려간다) */
  const pageOnly = useMemo(() => scrollTo && { page: scrollTo.page, nonce: scrollTo.nonce }, [scrollTo]);
  const inflight = useRef(new Set<number>());
  const fmt = formatOf(path);
  const pageCount = side.pages.length;
  /** 한글 문서를 rhwp 로 못 열어 엔진 렌더로 바꿨다: 상자는 rhwp 조판 기준이라 겹치지 않는다 */
  const fallback = fmt !== "pdf" && engine === "kordoc";

  // 쪽 수는 엔진이 같은 조판으로 센 값 (상자 쪽 번호와 같다)
  useEffect(() => {
    inflight.current.clear();
    setPages({});
    setError("");
    if (!rhwpWorth(fmt, pageCount)) { setEngine("kordoc"); return; }
    let cancelled = false;
    readBytes(path)
      .then((bytes) => (cancelled ? false : rh.open(bytes)))
      .then((ok) => { if (!cancelled && ok) setEngine("rhwp"); })
      .catch(() => { if (!cancelled) setEngine("kordoc"); });
    return () => { cancelled = true; rh.close(); setEngine(null); };
    // 문서마다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);
  useEffect(() => { if (rh.error) setEngine("kordoc"); }, [rh.error]);

  const need = useCallback(async (nums: number[]) => {
    const todo = nums.filter((n) => !inflight.current.has(n));
    if (!todo.length) return;
    todo.forEach((n) => inflight.current.add(n));
    const maxWidth = Math.round(Math.min(1800, 900 * (window.devicePixelRatio || 1)));
    for (let i = 0; i < todo.length; i += 4) {
      const chunk = todo.slice(i, i + 4);
      try {
        const r = await rpc("render_pages", { path, pages: toRanges(chunk), max_width: maxWidth });
        setDrawn(r.page_count);
        setPages((prev) => {
          const next = { ...prev };
          for (const p of r.pages) next[p.page] = p;
          return next;
        });
      } catch (e) {
        chunk.forEach((n) => inflight.current.delete(n));
        setError(errorText(e));
        return;
      }
    }
  }, [path]);

  const byPage = useMemo(() => {
    const m = new Map<number, VisualMark[]>();
    for (const x of side.marks) m.set(x.page, [...(m.get(x.page) ?? []), x]);
    return m;
  }, [side]);

  const overlay = useCallback((n: number) => (byPage.get(n) ?? []).map((m, i) => (
    <button
      key={i}
      type="button"
      tabIndex={-1}
      className="kd-cmp-mark"
      data-kind={m.kind}
      data-active={active === m.change || undefined}
      style={{ left: `${m.x * 100}%`, top: `${m.y * 100}%`, width: `${m.w * 100}%`, height: `${m.h * 100}%` }}
      onClick={() => onPick(m.change)}
      aria-label={m.kind === "gap" ? "다른 문서에만 있는 내용 자리" : "바뀐 곳"}
    />
  )), [byPage, active, onPick]);

  // 쪽 크기를 PageStack 의 pt 로 (엔진 단위: rhwp 는 96dpi px, PDF 는 pt)
  const sizes = useMemo(() => {
    const k = fmt === "pdf" ? 1 : 72 / 96;
    const a = new Float32Array(pageCount * 2);
    side.pages.forEach((p, i) => { a[i * 2] = p.width * k; a[i * 2 + 1] = p.height * k; });
    return a;
  }, [side, pageCount, fmt]);

  return (
    <section className="kd-cmp-pane" data-drop={id} data-over={dragTarget === id} aria-label={label} onMouseEnter={onLead} onFocus={onLead}>
      <header className="kd-cmp-pane-head">
        <span className="kd-label">{label}</span>
        <FormatBadge format={fmt} />
        <span className="kd-cmp-pane-name" title={path}>{baseName(path)}</span>
      </header>
      {fallback && !error && <div className="px-3 pt-2"><Note tone="info">이 문서는 미리보기를 열지 못해 바뀐 곳 표시 없이 보여 줍니다. 대조표로 보세요.</Note></div>}
      {error ? <div className="p-4"><Note tone="err">쪽 그림을 그리지 못했습니다: {error}</Note></div> : (
        engine === "rhwp"
          ? <PageStack label={`${label} 쪽 미리보기`} pageCount={rh.pageCount} sizes={rh.sizes} pages={rh.pages} onNeed={rh.need} zoom={zoom} scrollTo={scrollTo} follow={follow} onView={onView} overlay={overlay} maxFit={1200} />
          : fallback
            // 상자·쪽 안 자리는 rhwp 조판 기준이라 쓰지 않고 쪽 번호로만 옮긴다
            ? <PageStack label={`${label} 쪽 미리보기`} pageCount={drawn ?? pageCount} pages={pages} onNeed={need} zoom={zoom} scrollTo={pageOnly} maxFit={1200} />
            : <PageStack label={`${label} 쪽 미리보기`} pageCount={pageCount} sizes={sizes} pages={pages} onNeed={engine === "kordoc" ? need : undefined} zoom={zoom} scrollTo={scrollTo} follow={follow} onView={onView} overlay={overlay} maxFit={1200} />
      )}
    </section>
  );
}
