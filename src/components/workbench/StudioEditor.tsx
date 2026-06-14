/**
 * StudioEditor — rhwp-studio(한/글급 편집기)를 iframe으로 임베드 (KorDoc Studio Phase R3).
 *
 * studio는 자체 postMessage API(`rhwp-request`/`rhwp-response`)로 외부 제어를 지원한다.
 * kordoc이 만든 본문(hwpx 바이트)을 loadFile로 주입하고, exportHwpx로 편집 결과를 회수한다
 * ("kordoc이 본문, rhwp가 편집"의 접점). 데이터 흐름은 부모(React) ↔ iframe(studio) postMessage.
 *
 * dev: studio dev 서버(127.0.0.1:7700). prod: 빌드 산출물 임베드(후속).
 */

import { useCallback, useEffect, useImperativeHandle, useRef, useState, forwardRef } from "react";
import { Loader2, AlertTriangle } from "lucide-react";
import { b64ToBytes } from "../../lib/rhwp";

// dev는 cross-origin(7700) — Tauri 부모 CSP를 안 받아 canvaskit/CDN폰트가 자유롭게 뜬다.
// prod same-origin(/rhwp-studio/)은 CSP 완화(unsafe-eval + 폰트 CDN 허용) 후 전환 예정.
const STUDIO_URL = "http://127.0.0.1:7700/";

let msgCounter = 0;

/** iframe(studio)에 rhwp-request 보내고 rhwp-response 대기 */
function studioCall(win: Window, method: string, params?: unknown, timeoutMs = 20000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const id = ++msgCounter;
    const onMsg = (e: MessageEvent) => {
      const d = e.data;
      if (d && d.type === "rhwp-response" && d.id === id) {
        window.removeEventListener("message", onMsg);
        clearTimeout(timer);
        if (d.error) reject(new Error(d.error));
        else resolve(d.result);
      }
    };
    const timer = setTimeout(() => {
      window.removeEventListener("message", onMsg);
      reject(new Error("studio 응답 시간 초과"));
    }, timeoutMs);
    window.addEventListener("message", onMsg);
    win.postMessage({ type: "rhwp-request", id, method, params }, "*");
  });
}

export interface StudioHandle {
  /** 편집된 문서를 HWPX 바이트(base64)로 회수 */
  exportHwpx: () => Promise<string>;
}

interface StudioEditorProps {
  /** 편집할 문서(base64, HWPX) — kordoc/사이드카가 공급 */
  docB64: string | null;
  fileName: string;
  onLoaded?: (pageCount: number) => void;
}

export const StudioEditor = forwardRef<StudioHandle, StudioEditorProps>(
  function StudioEditor({ docB64, fileName, onLoaded }, ref) {
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
    const [err, setErr] = useState("");

    useImperativeHandle(ref, () => ({
      exportHwpx: async () => {
        const win = iframeRef.current?.contentWindow;
        if (!win) throw new Error("편집기가 준비되지 않았습니다");
        const out = (await studioCall(win, "exportHwpx")) as number[];
        // number[] → base64
        let bin = "";
        const bytes = new Uint8Array(out);
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
        return btoa(bin);
      },
    }), []);

    const boot = useCallback(async () => {
      const win = iframeRef.current?.contentWindow;
      if (!win) { setStatus("ready"); return; }
      setStatus("loading");
      setErr("");
      // 응답 핸드셰이크 best-effort(짧게) — 닿으면 저장 가능, 아니면 fire-and-forget 폴백.
      let handshake = false;
      for (let i = 0; i < 6 && !handshake; i++) {
        try { await studioCall(win, "ready", undefined, 400); handshake = true; }
        catch { await new Promise((r) => setTimeout(r, 250)); }
      }
      if (docB64) {
        const params = { data: Array.from(b64ToBytes(docB64)), fileName, skipUnsavedGuard: true };
        if (handshake) {
          try {
            const res = (await studioCall(win, "loadFile", params, 30000)) as { pageCount?: number };
            onLoaded?.(res?.pageCount ?? 0);
          } catch (e) { setErr(String(e)); }
        } else {
          // 응답 미수신 폴백 — fire-and-forget 재전송(멱등)
          for (let i = 0; i < 4; i++) {
            try { win.postMessage({ type: "rhwp-request", id: ++msgCounter, method: "loadFile", params }, "*"); } catch { /* 미준비 */ }
            await new Promise((r) => setTimeout(r, 500));
          }
          onLoaded?.(0);
        }
      }
      setStatus("ready");
    }, [docB64, fileName, onLoaded]);

    useEffect(() => {
      void boot();
    }, [boot]);

    return (
      <div className="flex-1 relative" style={{ backgroundColor: "var(--color-bg-secondary)" }}>
        <iframe
          ref={iframeRef}
          src={STUDIO_URL}
          title="rhwp studio editor"
          style={{ width: "100%", height: "100%", border: "none", display: "block" }}
        />
        {status !== "ready" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3" style={{ backgroundColor: "var(--color-bg-secondary)" }}>
            {status === "loading" ? (
              <>
                <Loader2 size={20} className="animate-spin" style={{ color: "var(--color-text-muted)" }} />
                <span className="ts-sm" style={{ color: "var(--color-text-muted)" }}>편집기 불러오는 중...</span>
              </>
            ) : (
              <>
                <AlertTriangle size={24} style={{ color: "var(--color-warning)" }} />
                <span className="ts-sm" style={{ color: "var(--color-text-secondary)" }}>편집기 로드 실패: {err}</span>
                <span className="ts-2xs" style={{ color: "var(--color-text-muted)" }}>studio dev 서버(127.0.0.1:7700)가 떠 있는지 확인</span>
              </>
            )}
          </div>
        )}
      </div>
    );
  },
);
