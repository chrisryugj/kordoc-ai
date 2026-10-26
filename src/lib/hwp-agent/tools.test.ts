import { readFileSync } from "node:fs";
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

  it("도구가 부르는 편집기 연산은 중계 페이지 허용 목록과 플러그인에 모두 있다", async () => {
    const { bridge, calls } = fakeBridge();
    const { skill } = createHwpSkill({ bridge });
    for (const t of TOOLS) await skill.executeTool({ id: "x", name: t.name, input: {} });
    const ops = [...new Set(calls.map(([name]) => name))];
    const host = readFileSync(new URL("../../../node-sidecar/editor-host/host.js", import.meta.url), "utf-8");
    const allowed = /AGENT_METHODS = new Set\(\[([\s\S]*?)\]\)/.exec(host)?.[1] ?? "";
    const plugin = readFileSync(new URL("../../../node-sidecar/studio-plugin/kordoc-ai-plugin.mjs", import.meta.url), "utf-8");
    for (const op of ops) {
      expect(allowed, `host.js AGENT_METHODS 에 ${op}`).toContain(`'${op}'`);
      expect(plugin, `kordoc-ai-plugin.mjs 에 ${op}`).toMatch(new RegExp(`'${op}'|\\b${op}:`));
    }
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

  it("org_format — 앱의 우리 기관 문서 모음에서 갈래 구성을 가져오고, 문맥에 있는 갈래를 알린다 (편집기 연산은 안 부름)", async () => {
    const { bridge, calls } = fakeBridge({ outline: { total: 0, from: 0, blocks: [] }, styles: [], fields: [] });
    const asked: string[] = [];
    const org = { kinds: async () => "보고서 2건", reference: async (k: string) => { asked.push(k); return k === "보고서" ? "우리 기관 보고서 2건에서 뽑은 구성" : null; } };
    const h = createHwpSkill({ bridge, org });
    expect((await h.skill.executeTool({ id: "1", name: "org_format", input: {} })).output).toContain("보고서 2건");
    expect(await h.skill.executeTool({ id: "2", name: "org_format", input: { kind: "보고서" } })).toMatchObject({ output: "우리 기관 보고서 2건에서 뽑은 구성", summary: "우리 기관 보고서 구성 확인" });
    const none = await h.skill.executeTool({ id: "3", name: "org_format", input: { kind: "보도자료" } });
    expect(none.output).toContain("있는 갈래: 보고서 2건");
    expect(asked).toEqual(["보고서", "보도자료"]);
    await h.refreshContext();
    expect(h.skill.buildContext!()).toContain("우리 기관 문서 모음: 보고서 2건");
    expect(calls.map(([n]) => n).sort()).toEqual(["fields", "outline", "styles"]);
    const bare = createHwpSkill({ bridge });
    expect(await bare.skill.executeTool({ id: "4", name: "org_format", input: { kind: "보고서" } })).toMatchObject({ isError: true });
  });

  it("도구 없이 고쳤다고 말하면 한 번 되묻는다", () => {
    const { skill } = createHwpSkill({ bridge: fakeBridge().bridge });
    expect(skill.verifyResponse!("제목을 바꿨습니다.", [])).toMatch(/도구를 실제로/);
    expect(skill.verifyResponse!("제목을 바꿨습니다.", [{ name: "replace_text", ok: true }])).toBeNull();
    expect(skill.verifyResponse!("무엇으로 바꿀까요?", [])).toBeNull();
  });
});
