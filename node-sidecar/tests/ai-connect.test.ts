/** AI 연결 — 이 PC 의 로컬 모델 서버(찾기·폐쇄망 허용)와 구독 계정의 앱 쪽 규칙(기본 꺼짐·폐쇄망 차단·기관 차단·자동 마스킹·통신 기록)
 *
 * 로컬 서버는 가짜 OpenAI 호환 서버(ai-fake-server), 구독은 가짜 claude(fixtures/fake-claude.mjs)를 설정의 프로그램 위치로 넣어
 * 실제 공급자 선택(getProvider)·ask 를 그대로 지난다.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFakeOpenAi, type FakeServer } from './ai-fake-server.js';

vi.mock('../src/infra/progress.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/infra/progress.js')>()),
  sendProgress: () => {},
  sendToken: () => {},
}));

import { reload, updateSettings } from '../src/infra/config.js';
import { netLogSnapshot } from '../src/infra/net-guard.js';
import { ask, contextCharBudget, getProvider } from '../src/infra/llm/index.js';
import { findLocalServers } from '../src/infra/llm/local-servers.js';
import { aiStatus, listServerModels } from '../src/core/ai/status.js';
import { subscriptionModels, subscriptionStatus } from '../src/core/ai/connect.js';
import { clearLoginCache } from '../src/infra/llm/subscription/status.js';
import { toAiError } from '../src/core/errors.js';
import { CliRunError } from '../src/infra/llm/subscription/messages.js';

const root = mkdtempSync(join(tmpdir(), 'kordoc-ai-connect-'));
process.env.KORDOC_AI_DATA_DIR = join(root, 'data');
const FAKE_CLAUDE = fileURLToPath(new URL('./fixtures/fake-claude.mjs', import.meta.url));
const signal = () => new AbortController().signal;
let ollama: FakeServer;
let plain: FakeServer;

beforeAll(async () => {
  chmodSync(FAKE_CLAUDE, 0o755); // POSIX 는 설정한 위치의 파일을 바로 띄운다 (#!/usr/bin/env node)
  ollama = await startFakeOpenAi({ ollama: { contextLength: 8192 }, models: ['gemma4:latest', 'qwen3:8b'], reply: () => '로컬 답' });
  plain = await startFakeOpenAi({ models: ['local-model'] });
});
afterAll(async () => {
  await Promise.all([ollama.close(), plain.close()]);
  delete process.env.KORDOC_AI_POLICY;
  rmSync(root, { recursive: true, force: true });
});

const portOf = (s: FakeServer) => Number(new URL(s.url).port);

describe('이 PC 의 로컬 모델 서버', () => {
  it('잘 알려진 포트를 한꺼번에 찾는다: 켜진 것만, Ollama 는 /api/version 으로 확인, 모델 목록까지', async () => {
    const before = netLogSnapshot().entries.length;
    const found = await findLocalServers({ ports: [
      { port: portOf(ollama), name: 'Ollama' },
      { port: portOf(plain), name: 'Ollama' }, // 포트만 Ollama 자리인 다른 서버
      { port: 1, name: 'LM Studio' }, // 꺼진 포트
    ] });
    expect(found).toEqual([
      { name: 'Ollama', base_url: `${ollama.url}/v1`, models: ['gemma4:latest', 'qwen3:8b'] },
      { name: 'OpenAI 호환 서버', base_url: `${plain.url}/v1`, models: ['local-model'] },
    ]);
    // 찾기 한 번은 통신 기록 한 줄 (이 PC 안, 외부 아님)
    const added = netLogSnapshot().entries.slice(0, netLogSnapshot().entries.length - before);
    expect(added).toEqual([expect.objectContaining({ host: '127.0.0.1', external: false, allowed: true })]);
  });

  it('폐쇄망 모드에서도 이 PC 서버로는 묻고 답한다 (클라우드 아님, 마스킹 없음, 외부로 센 것 없음)', async () => {
    await updateSettings({ privacy: { offline: true }, ai: { provider: 'local', local: { base_url: `${ollama.url}/v1`, api_key: '', model: 'gemma4:latest' }, timeout_ms: 5000 } });
    try {
      expect(aiStatus()).toMatchObject({ provider: 'local', configured: true, is_cloud: false, model: 'gemma4:latest' });
      const sent = netLogSnapshot().external_sent;
      const r = await ask({ messages: [{ role: 'user', content: '주민번호 900101-1234567' }], signal: signal(), stream: false });
      expect(r).toEqual({ text: '로컬 답', redacted: 0 });
      expect(ollama.chats().at(-1)!.messages.at(-1)!.content).toContain('900101-1234567');
      expect(netLogSnapshot().external_sent).toBe(sent);
      expect(getProvider().id).toBe('local');
    } finally {
      await updateSettings({ privacy: { offline: false } });
    }
  });

  it('주소·모델이 비면 할 일을 알려 준다', async () => {
    await updateSettings({ ai: { provider: 'local', local: { base_url: `${plain.url}/v1`, model: '' } } });
    expect(aiStatus().error).toMatch(/모델을 고르지 않았습니다/);
  });

  it('모델 불러오기는 그 칸(local)에 저장된 키를 저장된 주소에만 쓴다', async () => {
    await updateSettings({ ai: { local: { base_url: `${plain.url}/v1`, api_key: 'local-key-1234', model: 'local-model' } } });
    expect(await listServerModels({ slot: 'local' }, signal())).toEqual({ models: ['local-model'] });
    expect(plain.requests.at(-1)!.headers.authorization).toBe('Bearer local-key-1234');
    await listServerModels({ slot: 'local', base_url: `${ollama.url}/v1` }, signal());
    expect(ollama.requests.at(-1)!.headers.authorization).toBeUndefined();
  });

  it('주소에 경로가 없으면 /v1 을 붙여 쓴다 (http://127.0.0.1:포트 만 넣어도 됨)', async () => {
    expect(await listServerModels({ slot: 'local', base_url: plain.url }, signal())).toEqual({ models: ['local-model'] });
    await updateSettings({ privacy: { offline: false }, ai: { provider: 'local', local: { base_url: ollama.url, api_key: '', model: 'gemma4:latest' } } });
    expect((await ask({ messages: [{ role: 'user', content: 'x' }], signal: signal(), stream: false })).text).toBe('로컬 답');
    expect(ollama.chats().length).toBeGreaterThan(0);
  });
});

describe('구독 계정 — 앱 쪽 규칙', () => {
  // 가짜는 자식 환경 허용 목록 때문에 FAKE_LOG 를 못 받아 기본 자리에 남긴다
  const log = join(tmpdir(), 'kordoc-fake-claude.jsonl');
  const entries = () => (existsSync(log) ? readFileSync(log, 'utf-8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
  const runs = () => entries().filter((e) => e.kind === 'run').length;
  // 프로그램 위치는 기관 배포 설정으로만 정할 수 있다
  const cliPolicy = join(root, 'cli-policy.json');
  const usePolicy = (extra: Record<string, unknown> = {}) => {
    writeFileSync(cliPolicy, JSON.stringify({ version: 1, defaults: { ai: { claude_code: { cli_path: FAKE_CLAUDE } } }, ...extra }));
    process.env.KORDOC_AI_POLICY = cliPolicy;
    reload();
  };
  const useClaude = (extra: Record<string, unknown> = {}) => updateSettings({ privacy: { offline: false }, ai: { provider: 'claude-code', claude_code: { model: '' }, timeout_ms: 5000, redact_before_cloud: true, ...extra } });

  beforeAll(() => { rmSync(log, { force: true }); usePolicy(); });
  afterAll(() => { delete process.env.KORDOC_AI_POLICY; reload(); rmSync(log, { force: true }); });

  it('기본은 꺼짐: 고르기만 해서는 보내지 않고, 허용을 켜라고 알린다', async () => {
    await useClaude();
    const s = aiStatus();
    expect(s.configured).toBe(false);
    expect(s.error).toMatch(/구독 계정으로 문서 보내기가 꺼져 있습니다/);
    await expect(ask({ messages: [{ role: 'user', content: 'x' }], signal: signal() })).rejects.toThrow(/허용/);
    expect(runs()).toBe(0);
  });

  it('허용 전에는 상태 확인·모델 목록도 프로그램을 띄우지 않는다 (설치 위치만)', async () => {
    await useClaude({ allow_subscription: false });
    const { statuses } = await subscriptionStatus({ provider: 'claude-code' });
    expect(statuses[0]).toMatchObject({ provider: 'claude-code', state: 'installed', path: FAKE_CLAUDE });
    await expect(subscriptionModels({ provider: 'claude-code' }, signal())).rejects.toThrow(/허용하고 저장한 뒤/);
    expect(runs()).toBe(0);
  });

  it('프로그램 위치는 화면(update_settings)·settings.json 으로 못 바꾼다 (기관 배포 설정만)', async () => {
    const evil = join(root, 'evil.exe');
    await updateSettings({ ai: { claude_code: { cli_path: evil }, codex: { cli_path: evil } } });
    const { getSettings } = await import('../src/infra/config.js');
    expect(getSettings().ai.claude_code.cli_path).toBe(FAKE_CLAUDE);
    expect(getSettings().ai.codex.cli_path).toBe('');
    const file = JSON.parse(readFileSync(join(root, 'data', 'settings.json'), 'utf-8'));
    expect(JSON.stringify(file)).not.toContain('evil.exe');
    // 손으로 settings.json 에 넣어도 버린다
    writeFileSync(join(root, 'data', 'settings.json'), JSON.stringify({ ...file, ai: { ...file.ai, codex: { cli_path: evil } } }));
    reload();
    expect(getSettings().ai.codex.cli_path).toBe('');
  });

  it('허용하면 인터넷 AI 로 보고 보내기 전에 개인정보를 가린다(system 까지). 통신 기록에 프로그램 이름으로 남는다', async () => {
    await useClaude({ allow_subscription: true });
    clearLoginCache();
    expect(aiStatus()).toMatchObject({ provider: 'claude-code', configured: true, is_cloud: true });
    const sent = netLogSnapshot().external_sent;
    const r = await ask({ system: '담당자 전화 010-9876-5432 로 안내', messages: [{ role: 'user', content: '민원인 주민번호 900101-1234567, 전화 010-1234-5678 확인' }], signal: signal(), stream: false });
    expect(r.text).toBe('안녕하세요');
    expect(r.redacted).toBeGreaterThanOrEqual(3);
    const lines = entries().filter((e) => e.kind === 'stdin').map((e) => e.line as string);
    const userLine = lines.find((l) => l.includes('"type":"user"'))!;
    expect(userLine).toContain('민원인 주민번호');
    expect(userLine).not.toContain('1234567');
    expect(userLine).not.toContain('1234-5678');
    expect(lines.find((l) => l.includes('initialize'))).not.toContain('9876-5432');
    expect(netLogSnapshot().external_sent).toBe(sent + 1);
    expect(netLogSnapshot().entries[0]).toMatchObject({ host: 'api.anthropic.com (Claude Code)', external: true, allowed: true });
  });

  it('구독 프로그램은 문서 예산을 창 크기(18만 토큰)로 잡는다', async () => {
    await useClaude({ allow_subscription: true });
    expect(await contextCharBudget({ reserveTokens: 2048 })).toBe(Math.floor((180_000 - 2048) * 1.2));
  });

  it('폐쇄망 모드면 공급자부터 막고 프로그램을 띄우지 않는다 (상태 확인도)', async () => {
    await useClaude({ allow_subscription: true });
    await updateSettings({ privacy: { offline: true } });
    const before = runs();
    try {
      expect(aiStatus().error).toMatch(/폐쇄망 모드에서는 인터넷 AI를 쓸 수 없습니다/);
      await expect(ask({ messages: [{ role: 'user', content: 'x' }], signal: signal() })).rejects.toThrow(/폐쇄망/);
      const st = await subscriptionStatus({});
      expect(st.statuses.map((x) => x.state)).toEqual(['offline', 'offline']);
      await expect(subscriptionModels({ provider: 'codex' }, signal())).rejects.toThrow(/폐쇄망/);
      expect(runs()).toBe(before);
    } finally {
      await updateSettings({ privacy: { offline: false } });
    }
  });

  it('상태 확인: 설정한 프로그램 위치로 ready, 계정 이메일은 싣지 않는다', async () => {
    await useClaude({ allow_subscription: true });
    const { statuses } = await subscriptionStatus({ provider: 'claude-code' });
    expect(statuses).toEqual([{ provider: 'claude-code', state: 'ready', version: '2.1.300', plan: 'max', login_command: 'claude', path: FAKE_CLAUDE }]);
  });

  it('기관이 allow_subscription 을 false 로 고정하면 막혔다고 알리고 상태 확인도 띄우지 않는다', async () => {
    usePolicy({ locked: { ai: { allow_subscription: false } } });
    const before = runs();
    try {
      await updateSettings({ ai: { provider: 'claude-code', allow_subscription: true } }); // 고정값은 못 바꾼다
      expect(aiStatus().error).toMatch(/기관에서 구독 계정/);
      expect((await subscriptionStatus({})).statuses.map((x) => x.state)).toEqual(['disabled', 'disabled']);
      expect(runs()).toBe(before);
    } finally {
      usePolicy();
    }
  });

  it('구독 오류 문장은 화면 오류 변환(toAiError)을 지나도 그대로다', () => {
    for (const kind of ['signed-out', 'metered', 'not-installed', 'needs-update', 'rate-limit', 'overloaded', 'server-error', 'network', 'too-long', 'bad-request', 'timeout', 'unsafe-tools', 'failed'] as const) {
      for (const p of ['claude-code', 'codex'] as const) {
        const e = new CliRunError(kind, p, undefined, { seconds: 180, resetsAt: Date.now() + 3600_000 });
        expect((toAiError(e) as Error).message).toBe(e.message);
        expect(e.message).not.toMatch(/[—–]/); // 화면 문장에 줄표 금지
      }
    }
  });
});
