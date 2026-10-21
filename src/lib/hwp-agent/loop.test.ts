/** 편집기 AI 대화 기록 덜어내기 — 지난 요청의 문서 맥락은 빼고, 길면 오래된 요청부터 통째로 */

import { describe, it, expect } from "vitest";
import { trimHistory, type AgentEvent } from "./loop";

const ask = (text: string, context?: string): AgentEvent => ({ role: "user", text, ...(context ? { context } : {}) });
const say = (text: string): AgentEvent => ({ role: "assistant", text, calls: [] });

describe("trimHistory", () => {
  it("지난 요청의 문서 맥락을 뺀다", () => {
    const ev = [ask("첫 요청", "문서 글".repeat(10)), say("고쳤습니다")];
    trimHistory(ev);
    expect(ev[0]).toEqual({ role: "user", text: "첫 요청" });
  });

  it("상한을 넘으면 가장 오래된 요청을 도구 결과까지 통째로 덜어낸다", () => {
    const ev: AgentEvent[] = [
      ask("하나"), say("x".repeat(300)), { role: "tool", results: [{ id: "1", name: "read_document", output: "y".repeat(300) }] },
      ask("둘"), say("짧음"),
    ];
    trimHistory(ev, 200);
    expect(ev[0]).toEqual(ask("둘"));
    expect(ev).toHaveLength(2);
  });

  it("요청이 하나뿐이면 길어도 지우지 않는다", () => {
    const ev = [ask("하나"), say("x".repeat(500))];
    trimHistory(ev, 100);
    expect(ev).toHaveLength(2);
  });
});
