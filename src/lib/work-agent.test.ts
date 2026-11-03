/** 작업 에이전트 맥락 — "이어서" 요청은 파일 이름만 말하므로 이 대화에서 만든 파일의 전체 경로를 실어야 한다 */

import { describe, it, expect, vi } from "vitest";

const MADE = "C:\\결과\\회신.hwpx";
const ATTACHED = "C:\\받은\\공문.hwpx";

vi.mock("./rpc", () => ({
  rpc: vi.fn(async (method: string, params?: { name?: string }) => {
    if (method === "agent_tools") return { system: "sys", tools: [] };
    if (method === "agent_tool_run") {
      return params?.name === "precheck"
        ? { output: "파일이나 폴더를 찾을 수 없습니다. 경로가 맞는지 확인하세요.", summary: "precheck 실패", isError: true }
        : { output: "저장함", summary: "한글 문서 만듦", files: [MADE] };
    }
    throw new Error(method);
  }),
}));

import { createWorkSkill } from "./work-agent";

const run = (s: Awaited<ReturnType<typeof createWorkSkill>>, name: string, input: Record<string, unknown> = {}) =>
  s.executeTool({ id: name, name, input } as never, new AbortController().signal);

describe("createWorkSkill 맥락", () => {
  it("만든 파일이 없으면 붙인 파일만", async () => {
    const s = await createWorkSkill({ files: () => [ATTACHED], onFiles: () => {} });
    const ctx = s.buildContext!();
    expect(ctx).toContain(`- ${ATTACHED}`);
    expect(ctx).not.toContain("이 대화에서 만든 파일");
  });

  it("도구가 만든 파일은 다음 요청 맥락에 전체 경로로 남는다 (한 번만)", async () => {
    const s = await createWorkSkill({ files: () => [], onFiles: () => {} });
    s.buildContext!();
    await run(s, "write_document");
    await run(s, "write_document");
    const ctx = s.buildContext!();
    expect(ctx).toContain("이 대화에서 만든 파일");
    expect(ctx.split(`- ${MADE}`).length - 1).toBe(1);
  });

  it("경로를 못 찾은 실패에는 쓸 수 있는 전체 경로를 붙인다 (바꿔 넣지는 않음)", async () => {
    const s = await createWorkSkill({ files: () => [ATTACHED], onFiles: () => {} });
    s.buildContext!();
    await run(s, "write_document");
    const r = await run(s, "precheck", { path: "[New file]" });
    expect(r.isError).toBe(true);
    expect(r.output).toContain(`- ${ATTACHED}`);
    expect(r.output).toContain(`- ${MADE}`);
  });
});
