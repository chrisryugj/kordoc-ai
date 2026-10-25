/**
 * 쪽 격자: 쪽 그림 카드 + 쪽 사이 가위(나눌 자리). 누르기·Ctrl·Shift 고르기, 빈 곳을 끌어 여러 쪽 고르기, 쪽을 끌어 옮기기.
 * 끌기는 포인터 이벤트로 한다 (HTML 끌어 놓기는 창의 파일 놓기 처리와 부딪친다). 키보드: 화살표·Home·End·Space·Shift·Ctrl,
 * 그 밖의 키(돌리기·지우기 …)는 onKey 로 넘긴다. 보이는 쪽만 그림을 받는다 (IntersectionObserver).
 */

import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Check, Scissors } from "lucide-react";
import { clickSelect, fileOf, shownSize, type Board, type PageItem, type Selection } from "./model";
import type { Thumbs } from "./useThumbs";

interface Props {
  board: Board;
  sel: Selection;
  focus: string | null;
  /** 쪽 그림 칸 한 변(px) */
  size: number;
  thumbs: Thumbs;
  /** 나눌 자리가 있으면 새 파일이 시작하는 쪽마다 몇 번째 파일인지 */
  groups: Map<string, number> | null;
  /** 탐색기에서 파일을 끌어 책상 위에 올렸을 때 */
  dropOver: boolean;
  onSelect: (s: Selection) => void;
  onFocus: (key: string | null) => void;
  onMove: (keys: Set<string>, to: number) => void;
  onCut: (key: string) => void;
  onMenu: (key: string, x: number, y: number) => void;
  onOpen: (key: string) => void;
  onKey: (e: KeyboardEvent<HTMLDivElement>, key: string | null) => void;
  /** 크게 보기처럼 위에 뜬 창이 키를 받는 동안 (격자는 키를 무시) */
  keysOff?: boolean;
}

interface Drag {
  id: number;
  key: string | null;
  x: number;
  y: number;
  mod: { toggle: boolean; range: boolean };
  mode: "press" | "move" | "marquee";
  keys: Set<string>;
  base: Set<string>;
}

const GAP_X = 22;

export function PageGrid(p: Props) {
  const { board, sel, focus, size, thumbs } = p;
  const deskRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const [caret, setCaret] = useState<{ left: number; top: number; height: number } | null>(null);
  const [ghost, setGhost] = useState<{ x: number; y: number; n: number } | null>(null);
  const [marquee, setMarquee] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const target = useRef<number>(-1);
  const pointer = useRef({ x: 0, y: 0 });
  const scrollRaf = useRef(0);
  const visible = useRef(new Set<string>());
  const props = useRef(p);
  props.current = p;

  // ── 보이는 쪽만 그림 받기 ──
  const observer = useRef<IntersectionObserver | null>(null);
  const items = useRef(board.items);
  items.current = board.items;
  const wantKey = useCallback((key: string) => {
    const b = props.current.board;
    const it = b.items.find((x) => x.key === key);
    const f = it && fileOf(b, it);
    if (it && f) props.current.thumbs.want(f.source, it.page);
  }, []);
  useEffect(() => {
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const key = (e.target as HTMLElement).dataset.key!;
        if (e.isIntersecting) { visible.current.add(key); wantKey(key); } else visible.current.delete(key);
      }
    }, { root: deskRef.current, rootMargin: "600px 0px" });
    observer.current = io;
    gridRef.current?.querySelectorAll<HTMLElement>(".kd-pg").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [wantKey]);
  // 칸이 커지거나 쪽이 바뀌면 보이는 쪽을 다시 본다
  useEffect(() => { visible.current.forEach(wantKey); }, [thumbs.version, size, board, wantKey]);
  const observe = useCallback((el: HTMLElement | null) => {
    if (!el) return;
    observer.current?.observe(el);
    return () => observer.current?.unobserve(el);
  }, []);

  // ── 키보드 초점이 옮겨 가면 그 카드로 ──
  const focusFromKeys = useRef(false);
  useLayoutEffect(() => {
    if (!focusFromKeys.current || !focus) return;
    focusFromKeys.current = false;
    // 그사이 이름 칸 같은 데로 옮겨 간 초점은 빼앗지 않는다
    const active = document.activeElement;
    if (active && active !== document.body && !deskRef.current?.contains(active)) return;
    const el = gridRef.current?.querySelector<HTMLElement>(`[data-key="${focus}"]`);
    el?.focus({ preventScroll: true });
    el?.scrollIntoView({ block: "nearest" });
  }, [focus, board]);
  const armFocus = () => {
    focusFromKeys.current = true;
    // 초점·쪽이 안 바뀐 키(고른 쪽 없이 Delete 등) 뒤에 표시가 남아 나중에 초점을 빼앗지 않게
    requestAnimationFrame(() => requestAnimationFrame(() => { focusFromKeys.current = false; }));
  };

  const cards = () => [...(gridRef.current?.querySelectorAll<HTMLElement>(".kd-pg") ?? [])];

  /** 놓을 자리 (그 쪽 앞, 끝이면 items.length) + 표시선 (줄 끝에 놓으면 그 줄 마지막 쪽 오른쪽에) */
  const dropAt = (x: number, y: number) => {
    const els = cards();
    const grid = gridRef.current;
    if (!els.length || !grid) return { index: 0, mark: null };
    const g = grid.getBoundingClientRect();
    const rects = els.map((el) => el.getBoundingClientRect());
    const mark = (r: DOMRect, after: boolean) => ({ left: (after ? r.right + GAP_X / 2 : r.left - GAP_X / 2) - g.left, top: r.top - g.top, height: r.height });
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i];
      const rowEnd = i === rects.length - 1 || rects[i + 1].top > r.top + 1;
      if (y < r.top - 10 || (y <= r.bottom + 10 && x < r.left + r.width / 2)) return { index: i, mark: mark(r, false) };
      if (y <= r.bottom + 10 && rowEnd) return { index: i + 1, mark: mark(r, true) };
    }
    return { index: rects.length, mark: mark(rects[rects.length - 1], true) };
  };

  const autoscroll = () => {
    cancelAnimationFrame(scrollRaf.current);
    const step = () => {
      const d = drag.current;
      const desk = deskRef.current;
      if (!d || d.mode === "press" || !desk) return;
      const r = desk.getBoundingClientRect();
      const { y } = pointer.current;
      const v = y < r.top + 48 ? -Math.ceil((r.top + 48 - y) / 4) : y > r.bottom - 48 ? Math.ceil((y - r.bottom + 48) / 4) : 0;
      if (v) {
        desk.scrollTop += v;
        moveTo(pointer.current.x, pointer.current.y);
      }
      scrollRaf.current = requestAnimationFrame(step);
    };
    scrollRaf.current = requestAnimationFrame(step);
  };

  const moveTo = (x: number, y: number) => {
    const d = drag.current;
    if (!d) return;
    if (d.mode === "move") {
      const at = dropAt(x, y);
      target.current = at.index;
      setCaret(at.mark);
      setGhost({ x, y, n: d.keys.size });
    } else if (d.mode === "marquee") {
      const grid = gridRef.current!.getBoundingClientRect();
      const box = { left: Math.min(x, d.x), top: Math.min(y, d.y), right: Math.max(x, d.x), bottom: Math.max(y, d.y) };
      setMarquee({ left: box.left - grid.left, top: box.top - grid.top, width: box.right - box.left, height: box.bottom - box.top });
      const hit = cards().filter((el) => {
        const r = el.getBoundingClientRect();
        return r.left < box.right && r.right > box.left && r.top < box.bottom && r.bottom > box.top;
      }).map((el) => el.dataset.key!);
      props.current.onSelect({ keys: new Set([...d.base, ...hit]), anchor: hit[0] ?? null });
    }
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button, input, a")) return;
    const card = (e.target as HTMLElement).closest<HTMLElement>(".kd-pg");
    const mod = { toggle: e.ctrlKey || e.metaKey, range: e.shiftKey };
    drag.current = { id: e.pointerId, key: card?.dataset.key ?? null, x: e.clientX, y: e.clientY, mod, mode: "press", keys: new Set(), base: mod.toggle || mod.range ? new Set(sel.keys) : new Set() };
    pointer.current = { x: e.clientX, y: e.clientY };
    if (card) card.focus({ preventScroll: true });
    else deskRef.current?.focus({ preventScroll: true });
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    if (e.buttons === 0) { dropDrag(); return; }
    pointer.current = { x: e.clientX, y: e.clientY };
    if (d.mode === "press") {
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 6) return;
      if (d.key) {
        // 고른 쪽을 잡으면 고른 쪽 모두, 아니면 그 쪽만
        const keys = sel.keys.has(d.key) ? new Set(sel.keys) : new Set([d.key]);
        if (!sel.keys.has(d.key)) props.current.onSelect({ keys, anchor: d.key });
        d.keys = keys;
        d.mode = "move";
      } else d.mode = "marquee";
      // 끌기를 시작한 뒤에만 잡는다 (누르기만 할 때 잡으면 두 번 누르기가 카드에 안 온다)
      deskRef.current?.setPointerCapture(e.pointerId);
      autoscroll();
    }
    moveTo(e.clientX, e.clientY);
  };

  const endDrag = (e: PointerEvent<HTMLDivElement>, cancel = false) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    cancelAnimationFrame(scrollRaf.current);
    if (deskRef.current?.hasPointerCapture(e.pointerId)) deskRef.current.releasePointerCapture(e.pointerId);
    setCaret(null);
    setGhost(null);
    setMarquee(null);
    if (cancel) return;
    if (d.mode === "move") {
      if (target.current >= 0) props.current.onMove(d.keys, target.current);
    } else if (d.mode === "press") {
      if (d.key) {
        props.current.onSelect(clickSelect(items.current, sel, d.key, d.mod));
        props.current.onFocus(d.key);
      } else if (!d.mod.toggle && !d.mod.range) props.current.onSelect({ keys: new Set(), anchor: null });
    }
  };

  // ── 키보드 ──
  const columns = () => {
    const els = cards();
    if (!els.length) return 1;
    const top = els[0].offsetTop;
    const n = els.findIndex((el) => el.offsetTop !== top);
    return n < 0 ? els.length : n;
  };

  /** 끌기를 버린다 (Esc·우클릭·손을 뗀 채 들어온 포인터): 표시를 지우고 잡은 포인터를 놓는다. 그 뒤 움직임·놓기는 무시 */
  const dropDrag = () => {
    const d = drag.current;
    drag.current = null;
    cancelAnimationFrame(scrollRaf.current);
    setCaret(null); setGhost(null); setMarquee(null);
    if (d && deskRef.current?.hasPointerCapture(d.id)) deskRef.current.releasePointerCapture(d.id);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (p.keysOff || (e.target as HTMLElement).closest("input, textarea, select")) return;
    if (drag.current && e.key === "Escape") {
      dropDrag();
      e.preventDefault();
      return;
    }
    const list = board.items;
    const i = focus ? list.findIndex((it) => it.key === focus) : -1;
    const step: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns(), ArrowDown: columns() };
    if (!e.altKey && (e.key in step || e.key === "Home" || e.key === "End") && list.length) {
      e.preventDefault();
      const j = e.key === "Home" ? 0 : e.key === "End" ? list.length - 1 : i < 0 ? 0 : Math.min(list.length - 1, Math.max(0, i + step[e.key]));
      const key = list[j].key;
      armFocus();
      p.onFocus(key);
      if (e.shiftKey) p.onSelect(clickSelect(list, sel.anchor ? sel : { keys: sel.keys, anchor: focus ?? key }, key, { range: true }));
      else if (!(e.ctrlKey || e.metaKey)) p.onSelect({ keys: new Set([key]), anchor: key });
      return;
    }
    if (e.key === " " && focus) {
      e.preventDefault();
      p.onSelect(clickSelect(list, sel, focus, { toggle: true }));
      return;
    }
    if (e.key === "Enter" && focus) {
      e.preventDefault();
      p.onOpen(focus);
      return;
    }
    p.onKey(e, focus);
    // 지우기 같은 키 뒤에는 남은 쪽으로 초점을 옮긴다 (처리한 키만)
    if (e.defaultPrevented) armFocus();
  };

  // 초점 쪽이 지워졌으면(파일 빼기 등) 첫 쪽이 Tab 으로 닿게
  const tabKey = focus && board.items.some((it) => it.key === focus) ? focus : board.items[0]?.key;

  return (
    <div ref={deskRef} className="kd-pdf-desk" data-drop="pdf" data-over={p.dropOver} tabIndex={-1} onPointerDown={onPointerDown} onPointerMove={onPointerMove}
      onPointerUp={(e) => endDrag(e)} onPointerCancel={(e) => endDrag(e, true)} onKeyDown={onKeyDown}
      // 우클릭(맥은 Control+누르기)은 메뉴만: 손을 뗄 때 고르기를 바꾸지 않고, 끌던 중이면 끌기를 버린다
      onContextMenu={dropDrag}>
      <div ref={gridRef} className="kd-pdf-grid" role="listbox" aria-multiselectable="true" aria-label="쪽 목록. 화살표로 옮겨 가고 Space 로 고릅니다"
        style={{ "--pg": `${size}px`, "--pg-gap": `${GAP_X}px` } as React.CSSProperties}>
        {board.items.map((it, i) => {
          const f = fileOf(board, it);
          return (
            <Card key={it.key} it={it} index={i} board={board} size={size} selected={sel.keys.has(it.key)} focused={tabKey === it.key}
              cut={board.cuts.includes(it.key)} group={p.groups?.get(it.key)} url={f ? thumbs.get(f.source, it.page) : undefined} observe={observe}
              onCut={p.onCut} onMenu={p.onMenu} onOpen={p.onOpen} onFocus={p.onFocus} />
          );
        })}
        {caret && <div className="kd-pdf-caret" style={{ left: caret.left - 1.5, top: caret.top, height: caret.height }} aria-hidden="true" />}
        {marquee && <div className="kd-pdf-marquee" style={marquee} aria-hidden="true" />}
      </div>
      {ghost && <div className="kd-pdf-ghost" style={{ left: ghost.x + 14, top: ghost.y + 14 }} aria-hidden="true">{ghost.n}쪽 옮기기</div>}
    </div>
  );
}

interface CardProps {
  it: PageItem;
  index: number;
  board: Board;
  size: number;
  selected: boolean;
  focused: boolean;
  cut: boolean;
  group?: number;
  url?: string;
  observe: (el: HTMLElement | null) => (() => void) | undefined;
  onCut: (key: string) => void;
  onMenu: (key: string, x: number, y: number) => void;
  onOpen: (key: string) => void;
  onFocus: (key: string | null) => void;
}

const Card = memo(function Card({ it, index, board, size, selected, focused, cut, group, url, observe, onCut, onMenu, onOpen, onFocus }: CardProps) {
  const f = fileOf(board, it);
  const base = it.blank ?? f?.sizes[it.page - 1] ?? { width: 595, height: 842 };
  const shown = shownSize(board, it);
  // 칸에 맞춘 배율 (돌린 뒤 보이는 크기 기준), 그림은 원래 방향으로 두고 돌린다
  const s = Math.min((size - 8) / shown.width, (size - 8) / shown.height);
  const w = base.width * s;
  const h = base.height * s;
  // 표시(고름·새 파일 번호)는 돌린 뒤 보이는 종이 모서리에 붙인다
  const inset = { x: (size - shown.width * s) / 2 - 7, y: (size - shown.height * s) / 2 - 7 };
  const where = it.blank ? "빈 쪽" : `${f?.name ?? ""} ${it.page}쪽`;
  return (
    <div ref={observe} role="option" aria-selected={selected} tabIndex={focused ? 0 : -1} data-key={it.key} className="kd-pg" data-sel={selected} data-cut={cut}
      aria-label={`${index + 1}번째 쪽, ${where}${it.rotate ? `, ${it.rotate}도 돌림` : ""}${cut ? ", 이 쪽부터 새 파일" : ""}`}
      onFocus={() => onFocus(it.key)} onDoubleClick={() => onOpen(it.key)}
      onContextMenu={(e) => { e.preventDefault(); onMenu(it.key, e.clientX, e.clientY); }}>
      {index > 0 && (
        <button type="button" className="kd-pg-cut" tabIndex={-1} aria-pressed={cut} title={cut ? "나누기 풀기" : "여기서 나누기 (이 쪽부터 새 파일)"}
          aria-label={cut ? "나누기 풀기" : "여기서 나누기"} onClick={() => onCut(it.key)}>
          <Scissors size={13} />
        </button>
      )}
      <div className="kd-pg-stage">
        <div className={`kd-pg-sheet${it.blank ? " kd-pg-blank" : ""}`} style={{ width: w, height: h, transform: `translate(-50%, -50%) rotate(${it.rotate}deg)` }}>
          {url ? <img src={url} alt="" draggable={false} /> : <span className="kd-pg-wait">{it.blank ? "" : url === "" ? "그림 없음" : it.page}</span>}
        </div>
        {selected && <span className="kd-pg-check" style={{ top: inset.y, right: inset.x }} aria-hidden="true"><Check size={13} strokeWidth={3} /></span>}
        {group != null && <span className="kd-pg-group" style={{ top: inset.y, left: inset.x }} aria-hidden="true">{group}</span>}
      </div>
      <div className="kd-pg-cap">
        <span className="kd-pg-n">{index + 1}</span>
        {f && <span className="kd-pg-dot" data-c={f.color} aria-hidden="true" />}
        <span className="kd-pg-src" title={where}>{it.blank ? "빈 쪽" : `${f?.name.replace(/\.[^.]+$/, "") ?? ""} · ${it.page}`}</span>
      </div>
    </div>
  );
});
