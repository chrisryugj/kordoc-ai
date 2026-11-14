import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { invokeCmd, isTauri } from "../lib/rpc";
import { canQuit } from "../lib/quit";

/**
 * 우클릭 메뉴·Finder 빠른 동작·파일 연결로 들어오는 동작 (Rust 가 Tauri 이벤트로 넘긴다)
 *   deep-link: kordoc://<동작>?path=<인코딩된 경로>   (동작 = LINK_ACTIONS, 정본은 src-tauri/src/shell.rs 의 ACTIONS: Rust 시험이 맞춰 본다)
 *              kordoc://batch?manifest=<인코딩된 경로>   (같은 동작으로 묶인 여러 파일)
 *   open-files: string[]  (파일 연결 "다음으로 열기")
 * 앱이 꺼져 있다 이 동작으로 켜지면 이벤트가 화면 구독보다 먼저 나가 사라지므로, Rust 가 쌓아 두었다가
 * shell_take_pending 으로 넘긴다 (모양은 실시간 이벤트와 같다).
 */
type PendingEvent = { event: "deep-link"; payload: string } | { event: "open-files"; payload: string[] };
// 끝의 pdfmerge·hwpmerge·pdfsplit·hwpsplit 는 옛 판 메뉴의 형식별 합치기·나누기 (메뉴에는 없고 예전 주소로만).
// 목록 안에 주석을 넣지 말 것: Rust 시험이 대괄호 안을 쉼표로 잘라 읽는다
export const LINK_ACTIONS = [
  "ask", "summarize", "open", "tools", "edit", "pdf", "hwpx", "shrink", "pagenum", "pdfimages", "tables", "convert",
  "join", "xlsxmerge", "split", "pdfwork", "collect", "precheck", "redact", "compare", "versions", "inbox", "receipt",
  "pdfmerge", "hwpmerge", "pdfsplit", "hwpsplit",
] as const;
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
  // 동작 이름은 host 자리만 본다 (Rust 가 넘기는 꼴: kordoc://<동작>?path=…). 경로 첫 토막까지 읽으면 "kordoc:convert?path=…" 처럼
  // Rust 가 동작으로 보지 않은 주소를 여기서 동작으로 읽게 된다
  const action = url.host;
  if (action === "batch") {
    const manifestPath = url.searchParams.get("manifest");
    return manifestPath ? { type: "batch", manifestPath } : null;
  }
  const path = url.searchParams.get("path");
  if (!path || !isLinkAction(action)) return null;
  return { type: "file", action, path };
}

/** 돌고 있는 종료 전 묻기 수 (10초 넘게 걸리면 다음 완전 종료가 한 번 더 묻는다) */
let quitAsking = 0;

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
      // 트레이 "완전 종료": 저장 안 한 것을 물은 뒤에만 끈다. 묻는 동안(상자 없이 저장하는 중 포함) 표지를 단다:
      // 그사이 완전 종료를 또 눌러도 Rust(lib.rs QUIT_BUSY)가 화면이 멈춘 것으로 보고 끄지 않게
      listen("quit-requested", () => {
        quitAsking += 1;
        document.documentElement.toggleAttribute("data-quit-asking", true);
        void canQuit().then((ok) => invokeCmd(ok ? "quit_app" : "quit_cancelled")).catch(() => undefined).finally(() => {
          quitAsking -= 1;
          document.documentElement.toggleAttribute("data-quit-asking", quitAsking > 0);
        });
      }),
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
