import { useState, useEffect, useCallback } from "react";
import { invokeCmd, isTauri, listenEvent } from "../lib/rpc";

/** Rust SidecarStatus 직렬화: Stopped→"stopped", Ready→"ready", Error(msg)→{"error":"msg"} */
export type SidecarStatus = "stopped" | "starting" | "ready" | "error";

/** Rust 오류는 이미 한국어 문장이다. 상태 표시용 짧은 값("프로세스 종료됨")만 문장으로 */
function translateError(msg: string): string {
  if (msg.includes("프로세스 종료됨")) return "문서 엔진이 멈췄습니다";
  return msg;
}

/** 엔진 상태 감시 — 3초마다 확인하고, 멈추면 세 번까지 스스로 다시 켠다 */
export function useSidecar() {
  const [status, setStatus] = useState<SidecarStatus>(isTauri ? "starting" : "ready");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    if (!isTauri) return;
    let cancelled = false;
    let restarts = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const check = async () => {
      if (cancelled) return;
      try {
        const s = await invokeCmd<SidecarStatus | { error: string }>("sidecar_status");
        if (cancelled) return;
        if (typeof s === "object" && s !== null && "error" in s) {
          setStatus("error");
          setErrorMessage(translateError(s.error || "알 수 없는 오류"));
          if (restarts < 3) {
            restarts++;
            try { await invokeCmd("sidecar_start"); if (!cancelled) setStatus("starting"); } catch { /* 다음 확인에서 다시 */ }
          }
        } else {
          setStatus(s);
          if (s === "ready") { restarts = 0; setErrorMessage(""); }
        }
      } catch {
        /* 아직 준비 전 */
      }
      if (!cancelled) timer = setTimeout(check, 3000);
    };
    void check();

    const off = listenEvent<string>("sidecar:error", (payload) => {
      setStatus("error");
      setErrorMessage(translateError(payload || "문서 엔진을 시작하지 못했습니다"));
    });
    return () => { cancelled = true; if (timer) clearTimeout(timer); off(); };
  }, []);

  const restart = useCallback(() => {
    setStatus("starting");
    invokeCmd("sidecar_start").catch((e) => { setStatus("error"); setErrorMessage(translateError(String(e))); });
  }, []);

  return { status, errorMessage, restart };
}
