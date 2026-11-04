import { useEffect, useState } from "react";

export type ToastType = "success" | "error" | "loading" | "info";
export interface ToastData { id: string; message: string; type: ToastType; }

export function Toast({ toast, onDismiss }: { toast: ToastData; onDismiss: (id: string) => void }) {
  const [isVisible, setIsVisible] = useState(false);
  useEffect(() => { requestAnimationFrame(() => setIsVisible(true)); }, []);

  const handleDismiss = () => { setIsVisible(false); setTimeout(() => onDismiss(toast.id), 200); };

  // 어두운 알림 바탕 위라 밝은 색 (흰 면용 토큰은 너무 어둡다)
  const iconColor = { success: "#5EE39A", error: "#FF8A80", loading: "#6EE7C0", info: "#8FC3FF" }[toast.type];

  return (
    <div className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition-all duration-200 ${isVisible ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-2"}`}
      style={{ backgroundColor: "#1F242B", color: "#F3F5F7", boxShadow: "var(--shadow-xl)", minWidth: 280, maxWidth: 460 }} role="alert">
      <span className="w-4 h-4" style={{ color: iconColor }}>
        {toast.type === "success" ? "✓" : toast.type === "error" ? "✕" : "●"}
      </span>
      <span className="flex-1 line-clamp-3">{toast.message}</span>
      {toast.type !== "loading" && (
        <button type="button" onClick={handleDismiss} className="grid place-items-center w-8 h-8 -my-1.5 -mr-2 rounded-md hover:bg-white/10" aria-label="닫기">
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
