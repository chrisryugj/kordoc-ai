/** 편집기 AI 한 차례 (ai_agent_step) — 대화와 도구 목록을 받아 모델 답에서 할 말과 도구 호출을 꺼낸다.
 *
 * 공급자마다 도구 호출 방식이 달라서(로컬 모델·구독 프로그램은 함수 호출이 없다) 모두 같은 길로 간다:
 * 도구 목록과 답 형식을 지시문에 적고, 모델은 JSON 한 덩이 {"say": "...", "calls": [{"tool": "...", "args": {...}}]} 로 답한다.
 * 도구 실행은 화면 쪽 루프(src/lib/hwp-agent/loop.ts)가 편집기에서 하고, 결과를 다음 차례 대화에 붙인다.
 * 인자가 도구 정의(필수 항목·형)에 안 맞으면 inputError 로 돌려 모델이 고쳐 부르게 한다.
 */

import { ask, parseJsonLoose, type ChatMessage, type JsonSchema } from '../../infra/llm/index.js';

export interface AgentToolDef { name: string; description: string; inputSchema: Record<string, unknown> }
export interface AgentCall { id: string; name: string; input: Record<string, unknown>; inputError?: string }
export type AgentEvent =
  | { role: 'user'; text: string; context?: string }
  | { role: 'assistant'; text: string; calls: Array<{ id: string; name: string; input: Record<string, unknown> }> }
  | { role: 'tool'; results: Array<{ id: string; name: string; output: string; isError?: boolean }> };

/** 도구 결과 한 개를 대화에 실을 때의 글자 상한 (긴 문서 읽기 결과가 맥락을 다 먹지 않게) */
const RESULT_CHARS = 12_000;

const REPLY: JsonSchema = {
  type: 'object',
  properties: {
    say: { type: 'string' },
    calls: { type: 'array', items: { type: 'object', properties: { tool: { type: 'string' }, args: { type: 'object' } }, required: ['tool', 'args'] } },
  },
  required: ['say', 'calls'],
};

/** 지시문: 앱이 준 역할 + 도구 목록 + 답 형식 (고정 글이라 가리지 않는다) */
export function systemText(system: string, tools: AgentToolDef[]): string {
  const catalog = tools.map((t) => `- ${t.name}: ${t.description}\n  인자: ${JSON.stringify(t.inputSchema)}`).join('\n');
  return [
    system,
    '',
    '## 도구',
    catalog,
    '',
    '## 답 형식',
    '반드시 JSON 한 덩이로만 답합니다: {"say": "사용자에게 할 말", "calls": [{"tool": "도구 이름", "args": {...}}]}',
    '- 도구를 부를 땐 calls 에 넣습니다. 여러 개를 차례로 넣을 수 있고, 결과는 다음 차례에 받습니다.',
    '- 일을 마쳤거나 사용자에게 물을 땐 calls 를 빈 배열로 두고 say 에 답을 씁니다.',
  ].join('\n');
}

/** 대화 → 모델 메시지. 도구 결과는 사용자 차례의 글로 싣는다 */
export function toMessages(events: AgentEvent[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const e of events) {
    if (e.role === 'user') {
      out.push({ role: 'user', content: e.context ? `${e.context}\n\n---\n요청: ${e.text}` : e.text });
    } else if (e.role === 'assistant') {
      out.push({ role: 'assistant', content: JSON.stringify({ say: e.text, calls: e.calls.map((c) => ({ tool: c.name, args: c.input })) }) });
    } else {
      const lines = e.results.map((r) => {
        const body = r.output.length > RESULT_CHARS ? `${r.output.slice(0, RESULT_CHARS)}\n(결과가 길어 잘렸습니다)` : r.output;
        return `### ${r.name}${r.isError ? ' (실패)' : ''}\n${body}`;
      });
      out.push({ role: 'user', content: `도구 결과:\n${lines.join('\n\n')}` });
    }
  }
  return out;
}

/** 인자 확인: 객체인지, 필수 항목이 있는지, 기본 형이 맞는지 */
export function checkArgs(tool: AgentToolDef, args: unknown): string | undefined {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return `${tool.name} 의 args 는 객체여야 합니다.`;
  const schema = tool.inputSchema as { required?: string[]; properties?: Record<string, { type?: string }> };
  const a = args as Record<string, unknown>;
  const missing = (schema.required ?? []).filter((k) => a[k] === undefined || a[k] === null);
  if (missing.length) return `${tool.name} 에 꼭 필요한 인자가 빠졌습니다: ${missing.join(', ')}`;
  for (const [k, v] of Object.entries(a)) {
    const want = schema.properties?.[k]?.type;
    if (!want || v === undefined) continue;
    const ok = want === 'array' ? Array.isArray(v) : want === 'integer' ? Number.isInteger(v) : want === 'object' ? typeof v === 'object' && !Array.isArray(v) : typeof v === want;
    if (!ok) return `${tool.name} 의 ${k} 는 ${want} 여야 합니다.`;
  }
  return undefined;
}

export async function agentStep(p: { system: string; tools: AgentToolDef[]; events: AgentEvent[] }, signal: AbortSignal): Promise<{ text: string; calls: AgentCall[]; redacted: number }> {
  const r = await ask({ system: systemText(p.system, p.tools), messages: toMessages(p.events), schema: REPLY, signal, stream: false });
  let reply: { say?: unknown; calls?: unknown };
  try {
    reply = parseJsonLoose(r.text);
  } catch {
    // JSON 이 아니면 한 말로 본다 (도구 없이 끝)
    return { text: r.text.trim(), calls: [], redacted: r.redacted };
  }
  const byName = new Map(p.tools.map((t) => [t.name, t]));
  const calls: AgentCall[] = (Array.isArray(reply.calls) ? reply.calls : []).map((c, i) => {
    const call = (c ?? {}) as { tool?: unknown; args?: unknown };
    const name = String(call.tool ?? '');
    const id = `c${Date.now().toString(36)}${i}`;
    const tool = byName.get(name);
    if (!tool) return { id, name, input: {}, inputError: `"${name}" 라는 도구는 없습니다. 도구 목록의 이름을 쓰세요.` };
    const inputError = checkArgs(tool, call.args);
    return { id, name, input: inputError ? {} : (call.args as Record<string, unknown>), ...(inputError ? { inputError } : {}) };
  });
  return { text: typeof reply.say === 'string' ? reply.say : '', calls, redacted: r.redacted };
}
