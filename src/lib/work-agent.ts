/**
 * 작업 에이전트 스킬 — 'AI에게 일 시키기'. 도구 목록·지시문은 엔진(core/agent-tools, RPC agent_tools)이 정본이고
 * MCP 로 바깥 AI 에이전트에 내는 목록과 같다. 도구 실행은 엔진(agent_tool_run), 모델 루프는 hwp-agent/loop.ts 를 그대로 쓴다.
 */

import { rpc } from "./rpc";
import type { AgentSkill, ExecutedToolCall, ToolExecution } from "./hwp-agent/types";

/** 만들었다고 말하는 말투 (파일을 만든 도구 없이 이렇게 답하면 한 번 되묻는다) */
const CLAIMS = /(만들었|저장했|바꿨|바꾸었|채웠|가렸|합쳤|고쳤)습니다/;

export async function createWorkSkill(deps: { files: () => string[]; onFiles: (files: string[]) => void; onSaved?: (minutes: number) => void; outputs?: string[] }): Promise<AgentSkill> {
  const { system, tools } = await rpc("agent_tools", {});
  let made = 0;
  // 이 대화에서 만든 파일: "이어서" 요청은 파일 이름만 말하므로 전체 경로를 맥락에 실어야 모델이 경로를 지어내지 않는다 (실측: Gemma 4 E4B 가 precheck 에 없는 경로를 넣음)
  // 저장해 둔 대화를 다시 열어 이어 시키면 그 대화에서 만든 파일부터 안다
  const outputs: string[] = [...new Set(deps.outputs ?? [])];
  return {
    systemPrompt: system,
    tools,
    buildContext() {
      made = 0;
      const files = deps.files();
      const attached = files.length ? `사용자가 붙인 파일·폴더:\n${files.map((f) => `- ${f}`).join("\n")}` : "사용자가 붙인 파일이 없습니다. 필요하면 파일을 붙여 달라고 하세요.";
      return outputs.length ? `${attached}\n\n이 대화에서 만든 파일 (도구에는 이 전체 경로를 그대로 넣으세요):\n${outputs.map((f) => `- ${f}`).join("\n")}` : attached;
    },
    verifyResponse(text: string, executed: ExecutedToolCall[]) {
      if (made > 0 || !executed.every((e) => e.ok)) return null;
      return CLAIMS.test(text) ? "파일을 만드는 도구를 실제로 부르지 않았습니다. 말한 일을 도구로 하거나, 하지 못했다면 하지 못했다고 답하세요." : null;
    },
    async executeTool(call, signal): Promise<ToolExecution> {
      // 멈추면 엔진 안에서 돌던 작업도 함께 멈춘다
      const r = await rpc("agent_tool_run", { name: call.name, input: call.input ?? {} }, { signal });
      if (r.files?.length) {
        made += r.files.length;
        for (const f of r.files) if (!outputs.includes(f)) outputs.push(f);
        deps.onFiles(r.files);
      }
      if (r.saved_min) deps.onSaved?.(r.saved_min);
      // 경로를 잘못 옮겨 적어 못 찾으면 쓸 수 있는 전체 경로를 알려 다시 고르게 한다 (추측해 바꿔 넣지는 않는다)
      // 실측: Gemma 4 E4B 가 방금 만든 문서를 점검하며 경로 대신 "[New…" 를 넣음
      const known = [...new Set([...deps.files(), ...outputs])];
      const output = r.isError && /찾을 수 없습니다/.test(r.output) && known.length
        ? `${r.output}\n쓸 수 있는 파일 (이 전체 경로를 그대로 넣으세요):\n${known.map((f) => `- ${f}`).join("\n")}`
        : r.output;
      return { output, summary: r.summary, ...(r.isError ? { isError: true } : {}), ...(r.files?.length ? { mutated: true } : {}) };
    },
  };
}
