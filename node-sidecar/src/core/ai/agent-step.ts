/** 편집기 AI 한 차례 (ai_agent_step) — 대화와 도구 목록을 받아 모델 답에서 할 말과 도구 호출을 꺼낸다.
 *
 * 공급자마다 도구 호출 방식이 달라서(로컬 모델·구독 프로그램은 함수 호출이 없다) 모두 같은 길로 간다:
 * 도구 목록과 답 형식을 지시문에 적고, 모델은 JSON 한 덩이 {"say": "...", "calls": [{"tool": "...", "args": {...}}]} 로 답한다.
 * 도구 실행은 화면 쪽 루프(src/lib/hwp-agent/loop.ts)가 편집기에서 하고, 결과를 다음 차례 대화에 붙인다.
 * 인자가 도구 정의(필수 항목·형)에 안 맞으면 inputError 로 돌려 모델이 고쳐 부르게 한다.
 */

import { ask, contextCharBudget, parseJsonLoose, type ChatMessage, type JsonSchema } from '../../infra/llm/index.js';

export interface AgentToolDef { name: string; description: string; inputSchema: Record<string, unknown> }
export interface AgentCall { id: string; name: string; input: Record<string, unknown>; inputError?: string }
export type AgentEvent =
  | { role: 'user'; text: string; context?: string }
  | { role: 'assistant'; text: string; calls: Array<{ id: string; name: string; input: Record<string, unknown> }> }
  | { role: 'tool'; results: Array<{ id: string; name: string; output: string; isError?: boolean }> };

/** 도구 결과 한 개를 대화에 실을 때의 글자 상한 (긴 문서 읽기 결과가 맥락을 다 먹지 않게) */
const RESULT_CHARS = 12_000;

/** args 는 도구마다 모양이 달라 자유 객체로 둔다(additionalProperties: true). 이것이 없으면 내장 AI 의 문법(node-llama-cpp)이
 *  "properties 없는 객체 = 빈 객체 {} 만"으로 만들어, 인자가 필요한 도구를 하나도 부를 수 없다. 인자 검사는 checkArgs 가 한다 */
export const REPLY: JsonSchema = {
  type: 'object',
  properties: {
    say: { type: 'string' },
    calls: { type: 'array', items: { type: 'object', properties: { tool: { type: 'string' }, args: { type: 'object', additionalProperties: true } }, required: ['tool', 'args'] } },
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

/** 대화를 모델 맥락(글자 수 budget)에 맞춘다. 로컬 모델은 맥락이 짧아(8K 토큰이면 만 자 안팎) 문서를 두어 번 읽으면 넘치는데,
 *  넘치면 서버가 앞부분(지시문·도구 목록)을 조용히 잘라 답 형식이 깨진다. 도구 결과 한 건의 상한을 맥락에 맞춰 줄이고,
 *  그래도 넘치면 오래된 도구 결과부터 내용을 걷어 낸다 (가장 최근 결과는 모델이 지금 보고 답해야 하니 둔다) */
export function fitMessages(events: AgentEvent[], budget: number): ChatMessage[] {
  const msgs = toMessages(events, Math.max(1_000, Math.min(RESULT_CHARS, Math.floor(budget / 3))));
  const size = () => msgs.reduce((n, m) => n + m.content.length, 0);
  const tools = events.flatMap((e, i) => (e.role === 'tool' ? [i] : []));
  for (const i of tools.slice(0, -1)) {
    if (size() <= budget) break;
    msgs[i] = { role: 'user', content: '도구 결과: (앞서 받은 결과는 길어서 뺐습니다. 다시 필요하면 도구를 다시 부르세요)' };
  }
  return msgs;
}

/** 대화 → 모델 메시지 (대화 한 건이 메시지 하나). 도구 결과는 사용자 차례의 글로 싣는다 */
export function toMessages(events: AgentEvent[], resultChars = RESULT_CHARS): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const e of events) {
    if (e.role === 'user') {
      out.push({ role: 'user', content: e.context ? `${e.context}\n\n---\n요청: ${e.text}` : e.text });
    } else if (e.role === 'assistant') {
      out.push({ role: 'assistant', content: JSON.stringify({ say: e.text, calls: e.calls.map((c) => ({ tool: c.name, args: c.input })) }) });
    } else {
      const lines = e.results.map((r) => {
        const body = r.output.length > resultChars ? `${r.output.slice(0, resultChars)}\n(결과가 길어 잘렸습니다)` : r.output;
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
    // 선택 인자의 null 은 '안 줌' (작은 모델이 빈 칸을 null 로 채운다. 필수 인자의 null 은 위에서 거른다)
    if (!want || v === undefined || v === null) continue;
    const ok = want === 'array' ? Array.isArray(v) : want === 'integer' ? Number.isInteger(v) : want === 'object' ? typeof v === 'object' && !Array.isArray(v) : typeof v === want;
    if (!ok) return `${tool.name} 의 ${k} 는 ${want} 여야 합니다.`;
  }
  return undefined;
}

/** 답 형식(JSON)을 쓰려던 글인가 — 그냥 한 말과 가른다 */
const looksLikeJson = (text: string) => /^\s*(```(?:json)?\s*)?\{/.test(text) && /"(say|calls)"/.test(text);

export async function agentStep(p: { system: string; tools: AgentToolDef[]; events: AgentEvent[] }, signal: AbortSignal): Promise<{ text: string; calls: AgentCall[]; redacted: number }> {
  const system = systemText(p.system, p.tools);
  // 맥락 크기를 못 알아내면(공급자 설정 오류 등) 줄이지 않고 보낸다: 오류는 ask 가 제대로 알린다
  const room = await contextCharBudget({ signal }).catch(() => Infinity);
  const messages = fitMessages(p.events, Math.max(2_000, room - system.length));
  let r = await ask({ system, messages, schema: REPLY, signal, stream: false });
  let reply: { say?: unknown; calls?: unknown };
  try {
    reply = parseJsonLoose(r.text);
  } catch {
    // JSON 을 쓰려다 깨진 답(잘림·따옴표 빠짐)은 한 번만 다시 받는다: 그대로 "한 말"로 내면 깨진 JSON 이 화면에 뜨고 편집은 안 된 채 끝난다
    if (!looksLikeJson(r.text)) return { text: r.text.trim(), calls: [], redacted: r.redacted };
    const first = r.redacted;
    r = await ask({
      system,
      messages: [...messages, { role: 'assistant', content: r.text.slice(0, 2_000) }, { role: 'user', content: '방금 답은 JSON 형식이 깨져 읽지 못했습니다. 같은 내용을 {"say": "...", "calls": [...]} JSON 한 덩이로만 다시 답하세요.' }],
      schema: REPLY, signal, stream: false,
    });
    r = { ...r, redacted: r.redacted + first };
    try {
      reply = parseJsonLoose(r.text);
    } catch {
      if (looksLikeJson(r.text)) throw new Error('AI 답의 형식이 깨져 읽지 못했습니다. 다시 시도하거나 설정 › AI 연결에서 다른 모델을 고르세요.');
      // JSON 이 아니면 한 말로 본다 (도구 없이 끝)
      return { text: r.text.trim(), calls: [], redacted: r.redacted };
    }
  }
  // 외부 AI 로 보내며 가린 값이 도구 인자에 실려 오면 되돌린다 — 편집기 AI 의 고쳐 쓰기·칸 채우기가 문서의 연락처를 ● 로 바꿨다
  const unmask = (v: unknown): unknown => typeof v === 'string' ? r.restore(v)
    : Array.isArray(v) ? v.map(unmask) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, unmask(x)])) : v;
  const byName = new Map(p.tools.map((t) => [t.name, t]));
  const calls: AgentCall[] = (Array.isArray(reply.calls) ? reply.calls : []).map((c, i) => {
    const call = (c ?? {}) as { tool?: unknown; args?: unknown };
    const name = String(call.tool ?? '');
    const id = `c${Date.now().toString(36)}${i}`;
    const tool = byName.get(name);
    if (!tool) return { id, name, input: {}, inputError: `"${name}" 라는 도구는 없습니다. 도구 목록의 이름을 쓰세요.` };
    const inputError = checkArgs(tool, call.args);
    return { id, name, input: inputError ? {} : (unmask(call.args) as Record<string, unknown>), ...(inputError ? { inputError } : {}) };
  });
  return { text: typeof reply.say === 'string' ? r.restore(reply.say) : '', calls, redacted: r.redacted };
}
