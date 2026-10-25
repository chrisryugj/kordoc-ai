/** 편집기 AI 한 차례 (core/ai/agent-step.ts) — 지시문에 도구 목록·답 형식, 답 JSON {say, calls} 에서 글과 호출 (가짜 OpenAI 호환 서버) */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startFakeOpenAi, lastUser, systemOf, type ChatBody, type FakeServer } from './ai-fake-server.js';

vi.mock('../src/infra/progress.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/infra/progress.js')>()),
  sendProgress: () => {},
  sendToken: () => {},
}));

import { updateSettings } from '../src/infra/config.js';
import { agentStep } from '../src/core/ai/agent-step.js';

process.env.KORDOC_AI_DATA_DIR = mkdtempSync(join(tmpdir(), 'kordoc-ai-agent-'));
const signal = () => new AbortController().signal;
let fake: FakeServer;
let reply: (b: ChatBody, n: number) => string = () => '';

beforeAll(async () => {
  fake = await startFakeOpenAi({ reply: (b, n) => reply(b, n) });
  await updateSettings({ ai: { provider: 'openai', openai: { base_url: `${fake.url}/v1`, model: 'test-model' } }, privacy: { offline: false } });
});
afterAll(async () => { await fake.close(); });

const tools = [
  { name: 'replace_text', description: '글 바꾸기', inputSchema: { type: 'object', properties: { find: { type: 'string' }, replace: { type: 'string' }, all: { type: 'boolean' } }, required: ['find', 'replace'] } },
  { name: 'read_document', description: '문서 읽기', inputSchema: { type: 'object', properties: { from: { type: 'integer' } } } },
];

describe('agentStep', () => {
  it('지시문에 도구 목록·답 형식, 사용자 차례에 문서 문맥, 답에서 글과 호출', async () => {
    let body: ChatBody | undefined;
    reply = (b) => { body = b; return JSON.stringify({ say: '고치겠습니다', calls: [{ tool: 'replace_text', args: { find: '가', replace: '나' } }] }); };
    const r = await agentStep({ system: '편집기 지시', tools, events: [{ role: 'user', text: '가를 나로', context: '문서: 가' }] }, signal());
    expect(r.text).toBe('고치겠습니다');
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0]).toMatchObject({ name: 'replace_text', input: { find: '가', replace: '나' } });
    expect(r.calls[0].inputError).toBeUndefined();
    const sys = systemOf(body!);
    expect(sys).toContain('편집기 지시');
    expect(sys).toContain('- replace_text: 글 바꾸기');
    expect(sys).toContain('"calls"');
    expect(lastUser(body!)).toContain('문서: 가');
    expect(lastUser(body!)).toContain('요청: 가를 나로');
  });

  it('앞 차례의 호출과 도구 결과를 대화에 싣는다', async () => {
    let user = '';
    reply = (b) => { user = lastUser(b); return JSON.stringify({ say: '끝', calls: [] }); };
    const r = await agentStep({
      system: '',
      tools,
      events: [
        { role: 'user', text: '읽어 줘' },
        { role: 'assistant', text: '', calls: [{ id: 'c1', name: 'read_document', input: {} }] },
        { role: 'tool', results: [{ id: 'c1', name: 'read_document', output: '본문', isError: false }] },
      ],
    }, signal());
    expect(user).toContain('도구 결과:');
    expect(user).toContain('### read_document');
    expect(user).toContain('본문');
    expect(r).toMatchObject({ text: '끝', calls: [] });
  });

  it('모르는 도구·빠진 인자·형이 틀린 인자는 호출 대신 오류로 돌려 모델이 고치게 한다', async () => {
    reply = () => JSON.stringify({ say: '', calls: [{ tool: 'format_disk', args: {} }, { tool: 'replace_text', args: { find: '가' } }, { tool: 'read_document', args: { from: 'x' } }] });
    const r = await agentStep({ system: '', tools, events: [{ role: 'user', text: '해 줘' }] }, signal());
    expect(r.calls.map((c) => c.inputError ?? '')).toEqual([
      expect.stringContaining('없습니다'), expect.stringContaining('replace'), expect.stringContaining('integer'),
    ]);
  });

  it('JSON 이 아닌 답은 도구 없이 글로 끝낸다', async () => {
    reply = () => '그건 할 수 없습니다.';
    const r = await agentStep({ system: '', tools, events: [{ role: 'user', text: '해 줘' }] }, signal());
    expect(r).toMatchObject({ text: '그건 할 수 없습니다.', calls: [] });
  });
});
