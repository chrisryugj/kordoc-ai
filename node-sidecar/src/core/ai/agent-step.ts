/** 편집기 AI 의 한 차례 — 대화와 앱 도구 목록을 받아, 모델이 글과 도구 호출을 JSON 한 덩이로 답하게 한다
 *
 * 공급자(내장·기관 서버·인터넷 AI)마다 도구 호출 방식이 달라, 도구는 지시문의 목록으로 주고 답은 정해진 모양의
 * JSON 으로 받는다(구조화 응답). 도구 실행은 화면 쪽 루프가 편집기에서 한다(src/lib/hwp-agent/loop.ts).
 * 도구 결과 차례마다 "이미 실행했다"를 붙인다 — 매 차례 대화 전체를 새로 읽는 작은 모델이 첫 요청에 다시 답해
 * 같은 호출을 되풀이하던 것(같은 문단 네 번 넣기). 방식과 문구는 이음오피스 ai-provider/claude-code-cli.ts(Apache-2.0)에서.
 */

import { ask, parseJsonLoose, type JsonSchema } from '../../infra/llm/index.js';

export interface AgentToolDef { name: string; description: string; inputSchema: Record<string, unknown> }
export interface AgentCall { id: string; name: string; input: Record<string, unknown>; inputError?: string }
export type AgentEvent =
  | { role: 'user'; text: string; context?: string }
  | { role: 'assistant'; text: string; calls: Array<{ id: string; name: string; input: Record<string, unknown> }> }
  | { role: 'tool'; results: Array<{ id: string; name: string; output: string; isError?: boolean }> };

const STRUCTURED = [
  '당신은 사무용 앱에 들어 있는 언어 모델입니다. 스스로 쓰는 도구는 없습니다: 파일을 읽거나 고치거나, 명령을 실행하거나, 웹을 볼 수 없고 시도하지 않습니다.',
  '앱이 대화, 앱 도구 목록(<app_tools>), 답의 JSON 모양을 줍니다. 그 모양에 맞는 JSON 객체 하나로만 답합니다: 앞뒤 설명·코드블록 없이.',
  '"text" 에 사용자에게 보일 글을 먼저 쓰고, 앱 도구를 부르려면 "toolCalls" 에 넣습니다. 각 "inputJson" 은 그 도구의 inputSchema 에 맞는 객체를 JSON 문자열로 쓴 것입니다. 목록에 있는 이름만 씁니다. 도구가 필요 없으면 빈 배열입니다.',
  '앱이 요청한 도구를 실행하고 다음 차례에 결과를 알려 줍니다.',
].join(' ');

const AFTER_TOOL_RESULTS = '앞 차례에 요청한 도구 호출의 결과입니다. 앱이 그 호출을 이미 한 번씩 실행했으니 다시 요청하지 마세요. 결과에 이어 아직 필요한 호출만 요청하거나, 빈 "toolCalls" 로 마치세요.';

function outputSchema(tools: AgentToolDef[]): JsonSchema {
  return {
    type: 'object',
    properties: {
      text: { type: 'string' },
      toolCalls: {
        type: 'array',
        items: {
          type: 'object',
          properties: { name: { type: 'string', ...(tools.length ? { enum: tools.map((t) => t.name) } : {}) }, inputJson: { type: 'string' } },
          required: ['name', 'inputJson'],
          additionalProperties: false,
        },
      },
    },
    required: ['text', 'toolCalls'],
    additionalProperties: false,
  } as JsonSchema;
}

/** 대화를 한 사용자 메시지로 — 도구 목록, 그다음 차례마다 JSON 한 줄 */
function conversation(tools: AgentToolDef[], events: AgentEvent[]): string {
  const lines = [
    '<app_tools>',
    JSON.stringify(tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }))),
    '</app_tools>',
    '<conversation>',
  ];
  for (const e of events) {
    if (e.role === 'user') lines.push(JSON.stringify({ role: 'user', text: e.text, ...(e.context ? { context: e.context } : {}) }));
    else if (e.role === 'assistant') lines.push(JSON.stringify({ role: 'assistant', text: e.text, toolCalls: e.calls.map((c) => ({ id: c.id, name: c.name, input: c.input })) }));
    else lines.push(JSON.stringify({ role: 'tool_results', note: AFTER_TOOL_RESULTS, results: e.results }));
  }
  lines.push('</conversation>');
  return lines.join('\n');
}

let seq = 0;

export async function agentStep(p: { system: string; tools: AgentToolDef[]; events: AgentEvent[] }, signal: AbortSignal): Promise<{ text: string; calls: AgentCall[]; redacted: number }> {
  if (!p.events.length) throw new Error('보낼 요청이 없습니다.');
  const r = await ask({
    system: `${p.system}\n\n${STRUCTURED}`,
    messages: [{ role: 'user', content: conversation(p.tools, p.events) }],
    schema: outputSchema(p.tools),
    maxTokens: 4096,
    signal,
    stream: false,
  });
  let parsed: { text?: unknown; toolCalls?: unknown };
  try {
    parsed = parseJsonLoose(r.text);
  } catch {
    // 모양을 안 지킨 답은 글로 보인다 (도구 호출 없이 끝난다)
    return { text: r.text.trim(), calls: [], redacted: r.redacted };
  }
  const names = new Set(p.tools.map((t) => t.name));
  const calls: AgentCall[] = [];
  for (const c of Array.isArray(parsed.toolCalls) ? parsed.toolCalls : []) {
    const name = typeof c?.name === 'string' ? c.name : '';
    const id = `call-${Date.now()}-${seq++}`;
    if (!names.has(name)) { calls.push({ id, name: name || '(이름 없음)', input: {}, inputError: `없는 도구입니다: ${name}` }); continue; }
    try {
      const input = typeof c.inputJson === 'string' ? JSON.parse(c.inputJson || '{}') : c.input ?? {};
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('객체가 아닙니다');
      calls.push({ id, name, input });
    } catch (e) {
      calls.push({ id, name, input: {}, inputError: `inputJson 을 읽지 못했습니다: ${(e as Error).message}` });
    }
  }
  return { text: typeof parsed.text === 'string' ? parsed.text : '', calls, redacted: r.redacted };
}
