/** 편집기 AI 루프의 모양 (loop.ts·tools.ts 공용) */

export interface AgentToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface AgentToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/** 도구 하나를 실행한 결과 — output 은 모델이 읽고, summary 는 활동 줄에 보인다 */
export interface ToolExecution {
  output: string;
  summary: string;
  isError?: boolean;
  /** 문서를 바꿨다 */
  mutated?: boolean;
}

export interface ExecutedToolCall {
  name: string;
  ok: boolean;
}

export interface AgentSkill {
  systemPrompt: string;
  tools: AgentToolDef[];
  executeTool(call: AgentToolCall, signal?: AbortSignal): Promise<ToolExecution>;
  buildContext?(): string;
  /** 도구 없이 끝낸 답이 하지 않은 편집을 했다고 말하면, 모델에게 다시 보낼 한 줄 */
  verifyResponse?(text: string, executed: ExecutedToolCall[]): string | null;
}
