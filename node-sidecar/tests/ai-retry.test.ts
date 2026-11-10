/** 잠깐 붐벼서 온 거절은 다시 보내고(503·분당 한도), 하루 한도·서버 오류는 바로 알린다. 구독 한도가 풀리는 때, 구독 연결 상태 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tempDir } from './tmp-dirs.js';

process.env.KORDOC_AI_DATA_DIR = tempDir('kordoc-ai-retry-');

import { createOpenAiProvider } from '../src/infra/llm/openai.js';
import { retryPolicy } from '../src/infra/llm/types.js';
import { resetWhen } from '../src/infra/llm/subscription/errors.js';
import { checkLogin, forgetLogins } from '../src/infra/llm/subscription/login.js';
import { aiStatus } from '../src/core/ai/status.js';
import { updateSettings } from '../src/infra/config.js';

/** 차례대로 답하는 서버: 숫자는 그 상태 코드로 거절, 글은 그 글로 답 */
let plan: Array<number | string> = [];
let bodyOf: (status: number) => string = () => '{"error":{"message":"busy"}}';
let hits = 0;
let server: Server;
let base = '';

beforeAll(async () => {
  server = createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      if (!req.url?.includes('/chat/completions')) { res.writeHead(404); res.end(); return; }
      const step = plan[Math.min(hits, plan.length - 1)];
      hits++;
      if (typeof step === 'number') { res.writeHead(step, { 'content-type': 'application/json' }); res.end(bodyOf(step)); return; }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: step } }] })}\n\n`);
      res.end('data: [DONE]\n\n');
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const waits = retryPolicy.waits;
afterEach(() => { retryPolicy.waits = waits; bodyOf = () => '{"error":{"message":"busy"}}'; });

const chat = (signal = new AbortController().signal) => {
  hits = 0;
  return createOpenAiProvider({ base_url: base, api_key: '', model: 'm', vision_model: '' }, 5000).chat({ messages: [{ role: 'user', content: '안녕' }], signal });
};

describe('잠깐 붐빈 서버', () => {
  it('503 두 번 뒤에 받으면 답을 돌려준다 (세 번 보냄)', async () => {
    retryPolicy.waits = [1, 1];
    plan = [503, 503, '됐습니다'];
    expect(await chat()).toBe('됐습니다');
    expect(hits).toBe(3);
  });

  it('분당 한도(429)는 두 번 더 보내 보고, 그래도 안 되면 한도를 알린다', async () => {
    retryPolicy.waits = [1, 1];
    plan = [429];
    await expect(chat()).rejects.toThrow(/요청 한도를 넘었습니다/);
    expect(hits).toBe(3);
  });

  it('하루 한도(429)는 다시 보내지 않고 오늘은 안 풀린다고 알린다', async () => {
    retryPolicy.waits = [1, 1];
    plan = [429];
    bodyOf = () => JSON.stringify({ error: { message: 'Quota exceeded for quota metric', details: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] } });
    await expect(chat()).rejects.toThrow(/오늘 쓸 수 있는 사용량을 다 썼습니다/);
    expect(hits).toBe(1);
  });

  it('서버 오류(500)는 다시 보내지 않는다 (같은 요청은 같은 오류가 난다)', async () => {
    retryPolicy.waits = [1, 1];
    plan = [500];
    await expect(chat()).rejects.toThrow(/오류 500/);
    expect(hits).toBe(1);
  });

  it('기다리는 동안 멈추면 바로 멈춘다', async () => {
    retryPolicy.waits = [60_000, 60_000];
    plan = [503];
    const ac = new AbortController();
    const pending = chat(ac.signal);
    setTimeout(() => ac.abort(), 50);
    const t = Date.now();
    await expect(pending).rejects.toBeDefined();
    expect(Date.now() - t).toBeLessThan(5000);
    expect(hits).toBe(1);
  });
});

describe('구독 한도가 풀리는 때', () => {
  it('오늘이면 시각만, 다른 날이면 날짜까지', () => {
    const now = new Date(2026, 10, 10, 9, 0).getTime();
    expect(resetWhen(new Date(2026, 10, 10, 13, 5).getTime(), now)).toBe('13:05');
    expect(resetWhen(new Date(2026, 10, 14, 13, 5).getTime(), now)).toBe('11월 14일 13:05');
  });
});

describe('구독 연결 상태 (ai_status)', () => {
  it('확인한 적이 없으면 설정만 보고 연결로, 못 쓰는 것으로 확인됐으면 연결됐다고 하지 않는다', async () => {
    await updateSettings({ ai: { provider: 'claude-code', allow_subscription: true }, privacy: { offline: false } });
    forgetLogins();
    expect(aiStatus()).toMatchObject({ configured: true });
    expect(aiStatus().subscription_state).toBeUndefined();
    // 프로그램을 찾지 못한 것으로 확인됨
    await checkLogin('claude-code', null);
    const s = aiStatus();
    expect(s).toMatchObject({ configured: false, subscription_state: 'not-installed' });
    expect(s.error).toMatch(/Claude Code를 찾지 못했습니다/);
    // 다른 프로그램의 상태와 섞이지 않는다
    await updateSettings({ ai: { provider: 'codex' } });
    expect(aiStatus()).toMatchObject({ configured: true });
    forgetLogins();
  });
});
