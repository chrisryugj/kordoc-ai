import { useState, useCallback, useRef, useEffect } from "react";
import type { ToastData, ToastType } from "../components/ui/Toast";

export function useToast() {
  const [toasts, setToasts] = useState<ToastData[]>([]);
  const idCounter = useRef(0);
  const timersRef = useRef(new Set<ReturnType<typeof setTimeout>>());

  // Cleanup all pending timers on unmount
  useEffect(() => {
    const timers = timersRef.current;
    return () => { timers.forEach(clearTimeout); };
  }, []);

  const showToast = useCallback((message: string, type: ToastType = "info") => {
    const id = `toast-${++idCounter.current}`;
    setToasts((prev) => [...prev.slice(-4), { id, message, type }]);

    // Auto-dismiss after 4 seconds (except loading)
    if (type !== "loading") {
      const timer = setTimeout(() => {
        timersRef.current.delete(timer);
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 4000);
      timersRef.current.add(timer);
    }

    return id;
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return { toasts, showToast, dismissToast };
}
