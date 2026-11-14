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
