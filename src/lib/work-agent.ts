/**
 * 작업 에이전트 스킬 — 'AI에게 일 시키기'. 도구 목록·지시문은 엔진(core/agent-tools, RPC agent_tools)이 정본이고
 * MCP 로 바깥 AI 에이전트에 내는 목록과 같다. 도구 실행은 엔진(agent_tool_run), 모델 루프는 hwp-agent/loop.ts 를 그대로 쓴다.
 */

import { rpc } from "./rpc";
import { formatOf } from "./format";
import type { AgentSkill, ExecutedToolCall, ToolExecution } from "./hwp-agent/types";

/** 만들었다고 말하는 말투 (파일을 만든 도구 없이 이렇게 답하면 한 번 되묻는다) */
const CLAIMS = /(만들었|저장했|바꿨|바꾸었|채웠|가렸|합쳤|고쳤)습니다/;
const TEXT_DOCUMENTS = new Set(["hwp", "hwpx", "hwpml", "pdf", "docx", "md", "txt"]);
const ONE_PAGE = /(?:한|1)\s*(?:쪽|장|페이지)/;
const REVISE = /보강|보완|늘려|늘리|확장|다듬|재작성|풀어\s*(?:써|쓰)|(?:고쳐|다시)\s*(?:써|쓰)|(?:한|1)\s*(?:쪽|장|페이지)[^\n]{0,16}채워/;
const DOCUMENT_REFERENCE = /첨부|붙인|원문|본문|내용|분량|이거|이\s*(?:문서|파일|글)/;
const SKIP_ATTACHMENT = /(?:첨부|붙인|원문|파일|문서)[^\n]{0,14}(?:보지\s*말|읽지\s*말|무시|제외)/;
const CHAT_ONLY = /(?:채팅|답변|여기)(?:창)?(?:으로|로|에)?\s*만|(?:파일|문서)[^\n]{0,10}(?:만들지|저장하지)\s*말/;

export async function createWorkSkill(deps: {
  files: () => string[]; onFiles: (files: string[]) => void; onSaved?: (minutes: number) => void; outputs?: string[];
  /** 사용자가 이 대화에서 한 요청들 — 요청에 경로나 파일 이름을 적은 파일은 붙이지 않아도 연다 */
  said?: () => string[];
}): Promise<AgentSkill> {
  const { system, tools } = await rpc("agent_tools", {});
  let made = 0;
  let needsRevisedFile = false;
  let revisedFile = false;
  // 도구가 찾아 준 파일 (같은 문서의 다른 판): 이어서 비교·읽기를 할 수 있게
  const seen: string[] = [];
  // 이 대화에서 만든 파일: "이어서" 요청은 파일 이름만 말하므로 전체 경로를 맥락에 실어야 모델이 경로를 지어내지 않는다 (실측: Gemma 4 E4B 가 precheck 에 없는 경로를 넣음)
  // 저장해 둔 대화를 다시 열어 이어 시키면 그 대화에서 만든 파일부터 안다
  const outputs: string[] = [...new Set(deps.outputs ?? [])];
  return {
    systemPrompt: system,
    tools,
    prepareTurn(request: string) {
      made = 0;
      revisedFile = false;
      const files = deps.files();
      const [file] = files;
      // 첨부 문서의 내용을 고쳐 달라는 요청은 경로만 모델에게 맡기지 않고 앱에서 먼저 읽는다.
      // 변환·가리기 같은 파일 작업이나 폴더·여러 문서는 필요한 도구를 모델이 고르도록 둔다.
      const revisesAttachment = files.length === 1 && TEXT_DOCUMENTS.has(formatOf(file)) && REVISE.test(request)
        && (DOCUMENT_REFERENCE.test(request) || ONE_PAGE.test(request)) && !SKIP_ATTACHMENT.test(request)
        && !(outputs.length && /방금\s*(?:만든|저장한|작성한)/.test(request) && !/첨부|붙인/.test(request));
      needsRevisedFile = revisesAttachment && !CHAT_ONLY.test(request);
      const parts = [files.length ? `사용자가 붙인 파일·폴더:\n${files.map((f) => `- ${f}`).join("\n")}` : "사용자가 붙인 파일이 없습니다. 필요하면 파일을 붙여 달라고 하세요."];
      if (outputs.length) parts.push(`이 대화에서 만든 파일 (도구에는 이 전체 경로를 그대로 넣으세요):\n${outputs.map((f) => `- ${f}`).join("\n")}`);
      if (revisesAttachment) {
        parts.push("앱이 read_document로 첨부 본문을 먼저 읽습니다. 그 본문과 사용자 요청으로 작업하세요. 원문의 사실·수치·날짜는 유지하고 새 사실을 지어내지 마세요.");
        if (ONE_PAGE.test(request)) parts.push("한 쪽에 들어갈 분량으로 내용을 풀어 쓰고, 표지나 목차용 페이지를 추가하지 마세요.");
        if (needsRevisedFile) parts.push("고쳐 쓴 전체 내용을 write_document로 새 HWPX에 저장하세요. 저장한 뒤에 결과를 답하세요.");
      }
      return {
        context: parts.join("\n\n"),
        ...(revisesAttachment ? { firstTool: { id: "attachment-read", name: "read_document", input: { path: file } } } : {}),
      };
    },
    verifyResponse(text: string, executed: ExecutedToolCall[]) {
      if (needsRevisedFile && !revisedFile) return {
        retry: "첨부 본문이 read_document 결과에 이미 있습니다. 그 본문을 요청대로 고쳐 쓴 뒤 write_document를 호출해 새 HWPX로 저장하세요.",
        failure: "첨부 문서는 읽었지만 수정본 파일을 만들지 못했습니다. 요청을 다시 보내거나 설정에서 다른 AI 모델을 골라 시도하세요.",
      };
      if (made > 0 || !executed.every((e) => e.ok)) return null;
      return CLAIMS.test(text) ? "파일을 만드는 도구를 실제로 부르지 않았습니다. 말한 일을 도구로 하거나, 하지 못했다면 하지 못했다고 답하세요." : null;
    },
    async executeTool(call, signal): Promise<ToolExecution> {
      // 멈추면 엔진 안에서 돌던 작업도 함께 멈춘다
      // scope: 사용자가 맡긴 것만 열게 한다 (붙인 파일·폴더, 이 대화에서 만든 파일, 요청에 적은 파일).
      // 문서 속 글이 모델에게 다른 파일을 읽으라고 시켜도 엔진이 막는다
      const scope = { files: [...new Set([...deps.files(), ...outputs, ...seen])], said: deps.said?.() ?? [] };
      const r = await rpc("agent_tool_run", { name: call.name, input: call.input ?? {}, scope }, { signal });
      for (const f of r.seen ?? []) if (!seen.includes(f)) seen.push(f);
      if (r.files?.length) {
        made += r.files.length;
        if (call.name === "write_document" && !r.isError && r.files.some((f) => formatOf(f) === "hwpx")) revisedFile = true;
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
