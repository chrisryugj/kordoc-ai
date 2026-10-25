import { describe, expect, it } from "vitest";
import { TOOLS, createHwpSkill } from "./tools";
import type { AgentBridge } from "./bridge";

function fakeBridge(over: Partial<Record<keyof AgentBridge, unknown>> = {}) {
  const calls: Array<[string, unknown]> = [];
  const bridge = new Proxy({} as AgentBridge, {
    get: (_t, name: string) => async (arg: unknown) => {
      calls.push([name, arg]);
      const v = over[name as keyof AgentBridge];
      return typeof v === "function" ? (v as (a: unknown) => unknown)(arg) : v ?? {};
    },
  });
  return { bridge, calls };
}

describe("tools", () => {
  it("도구 이름은 겹치지 않고 모두 실행부가 있다", async () => {
    const names = TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    const { bridge } = fakeBridge();
    const { skill } = createHwpSkill({ bridge });
    for (const n of names) expect((await skill.executeTool({ id: "x", name: n, input: {} })).summary).not.toMatch(/모르는 도구/);
  });

  it("고치기 도구는 바뀐 곳을 알리고, 거절은 오류로 모델에 돌려준다", async () => {
    const changes: unknown[] = [];
    const { bridge, calls } = fakeBridge({ insertParagraphs: { first: "0.3", count: 2 }, fillCells: { error: "표 0.9.0 이 없습니다." } });
    const { skill } = createHwpSkill({ bridge, onChange: (c) => changes.push(c) });
    const ok = await skill.executeTool({ id: "1", name: "insert_paragraphs", input: { after: "0.2", texts: ["a", "b"] } });
    expect(ok).toMatchObject({ summary: "문단 2개 넣음", mutated: true });
    expect(calls[0]).toEqual(["insertParagraphs", { after: "0.2", texts: ["a", "b"] }]);
    expect(changes).toEqual([{ tool: "insert_paragraphs", place: "0.2" }]);
    const bad = await skill.executeTool({ id: "2", name: "fill_cells", input: { table: "0.9.0", cells: [] } });
    expect(bad).toMatchObject({ isError: true, output: "표 0.9.0 이 없습니다." });
    expect(changes).toHaveLength(1);
  });

  it("문맥: 문단 자리·표·스타일·빈칸·커서 문단", async () => {
    const { bridge } = fakeBridge({
      outline: { total: 2, from: 0, blocks: [{ id: "0.0", text: "제목" }, { id: "0.1", text: "", tables: [{ id: "0.1.0", rows: 2, cols: 3 }] }] },
      styles: [{ id: 0, name: "바탕글", englishName: "Normal", kind: "para" }],
      fields: [{ name: "시행일", value: "" }],
    });
    const h = createHwpSkill({ bridge });
    h.setSelection({ text: "제목", at: "0.0" });
    await h.refreshContext();
    const ctx = h.skill.buildContext!();
    expect(ctx).toContain("[0.0] 제목");
    expect(ctx).toContain("0.1.0: 2줄×3칸");
    expect(ctx).toContain("문단 스타일: 바탕글");
    expect(ctx).toContain("빈칸(누름틀): 시행일");
    expect(ctx).toContain('사용자의 커서가 있는 문단 0.0: "제목"');
  });

  it("도구 없이 고쳤다고 말하면 한 번 되묻는다", () => {
    const { skill } = createHwpSkill({ bridge: fakeBridge().bridge });
    expect(skill.verifyResponse!("제목을 바꿨습니다.", [])).toMatch(/도구를 실제로/);
    expect(skill.verifyResponse!("제목을 바꿨습니다.", [{ name: "replace_text", ok: true }])).toBeNull();
    expect(skill.verifyResponse!("무엇으로 바꿀까요?", [])).toBeNull();
  });
});
