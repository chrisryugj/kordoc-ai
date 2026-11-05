import { useState, useCallback, useRef } from "react";
import type { ToastData, ToastType } from "../components/ui/Toast";

export function useToast() {
  const [toasts, setToasts] = useState<ToastData[]>([]);
  const idCounter = useRef(0);

  // 저절로 닫기는 알림 쪽(Toast)이 한다: 마우스·초점이 올라가 있는 동안은 기다리고, 오류는 더 오래 둔다
  const showToast = useCallback((message: string, type: ToastType = "info") => {
    const id = `toast-${++idCounter.current}`;
    setToasts((prev) => [...prev.slice(-4), { id, message, type }]);
    return id;
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return { toasts, showToast, dismissToast };
}
