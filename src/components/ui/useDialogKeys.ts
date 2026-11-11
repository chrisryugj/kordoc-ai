/** 대화상자 키보드 — Tab 은 상자 안에서만 돌고, Esc 는 닫기(취소). 모달·첫 실행 안내가 함께 쓴다 */

import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

const focusables = (box: HTMLElement) =>
  Array.from(box.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => !(el as HTMLButtonElement).disabled && el.getClientRects().length > 0);

/** 열려 있는 대화상자 (연 차례). 키는 맨 나중에 연, 보이는 상자 하나만 받는다:
 *  창 위에 확인 상자가 뜬 채 Esc 를 누르면 둘 다 닫히고(창 닫기 + 확인 취소), Tab 은 두 상자가 서로 초점을 뺏는다 */
const open: Array<RefObject<HTMLElement | null>> = [];
const shown = (r: RefObject<HTMLElement | null>) => !!r.current && r.current.getClientRects().length > 0;

export function useDialogKeys(ref: RefObject<HTMLElement | null>, active: boolean, onEscape?: () => void) {
  const esc = useRef(onEscape);
  esc.current = onEscape;

  useEffect(() => {
    if (!active) return;
    open.push(ref);
    const onKey = (e: KeyboardEvent) => {
      const box = ref.current;
      // 숨은 자리(display:none) 안에 남아 있는 상자는 키를 잡지 않는다. 잡으면 보이지 않는 상자가 Tab 을 삼켜 화면 전체에서 Tab 이 죽는다
      if (!box || box.getClientRects().length === 0) return;
      if (open.filter(shown).at(-1) !== ref) return;
      if (e.key === "Escape" && !e.isComposing) {
        if (esc.current) { e.preventDefault(); esc.current(); }
        return;
      }
      if (e.key !== "Tab") return;
      const els = focusables(box);
      if (!els.length) { e.preventDefault(); return; }
      const first = els[0], last = els[els.length - 1];
      const inside = box.contains(document.activeElement);
      if (e.shiftKey && (!inside || document.activeElement === first)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (!inside || document.activeElement === last)) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      const at = open.indexOf(ref);
      if (at >= 0) open.splice(at, 1);
    };
  }, [active, ref]);
}
