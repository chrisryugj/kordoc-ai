/**
 * StudioEditor — rhwp-studio(한/글급 편집기)를 iframe으로 임베드 (KorDoc Studio Phase R3).
 *
 * studio는 자체 postMessage API(`rhwp-request`/`rhwp-response`)로 외부 제어를 지원한다.
 * kordoc이 만든 본문(hwpx 바이트)을 loadFile로 주입하고, exportHwpx로 편집 결과를 회수한다
 * ("kordoc이 본문, rhwp가 편집"의 접점). 데이터 흐름은 부모(React) ↔ iframe(studio) postMessage.
 *
 * 저장 연동: 본문 편집은 studio가 source of truth이므로 ref/prop drilling 대신
 * DocumentSession에 ExternalEditor(exportBytes/onSaved)를 등록한다 — save가 저장 직전
 * studio에서 최신 바이트를 회수해 사이드카 세션에 수렴시킨다. studio의 dirty 변경은
 * `rhwp-dirty` push로 받아 자동저장·저장상태를 동기화한다.
 *
 * dev: studio dev 서버(127.0.0.1:7700, cross-origin). prod: 빌드 산출물 임베드(후속).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, AlertTriangle } from "lucide-react";
import { b64ToBytes } from "../../lib/rhwp";
import { useDocumentSession } from "../../contexts/DocumentSession";

// dev는 cross-origin(7700) — Tauri 부모 CSP를 안 받아 canvaskit/CDN폰트가 자유롭게 뜬다.
// prod는 same-origin 빌드본(/rhwp-studio/) — 부모 CSP가 iframe에 상속되므로 canvaskit
// 요구 사항(wasm/eval, 폰트)을 prod 빌드 콘솔로 확인해 CSP에 최소 완화 필요(검증 진행 중).
const STUDIO_URL = import.meta.env.DEV ? "http://127.0.0.1:7700/" : "/rhwp-studio/";

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

/** number[](studio exportHwpx 반환) → base64 */
function bytesToB64(out: number[]): string {
  let bin = "";
  const bytes = new Uint8Array(out);
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

interface StudioEditorProps {
  /** 편집할 문서(base64, HWPX) — kordoc/사이드카가 공급 */
  docB64: string | null;
  fileName: string;
  onLoaded?: (pageCount: number) => void;
}

export function StudioEditor({ docB64, fileName, onLoaded }: StudioEditorProps) {
  const { setExternalEditor, notifyExternalChange } = useDocumentSession();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [err, setErr] = useState("");

  // 저장 직전 studio에서 최신 바이트 회수 — 실패 시 null(기존 세션 바이트로 저장)
  const exportBytes = useCallback(async (): Promise<string | null> => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return null;
    try {
      const out = (await studioCall(win, "exportHwpx")) as number[];
      return Array.isArray(out) ? bytesToB64(out) : null;
    } catch {
      return null;
    }
  }, []);

  // 호스트 저장 완료 → studio 내부 dirty 해제(다음 편집의 dirty 전이 보존)
  const onSaved = useCallback(() => {
    const win = iframeRef.current?.contentWindow;
    if (win) void studioCall(win, "markSaved").catch(() => {});
  }, []);

  // DocumentSession에 저장 연동 핸들 등록
  useEffect(() => {
    setExternalEditor({ exportBytes, onSaved });
    return () => setExternalEditor(null);
  }, [setExternalEditor, exportBytes, onSaved]);

  // studio dirty push 수신 → 세션 dirty 동기화(자동저장/저장상태)
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const d = e.data;
      if (d && d.type === "rhwp-dirty") notifyExternalChange(Boolean(d.dirty));
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [notifyExternalChange]);

  const boot = useCallback(async () => {
    const win = iframeRef.current?.contentWindow;
    if (!win) { setStatus("ready"); return; }
    setStatus("loading");
    setErr("");
    // ready 핸드셰이크 — studio는 wasm+canvaskit 초기화 완료 후에만 응답(#522).
    // 초기화가 수 초 걸리므로 넉넉히 폴링(2s×15 ≈ 30초). 닿으면 저장 양방향 가능.
    let handshake = false;
    for (let i = 0; i < 15 && !handshake; i++) {
      try { await studioCall(win, "ready", undefined, 2000); handshake = true; }
      catch { await new Promise((r) => setTimeout(r, 300)); }
    }
    if (docB64) {
      const params = { data: Array.from(b64ToBytes(docB64)), fileName, skipUnsavedGuard: true };
      if (handshake) {
        try {
          const res = (await studioCall(win, "loadFile", params, 30000)) as { pageCount?: number };
          onLoaded?.(res?.pageCount ?? 0);
        } catch (e) { setErr(String(e)); }
      } else {
        // 응답 미수신 폴백 — fire-and-forget 재전송(멱등). 저장 양방향은 불가.
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
}
