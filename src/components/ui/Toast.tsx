import { useEffect, useState } from "react";

export type ToastType = "success" | "error" | "loading" | "info";
export interface ToastData { id: string; message: string; type: ToastType; }

export function Toast({ toast, onDismiss }: { toast: ToastData; onDismiss: (id: string) => void }) {
  const [isVisible, setIsVisible] = useState(false);
  useEffect(() => { requestAnimationFrame(() => setIsVisible(true)); }, []);

  const handleDismiss = () => { setIsVisible(false); setTimeout(() => onDismiss(toast.id), 200); };

  const iconColor = { success: "var(--color-success)", error: "var(--color-error)", loading: "var(--color-accent)", info: "var(--color-accent)" }[toast.type];

  return (
    <div className={`flex items-center gap-3 px-4 py-2.5 rounded-md text-sm shadow-lg transition-all duration-200 ${isVisible ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-2"}`}
      style={{ backgroundColor: "var(--color-bg-secondary)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)", minWidth: 280, maxWidth: 420 }} role="alert">
      <span className="w-4 h-4" style={{ color: iconColor }}>
        {toast.type === "success" ? "✓" : toast.type === "error" ? "✕" : "●"}
      </span>
      <span className="flex-1">{toast.message}</span>
      {toast.type !== "loading" && (
        <button onClick={handleDismiss} className="p-1 rounded hover-bg-tertiary" aria-label="닫기">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
}

export function ToastContainer({ toasts, onDismiss }: { toasts: ToastData[]; onDismiss: (id: string) => void }) {
  if (toasts.length === 0) return null;
  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] flex flex-col gap-2 items-center">
      {toasts.map((t) => <Toast key={t.id} toast={t} onDismiss={onDismiss} />)}
    </div>
  );
}
