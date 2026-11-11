import { useEffect, useState } from "react";
import { CheckCircle2, Info, Loader2, X, XCircle } from "lucide-react";

export type ToastType = "success" | "error" | "loading" | "info";
export interface ToastData { id: string; message: string; type: ToastType; }

export function Toast({ toast, onDismiss }: { toast: ToastData; onDismiss: (id: string) => void }) {
  const [isVisible, setIsVisible] = useState(false);
  useEffect(() => { requestAnimationFrame(() => setIsVisible(true)); }, []);

  const handleDismiss = () => { setIsVisible(false); setTimeout(() => onDismiss(toast.id), 200); };
  // 오류는 12초(처음 쓰는 분도 끝까지 읽게), 그 밖은 4초, 진행 중은 그대로. 마우스·초점이 올라가 있으면 기다린다
  const ms = toast.type === "error" ? 12000 : toast.type === "loading" ? 0 : 4000;
  const [hold, setHold] = useState(false);
  useEffect(() => {
    if (!ms || hold) return;
    const t = setTimeout(handleDismiss, ms);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ms, hold]);

  // 어두운 알림 바탕 위라 밝은 색 (흰 면용 토큰은 너무 어둡다)
  const iconColor = { success: "var(--color-on-tip-ok)", error: "var(--color-on-tip-err)", loading: "var(--color-on-tip-busy)", info: "var(--color-on-tip-info)" }[toast.type];

  return (
    <div className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition-[opacity,transform] duration-200 ${isVisible ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-2"}`}
      style={{ backgroundColor: "var(--color-tip-bg)", color: "var(--color-tip-text)", border: "1px solid var(--color-tip-border)", boxShadow: "var(--shadow-xl)", minWidth: 280, maxWidth: 460 }} role={toast.type === "error" ? "alert" : "status"}
      onMouseEnter={() => setHold(true)} onMouseLeave={() => setHold(false)} onFocus={() => setHold(true)} onBlur={() => setHold(false)}>
      <span className="grid place-items-center w-4 h-4 shrink-0" style={{ color: iconColor }} aria-hidden="true">
        {toast.type === "success" ? <CheckCircle2 size={16} /> : toast.type === "error" ? <XCircle size={16} /> : toast.type === "loading" ? <Loader2 size={16} className="kd-spin" /> : <Info size={16} />}
      </span>
      {/* 띄어쓰기 없는 긴 낱말(밑줄로 이은 파일 이름·경로)도 상자 안에서 끊는다: 안 끊으면 글과 닫기 단추가 상자 밖으로 나간다 */}
      <span className={toast.type === "error" ? "flex-1 min-w-0" : "flex-1 min-w-0 line-clamp-3"} style={{ overflowWrap: "anywhere" }}>{toast.message}</span>
      {toast.type !== "loading" && (
        <button type="button" onClick={handleDismiss} className="grid place-items-center w-8 h-8 -my-1.5 -mr-2 rounded-md hover:bg-white/10" aria-label="닫기">
          <X size={14} />
        </button>
      )}
    </div>
  );
}

export function ToastContainer({ toasts, onDismiss }: { toasts: ToastData[]; onDismiss: (id: string) => void }) {
  if (toasts.length === 0) return null;
  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 flex flex-col gap-2 items-center" style={{ zIndex: "var(--z-toast)" }}>
      {toasts.map((t) => <Toast key={t.id} toast={t} onDismiss={onDismiss} />)}
    </div>
  );
}
