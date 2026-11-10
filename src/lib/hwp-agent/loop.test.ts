/** 편집기 AI 대화 기록 덜어내기 — 지난 요청의 문서 맥락은 빼고, 길면 오래된 요청부터 통째로 */

import { describe, it, expect, vi } from "vitest";
import { runAgent, trimHistory, type AgentEvent } from "./loop";
import type { AgentSkill } from "./types";

const step = vi.hoisted(() => vi.fn());
vi.mock("../rpc", () => ({ rpc: step }));

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

describe("runAgent — 멈춘 요청", () => {
  const skill = (executeTool: AgentSkill["executeTool"]): AgentSkill => ({ systemPrompt: "", tools: [], executeTool } as unknown as AgentSkill);
  const hooks = () => ({ onText: vi.fn(), onTool: vi.fn() });
  const call = { text: "", redacted: 0, calls: [{ id: "1", name: "read_document", input: {} }] };

  it("도구를 하나도 못 돌리고 멈추면 그 요청을 대화에서 걷어 낸다", async () => {
    const ev: AgentEvent[] = [ask("앞 요청"), say("앞 답")];
    const ac = new AbortController();
    step.mockReset().mockImplementation(async () => { ac.abort(); throw new DOMException("멈췄습니다", "AbortError"); });
    await expect(runAgent({ skill: skill(vi.fn()), events: ev, request: "요약해 줘", signal: ac.signal, hooks: hooks() })).rejects.toThrow();
    expect(ev).toEqual([ask("앞 요청"), say("앞 답")]);
  });

  it("도구를 돌린 뒤 멈추면 짝이 맞는 한 줄로 남기고, 끊긴 도구는 실패로 적지 않는다", async () => {
    const ev: AgentEvent[] = [];
    const ac = new AbortController();
    step.mockReset().mockResolvedValue(call);
    let n = 0;
    const run = vi.fn(async () => {
      if (n++ === 0) return { output: "글", summary: "읽음" };
      ac.abort();
      throw new Error("끊김");
    });
    const h = hooks();
    await expect(runAgent({ skill: skill(run), events: ev, request: "두 번 읽어", signal: ac.signal, hooks: h })).rejects.toThrow();
    expect(ev).toHaveLength(2);
    expect(ev[0]).toEqual(ask("두 번 읽어"));
    expect(ev[1]).toMatchObject({ role: "assistant", calls: [] });
    expect(h.onTool.mock.calls.every(([t]) => !t.isError)).toBe(true);
  });
});
