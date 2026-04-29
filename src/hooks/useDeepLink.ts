import { useEffect } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

// kordoc-launcher.exe 가 생성하는 deep-link URL 형식
//   kordoc://convert?path=<encoded>&action=md|pdf|hwpx
//   kordoc://summarize?path=<encoded>
//   kordoc://open?path=<encoded>
//   kordoc://batch?manifest=<encoded path>   (manifest = JSON: { action, files[] })
// 참조: kordoc-shell/kordoc-launcher/src/main.rs, docs/SPEC.md §3.4
export type DeepLinkPayload =
  | { type: "convert"; path: string; action: "md" | "pdf" | "hwpx" }
  | { type: "summarize"; path: string }
  | { type: "open"; path: string }
  | { type: "batch"; manifestPath: string };

export type DeepLinkHandler = (payload: DeepLinkPayload) => void;

function parseDeepLink(raw: string): DeepLinkPayload | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "kordoc:") return null;

  // url.host 가 action (kordoc://convert?... 의 'convert')
  const action = url.host || url.pathname.replace(/^\/+/, "");
  const path = url.searchParams.get("path") ?? "";

  switch (action) {
    case "convert": {
      const sub = url.searchParams.get("action") ?? "md";
      if (sub !== "md" && sub !== "pdf" && sub !== "hwpx") return null;
      if (!path) return null;
      return { type: "convert", path, action: sub };
    }
    case "summarize":
      if (!path) return null;
      return { type: "summarize", path };
    case "open":
      if (!path) return null;
      return { type: "open", path };
    case "batch": {
      const manifestPath = url.searchParams.get("manifest");
      if (!manifestPath) return null;
      return { type: "batch", manifestPath };
    }
    default:
      return null;
  }
}

export function useDeepLink(handler: DeepLinkHandler) {
  useEffect(() => {
    let mounted = true;
    let unlisten: UnlistenFn | null = null;

    listen<string>("deep-link", (event) => {
      if (!mounted) return;
      const parsed = parseDeepLink(event.payload);
      if (parsed) handler(parsed);
      else console.warn("[deep-link] 파싱 실패:", event.payload);
    }).then((fn) => {
      if (mounted) unlisten = fn;
      else fn();
    });

    return () => {
      mounted = false;
      unlisten?.();
    };
  }, [handler]);
}
