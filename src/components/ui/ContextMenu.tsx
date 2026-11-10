import { useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";

type MenuSeparator = { type: "separator" };
export type MenuItem = {
  label: string;
  icon?: React.ReactNode;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  /** 이름 아래 작은 글 — 못 쓰는 까닭이나 덧붙일 설명 */
  hint?: string;
  onClick: () => void;
};
export type ContextMenuEntry = MenuItem | MenuSeparator;

interface ContextMenuProps {
  items: ContextMenuEntry[];
  position: { x: number; y: number };
  onClose: () => void;
  /** 무엇의 메뉴인지 (화면 읽기 프로그램용. 예: "보고서.hwpx 메뉴") */
  label?: string;
  /** 맨 위 한 줄 (예: "3쪽 고름") */
  header?: string;
  /** 키보드(메뉴 키·Shift+F10)로 열었으면 첫 항목에 바로 초점 */
  keyboard?: boolean;
}

function isSeparator(item: ContextMenuEntry): item is MenuSeparator {
  return "type" in item && item.type === "separator";
}

/** 화면 가장자리 여백 */
const EDGE = 8;

export function ContextMenu({ items, position, onClose, label, header, keyboard = false }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  /** 메뉴를 열기 전에 초점이 있던 곳 — 닫으면 돌려준다 (안 그러면 초점이 사라져 Delete 같은 단축키가 죽는다) */
  const opener = useRef<HTMLElement | null>(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  const close = (restore: boolean) => {
    closeRef.current();
    if (restore && opener.current?.isConnected) opener.current.focus({ preventScroll: true });
  };

  // 자리: 화면 밖으로 나가면 반대쪽으로 펼치고(누른 자리에서 멀어지지 않게), 그래도 넘치면 안으로 당긴다
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const flipX = position.x + w > window.innerWidth - EDGE;
    const flipY = position.y + h > window.innerHeight - EDGE;
    const x = Math.max(EDGE, Math.min(flipX ? position.x - w : position.x, window.innerWidth - w - EDGE));
    const y = Math.max(EDGE, Math.min(flipY ? position.y - h : position.y, window.innerHeight - h - EDGE));
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.transformOrigin = `${flipX ? "right" : "left"} ${flipY ? "bottom" : "top"}`;
  }, [position, items, header]);

  // 열릴 때 한 번: 초점을 메뉴로 (키보드로 열었으면 첫 항목)
  useEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const first = keyboard ? el.querySelector<HTMLElement>("[role=menuitem]") : null;
    (first ?? el).focus({ preventScroll: true });
  }, [keyboard]);

  useEffect(() => {
    const inside = (t: EventTarget | null) => !!menuRef.current && t instanceof Node && menuRef.current.contains(t);
    const onPointer = (e: MouseEvent) => { if (!inside(e.target)) close(false); };
    const onScroll = (e: Event) => { if (!inside(e.target)) close(false); };
    const away = () => close(false);
    const onKey = (e: KeyboardEvent) => {
      const els = [...(menuRef.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
      const at = els.indexOf(document.activeElement as HTMLElement);
      const go = (i: number) => els[(i + els.length) % els.length]?.focus();
      switch (e.key) {
        case "Escape": close(true); break;
        case "Tab": close(true); break;
        case "ArrowDown": go(at + 1); break;
        case "ArrowUp": go(at < 0 ? els.length - 1 : at - 1); break;
        case "Home": case "PageUp": go(0); break;
        case "End": case "PageDown": go(els.length - 1); break;
        default: return;
      }
      // 메뉴가 받은 키는 아래 화면으로 넘기지 않는다 (Esc 가 열린 창까지 닫거나, 화살표가 목록을 움직이지 않게)
      e.preventDefault();
      e.stopPropagation();
    };
    // 약간 늦게 등록 — 메뉴를 연 우클릭 자체가 잡히지 않도록
    const t = setTimeout(() => {
      window.addEventListener("mousedown", onPointer, true);
      window.addEventListener("contextmenu", onPointer);
      window.addEventListener("scroll", onScroll, true);
      window.addEventListener("resize", away);
      window.addEventListener("blur", away);
    }, 0);
    window.addEventListener("keydown", onKey, true);
    return () => {
      clearTimeout(t);
      window.removeEventListener("mousedown", onPointer, true);
      window.removeEventListener("contextmenu", onPointer);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", away);
      window.removeEventListener("blur", away);
      window.removeEventListener("keydown", onKey, true);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const hasIcon = items.some((it) => !isSeparator(it) && it.icon);

  return createPortal(
    <div
      ref={menuRef}
      className="kd-context-menu animate-scale-in"
      style={{ left: position.x, top: position.y }}
      role="menu"
      tabIndex={-1}
      aria-label={label ?? "우클릭 메뉴"}
      onContextMenu={(e) => e.preventDefault()}
    >
      {header && <div className="kd-ctx-header">{header}</div>}
      {items.map((item, i) =>
        isSeparator(item) ? (
          <div key={`sep-${i}`} className="kd-ctx-separator" role="separator" />
        ) : (
          <button
            key={`${i}-${item.label}`}
            type="button"
            role="menuitem"
            aria-disabled={item.disabled || undefined}
            className={`kd-ctx-item${item.danger ? " kd-ctx-danger" : ""}`}
            onMouseEnter={(e) => e.currentTarget.focus({ preventScroll: true })}
            onClick={() => {
              if (item.disabled) return;
              // 먼저 닫고 초점을 돌려준 뒤 실행한다 (실행이 초점을 다른 곳으로 옮기면 그쪽이 이긴다)
              close(true);
              item.onClick();
            }}
          >
            {hasIcon && <span className="kd-ctx-icon" aria-hidden="true">{item.icon}</span>}
            <span className="kd-ctx-label">
              {item.label}
              {item.hint && <span className="kd-ctx-hint">{item.hint}</span>}
            </span>
            {item.shortcut && <span className="kd-ctx-shortcut">{item.shortcut}</span>}
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}
