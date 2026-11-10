/**
 * AI 대화 기록 — 대화(세션)마다 요청·진행·결과와 모델에 이어 보낼 대화(events)를 이 PC 화면 저장소에 둔다.
 * 목록(제목·시각)과 본문을 따로 둬서 목록을 그릴 때 본문을 다 읽지 않는다. 본창·문서 카드 창이 같은 저장소를 쓴다.
 * 저장소를 못 쓰면(가득 참 등) 이번 실행 동안만 기억한다.
 */

import type { AgentTurn } from "../hooks/useWorkAgent";
import { trimHistory, type AgentEvent } from "./hwp-agent/loop";

export interface ChatMeta {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  /** 우클릭 문서 카드 창에서 시작한 대화 */
  from?: "card";
}

export interface ChatBody {
  paths: string[];
  turns: AgentTurn[];
  events: AgentEvent[];
}

const INDEX = "kordoc-chats";
const BODY = (id: string) => `kordoc-chat:${id}`;
/** 오래된 대화부터 지운다 */
export const MAX_CHATS = 60;
/** 제목 글자 수 (첫 요청을 줄여 쓴다) */
const TITLE_MAX = 40;

export function newChatId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

/** 첫 요청 → 대화 제목: 줄바꿈을 걷고 앞부분만 */
export function titleOf(request: string): string {
  const one = request.replace(/\s+/g, " ").trim();
  return one.length > TITLE_MAX ? `${one.slice(0, TITLE_MAX - 1)}…` : one || "새 대화";
}

export function loadChats(): ChatMeta[] {
  try {
    const list = JSON.parse(localStorage.getItem(INDEX) ?? "[]") as ChatMeta[];
    return Array.isArray(list) ? list.filter((c) => c && typeof c.id === "string").sort((a, b) => b.updatedAt - a.updatedAt) : [];
  } catch {
    return [];
  }
}

function saveIndex(list: ChatMeta[]) {
  const sorted = [...list].sort((a, b) => b.updatedAt - a.updatedAt);
  for (const old of sorted.slice(MAX_CHATS)) removeBody(old.id);
  try {
    localStorage.setItem(INDEX, JSON.stringify(sorted.slice(0, MAX_CHATS)));
  } catch {
    /* 이번 실행 동안만 */
  }
}

function removeBody(id: string) {
  try { localStorage.removeItem(BODY(id)); } catch { /* 무시 */ }
}

/** 저장소 키 → 대화 id (본문 키가 아니면 null) */
export function chatIdOf(key: string | null): string | null {
  return key?.startsWith("kordoc-chat:") ? key.slice("kordoc-chat:".length) : null;
}

/** liveSince: 이 시각 뒤에 시작한 요청은 다른 창(문서 카드·본창)에서 도는 중이라 그대로 둔다 */
export function loadChat(id: string, liveSince = Infinity): ChatBody | null {
  try {
    const raw = localStorage.getItem(BODY(id));
    if (!raw) return null;
    const b = JSON.parse(raw) as ChatBody;
    // 앱이 꺼질 때 돌던 요청은 멈춘 것으로 보인다
    const turns = (b.turns ?? []).map((t) => (t.state === "running" && !(t.startedAt >= liveSince) ? { ...t, state: "stopped" as const, text: t.text || "앱이 꺼져서 멈췄습니다." } : t));
    return { paths: b.paths ?? [], turns, events: b.events ?? [] };
  } catch {
    return null;
  }
}

/** 본문과 목록을 함께 쓴다. 목록은 매번 저장소에서 다시 읽어 다른 창이 쓴 대화를 덮지 않는다 */
/** 한 대화에 남길 요청 수와 크기 상한 — 오래 쓴 대화 하나가 저장소를 다 차지해 다른 대화까지 지워지지 않게 (모델에 보내는 대화는 loop 의 HISTORY_CHARS 로 따로 줄인다) */
export const MAX_TURNS = 60;
const MAX_BODY_CHARS = 600_000;
const MAX_TEXT = 20_000;

/** 저장하는 도구 결과 한 건의 글자 상한 (문서 읽기 결과는 문서 전문이라 수십만 자가 된다) */
const MAX_TOOL_OUT = 4_000;

/** 모델에 이어 보낼 대화의 저장본 — 도구 결과는 앞부분만, 길이는 다음 요청에 실제로 이어 보낼 만큼만(loop 의 trimHistory 와 같은 기준).
 *  이것을 줄이지 않으면 큰 문서를 한 번 읽은 대화가 저장소를 다 차지해, 화면에 보이는 요청이 잘려 나가거나 다른 대화가 지워진다 */
function fitEvents(events: AgentEvent[]): AgentEvent[] {
  const copy = events.map((e): AgentEvent => (e.role === "tool"
    ? { ...e, results: e.results.map((r) => (r.output.length > MAX_TOOL_OUT ? { ...r, output: `${r.output.slice(0, MAX_TOOL_OUT)}…(줄임)` } : r)) }
    : { ...e }));
  trimHistory(copy);
  return copy;
}

/** 오래된 요청부터 덜고, 아주 긴 답 글은 앞부분만 남긴다 */
export function fitBody(body: ChatBody): ChatBody {
  let turns = body.turns.slice(-MAX_TURNS).map((t) => (t.text.length > MAX_TEXT ? { ...t, text: `${t.text.slice(0, MAX_TEXT)}…` } : t));
  let out = { ...body, turns, events: fitEvents(body.events) };
  // 그래도 크면 화면에 보이는 요청보다 모델 기억을 먼저 버린다 (기억은 다음 요청에서 다시 쌓인다)
  if (JSON.stringify(out).length > MAX_BODY_CHARS) out = { ...out, events: [] };
  while (JSON.stringify(out).length > MAX_BODY_CHARS && turns.length > 1) {
    turns = turns.slice(1);
    out = { ...out, turns };
  }
  return out;
}

export function saveChat(meta: ChatMeta, body0: ChatBody) {
  const body = fitBody(body0);
  const write = () => localStorage.setItem(BODY(meta.id), JSON.stringify(body));
  try {
    write();
  } catch {
    // 가득 찼으면 가장 오래된 대화부터 하나씩 지우며 들어갈 때까지 (한꺼번에 여럿을 지우면 대화가 몇 개 없을 때 전부 사라진다)
    const list = loadChats().filter((c) => c.id !== meta.id);
    let ok = false;
    while (!ok && list.length) {
      removeBody(list.pop()!.id);
      try { write(); ok = true; } catch { /* 하나 더 */ }
    }
    saveIndex(list);
    if (!ok) try { write(); } catch { /* 이번 실행 동안만 */ }
  }
  saveIndex([meta, ...loadChats().filter((c) => c.id !== meta.id)]);
}

export function renameChat(id: string, title: string) {
  const t = title.replace(/\s+/g, " ").trim();
  if (!t) return;
  saveIndex(loadChats().map((c) => (c.id === id ? { ...c, title: t } : c)));
}

export function deleteChat(id: string) {
  removeBody(id);
  saveIndex(loadChats().filter((c) => c.id !== id));
}

/** 목록 묶음: 오늘·어제·지난 7일·지난 30일·그 전 */
export function groupOf(at: number, now = Date.now()): string {
  const day = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const diff = Math.round((day(now) - day(at)) / 86_400_000);
  if (diff <= 0) return "오늘";
  if (diff === 1) return "어제";
  if (diff < 7) return "지난 7일";
  if (diff < 30) return "지난 30일";
  return "그 전";
}
