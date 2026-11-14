/** 편집기 AI 의 가린 값 되돌리기 — 글로 한 답도 되돌리고, 개인정보를 가리라는 차례엔 모델이 ● 로 쓴 도구 인자를 그대로 둔다 */

import { describe, it, expect, vi } from 'vitest';

const masked = '010-●●●●-5678';
const original = '010-1234-5678';
let answer = '';

vi.mock('../src/infra/llm/index.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/infra/llm/index.js')>()),
  contextCharBudget: async () => 100_000,
  ask: async () => ({ text: answer, redacted: 1, restore: (a: string) => a.split(masked).join(original) }),
}));

const { agentStep } = await import('../src/core/ai/agent-step.js');
const { maskTable, restoreWith } = await import('../src/infra/llm/index.js');

const tools = [{ name: 'rewrite_paragraph', description: '문단 고쳐 쓰기', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } }];
const step = (text: string) => agentStep({ system: '', tools, events: [{ role: 'user', text }] }, new AbortController().signal);
type Events = Parameters<typeof agentStep>[0]['events'];
const str = { type: 'string' };
const more = [
  ...tools,
  { name: 'replace_text', description: '바꾸기', inputSchema: { type: 'object', properties: { find: str, replace: str }, required: ['find', 'replace'] } },
  { name: 'find_text', description: '찾기', inputSchema: { type: 'object', properties: { text: str }, required: ['text'] } },
  { name: 'redact_personal_info', description: '가리기', inputSchema: { type: 'object', properties: { path: str, keep: { type: 'array' } }, required: ['path'] } },
  { name: 'fill_cells', description: '칸 채우기', inputSchema: { type: 'object', properties: { table: str, cells: { type: 'array' } }, required: ['table', 'cells'] } },
];
const run = (events: Events) => agentStep({ system: '', tools: more, events }, new AbortController().signal);
const said = (text: string): Events[number] => ({ role: 'assistant', text, calls: [] });

describe('편집기 AI 가린 값', () => {
  it('JSON 이 아닌 그냥 한 말도 되돌린다', async () => {
    answer = `담당자 연락처는 ${masked} 입니다.`;
    expect((await step('연락처 알려 줘')).text).toBe(`담당자 연락처는 ${original} 입니다.`);
  });

  it('보통 차례는 도구 인자를 되돌리고, 개인정보를 가리라는 차례는 모델이 쓴 ● 를 그대로 둔다', async () => {
    answer = JSON.stringify({ say: '고쳤습니다', calls: [{ tool: 'rewrite_paragraph', args: { text: `문의 ${masked}` } }] });
    expect((await step('문장을 다듬어 줘')).calls[0].input).toEqual({ text: `문의 ${original}` });
    expect((await step('전화번호는 가려 줘')).calls[0].input).toEqual({ text: `문의 ${masked}` });
    // "가리키는" 처럼 가리기가 아닌 말이나 개인정보와 상관없는 말은 종전대로 되돌린다
    expect((await step('이 표가 가리키는 내용을 정리해 줘')).calls[0].input).toEqual({ text: `문의 ${original}` });
  });

  it('가리라는 요청 뒤에 루프가 넣은 되묻는 글·이어 시키는 말이 와도 가리는 차례다 (마지막 사용자 글만 보면 원래 번호로 되돌아갔다)', async () => {
    answer = JSON.stringify({ say: '가렸습니다', calls: [{ tool: 'rewrite_paragraph', args: { text: `문의 ${masked}` } }] });
    const first: Events = [{ role: 'user', text: '전화번호는 가려 줘' }, said('●로 바꿨습니다')];
    // 루프가 넣은 글(auto)은 요청이 아니다
    expect((await run([...first, { role: 'user', text: '문서를 바꾸는 도구를 실제로 부르지 않았습니다. 도구를 불러 고치세요.', auto: true }])).calls[0].input).toEqual({ text: `문의 ${masked}` });
    // 앞 요청을 이어받는 말
    expect((await run([...first, { role: 'user', text: '아래 표도 똑같이 해 줘' }])).calls[0].input).toEqual({ text: `문의 ${masked}` });
    expect((await run([...first, { role: 'user', text: '2쪽도 해 줘' }, said('했습니다'), { role: 'user', text: '부록도 마찬가지로' }])).calls[0].input).toEqual({ text: `문의 ${masked}` });
    // 새 요청이면 종전대로 되돌린다 (가린 꼴이 문서에 들어가지 않게)
    expect((await run([...first, { role: 'user', text: '담당자 연락처를 맨 아래 문단에 적어 줘' }])).calls[0].input).toEqual({ text: `문의 ${original}` });
    // 이어받는 말이어도 앞 요청이 가리기가 아니면 되돌린다
    expect((await run([{ role: 'user', text: '문장을 다듬어 줘' }, said('다듬었습니다'), { role: 'user', text: '아래 표도 똑같이 해 줘' }])).calls[0].input).toEqual({ text: `문의 ${original}` });
  });

  it('가리는 차례에도 찾을 글·남길 글·읽기 도구 인자는 되돌린다 (문서에는 원래 번호가 있어 가린 꼴로는 못 찾는다)', async () => {
    const ask1: Events = [{ role: 'user', text: '담당자 전화는 남기고 나머지 전화번호를 가려 줘' }];
    const call = async (tool: string, args: unknown) => {
      answer = JSON.stringify({ say: '', calls: [{ tool, args }] });
      return (await run(ask1)).calls[0].input;
    };
    expect(await call('replace_text', { find: masked, replace: masked })).toEqual({ find: original, replace: masked });
    expect(await call('find_text', { text: masked })).toEqual({ text: original });
    expect(await call('redact_personal_info', { path: '/tmp/a.hwpx', keep: [masked] })).toEqual({ path: '/tmp/a.hwpx', keep: [original] });
    expect(await call('fill_cells', { table: 't1', cells: [{ row: 0, col: 1, text: masked }] })).toEqual({ table: 't1', cells: [{ row: 0, col: 1, text: masked }] });
  });

  it('고쳐 쓰기: 가려서 써 달라는 지시면 모델이 쓴 ● 를 되돌리지 않는다 (가려 달라던 번호가 그대로 문서에 들어갔다)', async () => {
    const { rewriteText } = await import('../src/core/ai/rewrite.js');
    const go = (instruction: string) => rewriteText({ text: `문의는 ${original} 로 주십시오.`, mode: 'custom', instruction }, new AbortController().signal);
    answer = `문의는 ${masked} 로 주시기 바랍니다.`;
    expect((await go('연락처는 가려서 다시 써 줘')).text).toBe(`문의는 ${masked} 로 주시기 바랍니다.`);
    expect((await go('공손하게 다시 써 줘')).text).toBe(`문의는 ${original} 로 주시기 바랍니다.`);
  });

  it('사용자가 이미 가려 둔 자리 판정은 literal 글에서만 — 앞 답에 실린 가린 꼴은 되돌리기를 끄지 않는다', () => {
    const doc = `문의 ${original}`;
    const shape = maskTable(doc)[0]?.[0];
    expect(shape).toContain('●');
    const firstAnswer = `{"say": "문의 ${shape}"`;
    // 보낸 글 전체(앞 답 포함)를 literal 로 보면 되돌리지 않고, 사용자 글만 보면 되돌린다
    expect(restoreWith(maskTable(`${doc}\n${firstAnswer}`), `문의 ${shape}`)).toBe(`문의 ${shape}`);
    expect(restoreWith(maskTable(`${doc}\n${firstAnswer}`, doc), `문의 ${shape}`)).toBe(doc);
  });
});
