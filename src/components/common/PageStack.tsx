/**
 * 쪽 미리보기 더미 — 가상 스크롤: 화면 가까이(앞뒤 한 화면) 온 쪽만 자리를 만들고, 그 쪽들을 그려 달라고(onNeed) 한다.
 * 수만 쪽 문서도 DOM 에는 몇 쪽뿐. 쪽 그림은 PNG data URL(엔진 렌더) 또는 SVG Blob 주소(rhwp).
 * 작업대·공문서 만들기 미리보기에서 같이 쓴다.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { PagePreview } from "../../lib/contract";

const PT_TO_PX = 96 / 72;
const A4 = { w: 595, h: 842 };
const NUM_TOP = 8;
const NUM_H = 17;
const GAP = 18;
const EXTRA = NUM_TOP + NUM_H + GAP;

interface PageStackProps {
  pageCount: number;
  pages: Record<number, PagePreview | undefined>;
  /** 쪽 크기(pt, [폭0, 높이0, 폭1, …]) — 알면 그리기 전부터 제 비율로 자리를 잡는다 (rhwp) */
  sizes?: ArrayLike<number> | null;
  /** 지금 보이는 쪽 전부(보이는 쪽 먼저, 그다음 앞뒤 한 화면) — 바뀔 때마다 */
  onNeed?: (pages: number[]) => void;
  /** "fit" = 폭 맞춤, 숫자 = 실제 크기 배율 */
  zoom: number | "fit";
  /** frac: 쪽 안 위치(0~1)를 화면 위쪽 1/3 쯤에 (없으면 쪽 머리로) */
  scrollTo?: { page: number; frac?: number; nonce: number } | null;
  onCurrent?: (page: number) => void;
  maxFit?: number;
  /** 쪽 그림 위에 겹칠 것 (나란히 비교의 칠한 상자) — 쪽 칸 안에 꽉 차게 놓인다 */
  overlay?: (page: number) => ReactNode;
  /** 보는 자리(쪽, 쪽 안 비율)가 바뀔 때마다 */
  onView?: (page: number, frac: number) => void;
  /** 다른 쪽 더미를 따라 바로(부드럽게 말고) 그 자리로 */
  follow?: { page: number; frac: number; nonce: number } | null;
  /** 화면 읽기용 이름 (한 화면에 둘 이상일 때 갈라 부르게) */
  label?: string;
}

export function PageStack({ pageCount, pages, sizes, onNeed, zoom, scrollTo, onCurrent, maxFit = 860, overlay, onView, follow, label = "쪽 미리보기" }: PageStackProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [top, setTop] = useState(0);
  /** 보던 자리 (처음엔 없음: 맨 위) */
  const anchor = useRef<{ page: number; frac: number } | null>(null);

  // 안쪽 폭·보이는 높이
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const measure = () => {
      const cs = getComputedStyle(root);
      const width = root.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      setBox((b) => (b.width === width && b.height === root.clientHeight ? b : { width, height: root.clientHeight }));
    };
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    measure();
    return () => ro.disconnect();
  }, []);

  const fallback = useMemo(() => {
    if (sizes && sizes.length >= 2) return { w: sizes[0], h: sizes[1] };
    const p = Object.values(pages).find((x) => x?.width && x.height);
    return p ? { w: p.width, h: p.height } : A4;
  }, [sizes, sizes ? null : pages]);

  const sizeOf = (n: number) => {
    if (sizes && sizes.length >= n * 2) return { w: sizes[(n - 1) * 2], h: sizes[(n - 1) * 2 + 1] };
    const p = pages[n];
    return p?.width && p.height ? { w: p.width, h: p.height } : fallback;
  };
  const fitW = Math.max(120, Math.min(box.width || maxFit, maxFit));
  const slotW = (s: { w: number }) => (zoom === "fit" ? fitW : Math.round(s.w * PT_TO_PX * zoom));
  const slotH = (s: { w: number; h: number }) => Math.round((slotW(s) * s.h) / s.w);

  // 쪽마다 위쪽 위치 (쪽 크기를 모르는 PNG 는 받은 쪽이 생길 때마다 다시 잰다)
  const layout = useMemo(() => {
    const tops = new Float64Array(pageCount + 1);
    let y = 0;
    let maxW = 0;
    for (let n = 1; n <= pageCount; n++) {
      const s = sizeOf(n);
      tops[n - 1] = y;
      y += slotH(s) + EXTRA;
      maxW = Math.max(maxW, slotW(s));
    }
    tops[pageCount] = y;
    return { tops, total: y, maxW };
    // sizeOf·slotW 는 아래 값들로만 바뀐다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageCount, sizes, sizes ? null : pages, fallback, zoom, fitW]);

  const offset = () => bodyRef.current?.offsetTop ?? 0;
  /** y(쪽 더미 안 위치)가 든 쪽 (1부터) */
  const pageAt = (y: number) => {
    let lo = 0;
    let hi = Math.max(0, pageCount - 1);
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (layout.tops[mid] <= y) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };

  // 크기·배율이 바뀌어도 보던 쪽에 머문다
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || !pageCount) return;
    const a = anchor.current;
    if (!a) return;
    const p = Math.min(a.page, pageCount);
    const h = layout.tops[p] - layout.tops[p - 1];
    const want = offset() + layout.tops[p - 1] + a.frac * h;
    if (Math.abs(root.scrollTop - want) > 1) root.scrollTop = want;
    setTop(root.scrollTop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setTop(root.scrollTop));
    };
    root.addEventListener("scroll", onScroll, { passive: true });
    return () => { root.removeEventListener("scroll", onScroll); cancelAnimationFrame(raf); };
  }, []);

  const viewTop = top - offset();
  const view = box.height || 800;
  const first = pageCount ? pageAt(viewTop - view) : 1;
  const last = pageCount ? pageAt(viewTop + 2 * view) : 0;
  const visFirst = pageCount ? pageAt(viewTop) : 1;
  const visLast = pageCount ? pageAt(viewTop + view) : 0;
  const current = pageCount ? pageAt(viewTop + view * 0.35) : 1;

  // 보던 자리 기억 (배율 바꿀 때 되돌아갈 곳)
  useEffect(() => {
    if (!pageCount) return;
    if (viewTop <= 0) { anchor.current = null; onView?.(1, 0); return; } // 맨 위(여백 포함)면 맨 위에 머문다
    const p = pageAt(viewTop);
    const h = layout.tops[p] - layout.tops[p - 1];
    anchor.current = { page: p, frac: h ? (viewTop - layout.tops[p - 1]) / h : 0 };
    onView?.(p, anchor.current.frac);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [top]);

  useEffect(() => { if (pageCount) onCurrent?.(current); }, [current, pageCount, onCurrent]);

  // 보이는 쪽 먼저, 다음 아래 한 화면, 위 한 화면
  const rangeKey = `${first}-${last}-${visFirst}-${visLast}-${pageCount}`;
  useEffect(() => {
    if (!onNeed || !pageCount) return;
    const order: number[] = [];
    for (let n = visFirst; n <= visLast; n++) order.push(n);
    for (let n = visLast + 1; n <= last; n++) order.push(n);
    for (let n = visFirst - 1; n >= first; n--) order.push(n);
    const t = setTimeout(() => onNeed(order), 60);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeKey, onNeed]);

  /** 이미 따라간 요청 (요청 하나에 한 번) */
  const scrolledTo = useRef<unknown>(null);
  useEffect(() => {
    // 폭을 재기 전(처음 그릴 때)에는 쪽 위치가 가짜 폭 기준이다 → 그때 움직이면 좁은 칸에서 뒤쪽으로 밀린다.
    // 폭과 쪽 수를 안 뒤에 한 번 움직인다 (근거 번호·지적을 눌러 처음 여는 문서)
    if (!scrollTo || !pageCount || !box.width || scrolledTo.current === scrollTo) return;
    scrolledTo.current = scrollTo;
    const p = Math.min(Math.max(1, scrollTo.page), pageCount);
    const inPage = scrollTo.frac != null ? scrollTo.frac * slotH(sizeOf(p)) - view / 3 : -16;
    rootRef.current?.scrollTo({ top: offset() + layout.tops[p - 1] + inPage, behavior: "smooth" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollTo, box.width, pageCount]);

  useEffect(() => {
    const root = rootRef.current;
    if (!follow || !pageCount || !root) return;
    const p = Math.min(Math.max(1, follow.page), pageCount);
    const h = layout.tops[p] - layout.tops[p - 1];
    root.scrollTop = offset() + layout.tops[p - 1] + follow.frac * h;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [follow]);

  const slots = [];
  for (let n = first; n <= last; n++) {
    const s = sizeOf(n);
    const h = slotH(s);
    const p = pages[n];
    slots.push(
      <div key={n} data-page={n} className="kd-page-slot" style={{ position: "absolute", top: layout.tops[n - 1], left: 0, right: 0, width: slotW(s) }}>
        {p ? (
          <img className="kd-page" src={p.data_url} alt={`${n}쪽`} style={{ width: "100%", height: h }} draggable={false} decoding="async" />
        ) : (
          <div className="kd-page-blank kd-skel" role="img" aria-label={`${n}쪽 그리는 중`} style={{ width: "100%", height: h }} />
        )}
        {overlay && p && <div className="kd-page-overlay" aria-hidden="true" style={{ height: h }}>{overlay(n)}</div>}
        <div className="kd-page-num" style={{ margin: `${NUM_TOP}px 0 0`, height: NUM_H, lineHeight: `${NUM_H}px` }}>{n} / {pageCount}쪽</div>
      </div>,
    );
  }

  return (
    <div ref={rootRef} className="kd-desk kd-pagestack" tabIndex={0} aria-label={label}>
      <div ref={bodyRef} style={{ position: "relative", height: layout.total, minWidth: layout.maxW }}>{slots}</div>
    </div>
  );
}
