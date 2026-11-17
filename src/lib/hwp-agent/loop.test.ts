/** 편집기 AI 대화 기록 덜어내기 — 지난 요청의 문서 맥락은 빼고, 길면 오래된 요청부터 통째로 */

import { describe, it, expect, vi } from "vitest";
import { failSummary, runAgent, trimHistory, wireEvents, type AgentEvent } from "./loop";
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

describe("runAgent — 헛도는 모델", () => {
  const skill = (executeTool: AgentSkill["executeTool"]): AgentSkill => ({ systemPrompt: "", tools: [], executeTool } as unknown as AgentSkill);
  const hooks = () => ({ onText: vi.fn(), onTool: vi.fn() });
  const ac = () => new AbortController().signal;
  const call = (input: Record<string, unknown> = {}) => ({ text: "", redacted: 0, calls: [{ id: "1", name: "read_document", input }] });

  it("같은 호출에 같은 결과가 세 번 이어지면 멈춘다", async () => {
    step.mockReset().mockResolvedValue(call());
    const r = await runAgent({ skill: skill(async () => ({ output: "같은 글", summary: "읽음" })), events: [], request: "읽어", signal: ac(), hooks: hooks() });
    expect(step).toHaveBeenCalledTimes(3);
    expect(r.text).toMatch(/되풀이/);
  });

  it("문서를 바꾸는 호출은 같아도 되풀이로 세지 않는다 (한 곳씩 차례로 바꾸기)", async () => {
    let n = 0;
    step.mockReset().mockImplementation(async () => (n++ < 5 ? call({ find: "가", replace: "나" }) : { text: "다 바꿨습니다", redacted: 0, calls: [] }));
    const r = await runAgent({ skill: skill(async () => ({ output: "1곳 바꿈", summary: "바꿈", mutated: true })), events: [], request: "바꿔", signal: ac(), hooks: hooks() });
    expect(r.text).toBe("다 바꿨습니다");
    expect(step).toHaveBeenCalledTimes(6);
  });

  it("부르는 도구마다 실패하는 차례가 다섯 번 이어지면 멈춘다", async () => {
    let n = 0;
    step.mockReset().mockImplementation(async () => call({ path: `없는 파일 ${n++}` }));
    const r = await runAgent({ skill: skill(async (c) => ({ output: `못 찾음 ${String(c.input.path)}`, summary: "실패", isError: true })), events: [], request: "읽어", signal: ac(), hooks: hooks() });
    expect(step).toHaveBeenCalledTimes(5);
    expect(r.text).toMatch(/계속 실패/);
  });
});

describe("차례 교대 — 사용자 차례가 연달아 가지 않게", () => {
  const skill = (executeTool: AgentSkill["executeTool"]): AgentSkill => ({ systemPrompt: "", tools: [], executeTool } as unknown as AgentSkill);
  const hooks = () => ({ onText: vi.fn(), onTool: vi.fn() });
  const ac = () => new AbortController().signal;
  const call = () => ({ text: "", redacted: 0, calls: [{ id: "1", name: "read_document", input: {} }] });
  /** 엔진이 도구 결과를 사용자 차례로 싣는 것과 같이 본 역할 */
  const roles = (ev: AgentEvent[]) => ev.map((e) => (e.role === "assistant" ? "assistant" : "user"));
  const alternates = (ev: AgentEvent[]) => roles(ev).every((r, i, a) => i === 0 || r !== a[i - 1]);

  it("헛돌아 멈춘 요청 뒤 다음 요청을 보내도 차례가 번갈아 간다", async () => {
    const ev: AgentEvent[] = [];
    step.mockReset().mockResolvedValue(call());
    const r = await runAgent({ skill: skill(async () => ({ output: "같은 글", summary: "읽음" })), events: ev, request: "읽어", signal: ac(), hooks: hooks() });
    expect(ev[ev.length - 1]).toEqual({ role: "assistant", text: r.text, calls: [] });
    step.mockReset().mockResolvedValue({ text: "알겠습니다", redacted: 0, calls: [] });
    await runAgent({ skill: skill(vi.fn()), events: ev, request: "다시 해", signal: ac(), hooks: hooks() });
    expect(alternates(step.mock.calls[0][1].events)).toBe(true);
  });

  it("되돌리기 알림 뒤 새 요청은 사용자 차례 하나로 합쳐 보낸다", async () => {
    const ev: AgentEvent[] = [ask("고쳐"), say("고쳤습니다"), ask("(사용자가 바로 앞 요청의 변경을 모두 되돌렸습니다.)")];
    step.mockReset().mockResolvedValue({ text: "네", redacted: 0, calls: [] });
    await runAgent({ skill: skill(vi.fn()), events: ev, request: "제목만 고쳐", signal: ac(), hooks: hooks() });
    const sent: AgentEvent[] = step.mock.calls[0][1].events;
    expect(sent).toHaveLength(3);
    expect(sent[2]).toEqual({ role: "user", text: "(사용자가 바로 앞 요청의 변경을 모두 되돌렸습니다.)\n\n제목만 고쳐" });
    // 부른 쪽이 쥔 대화는 그대로 (합치는 것은 보낼 때만)
    expect(ev[2]).toEqual(ask("(사용자가 바로 앞 요청의 변경을 모두 되돌렸습니다.)"));
  });

  it("wireEvents 는 합친 차례에 새 요청의 문서 맥락을 남긴다", () => {
    expect(wireEvents([ask("앞"), ask("뒤", "문서 글")])).toEqual([ask("앞\n\n뒤", "문서 글")]);
    expect(wireEvents([ask("하나"), say("답"), ask("둘")])).toHaveLength(3);
  });
});

describe("활동 줄의 실패 글", () => {
  it("도구가 던진 오류에 내부 도구 이름을 붙이지 않고, 영어 원문은 내지 않는다", () => {
    expect(failSummary(new Error("편집기가 답하지 않습니다"))).toBe("하지 못함 · 편집기가 답하지 않습니다");
    expect(failSummary(new Error("Cannot read properties of undefined"))).toBe("하지 못함");
  });

  it("도구가 던지거나 인자가 틀려도 진행 줄에 도구 이름이 나오지 않는다", async () => {
    step.mockReset()
      .mockResolvedValueOnce({ text: "", redacted: 0, calls: [{ id: "1", name: "replace_text", input: {}, inputError: "replace_text 에 꼭 필요한 인자가 빠졌습니다: find" }] })
      .mockResolvedValueOnce({ text: "", redacted: 0, calls: [{ id: "2", name: "replace_text", input: { find: "가", replace: "나" } }] })
      .mockResolvedValueOnce({ text: "못 했습니다", redacted: 0, calls: [] });
    const h = { onText: vi.fn(), onTool: vi.fn() };
    const sk = { systemPrompt: "", tools: [], executeTool: async () => { throw new Error("boom"); } } as unknown as AgentSkill;
    await runAgent({ skill: sk, events: [], request: "바꿔", signal: new AbortController().signal, hooks: h });
    const lines = h.onTool.mock.calls.map(([t]) => t.summary as string);
    expect(lines).toHaveLength(2);
    expect(lines.some((s) => /replace_text|boom/.test(s))).toBe(false);
  });
});
