/** 작업 에이전트 맥락 — "이어서" 요청은 파일 이름만 말하므로 이 대화에서 만든 파일의 전체 경로를 실어야 한다 */

import { describe, it, expect, vi } from "vitest";

vi.mock("./rpc", () => ({
  rpc: vi.fn(async (method: string) => {
    if (method === "agent_tools") return { system: "sys", tools: [] };
    if (method === "agent_tool_run") return { output: "저장함", summary: "한글 문서 만듦", files: ["C:\\결과\\회신.hwpx"] };
    throw new Error(method);
  }),
}));

import { createWorkSkill } from "./work-agent";

describe("createWorkSkill 맥락", () => {
  it("만든 파일이 없으면 붙인 파일만", async () => {
    const s = await createWorkSkill({ files: () => ["C:\\받은\\공문.hwpx"], onFiles: () => {} });
    const ctx = s.buildContext!();
    expect(ctx).toContain("- C:\\받은\\공문.hwpx");
    expect(ctx).not.toContain("이 대화에서 만든 파일");
  });

  it("도구가 만든 파일은 다음 요청 맥락에 전체 경로로 남는다 (한 번만)", async () => {
    const s = await createWorkSkill({ files: () => [], onFiles: () => {} });
    s.buildContext!();
    await s.executeTool({ id: "1", name: "write_document", input: {} } as never, new AbortController().signal);
    await s.executeTool({ id: "2", name: "write_document", input: {} } as never, new AbortController().signal);
    const ctx = s.buildContext!();
    expect(ctx).toContain("이 대화에서 만든 파일");
    expect(ctx.match(/- C:\\결과\\회신\.hwpx/g)).toHaveLength(1);
  });
});
