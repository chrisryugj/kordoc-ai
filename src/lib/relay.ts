/**
 * 중계 모드 — 주소에 ?relay=http://127.0.0.1:7717 이 있으면 Tauri 창인 척한다.
 * window.__TAURI_INTERNALS__ 를 깔아 @tauri-apps/api(invoke·이벤트·대화상자·창)가 그대로 돌게 하고,
 *   명령  → POST {relay}/invoke { cmd, args } → { ok, result | error }
 *   이벤트 → EventSource({relay}/events), 이벤트 이름 = Tauri 이벤트 이름
 * 목 응답은 하나도 쓰지 않는다 (진짜 사이드카 결과만). 중계기: scripts/dev-relay.mjs (리드 소유).
 * 화면 검증과 무관한 플러그인(알림·창 상태·프로세스·외부 링크·창 조작)은 여기서 성공으로 삼킨다.
 * main.tsx 가 맨 먼저 불러야 한다 (rpc.ts 가 불러올 때 Tauri 여부를 정한다).
 */

type Callback = (payload: unknown) => void;

const relay = new URLSearchParams(window.location.search).get("relay")?.replace(/\/+$/, "");
/** ?notify 가 있으면 알림 권한이 있는 척하고 알림을 중계기로 넘긴다 (빠른 동작 시험: 중계기 /log 로 확인) */
const notifyOn = new URLSearchParams(window.location.search).has("notify");

if (relay && !("__TAURI_INTERNALS__" in window)) {
  const callbacks = new Map<number, Callback>();
  const listeners = new Map<string, Map<number, number>>(); // 이벤트 이름 → (eventId → callbackId)
  const subscribed = new Set<string>();
  const source = new EventSource(`${relay}/events`);
  let nextCallback = 1;
  let nextEvent = 1;

  const subscribe = (event: string) => {
    if (subscribed.has(event)) return;
    subscribed.add(event);
    source.addEventListener(event, (e) => {
      let payload: unknown = (e as MessageEvent).data;
      try { payload = JSON.parse(String(payload)); } catch { /* 글 그대로 */ }
      listeners.get(event)?.forEach((cbId, eventId) => callbacks.get(cbId)?.({ event, id: eventId, payload }));
    });
  };

  /** 중계기로 보내지 않고 여기서 끝내는 명령 */
  const local = (cmd: string): { done: boolean; value?: unknown } => {
    if (cmd === "plugin:notification|is_permission_granted") return { done: true, value: notifyOn };
    if (cmd === "plugin:notification|request_permission") return { done: true, value: notifyOn ? "granted" : "denied" };
    if (cmd === "plugin:window|is_focused") return { done: true, value: !notifyOn };
    if (cmd === "plugin:window|is_visible") return { done: true, value: true };
    if (/^plugin:(notification|window-state|process|shell|window|webview|deep-link)\|/.test(cmd)) return { done: true, value: null };
    return { done: false };
  };

  // 알림 플러그인은 window.Notification 으로 보낸다: ?notify 면 권한이 있는 척하고 중계기 기록으로
  if (notifyOn) {
    class RelayNotification {
      static permission = "granted";
      static requestPermission = async () => "granted";
      constructor(title: string, opts?: { body?: string }) {
        void fetch(`${relay}/invoke`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cmd: "plugin:notification|notify", args: { title, body: opts?.body ?? "" } }) });
      }
    }
    (window as unknown as { Notification: unknown }).Notification = RelayNotification;
  }

  const internals = {
    metadata: { currentWindow: { label: "main" }, currentWebview: { windowLabel: "main", label: "main" } },
    transformCallback(cb: Callback, once = false): number {
      const id = nextCallback++;
      callbacks.set(id, (p) => { if (once) callbacks.delete(id); cb(p); });
      return id;
    },
    unregisterCallback(id: number) { callbacks.delete(id); },
    convertFileSrc(path: string, protocol = "asset") { return `${protocol}://localhost/${encodeURIComponent(path)}`; },
    async invoke(cmd: string, args: Record<string, unknown> = {}): Promise<unknown> {
      if (cmd === "plugin:event|listen") {
        const event = String(args.event);
        const id = nextEvent++;
        if (!listeners.has(event)) listeners.set(event, new Map());
        listeners.get(event)!.set(id, Number(args.handler));
        subscribe(event);
        return id;
      }
      if (cmd === "plugin:event|unlisten") { listeners.get(String(args.event))?.delete(Number(args.eventId)); return null; }
      if (cmd.startsWith("plugin:event|")) return null;
      const l = local(cmd);
      if (l.done) return l.value;
      const res = await fetch(`${relay}/invoke`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cmd, args }) });
      const body = (await res.json()) as { ok: boolean; result?: unknown; error?: unknown };
      if (!body.ok) throw body.error ?? "중계기 오류";
      return body.result;
    },
  };

  Object.assign(window, {
    __TAURI_INTERNALS__: internals,
    __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: (event: string, id: number) => listeners.get(event)?.delete(id) },
  });
}

export {};
