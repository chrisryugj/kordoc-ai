import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { invokeCmd, isTauri } from "../lib/rpc";
import { canQuit } from "../lib/quit";

/**
 * 우클릭 메뉴·Finder 빠른 동작·파일 연결로 들어오는 동작 (Rust 가 Tauri 이벤트로 넘긴다)
 *   deep-link: kordoc://open|convert|pdf|redact|summarize?path=<인코딩된 경로>
 *              kordoc://batch?manifest=<인코딩된 경로>   (같은 동작으로 묶인 여러 파일)
 *   open-files: string[]  (파일 연결 "다음으로 열기")
 * 앱이 꺼져 있다 이 동작으로 켜지면 이벤트가 화면 구독보다 먼저 나가 사라지므로, Rust 가 쌓아 두었다가
 * shell_take_pending 으로 넘긴다 (모양은 실시간 이벤트와 같다).
 */
type PendingEvent = { event: "deep-link"; payload: string } | { event: "open-files"; payload: string[] };
export const LINK_ACTIONS = ["open", "convert", "pdf", "redact", "summarize"] as const;
export type LinkAction = (typeof LINK_ACTIONS)[number];

export type DeepLinkPayload =
  | { type: "file"; action: LinkAction; path: string }
  | { type: "batch"; manifestPath: string };

export function isLinkAction(s: string): s is LinkAction {
  return (LINK_ACTIONS as readonly string[]).includes(s);
}

export function parseDeepLink(raw: string): DeepLinkPayload | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "kordoc:") return null;
  const action = url.host || url.pathname.replace(/^\/+/, "").split("/")[0];
  if (action === "batch") {
    const manifestPath = url.searchParams.get("manifest");
    return manifestPath ? { type: "batch", manifestPath } : null;
  }
  const path = url.searchParams.get("path");
  if (!path || !isLinkAction(action)) return null;
  return { type: "file", action, path };
}

export function useDeepLink(onLink: (p: DeepLinkPayload) => void, onOpenFiles: (paths: string[]) => void) {
  const linkRef = useRef(onLink);
  const filesRef = useRef(onOpenFiles);
  linkRef.current = onLink;
  filesRef.current = onOpenFiles;

  useEffect(() => {
    if (!isTauri) return;
    const onDeepLink = (raw: string) => {
      const parsed = parseDeepLink(raw);
      if (parsed) linkRef.current(parsed);
    };
    const onFiles = (paths: string[]) => {
      if (Array.isArray(paths) && paths.length) filesRef.current(paths);
    };
    let disposed = false;
    let offs: Array<() => void> = [];
    // 구독이 실제로 걸린 뒤에 쌓인 것을 받는다. 그 전에 온 것은 Rust 가 쌓아 두고, 받은 뒤로는 이벤트로 오니 빠지지도 겹치지도 않는다
    void Promise.all([
      listen<string>("deep-link", (e) => onDeepLink(e.payload)),
      listen<string[]>("open-files", (e) => onFiles(e.payload)),
      // 트레이 "완전 종료": 저장 안 한 것을 물은 뒤에만 끈다
      listen("quit-requested", () => { void canQuit().then((ok) => invokeCmd(ok ? "quit_app" : "quit_cancelled")).catch(() => undefined); }),
    ]).then(async (fns) => {
      if (disposed) { fns.forEach((off) => off()); return; }
      offs = fns;
      const pending = await invokeCmd<PendingEvent[] | null>("shell_take_pending").catch(() => null);
      for (const p of pending ?? []) {
        if (p.event === "open-files") onFiles(p.payload);
        else onDeepLink(p.payload);
      }
    });
    return () => { disposed = true; offs.forEach((off) => off()); };
  }, []);
}
