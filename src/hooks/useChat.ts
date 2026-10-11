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

/** 문서와 대화 (ai_chat) — 토큰을 받는 대로 마지막 답에 이어 붙인다 */
export function useChat(paths: string[]) {
  const [items, setItems] = useState<ChatItem[]>([]);
  const [busy, setBusy] = useState(false);
  const ctrl = useRef<AbortController | null>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const patchLast = (fn: (it: ChatItem) => ChatItem) =>
    setItems((prev) => (prev.length ? [...prev.slice(0, -1), fn(prev[prev.length - 1])] : prev));

  const send = useCallback(async (question: string) => {
    const q = question.trim();
    if (!q || !paths.length) return;
    const history: ChatMessage[] = itemsRef.current
      .filter((i) => !i.error && !i.pending && i.content)
      .map((i) => ({ role: i.role, content: i.content }));
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
      ctrl.current = null;
      setBusy(false);
    }
  }, [paths]);

  const stop = useCallback(() => ctrl.current?.abort(), []);
  const reset = useCallback(() => { ctrl.current?.abort(); setItems([]); }, []);

  return { items, busy, send, stop, reset };
}
