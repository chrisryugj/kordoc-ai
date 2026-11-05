import { useEffect, useRef, useMemo, useId, type ReactNode } from "react";
import { X } from "lucide-react";
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
    // 첫 초점은 본문·아래 단추의 첫 칸 (닫기 X 가 먼저 잡히면 Enter 한 번에 닫힌다). 없으면 X
    requestAnimationFrame(() => {
      const box = modalRef.current;
      const first = box?.querySelector<HTMLElement>(`[data-modal-body] :is(${FOCUSABLE}), [data-modal-foot] :is(${FOCUSABLE})`);
      (first ?? box?.querySelector<HTMLElement>(FOCUSABLE))?.focus();
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
    >
      {/* 대화상자 역할은 상자 자체에 (배경 판이 아니라) */}
      <div ref={modalRef} role="dialog" aria-modal="true" aria-labelledby={titleId} className={`w-full ${sizeClasses[size]} mx-4 animate-modal-enter rounded-2xl overflow-hidden max-h-[80vh] flex flex-col`}
        style={{ backgroundColor: "var(--color-bg-secondary)", boxShadow: "var(--shadow-xl)", border: "1px solid var(--color-border)" }}>
        <div className="shrink-0 flex items-center justify-between px-6 pt-5 pb-3" style={{ borderColor: "var(--color-border)" }}>
          <h2 id={titleId} className="text-lg font-bold tracking-tight" style={{ color: "var(--color-text-primary)" }}>{title}</h2>
          {closable && (
            <button type="button" onClick={handleClose} className="kd-icon-btn -mr-1.5" aria-label="닫기">
              <X size={16} />
            </button>
          )}
        </div>
        <div className="px-6 py-4 overflow-y-auto flex-1" data-modal-body>{children}</div>
        {footer && <div className="px-6 py-4 shrink-0" data-modal-foot style={{ background: "var(--color-bg-primary)", borderTop: "1px solid var(--color-border-subtle)" }}>{footer}</div>}
      </div>
    </div>
  );
}
