import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
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
    if (msg.includes("Failed to spawn sidecar")) return "엔진을 시작할 수 없습니다 (Node.js 설치 확인)";
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

    // sidecar:error 이벤트 즉시 수신 — 3초 폴링 대기 없이 에러 표시
    let unlistenError: (() => void) | null = null;
    listen<string>("sidecar:error", (event) => {
      if (cancelled) return;
      setStatus("error");
      setErrorMessage(translateError(event.payload || "엔진 시작 실패"));
    }).then((fn) => {
      if (cancelled) fn();
      else unlistenError = fn;
    });

    return () => {
      cancelled = true;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      unlistenError?.();
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
        setStatus("starting");
        // 최대 2회 재시작 시도 (지수 백오프: 800ms, 2000ms)
        const delays = [800, 2000];
        for (let attempt = 0; attempt < delays.length; attempt++) {
          try {
            await invoke("sidecar_start");
            await new Promise((r) => setTimeout(r, delays[attempt]));
            const result = await invoke("sidecar_call", { method, params: params ?? null });
            setStatus("ready");
            return result;
          } catch {
            // 다음 시도로
          }
        }
        setStatus("error");
        setErrorMessage("엔진 재시작 실패");
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
