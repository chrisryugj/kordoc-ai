import { useEffect, useRef, useMemo, useId, type ReactNode } from "react";
import { useDialogKeys } from "./useDialogKeys";

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

  // Esc: 닫을 수 있으면 닫기, 닫기 단추가 없는 확인 상자도 onClose 를 주면 Esc 로 취소
  useDialogKeys(modalRef, isOpen, closable || onClose ? handleClose : undefined);

  useEffect(() => {
    if (!isOpen) return;
    // 열기 전 포커스 저장 (닫을 때 복원용)
    previousFocusRef.current = document.activeElement;
    document.body.style.overflow = "hidden";
    requestAnimationFrame(() => {
      modalRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE)?.[0]?.focus();
    });
    return () => {
      document.body.style.overflow = "";
      // 모달 닫힘 시 이전 포커스 복원 (WCAG 2.1 Level A)
      const prev = previousFocusRef.current;
      if (prev && prev instanceof HTMLElement) {
        requestAnimationFrame(() => prev.focus());
      }
    };
  }, [isOpen]);

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
            <button type="button" onClick={handleClose} className="grid place-items-center w-8 h-8 -mr-1.5 rounded-md btn-icon-hover" aria-label="닫기">
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
