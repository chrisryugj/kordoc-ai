/**
 * 내장 한글 편집기(rhwp-studio) 클라이언트 — 앱 창 ↔ 중계 페이지(127.0.0.1) postMessage
 *
 * 사용:
 *   const { host_url } = await rpc("editor_server", {});
 *   const ed = new HwpEditorClient();
 *   iframe.src = ed.attach(iframe, host_url);   // 중계 페이지 주소(?parent= 포함)를 돌려준다
 *   await ed.ready();
 *   await ed.call("load", { bytes, name }, [bytes]);
 *
 * 프로토콜 정본: node-sidecar/src/types/editor-bridge.ts (리드 소유 — 이 파일도 리드 소유)
 */
import type { EditorEvent, EditorOp, EditorOps } from "../../node-sidecar/src/types/editor-bridge";

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> };
type Incoming = { kd: "res"; id: number; ok: boolean; result?: unknown; error?: string } | EditorEvent;

/** 동작별 기본 시간 제한 — 열기·내보내기는 큰 문서에서 오래 걸린다 */
const TIMEOUT: Partial<Record<EditorOp, number>> = { load: 120_000, export: 120_000, find: 30_000, replace_selection: 30_000 };

/** 시간 제한 안에 답이 없었다 — 편집기는 아직 그 일을 하고 있을 수 있다(큰 문서 열기면 iframe 을 내려야 멈춘다) */
export class EditorTimeoutError extends Error {
  constructor(readonly op: EditorOp) {
    super("한글 편집기가 응답하지 않습니다. 편집기를 다시 열어 보세요.");
  }
}

export class HwpEditorClient {
  private frame: HTMLIFrameElement | null = null;
  private hostOrigin = "";
  private seq = 0;
  private pending = new Map<number, Pending>();
  private listeners = new Set<(ev: EditorEvent) => void>();
  private readyPromise: Promise<string>;
  private resolveReady!: (version: string) => void;
  private rejectReady!: (err: Error) => void;

  constructor() {
    this.readyPromise = new Promise((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    window.addEventListener("message", this.onMessage);
  }

  /** iframe 에 붙이고, iframe.src 에 넣을 주소를 돌려준다 */
  attach(frame: HTMLIFrameElement, hostUrl: string): string {
    this.frame = frame;
    const u = new URL(hostUrl);
    this.hostOrigin = u.origin;
    u.searchParams.set("parent", window.location.origin);
    return u.toString();
  }

  /** 편집기 준비 끝(스튜디오 버전) — 준비 전 호출은 이걸 기다려라 */
  ready(): Promise<string> {
    return this.readyPromise;
  }

  on(fn: (ev: EditorEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  call<O extends EditorOp>(op: O, args?: EditorOps[O][0], transfer: Transferable[] = []): Promise<EditorOps[O][1]> {
    const win = this.frame?.contentWindow;
    if (!win) return Promise.reject(new Error("한글 편집기가 아직 열리지 않았습니다"));
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new EditorTimeoutError(op));
      }, TIMEOUT[op] ?? 20_000);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      win.postMessage({ kd: "req", id, op, args: args ?? {} }, this.hostOrigin, transfer);
    });
  }

  /** 편의: 바이트로 열기 (복사본을 넘겨 호출한 쪽 버퍼를 지키지 않는다면 그대로 transfer) */
  async open(bytes: Uint8Array, name: string): Promise<number> {
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const r = await this.call("load", { bytes: buf, name }, [buf]);
    return r.pageCount;
  }

  /** 편의: HWP·HWPX 바이트로 내보내기 */
  async save(format: "hwp" | "hwpx"): Promise<Uint8Array> {
    const r = await this.call("export", { format });
    return new Uint8Array(r.bytes);
  }

  destroy(): void {
    window.removeEventListener("message", this.onMessage);
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error("편집기를 닫았습니다"));
    }
    this.pending.clear();
    this.listeners.clear();
    this.frame = null;
  }

  private onMessage = (e: MessageEvent) => {
    if (!this.frame || e.source !== this.frame.contentWindow || e.origin !== this.hostOrigin) return;
    const msg = e.data as Incoming | undefined;
    if (msg?.kd === "res") {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.ok) p.resolve(msg.result);
      else p.reject(new Error(msg.error || "편집기 오류"));
      return;
    }
    if (msg?.kd === "event") {
      if (msg.type === "ready") this.resolveReady(msg.studioVersion);
      if (msg.type === "error") this.rejectReady(new Error(msg.message));
      for (const fn of this.listeners) fn(msg);
    }
  };
}
