/**
 * 사이드카 호출 헬퍼 — 계약 타입(rpc-contract.ts)으로 묶인 rpc() 하나.
 *
 * - onProgress·onToken·signal 중 하나라도 주면 params 에 고유 `__stream` 을 붙이고
 *   Tauri 이벤트 `sidecar:notify` 를 그 stream 으로 걸러 콜백한다.
 * - signal 을 끊으면 `cancel { stream }` 을 보내고 AbortError 로 끝낸다.
 * - Tauri 밖(브라우저 미리보기)에서는 mock-sidecar 가 계약 모양의 가짜 응답을 준다.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { RpcMethod, RpcParams, RpcResult } from "./contract";

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export interface Progress {
  current: number;
  total: number;
  message: string;
}

export interface RpcOptions {
  onProgress?: (p: Progress) => void;
  onToken?: (text: string) => void;
  signal?: AbortSignal;
}

export interface Notify {
  method: string;
  params: Record<string, unknown>;
}

type NotifyHandler = (n: Notify) => void;

const streamHandlers = new Map<string, NotifyHandler>();
const globalHandlers = new Set<NotifyHandler>();
let notifyReady: Promise<void> | null = null;

function dispatchNotify(n: Notify) {
  const stream = n.params?.stream;
  if (typeof stream === "string") streamHandlers.get(stream)?.(n);
  globalHandlers.forEach((h) => h(n));
}

function ensureNotifyListener(): Promise<void> {
  if (!notifyReady) {
    notifyReady = isTauri
      ? listen<Notify>("sidecar:notify", (e) => dispatchNotify(e.payload)).then(() => undefined)
      : Promise.resolve();
  }
  return notifyReady;
}

let mockModule: Promise<typeof import("./mock-sidecar")> | null = null;
export function loadMock() {
  if (!mockModule) mockModule = import("./mock-sidecar");
  return mockModule;
}

/** 엔진 프로세스가 죽었을 때 Rust 가 내는 오류 (지금 판의 한국어 문장 + 옛 판의 영어). 그냥 "closed" 가 든 오류는 아니다 */
const DEAD = /프로세스 종료|Sidecar not started|Sidecar process closed|Write failed|Flush failed/i;

/** 엔진이 죽었다 켜진 뒤 한 번 더 보내도 되는 메서드: 읽기만 한다. 저장·인쇄·목록 추가·AI 호출은 두 번 하면 안 되니 다시 보내지 않는다 */
const RETRY_SAFE = new Set([
  "ping", "system_info", "get_settings", "list_files", "scan_paths", "read_batch_manifest", "detect_mcp_env", "models_status",
  "doc_info", "render_pages", "read_file_b64", "preview_bytes", "pdf_page_count", "lint", "validate_hwpx", "gongmun_meta",
  "template_library", "template_fields", "org_autofill", "inbox_list", "watch_list", "list_printers", "search_files", "collect_fields",
  "ai_status", "llm_catalog", "llm_list", "usage_report", "security_status", "editor_server", "form_schema",
]);
const retrySafe = (method: string, params: Record<string, unknown>) =>
  RETRY_SAFE.has(method) || (method === "convert" && params.save === false) || (method === "redact" && params.dry_run === true);

async function sidecarInvoke(method: string, params: Record<string, unknown>): Promise<unknown> {
  if (!isTauri) return (await loadMock()).mockCall(method, params, dispatchNotify);
  try {
    return await invoke("sidecar_call", { method, params });
  } catch (e) {
    // 엔진이 죽었으면 한 번 다시 켜고, 읽기만 하는 호출이면 한 번 더 시도
    if (!DEAD.test(String(e)) || !retrySafe(method, params)) throw e;
    await invoke("sidecar_start");
    await new Promise((r) => setTimeout(r, 1200));
    return invoke("sidecar_call", { method, params });
  }
}

/** 옛 판 Rust 가 내던 영어 오류 → 할 일을 적은 한국어 */
const ENGINE_HINTS: Array<[RegExp, string]> = [
  [/Failed to spawn sidecar/i, "문서 엔진을 켜지 못했습니다. 앱을 다시 켜 보고, 계속되면 앱을 다시 설치하세요."],
  [/Timeout after \d+s/i, "작업이 너무 오래 걸려 멈췄습니다. 잠시 뒤 다시 하거나 쪽 범위·파일 수를 줄여 보세요."],
  [/Sidecar not started|Sidecar process closed|Write failed|Flush failed/i, "문서 엔진이 멈췄습니다. 잠시 뒤 다시 하고, 계속되면 앱을 다시 켜세요."],
  // 옛 엔진·kordoc 이 내는 개발자용 안내 ("… 설치: npm install pdfjs-dist"). 화면에 npm 을 보이지 않는다 (엔진 core/errors.ts MISSING_PART 와 같은 문장)
  [/MISSING_DEPENDENCY|\bnpm (install|i)\b|Cannot find (module|package)|ERR_MODULE_NOT_FOUND/i, "문서를 읽는 데 필요한 부품이 없습니다. 설정 › 엔진 점검을 눌러 보고, 계속되면 앱을 다시 설치하세요."],
];

/** Rust·사이드카 오류 문자열에서 사람이 읽을 문장만 */
export function errorText(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  const text = raw
    .replace(/^Error:\s*/, "")
    .replace(/^(JSON-RPC error|Sidecar error|IO error|JSON error|Tauri error):\s*/i, "")
    .trim();
  return ENGINE_HINTS.find(([re]) => re.test(text))?.[1] ?? text;
}

export function isAbort(e: unknown): boolean {
  return e instanceof Error && e.name === "AbortError";
}

function abortError(): Error {
  const err = new Error("취소했습니다");
  err.name = "AbortError";
  return err;
}

let seq = 0;

export async function rpc<M extends RpcMethod>(method: M, params: RpcParams<M>, opts: RpcOptions = {}): Promise<RpcResult<M>> {
  const { onProgress, onToken, signal } = opts;
  if (signal?.aborted) throw abortError();
  const payload: Record<string, unknown> = { ...(params as Record<string, unknown>) };
  let stream: string | undefined;

  if (onProgress || onToken || signal) {
    await ensureNotifyListener();
    // 알림 구독을 기다리는 사이 취소됐으면 보내지 않는다 (보내고 나면 이미 취소된 신호라 cancel 이 엔진에 안 간다)
    if (signal?.aborted) throw abortError();
    stream = `kd-${Date.now().toString(36)}-${++seq}`;
    payload.__stream = stream;
    streamHandlers.set(stream, (n) => {
      if (n.method === "progress" && onProgress) {
        onProgress({ current: Number(n.params.current ?? 0), total: Number(n.params.total ?? 0), message: String(n.params.message ?? "") });
      } else if (n.method === "ai_token" && onToken) {
        onToken(String(n.params.text ?? ""));
      }
    });
  }

  let onAbort: (() => void) | undefined;
  try {
    const call = sidecarInvoke(method, payload);
    if (!signal) return (await call) as RpcResult<M>;
    call.catch(() => undefined); // 취소 뒤 늦게 오는 오류는 버림
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => {
        void sidecarInvoke("cancel", { stream }).catch(() => undefined);
        reject(abortError());
      };
      signal.addEventListener("abort", onAbort, { once: true });
    });
    return (await Promise.race([call, aborted])) as RpcResult<M>;
  } finally {
    if (stream) streamHandlers.delete(stream);
    if (onAbort) signal?.removeEventListener("abort", onAbort);
  }
}

/** 계약 표에 없는 v1 모양 메서드 (FillWizard·DocEditor 의 form_*·edit_*·render_preview) */
export function callRaw(method: string, params?: Record<string, unknown>): Promise<unknown> {
  return sidecarInvoke(method, params ?? {});
}

/** stream 과 무관한 알림 구독 (예: watch_event) */
export function onNotify(method: string, handler: (params: Record<string, unknown>) => void): () => void {
  const h: NotifyHandler = (n) => { if (n.method === method) handler(n.params); };
  globalHandlers.add(h);
  void ensureNotifyListener();
  return () => { globalHandlers.delete(h); };
}

/** 사이드카를 거치지 않는 Tauri 명령 (shell_menu_* 등) */
export async function invokeCmd<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri) return (await loadMock()).mockCommand(cmd, args ?? {}) as T;
  return invoke<T>(cmd, args);
}

/** Tauri 이벤트 구독 — 브라우저 미리보기에서는 아무것도 하지 않는다 */
export function listenEvent<T>(name: string, handler: (payload: T) => void): () => void {
  if (!isTauri) return () => undefined;
  let off: (() => void) | null = null;
  let disposed = false;
  void listen<T>(name, (e) => handler(e.payload)).then((fn) => {
    if (disposed) fn();
    else off = fn;
  });
  return () => {
    disposed = true;
    off?.();
  };
}
