/** API 키 방식 외부 AI 의 모델 목록 (ai_list_models slot anthropic·gemini) — fetch 를 가짜로 바꿔 실제 회사 서버는 부르지 않는다 */

import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { updateSettings } from '../src/infra/config.js';
import { listServerModels } from '../src/core/ai/status.js';
import { tempDir } from './tmp-dirs.js';

vi.mock('../src/infra/net-guard.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/infra/net-guard.js')>()),
  assertAllowed: async () => undefined,
}));

process.env.KORDOC_AI_DATA_DIR = tempDir('kordoc-ai-cloud-models-');
const signal = () => new AbortController().signal;
const calls: Array<{ url: string; headers: Record<string, string> }> = [];

function fakeFetch(body: unknown, status = 200) {
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), headers: { ...(init?.headers as Record<string, string>) } });
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  });
}

beforeAll(async () => {
  await updateSettings({ ai: { anthropic: { api_key: 'sk-ant-saved', model: '' }, gemini: { api_key: 'AIza-saved', model: '' } }, privacy: { offline: false } });
});
afterEach(() => { vi.unstubAllGlobals(); calls.length = 0; });

describe('ai_list_models — API 키 방식', () => {
  it('Anthropic: Models API 의 id 를 그대로, 가려진 키면 저장된 키', async () => {
    fakeFetch({ data: [{ id: 'claude-opus-5-5' }, { id: 'claude-sonnet-5-5' }] });
    const r = await listServerModels({ slot: 'anthropic', api_key: 'sk-a****' }, signal());
    expect(r.models).toEqual(['claude-opus-5-5', 'claude-sonnet-5-5']);
    expect(calls[0].url).toMatch(/^https:\/\/api\.anthropic\.com\/v1\/models/);
    expect(calls[0].headers['x-api-key']).toBe('sk-ant-saved');
    expect(calls[0].headers['anthropic-version']).toBeTruthy();
  });

  it('Gemini: 글 생성 모델만, "models/" 는 떼고, 입력 중인 키를 쓴다', async () => {
    fakeFetch({ models: [
      { name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent', 'countTokens'] },
      { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
    ] });
    const r = await listServerModels({ slot: 'gemini', api_key: 'AIza-typed' }, signal());
    expect(r.models).toEqual(['gemini-3.8-flash']);
    expect(calls[0].headers['x-goog-api-key']).toBe('AIza-typed');
  });

  it('키가 틀리면 무엇을 하면 되는지까지 알린다', async () => {
    fakeFetch({ error: { message: 'invalid x-api-key' } }, 401);
    await expect(listServerModels({ slot: 'anthropic', api_key: 'sk-bad' }, signal())).rejects.toThrow(/API 키를 확인/);
  });

  it('키가 없으면 부르지 않고 키부터 넣으라고 한다', async () => {
    await updateSettings({ ai: { gemini: { api_key: '' } } });
    fakeFetch({ models: [] });
    await expect(listServerModels({ slot: 'gemini' }, signal())).rejects.toThrow(/키를 넣은 뒤/);
    expect(calls).toHaveLength(0);
  });
});
