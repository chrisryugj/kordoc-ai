/**
 * 작업 에이전트 스킬 — 'AI에게 일 시키기'. 도구 목록·지시문은 엔진(core/agent-tools, RPC agent_tools)이 정본이고
 * MCP 로 바깥 AI 에이전트에 내는 목록과 같다. 도구 실행은 엔진(agent_tool_run), 모델 루프는 hwp-agent/loop.ts 를 그대로 쓴다.
 */

import { rpc } from "./rpc";
import type { AgentSkill, ExecutedToolCall, ToolExecution } from "./hwp-agent/types";

/** 만들었다고 말하는 말투 (파일을 만든 도구 없이 이렇게 답하면 한 번 되묻는다) */
const CLAIMS = /(만들었|저장했|바꿨|바꾸었|채웠|가렸|합쳤|고쳤)습니다/;

export async function createWorkSkill(deps: { files: () => string[]; onFiles: (files: string[]) => void }): Promise<AgentSkill> {
  const { system, tools } = await rpc("agent_tools", {});
  let made = 0;
  return {
    systemPrompt: system,
    tools,
    buildContext() {
      made = 0;
      const files = deps.files();
      return files.length ? `사용자가 붙인 파일·폴더:\n${files.map((f) => `- ${f}`).join("\n")}` : "사용자가 붙인 파일이 없습니다. 필요하면 파일을 붙여 달라고 하세요.";
    },
    verifyResponse(text: string, executed: ExecutedToolCall[]) {
      if (made > 0 || !executed.every((e) => e.ok)) return null;
      return CLAIMS.test(text) ? "파일을 만드는 도구를 실제로 부르지 않았습니다. 말한 일을 도구로 하거나, 하지 못했다면 하지 못했다고 답하세요." : null;
    },
    async executeTool(call, signal): Promise<ToolExecution> {
      // 멈추면 엔진 안에서 돌던 작업도 함께 멈춘다
      const r = await rpc("agent_tool_run", { name: call.name, input: call.input ?? {} }, { signal });
      if (r.files?.length) { made += r.files.length; deps.onFiles(r.files); }
      return { output: r.output, summary: r.summary, ...(r.isError ? { isError: true } : {}), ...(r.files?.length ? { mutated: true } : {}) };
    },
  };
}
