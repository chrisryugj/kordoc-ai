import { useEffect, useRef, useCallback, useMemo, useId, type ReactNode } from "react";

interface ModalProps {
  isOpen: boolean;
  onClose?: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
  closable?: boolean;
}

const sizeClasses = { sm: "max-w-md", md: "max-w-lg", lg: "max-w-xl" };
const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
const NOOP = () => {};

export function Modal({ isOpen, onClose, title, children, footer, size = "md", closable = true }: ModalProps) {
  const handleClose = useMemo(() => onClose ?? NOOP, [onClose]);
  const titleId = useId();
  const modalRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<Element | null>(null);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape" && closable) { handleClose(); return; }
    if (e.key === "Tab" && modalRef.current) {
      const els = modalRef.current.querySelectorAll<HTMLElement>(FOCUSABLE);
      const first = els[0], last = els[els.length - 1];
      if (!first) return;
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    }
  }, [closable, handleClose]);

  useEffect(() => {
    if (!isOpen) return;
    // 열기 전 포커스 저장 (닫을 때 복원용)
    previousFocusRef.current = document.activeElement;
    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";
    requestAnimationFrame(() => {
      modalRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE)?.[0]?.focus();
    });
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
      // 모달 닫힘 시 이전 포커스 복원 (WCAG 2.1 Level A)
      const prev = previousFocusRef.current;
      if (prev && prev instanceof HTMLElement) {
        requestAnimationFrame(() => prev.focus());
      }
    };
  }, [isOpen, handleKeyDown]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 flex items-start justify-center z-50 pt-[10vh]"
      style={{ backgroundColor: "var(--color-backdrop)" }}
      onClick={(e) => e.target === e.currentTarget && closable && handleClose()}
      role="dialog" aria-modal="true" aria-labelledby={titleId}
    >
      <div ref={modalRef} className={`w-full ${sizeClasses[size]} mx-4 animate-modal-enter rounded-lg max-h-[80vh] flex flex-col`}
        style={{ backgroundColor: "var(--color-bg-secondary)", boxShadow: "var(--shadow-xl)", border: "1px solid var(--color-border)" }}>
        <div className="shrink-0 flex items-center justify-between px-6 py-3 border-b" style={{ borderColor: "var(--color-border)" }}>
          <h2 id={titleId} className="text-base font-bold" style={{ color: "var(--color-text-primary)" }}>{title}</h2>
          {closable && (
            <button onClick={handleClose} className="p-1.5 rounded-md btn-icon-hover" aria-label="닫기">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
        <div className="px-6 py-4 overflow-y-auto flex-1">{children}</div>
        {footer && <div className="px-6 py-4 border-t shrink-0" style={{ borderColor: "var(--color-border)" }}>{footer}</div>}
      </div>
    </div>
  );
}
