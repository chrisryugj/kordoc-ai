/**
 * 편집기 AI 루프 — 사용자 요청 하나를 끝까지: 모델 한 차례(ai_agent_step) → 요청한 도구를 편집기에서 실행 → 결과를 돌려
 * 다음 차례 … 도구 호출 없이 답하면 끝. 마지막 답이 하지 않은 편집을 했다고 말하면 한 번만 되묻는다(skill.verifyResponse).
 * 대화(events)는 부른 쪽이 쥐고 다음 요청에 이어 쓴다.
 */

import { rpc } from "../rpc";
import type { RpcParams } from "../contract";
import type { AgentSkill, ExecutedToolCall } from "./types";

export type AgentEvent = RpcParams<"ai_agent_step">["events"][number];

/** 요청 하나에서 모델 차례 상한 — 고장 난 모델이 도구를 끝없이 부르지 않게 */
export const MAX_STEPS = 24;
/** 이어 보내는 대화의 글자 상한 — 로컬 모델은 맥락이 짧아(4K~8K 토큰) 넘치면 지시문이 잘려 답 형식이 깨진다 */
export const HISTORY_CHARS = 24_000;

/** 지난 요청의 문서 맥락은 빼고(그새 문서가 바뀌었다), 그래도 길면 가장 오래된 요청부터 통째로 덜어낸다 */
export function trimHistory(events: AgentEvent[], limit = HISTORY_CHARS): void {
  for (const e of events) if (e.role === "user" && "context" in e) delete (e as { context?: string }).context;
  const size = () => events.reduce((n, e) => n + JSON.stringify(e).length, 0);
  while (size() > limit) {
    const next = events.findIndex((e, i) => i > 0 && e.role === "user");
    if (next < 0) break;
    events.splice(0, next);
  }
}

export interface RunHooks {
  /** 모델이 쓴 글 (차례마다 마지막 글로 바뀐다) */
  onText(text: string): void;
  /** 도구 하나를 실행했다 (활동 줄) */
  onTool(t: { name: string; summary: string; isError: boolean }): void;
}

export async function runAgent(opts: {
  skill: AgentSkill;
  events: AgentEvent[];
  request: string;
  signal: AbortSignal;
  hooks: RunHooks;
}): Promise<{ text: string; redacted: number }> {
  const { skill, events, signal, hooks } = opts;
  const context = skill.buildContext?.() ?? "";
  trimHistory(events);
  events.push({ role: "user", text: opts.request, ...(context ? { context } : {}) });
  const executed: ExecutedToolCall[] = [];
  let corrected = false;
  let text = "";
  let redacted = 0;
  for (let step = 0; step < MAX_STEPS; step++) {
    if (signal.aborted) throw new DOMException("멈췄습니다", "AbortError");
    const turn = await rpc("ai_agent_step", { system: skill.systemPrompt, tools: skill.tools, events }, { signal });
    redacted += turn.redacted;
    if (turn.text) { text = turn.text; hooks.onText(text); }
    events.push({ role: "assistant", text: turn.text, calls: turn.calls.map(({ id, name, input }) => ({ id, name, input })) });
    if (!turn.calls.length) {
      const fix = corrected ? null : skill.verifyResponse?.(text, executed) ?? null;
      if (!fix) return { text, redacted };
      corrected = true;
      events.push({ role: "user", text: fix });
      continue;
    }
    const results: Array<{ id: string; name: string; output: string; isError?: boolean }> = [];
    for (const call of turn.calls) {
      if (signal.aborted) throw new DOMException("멈췄습니다", "AbortError");
      if (call.inputError) {
        results.push({ id: call.id, name: call.name, output: call.inputError, isError: true });
        hooks.onTool({ name: call.name, summary: call.inputError, isError: true });
        continue;
      }
      let out;
      try {
        out = await skill.executeTool({ id: call.id, name: call.name, input: call.input }, signal);
      } catch (e) {
        out = { output: e instanceof Error ? e.message : String(e), isError: true, summary: `${call.name} 실패` };
      }
      executed.push({ name: call.name, ok: !out.isError });
      results.push({ id: call.id, name: call.name, output: out.output, ...(out.isError ? { isError: true } : {}) });
      hooks.onTool({ name: call.name, summary: out.summary, isError: !!out.isError });
    }
    events.push({ role: "tool", results });
  }
  return { text: text || "도구를 너무 여러 번 불러 멈췄습니다. 요청을 나눠 다시 시도하세요.", redacted };
}
