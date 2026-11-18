import { useCallback, useRef, useState } from "react";
import type { ChatMessage, Citation } from "../lib/contract";
import { errorText, isAbort, rpc } from "../lib/rpc";

export interface ChatItem {
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  /** 숫자가 있는데 근거 번호를 달지 않은 문장 */
  unsupported?: string[];
  redacted?: number;
  error?: string;
  pending?: boolean;
}

/** 이어 보낼 앞 대화. 답이 실패·멈춘 질문 뒤에는 같은 역할 차례가 연달아 남는다 → 하나로 합친다
 *  (차례가 번갈아 와야 받는 서버가 거절하지 않게). 답을 못 받은 마지막 질문은 뺀다: 엔진이 새 질문을 사용자 차례로 붙인다 */
export function chatHistory(items: ChatItem[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const i of items) {
    if (i.error || i.pending || !i.content.trim()) continue;
    const prev = out[out.length - 1];
    if (prev?.role === i.role) out[out.length - 1] = { role: i.role, content: `${prev.content}\n\n${i.content}` };
    else out.push({ role: i.role, content: i.content });
  }
  if (out[out.length - 1]?.role === "user") out.pop();
  return out;
}

/** 문서와 대화 (ai_chat) — 토큰을 받는 대로 마지막 답에 이어 붙인다 */
export function useChat(paths: string[]) {
  const [items, setItems] = useState<ChatItem[]>([]);
  const [busy, setBusy] = useState(false);
  const ctrl = useRef<AbortController | null>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const patchLast = (fn: (it: ChatItem) => ChatItem) =>
    setItems((prev) => (prev.length ? [...prev.slice(0, -1), fn(prev[prev.length - 1])] : prev));

  /** 보냈으면 true — 답을 받는 중이거나 빈 질문이면 false (부른 쪽은 true 일 때만 입력칸을 비운다) */
  const send = useCallback(async (question: string): Promise<boolean> => {
    const q = question.trim();
    // 답을 받는 중 Enter 를 또 누르면 요청이 둘 돌고 토큰이 섞인다
    if (!q || !paths.length || ctrl.current) return false;
    const history = chatHistory(itemsRef.current);
    setItems((prev) => [...prev, { role: "user", content: q }, { role: "assistant", content: "", pending: true }]);
    const ac = new AbortController();
    ctrl.current = ac;
    setBusy(true);
    try {
      const res = await rpc("ai_chat", { paths, question: q, history }, {
        signal: ac.signal,
        onToken: (t) => patchLast((it) => ({ ...it, content: it.content + t })),
      });
      patchLast(() => ({ role: "assistant", content: res.answer, citations: res.citations, unsupported: res.unsupported, redacted: res.redacted }));
    } catch (e) {
      patchLast((it) => ({ ...it, pending: false, error: isAbort(e) ? "답을 멈췄습니다" : errorText(e) }));
    } finally {
      if (ctrl.current === ac) ctrl.current = null;
      setBusy(false);
    }
    return true;
  }, [paths]);

  const stop = useCallback(() => ctrl.current?.abort(), []);
  const reset = useCallback(() => { ctrl.current?.abort(); ctrl.current = null; setItems([]); }, []);

  return { items, busy, send, stop, reset };
}
