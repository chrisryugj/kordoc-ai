/** 문서와 대화 — 이어 보낼 앞 대화에서 같은 역할 차례가 연달아 가지 않게 */

import { describe, it, expect, vi } from "vitest";
vi.mock("../lib/rpc", () => ({ rpc: vi.fn(), errorText: String, isAbort: () => false }));
import { chatHistory, type ChatItem } from "./useChat";

const q = (content: string): ChatItem => ({ role: "user", content });
const a = (content: string, more: Partial<ChatItem> = {}): ChatItem => ({ role: "assistant", content, ...more });

describe("chatHistory", () => {
  it("답이 실패한 질문 뒤에 다음 질문이 와도 사용자 차례가 연달아 가지 않는다", () => {
    const h = chatHistory([q("예산은?"), a("", { error: "AI 서버에 닿지 못했습니다" }), q("예산 합계는?"), a("3억 원입니다 [1]")]);
    expect(h).toEqual([{ role: "user", content: "예산은?\n\n예산 합계는?" }, { role: "assistant", content: "3억 원입니다 [1]" }]);
  });

  it("마지막 질문의 답이 실패했으면 그 질문은 빼고 보낸다 (엔진이 새 질문을 사용자 차례로 붙인다)", () => {
    const h = chatHistory([q("하나"), a("답 하나"), q("둘"), a("반쯤 온 답", { error: "답을 멈췄습니다" })]);
    expect(h).toEqual([{ role: "user", content: "하나" }, { role: "assistant", content: "답 하나" }]);
  });

  it("차례가 번갈아 오면 그대로 보낸다", () => {
    const h = chatHistory([q("하나"), a("답 하나"), q("둘"), a("답 둘")]);
    expect(h.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
  });
});
