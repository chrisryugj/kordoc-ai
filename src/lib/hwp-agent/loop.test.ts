/** 편집기 AI 대화 기록 덜어내기 — 지난 요청의 문서 맥락은 빼고, 길면 오래된 요청부터 통째로 */

import { describe, it, expect, vi } from "vitest";
import { MAX_STEPS, runAgent, trimHistory, type AgentEvent } from "./loop";
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

  it("루프가 넣은 되묻기는 요청 경계가 아니다 (되묻기부터 남기면 사용자 요청 없이 되묻기만 남는다)", () => {
    const ev: AgentEvent[] = [
      ask("하나"), say("x".repeat(300)), { role: "user", text: "정말 고쳤나요?", auto: true }, say("고쳤습니다"),
      ask("둘"), say("짧음"),
    ];
    trimHistory(ev, 200);
    expect(ev[0]).toEqual(ask("둘"));
  });

  it("요청이 하나뿐이면 길어도 지우지 않는다", () => {
    const ev = [ask("하나"), say("x".repeat(500))];
    trimHistory(ev, 100);
    expect(ev).toHaveLength(2);
  });
});

describe("runAgent — 되묻기", () => {
  it("하지 않은 편집을 했다고 답해 되물을 때 그 글에 auto 표지를 단다 (엔진이 사용자 요청으로 세지 않게)", async () => {
    const ev: AgentEvent[] = [];
    step.mockReset()
      .mockResolvedValueOnce({ text: "고쳤습니다", redacted: 0, calls: [] })
      .mockResolvedValueOnce({ text: "고치지 못했습니다", redacted: 0, calls: [] });
    const skill = { systemPrompt: "", tools: [], executeTool: vi.fn(), verifyResponse: () => "실제로 고친 것이 없습니다. 다시 답하세요." } as unknown as AgentSkill;
    await runAgent({ skill, events: ev, request: "주민번호를 가려 줘", signal: new AbortController().signal, hooks: { onText: vi.fn(), onTool: vi.fn() } });
    expect(ev.filter((e) => e.role === "user")).toEqual([
      expect.objectContaining({ text: "주민번호를 가려 줘" }),
      { role: "user", text: "실제로 고친 것이 없습니다. 다시 답하세요.", auto: true },
    ]);
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
    expect(r.cut).toBe(true);
  });

  it("차례 상한에 걸리면 모델이 중간에 쓴 글이 있어도 멈췄다고 알리고 끊김으로 돌려준다", async () => {
    let n = 0;
    step.mockReset().mockImplementation(async () => ({ text: "다음 문서를 변환하겠습니다", redacted: 0, calls: [{ id: "1", name: "convert", input: { n: n++ } }] }));
    const r = await runAgent({ skill: skill(async () => ({ output: "바꿈", summary: "바꿈", mutated: true })), events: [], request: "하나씩 PDF로", signal: ac(), hooks: hooks() });
    expect(step).toHaveBeenCalledTimes(MAX_STEPS);
    expect(r.text).toMatch(/^다음 문서를 변환하겠습니다/);
    expect(r.text).toMatch(/너무 여러 번 불러 멈췄습니다/);
    expect(r.cut).toBe(true);
  });

  it("도구 없이 답하고 끝난 요청은 끊김이 아니다", async () => {
    step.mockReset().mockResolvedValue({ text: "요약입니다", redacted: 0, calls: [] });
    const r = await runAgent({ skill: skill(vi.fn()), events: [], request: "요약해 줘", signal: ac(), hooks: hooks() });
    expect(r.text).toBe("요약입니다");
    expect(r.cut).toBeFalsy();
  });
});
