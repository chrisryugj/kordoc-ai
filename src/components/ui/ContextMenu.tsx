import { useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";

type MenuSeparator = { type: "separator" };
export type MenuItem = {
  label: string;
  icon?: React.ReactNode;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
};
export type ContextMenuEntry = MenuItem | MenuSeparator;

interface ContextMenuProps {
  items: ContextMenuEntry[];
  position: { x: number; y: number };
  onClose: () => void;
}

function isSeparator(item: ContextMenuEntry): item is MenuSeparator {
  return "type" in item && item.type === "separator";
}

export function ContextMenu({ items, position, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const focusIdx = useRef(0);

  // 위치 경계 보정
  const adjustedPos = useRef(position);
  useEffect(() => {
    if (!menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    const x = Math.min(position.x, window.innerWidth - rect.width - 8);
    const y = Math.min(position.y, window.innerHeight - rect.height - 8);
    adjustedPos.current = { x: Math.max(4, x), y: Math.max(4, y) };
    menuRef.current.style.left = `${adjustedPos.current.x}px`;
    menuRef.current.style.top = `${adjustedPos.current.y}px`;
  }, [position]);

  // 외부 클릭 / ESC로 닫기
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const actionItems = menuRef.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]:not([disabled])");
        if (!actionItems?.length) return;
        const dir = e.key === "ArrowDown" ? 1 : -1;
        focusIdx.current = (focusIdx.current + dir + actionItems.length) % actionItems.length;
        actionItems[focusIdx.current]?.focus();
      }
    };
    // 약간 지연해서 등록 — 우클릭 이벤트 자체가 잡히지 않도록
    const t = setTimeout(() => {
      window.addEventListener("click", handleClick);
      window.addEventListener("contextmenu", handleClick);
      window.addEventListener("keydown", handleKey);
    }, 0);
    return () => {
      clearTimeout(t);
      window.removeEventListener("click", handleClick);
      window.removeEventListener("contextmenu", handleClick);
      window.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  // 첫 항목 autoFocus
  const setInitialFocus = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    requestAnimationFrame(() => {
      el.querySelector<HTMLButtonElement>("[role=menuitem]:not([disabled])")?.focus();
    });
  }, []);

  return createPortal(
    <div
      ref={(el) => { (menuRef as React.MutableRefObject<HTMLDivElement | null>).current = el; setInitialFocus(el); }}
      className="kd-context-menu animate-scale-in"
      style={{ left: position.x, top: position.y }}
      role="menu"
      aria-label="컨텍스트 메뉴"
    >
      {items.map((item, i) =>
        isSeparator(item) ? (
          <div key={`sep-${i}`} className="kd-ctx-separator" role="separator" />
        ) : (
          <button
            key={item.label}
            role="menuitem"
            disabled={item.disabled}
            className={`kd-ctx-item${item.danger ? " kd-ctx-danger" : ""}`}
            onClick={() => { item.onClick(); onClose(); }}
          >
            {item.icon && <span className="kd-ctx-icon">{item.icon}</span>}
            <span className="kd-ctx-label">{item.label}</span>
            {item.shortcut && <span className="kd-ctx-shortcut">{item.shortcut}</span>}
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}
