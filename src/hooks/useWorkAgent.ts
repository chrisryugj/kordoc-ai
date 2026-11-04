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
import { deleteChat, loadChat, loadChats, newChatId, renameChat, saveChat, titleOf, type ChatBody, type ChatMeta } from "../lib/chat-store";

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

interface Live { meta: ChatMeta | null; body: ChatBody; skill: AgentSkill | null }

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
  const [runningId, setRunningId] = useState<string | null>(null);
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const ctrl = useRef<AbortController | null>(null);

  const live = useCallback((id: string): Live => {
    let l = store.current.get(id);
    if (!l) {
      const body = loadChat(id);
      const meta = body ? loadChats().find((c) => c.id === id) ?? null : null;
      l = { meta, body: body ?? { paths: [], turns: [], events: [] }, skill: null };
      store.current.set(id, l);
    }
    return l;
  }, []);

  const persist = useCallback((l: Live) => {
    if (!l.meta) return;
    l.meta = { ...l.meta, updatedAt: Date.now() };
    saveChat(l.meta, l.body);
    setChats(loadChats());
  }, []);

  // 다른 창(문서 카드)이 쓴 대화를 목록에 반영
  useEffect(() => {
    const onStorage = (e: StorageEvent) => { if (!e.key || e.key.startsWith("kordoc-chat")) setChats(loadChats()); };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
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
    send,
    start,
    stop,
    newChat,
    openChat,
    rename,
    remove,
  };
}
