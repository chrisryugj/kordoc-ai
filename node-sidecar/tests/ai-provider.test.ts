/** AI 공급자 계층·연결 상태 — 가짜 OpenAI 호환 서버로 (유료 클라우드 호출 없음) */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startFakeOpenAi, type FakeServer } from './ai-fake-server.js';

const h = vi.hoisted(() => ({ tokens: [] as string[] }));

vi.mock('../src/infra/progress.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/infra/progress.js')>()),
  sendProgress: () => {},
  sendToken: (t: string) => h.tokens.push(t),
}));

import { updateSettings } from '../src/infra/config.js';
import { ask, contextCharBudget, parseJsonLoose } from '../src/infra/llm/index.js';
import { createThinkFilter } from '../src/infra/llm/types.js';
import { aiStatus, aiTest, listServerModels } from '../src/core/ai/status.js';
import { RpcRouter } from '../src/rpc/router.js';
import { registerAi } from '../src/rpc/methods/ai.js';

// 설정은 첫 getSettings() 때 읽으니(가져오기 시점엔 안 읽음) 테스트 전에만 정하면 된다
process.env.KORDOC_AI_DATA_DIR = mkdtempSync(join(tmpdir(), 'kordoc-ai-provider-'));
const signal = () => new AbortController().signal;
let fake: FakeServer;

async function useServer(s: FakeServer, extra: Record<string, unknown> = {}) {
  await updateSettings({ ai: { provider: 'openai', openai: { base_url: `${s.url}/v1`, api_key: 'sk-local-1234', model: 'test-model', vision_model: '' }, timeout_ms: 5000, ...extra }, privacy: { offline: false } });
}

beforeAll(async () => {
  fake = await startFakeOpenAi({ reply: () => '<think>속으로 생각</think>서울입니다.', reasoning: '사고 과정은 버려야 함' });
  await useServer(fake);
});
afterAll(async () => { await fake.close(); });
beforeEach(() => { h.tokens.length = 0; });

describe('ask (OpenAI 호환 스트림)', () => {
  it('본문 조각만 이어 붙이고 reasoning·<think> 는 버린다, 토큰은 프론트로 흘린다', async () => {
    const r = await ask({ messages: [{ role: 'user', content: '수도는?' }], signal: signal() });
    expect(r.text).toBe('서울입니다.');
    expect(h.tokens.join('')).toBe('서울입니다.');
    expect(r.redacted).toBe(0);
    const body = fake.chats().at(-1)!;
    expect(body.stream).toBe(true);
    expect(body.reasoning_effort).toBeUndefined(); // Ollama 가 아니면 보내지 않음
  });

  it('stream:false 면 토큰을 흘리지 않는다', async () => {
    await ask({ messages: [{ role: 'user', content: '수도는?' }], signal: signal(), stream: false });
    expect(h.tokens).toHaveLength(0);
  });

  it('schema → response_format json_schema, 거부(400)하면 빼고 한 번 더', async () => {
    const strict = await startFakeOpenAi({ reply: () => '{"a":"1"}', rejectResponseFormat: true });
    await useServer(strict);
    try {
      const r = await ask({ messages: [{ role: 'user', content: 'x' }], schema: { type: 'object', properties: { a: { type: 'string' } } }, signal: signal(), stream: false });
      expect(r.text).toBe('{"a":"1"}');
      const [first, second] = strict.chats();
      expect(first.response_format?.type).toBe('json_schema');
      expect(second.response_format).toBeUndefined();
    } finally {
      await strict.close();
      await useServer(fake);
    }
  });

  it('Ollama 면 사고를 끄고(reasoning_effort none) /api/ps 의 컨텍스트로 예산을 잡는다', async () => {
    const ollama = await startFakeOpenAi({ reply: () => '네', ollama: { contextLength: 32768 } });
    await useServer(ollama);
    try {
      await ask({ messages: [{ role: 'user', content: 'x' }], signal: signal(), stream: false });
      expect(ollama.chats()[0].reasoning_effort).toBe('none');
      const budget = await contextCharBudget({ reserveTokens: 2048 });
      expect(budget).toBe(Math.floor((32768 - 2048) * 1.2));
    } finally {
      await ollama.close();
      await useServer(fake);
    }
  });

  it('컨텍스트를 모르는 내부 서버는 8K 로 보수적으로', async () => {
    expect(await contextCharBudget({ reserveTokens: 2048 })).toBe(Math.floor((8192 - 2048) * 1.2));
  });

  it('응답이 멈추면 "초 동안 응답하지 않습니다" 로 끊는다. 첫 글자 전(서버가 긴 글을 읽는 중)은 4배까지 기다린다', async () => {
    const reading = await startFakeOpenAi({ reply: () => '늦은 답', delayMs: 700 });
    const tooSlow = await startFakeOpenAi({ reply: () => '늦은 답', delayMs: 1500 });
    const stalled = await startFakeOpenAi({ reply: () => '멈춘 답입니다', stallMs: 700 });
    const ask1 = () => ask({ messages: [{ role: 'user', content: 'x' }], signal: signal(), stream: false });
    try {
      await useServer(reading, { timeout_ms: 300 });
      expect((await ask1()).text).toBe('늦은 답');
      await useServer(tooSlow, { timeout_ms: 300 });
      await expect(ask1()).rejects.toThrow(/1초 동안 응답하지 않습니다/);
      await useServer(stalled, { timeout_ms: 300 });
      await expect(ask1()).rejects.toThrow(/0초 동안 응답하지 않습니다/);
    } finally {
      await Promise.all([reading.close(), tooSlow.close(), stalled.close()]);
      await useServer(fake);
    }
  });
});

describe('넘겨주기·내부 이름', () => {
  it('서버가 307 로 넘겨 보내면 따라가지 않고 주소를 고치라고 알린다 (넘겨받는 쪽엔 요청이 가지 않음)', async () => {
    const target = await startFakeOpenAi({ reply: () => '새 곳' });
    const hop = await startFakeOpenAi({ redirectChatTo: `${target.url}/v1/chat/completions` });
    await useServer(hop);
    try {
      await expect(ask({ messages: [{ role: 'user', content: '문서 내용' }], signal: signal(), stream: false })).rejects.toThrow(/넘겨 보냅니다/);
      expect(target.chats()).toHaveLength(0);
    } finally {
      await hop.close();
      await target.close();
      await useServer(fake);
    }
  });

  it('점 없는 내부 이름(gpu01)은 기관 내부로 본다: 폐쇄망에서도 공급자 허용, 클라우드 아님', async () => {
    await updateSettings({ privacy: { offline: true }, ai: { openai: { base_url: 'http://gpu01:8000/v1' } } });
    try {
      const s = aiStatus();
      expect(s.is_cloud).toBe(false);
      expect(s.configured).toBe(true);
    } finally {
      await updateSettings({ privacy: { offline: false } });
      await useServer(fake);
    }
  });
});

describe('createThinkFilter', () => {
  it('조각 경계에 걸린 <think> 태그도 거른다', () => {
    const f = createThinkFilter();
    const out = ['안녕 <th', 'ink>비밀', '</thi', 'nk>하세요', ' a < b'].map((c) => f.push(c)).join('') + f.flush();
    expect(out).toBe('안녕 하세요 a < b');
  });
});

describe('parseJsonLoose', () => {
  it('코드펜스·잡문·끝 쉼표가 있어도 객체를 꺼낸다', () => {
    expect(parseJsonLoose<{ a: number }>('결과입니다\n```json\n{"a": 1,}\n```')).toEqual({ a: 1 });
    expect(parseJsonLoose<number[]>('답: [1, 2, 3] 끝')).toEqual([1, 2, 3]);
    expect(() => parseJsonLoose('JSON 없음')).toThrow(/JSON/);
  });
});

describe('ai_status · ai_test · ai_list_models', () => {
  it('ai_status — 연결됨/빠진 값 안내', async () => {
    let s = aiStatus();
    expect(s).toMatchObject({ provider: 'openai', configured: true, is_cloud: false, model: 'test-model', embedded_loaded: false });
    await updateSettings({ ai: { provider: 'embedded', embedded: { model_path: join(process.env.KORDOC_AI_DATA_DIR!, '없는.gguf') } } });
    s = aiStatus();
    expect(s.configured).toBe(false);
    expect(s.error).toMatch(/설정 > AI 연결/);
    await updateSettings({ ai: { provider: 'none' } });
    expect(aiStatus().configured).toBe(false);
    await useServer(fake);
  });

  it('ai_test — 짧은 질문 1회, 지연 측정', async () => {
    const r = await aiTest(signal());
    expect(r.ok).toBe(true);
    expect(r.sample).toBe('서울입니다.');
    expect(r.latency_ms).toBeGreaterThanOrEqual(0);
    expect(fake.chats().at(-1)!.max_tokens).toBe(32);
  });

  it('ai_test — 서버가 꺼져 있으면 ok:false + 오류 문장 (throw 안 함)', async () => {
    await updateSettings({ ai: { openai: { base_url: 'http://127.0.0.1:9/v1' } } });
    const r = await aiTest(signal());
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
    await useServer(fake);
  });

  it('ai_list_models — 저장 전 주소로, 가려진 키(****)면 저장된 키를 쓴다', async () => {
    const r = await listServerModels({ base_url: `${fake.url}/v1`, api_key: 'sk-l****' }, signal());
    expect(r.models).toEqual(['alpha', 'test-model']);
    const req = fake.requests.filter((x) => x.path === '/v1/models').at(-1)!;
    expect(req.headers.authorization).toBe('Bearer sk-local-1234');
  });

  it('ai_list_models — 다른 주소를 시험할 땐 저장된 키를 보내지 않는다', async () => {
    const other = await startFakeOpenAi({});
    try {
      await listServerModels({ base_url: `${other.url}/v1`, api_key: 'sk-l****' }, signal());
      expect(other.requests.at(-1)!.headers.authorization).toBeUndefined();
    } finally {
      await other.close();
    }
  });

  it('폐쇄망 모드: 사설 주소는 통과, 외부 주소는 막는다', async () => {
    await updateSettings({ privacy: { offline: true } });
    try {
      expect((await listServerModels({ base_url: `${fake.url}/v1` }, signal())).models.length).toBe(2);
      await expect(listServerModels({ base_url: 'http://8.8.8.8:9/v1' }, signal())).rejects.toThrow(/폐쇄망/);
      // 외부 주소를 가리키는 OpenAI 호환 설정은 클라우드로 보고 공급자 자체를 막는다
      await updateSettings({ ai: { openai: { base_url: 'https://api.example.com/v1' } } });
      await expect(ask({ messages: [{ role: 'user', content: 'x' }], signal: signal() })).rejects.toThrow(/폐쇄망/);
    } finally {
      await updateSettings({ privacy: { offline: false } });
      await useServer(fake);
    }
  });
});

describe('RPC 등록', () => {
  it('계약의 AI 메서드가 모두 있고 v1 이름(summarize·inspect_document)은 없다', () => {
    const router = new RpcRouter();
    registerAi(router);
    const names = router.listMethods();
    for (const m of ['ai_status', 'ai_test', 'ai_list_models', 'ai_warmup', 'llm_catalog', 'llm_list', 'llm_download', 'llm_import', 'llm_delete',
      'ai_summarize', 'ai_chat', 'ai_draft', 'ai_rewrite', 'ai_review', 'ai_fill_suggest', 'ai_extract']) {
      expect(names).toContain(m);
    }
    expect(names).not.toContain('summarize');
    expect(names).not.toContain('inspect_document');
  });

  it('ai_status 를 라우터로', async () => {
    const router = new RpcRouter();
    registerAi(router);
    const res = await router.dispatch('ai_status', {}, 1);
    expect(res.error).toBeUndefined();
    expect((res.result as { provider: string }).provider).toBe('openai');
  });
});
