/** 편집기 AI 루프의 모양 — 이음오피스 packages/agent-core(Apache-2.0)의 같은 이름 타입 중 이 앱이 쓰는 것만 */

export interface AgentToolDef {
  name: string;
  description: string;
  /** 입력 JSON Schema (object) */
  inputSchema: Record<string, unknown>;
}

export interface AgentToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolExecution {
  /** 모델에게 돌려줄 결과 글 */
  output: string;
  isError?: boolean;
  /** 문서를 바꿨다 */
  mutated?: boolean;
  /** 화면 활동 줄에 보일 짧은 글 */
  summary: string;
}

export interface ExecutedToolCall {
  name: string;
  ok: boolean;
}

export interface AgentSkill {
  id: string;
  systemPrompt: string;
  tools: AgentToolDef[];
  /** 사용자 요청마다 붙일 문서 상황 (없으면 '') */
  buildContext?(): string;
  executeTool(call: AgentToolCall, signal?: AbortSignal): ToolExecution | Promise<ToolExecution>;
  /** 마지막 답이 하지 않은 일을 했다고 말하면 한 번 더 시킬 지시 (없으면 null) */
  verifyResponse?(finalText: string, executed: readonly ExecutedToolCall[]): string | null;
}
