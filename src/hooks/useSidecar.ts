import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { SidecarStatus } from "../types/sidecar";

interface UseSidecarReturn {
  status: SidecarStatus;
  errorMessage: string;
  call: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
  start: () => Promise<void>;
}

export function useSidecar(): UseSidecarReturn {
  const [status, setStatus] = useState<SidecarStatus>("stopped");
  const [errorMessage, setErrorMessage] = useState("");

  /** Rust 영문 에러를 사용자 친화적 한글로 변환 */
  const translateError = (msg: string): string => {
    if (msg.includes("spawn sidecar exe")) return "Python 엔진 실행 파일을 찾을 수 없습니다";
    if (msg.includes("Failed to spawn sidecar")) return "Python 엔진을 시작할 수 없습니다";
    if (msg.includes("Unexpected ping")) return "엔진이 응답하지 않습니다";
    if (msg.includes("프로세스 종료됨")) return "엔진이 비정상 종료되었습니다";
    if (msg.includes("Timeout")) return "엔진 응답 시간 초과";
    return msg;
  };

  // Poll sidecar status — recursive setTimeout to prevent overlap
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    let autoRestartAttempts = 0;
    const MAX_AUTO_RESTARTS = 3;
    const POLL_INTERVAL = 3000;

    const checkStatus = async () => {
      if (cancelled) return;
      try {
        const s = await invoke<SidecarStatus | { error: string }>("sidecar_status");
        if (cancelled) return;
        if (typeof s === "object" && s !== null && "error" in s) {
          const msg = (s as { error: string }).error;
          setStatus("error");
          setErrorMessage(translateError(msg || "알 수 없는 오류"));
          if (autoRestartAttempts < MAX_AUTO_RESTARTS) {
            autoRestartAttempts++;
            try {
              await invoke("sidecar_start");
              if (!cancelled) setStatus("starting");
            } catch { /* retry on next poll */ }
          }
        } else {
          const newStatus = s as SidecarStatus;
          setStatus(newStatus);
          if (newStatus === "ready") {
            autoRestartAttempts = 0;
            setErrorMessage("");
          }
        }
      } catch {
        // Sidecar not yet available
      }
      if (!cancelled) {
        timeoutRef.current = setTimeout(checkStatus, POLL_INTERVAL);
      }
    };

    checkStatus();
    return () => {
      cancelled = true;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const call = useCallback(async (method: string, params?: Record<string, unknown>) => {
    try {
      const result = await invoke("sidecar_call", { method, params: params ?? null });
      return result;
    } catch (e) {
      // Auto-restart sidecar on call failure (process may have crashed)
      const errStr = String(e).toLowerCase();
      const isProcessDead = errStr.includes("not started") || errStr.includes("closed") || errStr.includes("write failed");
      if (isProcessDead) {
        // 최대 2회 재시작 시도 (연속 크래시 대응)
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            await invoke("sidecar_start");
            // sidecar ready 대기 (짧은 딜레이)
            await new Promise((r) => setTimeout(r, 500));
            return await invoke("sidecar_call", { method, params: params ?? null });
          } catch {
            // 다음 시도로
          }
        }
      }
      throw e;
    }
  }, []);

  const start = useCallback(async () => {
    setStatus("starting");
    try {
      await invoke("sidecar_start");
      // Let the polling detect readiness — don't prematurely set "ready"
    } catch (e) {
      setStatus("error");
      throw e;
    }
  }, []);

  return { status, errorMessage, call, start };
}
