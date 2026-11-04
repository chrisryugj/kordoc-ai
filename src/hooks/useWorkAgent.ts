/**
 * AI 에게 일 시키기 — 대화(세션) 여러 개를 오가며 보내기·멈추기. 대화마다 요청·결과·모델에 이어 보낼 대화를 저장한다(lib/chat-store).
 * 본창은 state/chats 가 하나를 들고 홈·AI 대화 화면이 같이 쓰고, 문서 카드 창은 따로 하나를 쓴다(같은 목록에 남는다).
 * 도구는 엔진의 작업 에이전트 도구(MCP 와 같은 목록), 모델 루프는 hwp-agent/loop.ts.
 * 한 번에 한 요청만 돈다. 도는 중에 다른 대화로 옮겨도 그 요청은 제 대화에 이어 쓴다.
 */

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { errorText, isAbort } from "../lib/rpc";
import { createWorkSkill } from "../lib/work-agent";
import { runAgent } from "../lib/hwp-agent/loop";
import type { AgentSkill } from "../lib/hwp-agent/types";
import { chatIdOf, deleteChat, loadChat, loadChats, newChatId, renameChat, saveChat, titleOf, type ChatBody, type ChatMeta } from "../lib/chat-store";

export interface AgentStep { tool: string; summary: string; isError: boolean }

export interface AgentTurn {
  request: string;
  steps: AgentStep[];
  text: string;
  files: string[];
  /** 손으로 하면 걸릴 분 (효과 집계 기준 가정치) */
  saved: number;
  state: "running" | "done" | "stopped" | "error";
  startedAt: number;
  ms?: number;
}

/** gone: 지운 대화 (늦게 끝난 요청이 다시 저장하지 않게) */
interface Live { meta: ChatMeta | null; body: ChatBody; skill: AgentSkill | null; gone?: boolean }

export interface WorkAgent {
  chatId: string;
  /** 지금 보는 대화의 제목 (아직 보낸 적 없으면 null) */
  title: string | null;
  chats: ChatMeta[];
  paths: string[];
  setPaths: (paths: string[]) => void;
  turns: AgentTurn[];
  busy: boolean;
  /** 도는 요청이 있는 대화 */
  runningId: string | null;
  /** 지금 보는 대화가 다른 창(문서 카드·본창)에서 도는 중 (끝날 때까지 이 창에서는 보내지 않는다) */
  elsewhere: boolean;
  send: (text: string) => Promise<void>;
  start: (text: string, paths: string[]) => Promise<void>;
  stop: () => void;
  newChat: (paths?: string[]) => void;
  openChat: (id: string) => void;
  rename: (id: string, title: string) => void;
  remove: (id: string) => void;
}

export function useWorkAgent({ from }: { from?: "card" } = {}): WorkAgent {
  const store = useRef(new Map<string, Live>());
  const [viewId, setViewId] = useState(newChatId);
  const [chats, setChats] = useState<ChatMeta[]>(loadChats);
  const [runningId, setRunningIdState] = useState<string | null>(null);
  const running = useRef<string | null>(null);
  const setRunningId = (id: string | null) => { running.current = id; setRunningIdState(id); };
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const ctrl = useRef<AbortController | null>(null);

  const live = useCallback((id: string): Live => {
    let l = store.current.get(id);
    if (!l) {
      // 이 창이 뜬 뒤 시작한 요청이 돌고 있으면 다른 창이 하는 중이다 (그 전 것은 앱이 꺼져 멈춘 것)
      const body = loadChat(id, performance.timeOrigin);
      const meta = body ? loadChats().find((c) => c.id === id) ?? null : null;
      l = { meta, body: body ?? { paths: [], turns: [], events: [] }, skill: null };
      store.current.set(id, l);
    }
    return l;
  }, []);

  const persist = useCallback((l: Live) => {
    if (!l.meta || l.gone) return;
    // 다른 창에서 바꾼 이름은 덮지 않는다
    const title = loadChats().find((c) => c.id === l.meta!.id)?.title ?? l.meta.title;
    l.meta = { ...l.meta, title, updatedAt: Date.now() };
    saveChat(l.meta, l.body);
    setChats(loadChats());
  }, []);

  // 다른 창(문서 카드·본창)이 쓴 대화를 목록과 열어 둔 대화에 반영
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key && !e.key.startsWith("kordoc-chat")) return;
      setChats(loadChats());
      const id = chatIdOf(e.key);
      const l = id ? store.current.get(id) : undefined;
      if (!id || !l) return;
      if (e.newValue === null) {
        // 다른 창에서 지웠다: 이 창에서 돌던 요청이면 멈추고, 다시 저장하지 않는다
        l.gone = true;
        if (running.current === id) ctrl.current?.abort();
        store.current.delete(id);
      } else if (running.current !== id) {
        // 다른 창이 이어 쓴 대화: 다음에 그릴 때 저장소에서 다시 읽는다
        store.current.delete(id);
      }
      redraw();
    };
    // 창을 닫으면 돌던 요청을 멈춘 것으로 남긴다 (다른 창이 도는 중으로 계속 보지 않게)
    const onHide = () => {
      const l = running.current ? store.current.get(running.current) : undefined;
      const ts = l?.body.turns ?? [];
      const t = ts[ts.length - 1];
      if (!l?.meta || l.gone || t?.state !== "running") return;
      l.body = { ...l.body, turns: [...ts.slice(0, -1), { ...t, state: "stopped", text: t.text || "창을 닫아서 멈췄습니다.", ms: Date.now() - t.startedAt }] };
      saveChat(l.meta, l.body);
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("pagehide", onHide);
    };
  }, []);

  const cur = live(viewId);

  const setPaths = useCallback((paths: string[]) => {
    const l = live(viewId);
    l.body = { ...l.body, paths };
    redraw();
    persist(l);
  }, [viewId, live, persist]);

  const run = useCallback(async (id: string, text: string) => {
    const request = text.trim();
    if (!request || ctrl.current) return;
    const l = live(id);
    if (l.body.turns[l.body.turns.length - 1]?.state === "running") return;
    const ac = new AbortController();
    ctrl.current = ac;
    setRunningId(id);
    const startedAt = Date.now();
    l.meta ??= { id, title: titleOf(request), createdAt: startedAt, updatedAt: startedAt, ...(from ? { from } : {}) };
    l.body = { ...l.body, turns: [...l.body.turns, { request, steps: [], text: "", files: [], saved: 0, state: "running", startedAt }] };
    redraw();
    persist(l);
    const patch = (fn: (t: AgentTurn) => AgentTurn, save = false) => {
      const ts = l.body.turns;
      l.body = { ...l.body, turns: [...ts.slice(0, -1), fn(ts[ts.length - 1])] };
      redraw();
      if (save) persist(l);
    };
    try {
      l.skill ??= await createWorkSkill({
        files: () => l.body.paths,
        outputs: l.body.turns.flatMap((t) => t.files),
        onFiles: (f) => patch((t) => ({ ...t, files: [...new Set([...t.files, ...f])] }), true),
        onSaved: (m) => patch((t) => ({ ...t, saved: t.saved + m })),
      });
      const r = await runAgent({
        skill: l.skill,
        events: l.body.events,
        request,
        signal: ac.signal,
        hooks: {
          onText: (s) => patch((t) => ({ ...t, text: s })),
          onTool: (s) => patch((t) => ({ ...t, steps: [...t.steps, { tool: s.name, summary: s.summary, isError: s.isError }] }), true),
        },
      });
      const note = r.redacted ? `\n\n(외부 AI로 보내기 전에 개인정보 ${r.redacted}건을 가렸습니다.)` : "";
      patch((t) => ({ ...t, text: (r.text || t.text || "끝났습니다.") + note, state: "done", ms: Date.now() - startedAt }), true);
    } catch (e) {
      const aborted = isAbort(e);
      patch((t) => ({ ...t, text: aborted ? "멈췄습니다." : errorText(e), state: aborted ? "stopped" : "error", ms: Date.now() - startedAt }), true);
    } finally {
      ctrl.current = null;
      setRunningId(null);
    }
  }, [live, persist, from]);

  const send = useCallback((text: string) => run(viewId, text), [run, viewId]);

  /** 새 대화를 열고 바로 보낸다 (홈 입력창) */
  const start = useCallback((text: string, paths: string[]) => {
    if (!text.trim() || ctrl.current) return Promise.resolve();
    const id = newChatId();
    store.current.set(id, { meta: null, body: { paths, turns: [], events: [] }, skill: null });
    setViewId(id);
    return run(id, text);
  }, [run]);

  const stop = useCallback(() => ctrl.current?.abort(), []);

  const newChat = useCallback((paths: string[] = []) => {
    const cur = store.current.get(viewId);
    // 아직 아무것도 안 보낸 빈 대화면 그 자리를 그대로 쓴다
    if (cur && !cur.meta && !cur.body.turns.length) {
      cur.body = { ...cur.body, paths };
      redraw();
      return;
    }
    const id = newChatId();
    store.current.set(id, { meta: null, body: { paths, turns: [], events: [] }, skill: null });
    setViewId(id);
  }, [viewId]);

  const openChat = useCallback((id: string) => setViewId(id), []);

  const rename = useCallback((id: string, title: string) => {
    renameChat(id, title);
    const l = store.current.get(id);
    if (l?.meta && title.trim()) l.meta = { ...l.meta, title: title.replace(/\s+/g, " ").trim() };
    setChats(loadChats());
  }, []);

  const remove = useCallback((id: string) => {
    if (id === runningId) ctrl.current?.abort();
    deleteChat(id);
    const l = store.current.get(id);
    if (l) l.gone = true;
    store.current.delete(id);
    setChats(loadChats());
    if (id === viewId) {
      const nid = newChatId();
      store.current.set(nid, { meta: null, body: { paths: [], turns: [], events: [] }, skill: null });
      setViewId(nid);
    }
  }, [viewId, runningId]);

  return {
    chatId: viewId,
    title: cur.meta?.title ?? null,
    chats,
    paths: cur.body.paths,
    setPaths,
    turns: cur.body.turns,
    busy: runningId !== null,
    runningId,
    elsewhere: runningId !== viewId && cur.body.turns[cur.body.turns.length - 1]?.state === "running",
    send,
    start,
    stop,
    newChat,
    openChat,
    rename,
    remove,
  };
}
