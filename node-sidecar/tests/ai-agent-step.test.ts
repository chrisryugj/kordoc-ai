/** 편집기 AI 한 차례 — 도구 목록·대화를 한 메시지로 보내고, 답의 JSON 에서 글과 도구 호출을 꺼낸다 (가짜 OpenAI 호환 서버) */

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
  { name: 'replace_text', description: '글 바꾸기', inputSchema: { type: 'object', properties: { find: { type: 'string' }, replace: { type: 'string' } } } },
  { name: 'read_document', description: '문서 읽기', inputSchema: { type: 'object', properties: {} } },
];

describe('agentStep', () => {
  it('도구 목록과 대화를 보내고, 글과 도구 호출을 돌려준다', async () => {
    let body: ChatBody | undefined;
    reply = (b) => { body = b; return JSON.stringify({ text: '고치겠습니다', toolCalls: [{ name: 'replace_text', inputJson: '{"find":"가","replace":"나"}' }] }); };
    const r = await agentStep({ system: '편집기 지시', tools, events: [{ role: 'user', text: '가를 나로', context: '문서: 가' }] }, signal());
    expect(r.text).toBe('고치겠습니다');
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0]).toMatchObject({ name: 'replace_text', input: { find: '가', replace: '나' } });
    expect(r.calls[0].inputError).toBeUndefined();
    expect(systemOf(body!)).toContain('편집기 지시');
    const user = lastUser(body!);
    expect(user).toContain('<app_tools>');
    expect(user).toContain('"replace_text"');
    expect(user).toContain('문서: 가');
  });

  it('도구 결과 차례에는 이미 실행했다는 말을 붙인다 — 같은 호출을 되풀이하지 않게', async () => {
    let user = '';
    reply = (b) => { user = lastUser(b); return JSON.stringify({ text: '끝', toolCalls: [] }); };
    await agentStep({
      system: '',
      tools,
      events: [
        { role: 'user', text: '읽어 줘' },
        { role: 'assistant', text: '', calls: [{ id: 'c1', name: 'read_document', input: {} }] },
        { role: 'tool', results: [{ id: 'c1', name: 'read_document', output: '본문' }] },
      ],
    }, signal());
    expect(user).toContain('이미 한 번씩 실행했으니 다시 요청하지 마세요');
  });

  it('모르는 도구·읽을 수 없는 인자는 호출 대신 오류로 돌려 모델이 다시 고치게 한다', async () => {
    reply = () => JSON.stringify({ text: '', toolCalls: [{ name: 'format_disk', inputJson: '{}' }, { name: 'replace_text', inputJson: '{find:' }] });
    const r = await agentStep({ system: '', tools, events: [{ role: 'user', text: '해 줘' }] }, signal());
    expect(r.calls.map((c) => !!c.inputError)).toEqual([true, true]);
  });

  it('JSON 이 아닌 답은 도구 없이 글로 끝낸다', async () => {
    reply = () => '그건 할 수 없습니다.';
    const r = await agentStep({ system: '', tools, events: [{ role: 'user', text: '해 줘' }] }, signal());
    expect(r).toMatchObject({ text: '그건 할 수 없습니다.', calls: [] });
  });
});
