import { useState, useRef, useCallback, useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface TooltipProps {
  children: ReactNode;
  content: ReactNode;
  position?: "top" | "bottom" | "left" | "right";
  delay?: number;
  disabled?: boolean;
}

const GAP = 8;

function calcPosition(
  rect: DOMRect,
  tipW: number,
  tipH: number,
  preferred: NonNullable<TooltipProps["position"]>,
): { style: React.CSSProperties; resolved: string } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const positions: Record<string, () => { left: number; top: number }> = {
    top: () => ({ left: rect.left + rect.width / 2 - tipW / 2, top: rect.top - tipH - GAP }),
    bottom: () => ({ left: rect.left + rect.width / 2 - tipW / 2, top: rect.bottom + GAP }),
    left: () => ({ left: rect.left - tipW - GAP, top: rect.top + rect.height / 2 - tipH / 2 }),
    right: () => ({ left: rect.right + GAP, top: rect.top + rect.height / 2 - tipH / 2 }),
  };

  const fits = (pos: string): boolean => {
    const s = positions[pos]();
    return s.left >= 4 && s.top >= 4 && s.left + tipW <= vw - 4 && s.top + tipH <= vh - 4;
  };

  const order = [preferred, ...["top", "bottom", "right", "left"].filter((p) => p !== preferred)];
  const resolved = order.find(fits) ?? preferred;
  const raw = positions[resolved]();

  return {
    style: {
      left: Math.max(4, Math.min(raw.left, vw - tipW - 4)),
      top: Math.max(4, Math.min(raw.top, vh - tipH - 4)),
    },
    resolved,
  };
}

export function Tooltip({ children, content, position = "top", delay = 300, disabled }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState<{ style: React.CSSProperties; resolved: string } | null>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const show = useCallback(() => {
    if (disabled || !content) return;
    timerRef.current = setTimeout(() => setVisible(true), delay);
  }, [disabled, content, delay]);

  const hide = useCallback(() => {
    clearTimeout(timerRef.current);
    setVisible(false);
    setPos(null);
  }, []);

  useEffect(() => {
    if (!visible || !triggerRef.current) return;
    requestAnimationFrame(() => {
      if (!triggerRef.current || !tipRef.current) return;
      const rect = triggerRef.current.getBoundingClientRect();
      setPos(calcPosition(rect, tipRef.current.offsetWidth, tipRef.current.offsetHeight, position));
    });
  }, [visible, position]);

  useEffect(() => {
    if (!visible) return;
    const h = () => hide();
    window.addEventListener("scroll", h, true);
    window.addEventListener("resize", h);
    return () => { window.removeEventListener("scroll", h, true); window.removeEventListener("resize", h); };
  }, [visible, hide]);

  return (
    <>
      <span
        ref={triggerRef}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        style={{ display: "inline-flex" }}
      >
        {children}
      </span>
      {visible && createPortal(
        <div
          ref={tipRef}
          className="kd-tooltip"
          style={pos ? { ...pos.style, opacity: 1 } : { position: "fixed", top: -9999, left: -9999, opacity: 0 }}
          data-position={pos?.resolved ?? position}
          role="tooltip"
        >
          {content}
          <div className="kd-tooltip-arrow" data-position={pos?.resolved ?? position} />
        </div>,
        document.body,
      )}
    </>
  );
}
