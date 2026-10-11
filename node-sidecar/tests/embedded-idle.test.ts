/** 내장 모델 — 10분 동안 쓰지 않으면 내리고, 쓰는 중에는 내리지 않는다 (node-llama-cpp 는 가짜) */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const disposed = vi.fn();
let release: (() => void) | undefined;
vi.mock('node-llama-cpp', () => ({
  getLlama: async () => ({
    gpu: false,
    dispose: async () => {},
    loadModel: async () => ({
      trainContextSize: 4096,
      dispose: async () => {},
      createContext: async () => ({ contextSize: 4096, dispose: async () => { disposed(); }, getSequence: () => ({}) }),
    }),
  }),
  LlamaChatSession: class {
    getChatHistory() { return []; }
    dispose() {}
    prompt() { return new Promise<string>((r) => { release = () => r('답'); }); }
  },
}));

vi.mock('../src/infra/progress.js', async (orig) => ({ ...(await orig<typeof import('../src/infra/progress.js')>()), sendProgress: () => {} }));

import { createEmbeddedProvider, isEmbeddedLoaded, warmupEmbedded } from '../src/infra/llm/embedded.js';

const model = join(mkdtempSync(join(tmpdir(), 'kordoc-ai-embedded-')), 'm.gguf');
writeFileSync(model, 'gguf');
const cfg = { model_path: model, context_size: 4096, gpu: 'auto' as const };
const MIN = 60_000;

afterEach(() => vi.useRealTimers());

describe('내장 모델 유휴 해제', () => {
  it('마지막으로 쓴 뒤 10분이 지나면 내린다', async () => {
    vi.useFakeTimers();
    await warmupEmbedded(cfg);
    expect(isEmbeddedLoaded()).toBe(true);
    await vi.advanceTimersByTimeAsync(9 * MIN);
    expect(isEmbeddedLoaded()).toBe(true);
    await vi.advanceTimersByTimeAsync(1 * MIN + 10);
    expect(isEmbeddedLoaded()).toBe(false);
    expect(disposed).toHaveBeenCalledTimes(1);
  });

  it('답을 쓰는 동안은 10분이 넘어도 내리지 않고, 끝난 뒤부터 다시 잰다', async () => {
    vi.useFakeTimers();
    await warmupEmbedded(cfg); // 모듈 import 는 가짜 시계로 안 끝나서 미리 올려 둔다
    const p = createEmbeddedProvider(cfg).chat({ messages: [{ role: 'user', content: '질문' }], maxTokens: 10 });
    await vi.advanceTimersByTimeAsync(15 * MIN);
    expect(isEmbeddedLoaded()).toBe(true);
    release!();
    expect(await p).toBe('답');
    await vi.advanceTimersByTimeAsync(9 * MIN);
    expect(isEmbeddedLoaded()).toBe(true);
    await vi.advanceTimersByTimeAsync(1 * MIN + 10);
    expect(isEmbeddedLoaded()).toBe(false);
  });
});
