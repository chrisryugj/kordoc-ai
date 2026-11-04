/**
 * 앱 전체 툴팁 — 단추·링크에 붙은 title(또는 data-tip)을 브라우저 기본 노란 상자 대신 앱 모양 말풍선으로 보인다.
 * 글 없는 아이콘 단추는 aria-label 을 말풍선으로. 마우스를 0.45초 올려 두거나 키보드로 초점을 옮기면 뜨고,
 * 누르거나 떠나거나 굴리면 사라진다. 화면 위쪽이 모자라면 아래로, 양옆은 창 안으로 맞춘다.
 * 각 단추는 data-tip 만 쓰면 된다(title 도 받는다: 처음 올릴 때 data-tip 으로 옮겨 기본 상자가 겹쳐 뜨지 않게 함).
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const DELAY = 450;
const GAP = 8;
const SEL = "[data-tip], [title], button[aria-label], a[aria-label], [role='button'][aria-label]";

interface Tip { text: string; x: number; y: number; below: boolean }

/** 말풍선에 쓸 글 — 단추 글자와 같은 말이면 띄우지 않는다 */
function tipOf(el: HTMLElement): string {
  if (el.hasAttribute("title")) {
    const t = el.getAttribute("title") ?? "";
    el.removeAttribute("title");
    if (t && !el.hasAttribute("data-tip")) el.setAttribute("data-tip", t);
    // 글 없는 단추는 읽어 주는 이름이 title 뿐이었을 수 있다
    if (t && !el.textContent?.trim() && !el.hasAttribute("aria-label")) el.setAttribute("aria-label", t);
  }
  const own = (el.textContent ?? "").replace(/\s+/g, " ").trim();
  const tip = (el.getAttribute("data-tip") ?? (own ? "" : el.getAttribute("aria-label") ?? "")).trim();
  if (!tip || tip === own) return "";
  return tip;
}

export function TipLayer() {
  const [tip, setTip] = useState<Tip | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const cur = useRef<HTMLElement | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const hide = () => { clearTimeout(timer.current); cur.current = null; setTip(null); };
    const place = (el: HTMLElement, text: string) => {
      if (!el.isConnected) return;
      const r = el.getBoundingClientRect();
      const below = r.top < 48;
      setTip({ text, x: r.left + r.width / 2, y: below ? r.bottom + GAP : r.top - GAP, below });
    };
    const arm = (target: EventTarget | null, wait: number) => {
      const el = (target as HTMLElement | null)?.closest?.(SEL) as HTMLElement | null;
      if (el === cur.current) return;
      hide();
      if (!el || el.closest("[data-no-tip], .kd-tooltip-host")) return;
      const text = tipOf(el);
      if (!text) return;
      cur.current = el;
      timer.current = setTimeout(() => place(el, text), wait);
    };
    const over = (e: MouseEvent) => arm(e.target, DELAY);
    const focus = (e: FocusEvent) => { if ((e.target as HTMLElement).matches?.(":focus-visible")) arm(e.target, 150); };
    document.addEventListener("mouseover", over);
    document.addEventListener("focusin", focus);
    document.addEventListener("focusout", hide);
    document.addEventListener("mousedown", hide, true);
    document.addEventListener("keydown", hide, true);
    document.addEventListener("scroll", hide, true);
    window.addEventListener("blur", hide);
    return () => {
      clearTimeout(timer.current);
      document.removeEventListener("mouseover", over);
      document.removeEventListener("focusin", focus);
      document.removeEventListener("focusout", hide);
      document.removeEventListener("mousedown", hide, true);
      document.removeEventListener("keydown", hide, true);
      document.removeEventListener("scroll", hide, true);
      window.removeEventListener("blur", hide);
    };
  }, []);

  // 창 밖으로 나가지 않게 너비를 재고 옆으로 민다
  const [shift, setShift] = useState(0);
  useEffect(() => {
    if (!tip || !box.current) return;
    const w = box.current.offsetWidth;
    const left = tip.x - w / 2;
    setShift(left < 8 ? 8 - left : left + w > window.innerWidth - 8 ? window.innerWidth - 8 - (left + w) : 0);
  }, [tip]);

  if (!tip) return null;
  return createPortal(
    <div ref={box} className="kd-tip" role="tooltip" data-below={tip.below}
      style={{ left: tip.x + shift, top: tip.y }}>
      {tip.text}
    </div>,
    document.body,
  );
}
