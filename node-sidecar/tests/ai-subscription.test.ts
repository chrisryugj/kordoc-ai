/** 구독 계정(Claude Code·Codex) 공급자 — 가짜 프로그램(tests/fixtures/fake-*.mjs)으로. 실제 claude·codex 는 띄우지 않는다(구독 사용량)
 *
 * 시작 인자(도구 0개 플래그), stdin 으로만 가는 글, 자식 환경에서 빠지는 키, 도구 0개 확인의 거절 길, 오류 → 할 일,
 * 시간 제한·취소 때 프로세스 끝내기, 로그인 상태 읽기(계정 이메일을 옮기지 않음), 프로그램 찾기(.cmd 껍데기 뒤)
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { updateSettings } from '../src/infra/config.js';
import { netLogSnapshot, OfflineBlockedError } from '../src/infra/net-guard.js';
import { claudeCodeLaunchArgs, createClaudeCodeProvider, listClaudeCodeModels, type CliDeps } from '../src/infra/llm/claude-code.js';
import { CODEX_CONFIG_OVERRIDES, createCodexProvider, listCodexModels, type CodexDeps } from '../src/infra/llm/codex.js';
import { locateSubscriptionProgram, type SubscriptionProgram } from '../src/infra/llm/subscription/locate.js';
import { CliRunError, type SubscriptionProviderId } from '../src/infra/llm/subscription/messages.js';
import { subscriptionChildEnv } from '../src/infra/llm/subscription/process.js';
import { assertSubscriptionLogin, clearLoginCache, detectSubscriptionLogin, parseClaudeAuthStatus, parseCodexLoginStatus } from '../src/infra/llm/subscription/status.js';
import type { ChatRequest } from '../src/infra/llm/types.js';

process.env.KORDOC_AI_DATA_DIR = mkdtempSync(join(tmpdir(), 'kordoc-ai-sub-'));
const FAKE_CLAUDE = fileURLToPath(new URL('./fixtures/fake-claude.mjs', import.meta.url));
const FAKE_CODEX = fileURLToPath(new URL('./fixtures/fake-codex.mjs', import.meta.url));
const work = mkdtempSync(join(tmpdir(), 'kordoc-ai-sub-work-'));
let logN = 0;

const program = (provider: SubscriptionProviderId, script: string): SubscriptionProgram => ({ provider, command: process.execPath, prefixArgs: [script], env: {}, entry: script, source: 'configured' });
type Entry = { kind: string; pid?: number; args?: string[]; cwd?: string; env?: Record<string, string | null>; line?: string; method?: string; params?: Record<string, unknown>; id?: unknown; error?: unknown };
const readLog = (file: string): Entry[] => (existsSync(file) ? readFileSync(file, 'utf-8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function gone(pid: number, ms = 5000) {
  const until = Date.now() + ms;
  while (alive(pid) && Date.now() < until) await new Promise((r) => setTimeout(r, 50));
  return !alive(pid);
}
/** 가짜가 떠 있었다면 끝났는지. 시작 기록도 없으면 기록하기 전에 끝낸 것(Windows 는 트리 종료가 비동기라 잠깐 기다려 본다) */
async function stopped(log: string) {
  await new Promise((r) => setTimeout(r, 300));
  const pid = readLog(log).find((e) => e.kind === 'start')?.pid;
  return pid === undefined ? true : gone(pid);
}

/** 가짜 프로그램과 기록 파일, 띄운 옵션을 엿보는 spawn */
function rig(script: string, provider: SubscriptionProviderId, env: Record<string, string>) {
  const log = join(work, `log-${++logN}.jsonl`);
  const spawned: Array<{ command: string; args: string[]; shell: unknown }> = [];
  const deps = {
    resolveProgram: async () => program(provider, script),
    checkLogin: async () => {},
    baseEnv: { ...process.env, ...env, FAKE_LOG: log, ANTHROPIC_API_KEY: 'sk-ant-should-not-pass', OPENAI_API_KEY: 'sk-openai-should-not-pass', CODEX_API_KEY: 'x' },
    exitGraceMs: 500,
    spawn: ((command: string, args: string[], opts: Parameters<typeof spawn>[2]) => {
      spawned.push({ command, args, shell: opts.shell });
      return spawn(command, args, opts);
    }) as unknown as CliDeps['spawn'],
  };
  return { log, spawned, deps };
}

const req = (over: Partial<ChatRequest> = {}): ChatRequest & { tokens: string[] } => {
  const tokens: string[] = [];
  return { messages: [{ role: 'user', content: '가온시 민원 처리 현황을 요약하세요' }], signal: new AbortController().signal, onToken: (t) => tokens.push(t), tokens, ...over };
};

beforeAll(async () => { await updateSettings({ privacy: { offline: false } }); });
beforeEach(() => clearLoginCache());

describe('Claude Code: 시작 인자', () => {
  it('도구 0개·사용자 설정 무시 플래그를 늘 붙이고, 모델 이름만 가변 값으로', () => {
    const a = claudeCodeLaunchArgs('sonnet');
    for (const f of ['-p', '--restricted', '--strict-mcp-config', '--disable-slash-commands', '--no-session-persistence']) expect(a).toContain(f);
    expect(a[a.indexOf('--tools') + 1]).toBe('');
    expect(a[a.indexOf('--setting-sources') + 1]).toBe('');
    expect(a).not.toContain('--bare');
    expect(a).not.toContain('--json-schema');
    expect(a.slice(-2)).toEqual(['--model', 'sonnet']);
    expect(claudeCodeLaunchArgs('')).not.toContain('--model');
    expect(() => claudeCodeLaunchArgs('--dangerously-skip-permissions')).toThrow(CliRunError);
  });
});

describe('Claude Code: 한 번 묻기 (가짜 프로그램)', () => {
  it('지시문·대화는 stdin 으로만, 명령줄에는 없다. 셸 없이, API 키 변수를 빼고, 새 빈 폴더에서. 글 조각을 흘린다', async () => {
    const { log, spawned, deps } = rig(FAKE_CLAUDE, 'claude-code', { FAKE_CLAUDE_MODE: 'ok' });
    const p = createClaudeCodeProvider({ model: 'sonnet', cli_path: '' }, 5000, deps);
    const r = req({ system: '당신은 공문 비서입니다' });
    expect(await p.chat(r)).toBe('안녕하세요');
    expect(r.tokens.join('')).toBe('안녕하세요'); // 사고(thinking) 조각은 버린다
    expect(spawned[0].shell).toBe(false);
    expect(spawned[0].args.join(' ')).not.toContain('가온시');
    const entries = readLog(log);
    const start = entries.find((e) => e.kind === 'start')!;
    expect(start.env).toMatchObject({ ANTHROPIC_API_KEY: null, OPENAI_API_KEY: null, DISABLE_AUTOUPDATER: '1' });
    expect(start.cwd).toMatch(/kordoc-claude-code-/);
    const lines = entries.filter((e) => e.kind === 'stdin').map((e) => JSON.parse(e.line!));
    expect(lines[0].request.subtype).toBe('initialize');
    expect(lines[0].request.systemPrompt[0]).toBe('당신은 공문 비서입니다');
    expect(lines[0].request.systemPrompt[1]).toMatch(/도구는 없습니다/);
    expect(JSON.stringify(lines[1].message.content)).toContain('가온시 민원 처리 현황');
    await new Promise((r2) => setTimeout(r2, 300));
    expect(existsSync(start.cwd!)).toBe(false); // 임시 폴더는 지운다
  });

  it('schema 는 지시문의 <response_schema> 로 준다 (--json-schema 는 도구를 하나 더해 쓰지 않는다)', async () => {
    const { log, spawned, deps } = rig(FAKE_CLAUDE, 'claude-code', { FAKE_CLAUDE_MODE: 'ok', FAKE_CLAUDE_REPLY: '{"a":"1"}' });
    const p = createClaudeCodeProvider({ model: '', cli_path: '' }, 5000, deps);
    expect(await p.chat(req({ schema: { type: 'object', properties: { a: { type: 'string' } } }, json: true }))).toBe('{"a":"1"}');
    expect(spawned[0].args).not.toContain('--json-schema');
    const init = JSON.parse(readLog(log).find((e) => e.kind === 'stdin')!.line!);
    expect(init.request.systemPrompt.join('\n')).toMatch(/<response_schema>\n\{"type":"object"/);
  });

  for (const [mode, why] of [['tools', '도구 2개가 켜져 있음'], ['early', '도구 목록을 알리기 전'], ['permission', '허락을 물음']] as const) {
    it(`도구 0개가 아니면 멈추고 프로세스를 끝낸다: ${mode}`, async () => {
      const { log, deps } = rig(FAKE_CLAUDE, 'claude-code', { FAKE_CLAUDE_MODE: mode });
      const p = createClaudeCodeProvider({ model: '', cli_path: '' }, 5000, deps);
      const err = await p.chat(req()).catch((e) => e);
      expect(err).toBeInstanceOf(CliRunError);
      expect(err.kind).toBe('unsafe-tools');
      expect(err.message).toContain(why);
      expect(await stopped(log)).toBe(true);
    });
  }

  it('로그인 안 됨 → claude 로 로그인하라는 안내, 프로그램이 찍은 계정 이메일은 문장에 없다', async () => {
    const { deps } = rig(FAKE_CLAUDE, 'claude-code', { FAKE_CLAUDE_MODE: 'auth' });
    const err = await createClaudeCodeProvider({ model: '', cli_path: '' }, 5000, deps).chat(req()).catch((e) => e);
    expect(err.kind).toBe('signed-out');
    expect(err.message).toMatch(/로그인되어 있지 않습니다.*claude 를 실행해/);
    expect(err.message).not.toContain('kim@example.com');
  });

  it('사용량 한도 → 다시 쓸 수 있는 시각', async () => {
    const { deps } = rig(FAKE_CLAUDE, 'claude-code', { FAKE_CLAUDE_MODE: 'ratelimit' });
    const err = await createClaudeCodeProvider({ model: '', cli_path: '' }, 5000, deps).chat(req()).catch((e) => e);
    expect(err.kind).toBe('rate-limit');
    expect(err.message).toMatch(/\d\d:\d\d부터 다시 쓸 수 있습니다/);
  });

  it('응답이 멈추면 시간 제한으로 끊고 프로세스를 끝낸다', async () => {
    const { log, deps } = rig(FAKE_CLAUDE, 'claude-code', { FAKE_CLAUDE_MODE: 'hang' });
    const err = await createClaudeCodeProvider({ model: '', cli_path: '' }, 600, deps).chat(req()).catch((e) => e);
    expect(err.kind).toBe('timeout');
    expect(err.message).toMatch(/초 동안 응답하지 않아 멈췄습니다/);
    expect(await stopped(log)).toBe(true);
  });

  it('취소하면 AbortError, 프로세스 트리를 끝낸다', async () => {
    const { log, deps } = rig(FAKE_CLAUDE, 'claude-code', { FAKE_CLAUDE_MODE: 'hang' });
    const ctl = new AbortController();
    const run = createClaudeCodeProvider({ model: '', cli_path: '' }, 8000, deps).chat(req({ signal: ctl.signal }));
    // 가짜가 대화를 받은 뒤(실행 중)에 취소한다 — 전체 시험을 함께 돌리면 띄우는 데 0.5초 넘게 걸리기도 한다
    const until = Date.now() + 6000;
    while (!readLog(log).some((e) => e.kind === 'stdin' && e.line!.includes('"type":"user"')) && Date.now() < until) await new Promise((r) => setTimeout(r, 50));
    ctl.abort();
    const err = await run.catch((e) => e);
    expect(err.name).toBe('AbortError');
    expect(await stopped(log)).toBe(true);
  });

  it('낡은 버전(모르는 옵션) → claude update 안내, 그냥 끝나면 종료 코드', async () => {
    const old = rig(FAKE_CLAUDE, 'claude-code', { FAKE_CLAUDE_MODE: 'old' });
    const e1 = await createClaudeCodeProvider({ model: '', cli_path: '' }, 5000, old.deps).chat(req()).catch((e) => e);
    expect(e1.kind).toBe('needs-update');
    expect(e1.message).toContain('claude update');
    const exit = rig(FAKE_CLAUDE, 'claude-code', { FAKE_CLAUDE_MODE: 'exit' });
    const e2 = await createClaudeCodeProvider({ model: '', cli_path: '' }, 5000, exit.deps).chat(req()).catch((e) => e);
    expect(e2.message).toContain('종료 코드 3');
  });

  it('모델 목록은 initialize 만 보내 읽는다 (모델을 부르지 않음, 기본 모델은 빈 id, 옵션 모양 이름은 버림)', async () => {
    const { log, deps } = rig(FAKE_CLAUDE, 'claude-code', { FAKE_CLAUDE_MODE: 'ok' });
    const models = await listClaudeCodeModels({ model: '', cli_path: '' }, AbortSignal.timeout(5000), deps);
    expect(models).toEqual([{ id: '', label: 'Default (recommended)' }, { id: 'sonnet', label: 'Sonnet' }]);
    const stdin = readLog(log).filter((e) => e.kind === 'stdin');
    expect(stdin).toHaveLength(1);
    expect(JSON.parse(stdin[0].line!).request.subtype).toBe('initialize');
  });

  it('폐쇄망 모드면 띄우지 않고 막으며, 막은 것을 통신 기록에 남긴다', async () => {
    await updateSettings({ privacy: { offline: true } });
    try {
      const { spawned, deps } = rig(FAKE_CLAUDE, 'claude-code', { FAKE_CLAUDE_MODE: 'ok' });
      await expect(createClaudeCodeProvider({ model: '', cli_path: '' }, 5000, deps).chat(req())).rejects.toBeInstanceOf(OfflineBlockedError);
      expect(spawned).toHaveLength(0);
      expect(netLogSnapshot().entries[0]).toMatchObject({ host: 'api.anthropic.com (Claude Code)', external: true, allowed: false });
    } finally {
      await updateSettings({ privacy: { offline: false } });
    }
  });
});

describe('Codex: app-server (가짜 프로그램)', () => {
  it('설정 덮어쓰기 인자, 기본 모델 지정, 권한 프로필(읽기만)·MCP 끄기, 서버 요청은 거절, 키 변수 빼기, 글 조각', async () => {
    const { log, spawned, deps } = rig(FAKE_CODEX, 'codex', { FAKE_CODEX_MODE: 'ok' });
    const r = req();
    expect(await createCodexProvider({ model: '', cli_path: '' }, 5000, deps as CodexDeps).chat(r)).toBe('안녕하세요');
    expect(r.tokens.join('')).toBe('안녕하세요');
    expect(spawned[0].shell).toBe(false);
    const entries = readLog(log);
    const start = entries.find((e) => e.kind === 'start')!;
    expect(start.args).toEqual(['app-server', ...CODEX_CONFIG_OVERRIDES.flatMap((o) => ['-c', o]), '--listen', 'stdio://']);
    expect(start.env).toEqual({ OPENAI_API_KEY: null, CODEX_API_KEY: null });
    const rpc = entries.filter((e) => e.kind === 'rpc');
    const thread = rpc.find((e) => e.method === 'thread/start')!.params!;
    expect(thread).toMatchObject({ model: 'gpt-5.5-codex', approvalPolicy: 'never', ephemeral: true });
    const cfg = thread.config as { default_permissions: string; permissions: Record<string, { filesystem: Record<string, string> }>; mcp_servers: unknown };
    expect(cfg.mcp_servers).toEqual({ github: { enabled: false } });
    expect(Object.values(cfg.permissions[cfg.default_permissions].filesystem).every((v) => v === 'read')).toBe(true);
    expect(JSON.stringify(thread)).not.toMatch(/write|danger|full-access/);
    expect(rpc.find((e) => e.id === 'srv-1')?.error).toMatchObject({ code: -32601 });
    const turn = rpc.find((e) => e.method === 'turn/start')!.params as { input: Array<{ text?: string }>; outputSchema?: unknown };
    expect(turn.input[0].text).toContain('가온시 민원 처리 현황');
    expect(turn.outputSchema).toBeUndefined();
    expect(spawned[0].args.join(' ')).not.toContain('가온시');
  });

  it('schema → turn/start 의 outputSchema', async () => {
    const { log, deps } = rig(FAKE_CODEX, 'codex', { FAKE_CODEX_MODE: 'ok' });
    const schema = { type: 'object', properties: { a: { type: 'string' } }, required: ['a'], additionalProperties: false };
    expect(await createCodexProvider({ model: 'gpt-5.5-mini', cli_path: '' }, 5000, deps as CodexDeps).chat(req({ schema, json: true }))).toBe('{"a":"1"}');
    const rpc = readLog(log).filter((e) => e.kind === 'rpc');
    expect(rpc.find((e) => e.method === 'turn/start')!.params!.outputSchema).toEqual(schema);
    expect(rpc.find((e) => e.method === 'thread/start')!.params!.model).toBe('gpt-5.5-mini');
    expect(rpc.some((e) => e.method === 'model/list')).toBe(false);
  });

  it('권한 프로필이 안 먹으면 그 스레드를 지우고 read-only 샌드박스로', async () => {
    const { log, deps } = rig(FAKE_CODEX, 'codex', { FAKE_CODEX_MODE: 'noprofile' });
    await createCodexProvider({ model: 'm', cli_path: '' }, 5000, deps as CodexDeps).chat(req());
    const rpc = readLog(log).filter((e) => e.kind === 'rpc');
    const starts = rpc.filter((e) => e.method === 'thread/start').map((e) => e.params!);
    expect(starts[1]).toMatchObject({ sandbox: 'read-only' });
    expect(rpc.find((e) => e.method === 'thread/delete')!.params).toEqual({ threadId: 'thread-profile' });
  });

  for (const [mode, kind, text] of [
    ['apikey', 'metered', '쓴 만큼 요금'],
    ['signedout', 'signed-out', 'codex login'],
    ['mcp', 'unsafe-tools', 'MCP'],
    ['nostatus', 'unsafe-tools', 'MCP'],
    ['usage', 'rate-limit', '부터 다시 쓸 수 있습니다'],
  ] as const) {
    it(`${mode} → ${kind}`, async () => {
      const { log, deps } = rig(FAKE_CODEX, 'codex', { FAKE_CODEX_MODE: mode });
      const err = await createCodexProvider({ model: 'm', cli_path: '' }, 5000, deps as CodexDeps).chat(req()).catch((e) => e);
      expect(err).toBeInstanceOf(CliRunError);
      expect(err.kind).toBe(kind);
      expect(err.message).toContain(text);
      // 문서 글은 보내지 않았다 (계정·MCP 확인에서 멈춤)
      if (mode !== 'usage') expect(readLog(log).some((e) => e.method === 'turn/start')).toBe(false);
      expect(await stopped(log)).toBe(true);
    });
  }

  it('차례 안에서 Codex 자신의 도구(명령 실행)를 쓰기 시작하면 끊고 프로세스를 끝낸다', async () => {
    const { log, deps } = rig(FAKE_CODEX, 'codex', { FAKE_CODEX_MODE: 'toolitem' });
    const err = await createCodexProvider({ model: 'm', cli_path: '' }, 5000, deps as CodexDeps).chat(req()).catch((e) => e);
    expect(err.kind).toBe('unsafe-tools');
    expect(err.message).toContain('commandExecution');
    expect(await stopped(log)).toBe(true);
  });

  it('initialize 중에 취소해도 프로세스를 끝낸다', async () => {
    const { log, deps } = rig(FAKE_CODEX, 'codex', { FAKE_CODEX_MODE: 'noinit' });
    const ctl = new AbortController();
    const run = createCodexProvider({ model: 'm', cli_path: '' }, 5000, deps as CodexDeps).chat(req({ signal: ctl.signal }));
    const until = Date.now() + 6000;
    while (!readLog(log).some((e) => e.method === 'initialize') && Date.now() < until) await new Promise((r) => setTimeout(r, 50));
    ctl.abort();
    expect((await run.catch((e) => e)).name).toBe('AbortError');
    expect(await stopped(log)).toBe(true);
  });

  it('응답이 멈추면 끊고 프로세스를 끝낸다', async () => {
    const { log, deps } = rig(FAKE_CODEX, 'codex', { FAKE_CODEX_MODE: 'hang' });
    const err = await createCodexProvider({ model: 'm', cli_path: '' }, 600, deps as CodexDeps).chat(req()).catch((e) => e);
    expect(err.kind).toBe('timeout');
    expect(await stopped(log)).toBe(true);
  });

  it('모델 목록은 model/list 만 (스레드를 열지 않음, 숨긴 모델 제외)', async () => {
    const { log, deps } = rig(FAKE_CODEX, 'codex', { FAKE_CODEX_MODE: 'ok' });
    const models = await listCodexModels({ model: '', cli_path: '' }, AbortSignal.timeout(5000), deps as CodexDeps);
    expect(models).toEqual([{ id: 'gpt-5.5-codex', label: 'GPT-5.5 Codex' }, { id: 'gpt-5.5-mini', label: 'Mini' }]);
    expect(readLog(log).some((e) => e.method === 'thread/start' || e.method === 'turn/start')).toBe(false);
  });
});

describe('로그인 상태 — 프로그램 자신의 답으로, 계정은 옮기지 않는다', () => {
  it('claude auth status: 구독·종량제·로그아웃, 이메일·조직 이름은 결과에 없다', () => {
    const sub = parseClaudeAuthStatus('{"loggedIn":true,"authMethod":"claude.ai","apiProvider":"firstParty","subscriptionType":"max","email":"kim@example.com","orgName":"가온시청"}');
    expect(sub).toEqual({ signedIn: true, method: 'subscription', plan: 'max' });
    expect(parseClaudeAuthStatus('{"loggedIn":true,"authMethod":"api_key","apiProvider":"firstParty"}')).toEqual({ signedIn: true, method: 'metered' });
    expect(parseClaudeAuthStatus('{"loggedIn":true,"authMethod":"claude.ai","apiProvider":"bedrock","subscriptionType":"max"}')).toEqual({ signedIn: true, method: 'metered' });
    expect(parseClaudeAuthStatus('{"loggedIn":true,"authMethod":"oauth_token"}')).toEqual({ signedIn: true, method: 'unknown' });
    expect(parseClaudeAuthStatus('{"loggedIn":false}')).toEqual({ signedIn: false });
    expect(parseClaudeAuthStatus('이상한 출력')).toBeNull();
  });

  it('codex login status 의 알려진 줄만', () => {
    expect(parseCodexLoginStatus('Logged in using ChatGPT')).toEqual({ signedIn: true, method: 'subscription' });
    expect(parseCodexLoginStatus('Logged in using an API key - sk-proj-***ABCD')).toEqual({ signedIn: true, method: 'metered' });
    expect(parseCodexLoginStatus('Not logged in')).toEqual({ signedIn: false });
    expect(parseCodexLoginStatus('Logged in using something new')).toEqual({ signedIn: true, method: 'unknown' });
  });

  it('가짜 claude 로 상태 확인: ready + 버전, 결과 어디에도 이메일 없음 / 종량제면 할 일 / 없으면 설치 안내', async () => {
    const locate = async () => program('claude-code', FAKE_CLAUDE);
    const ready = await detectSubscriptionLogin('claude-code', { locate });
    expect(ready).toMatchObject({ provider: 'claude-code', state: 'ready', version: '2.1.300', plan: 'max', login_command: 'claude' });
    expect(JSON.stringify(ready)).not.toContain('kim@');
    process.env.FAKE_CLAUDE_AUTH = 'apikey';
    try {
      const metered = await detectSubscriptionLogin('claude-code', { locate });
      expect(metered.state).toBe('metered');
      expect(metered.message).toMatch(/요금/);
      await expect(assertSubscriptionLogin('claude-code', program('claude-code', FAKE_CLAUDE))).rejects.toMatchObject({ kind: 'metered' });
    } finally {
      delete process.env.FAKE_CLAUDE_AUTH;
    }
    const missing = await detectSubscriptionLogin('codex', { locate: async () => null });
    expect(missing).toMatchObject({ state: 'not-installed', login_command: 'codex login' });
    expect(missing.message).toMatch(/설치/);
  });
});

describe('프로그램 찾기·환경', () => {
  it.runIf(process.platform === 'win32')('Windows: npm .cmd 껍데기는 띄우지 않고 그 뒤의 claude.exe 를 찾는다', async () => {
    const dir = mkdtempSync(join(work, 'npm-'));
    const exe = join(dir, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
    mkdirSync(join(exe, '..'), { recursive: true });
    writeFileSync(exe, '');
    writeFileSync(join(dir, 'claude.cmd'), '@ECHO off\r\n"%dp0%\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe" %*\r\n');
    const p = await locateSubscriptionProgram('claude-code', { platform: 'win32', env: { PATH: dir, USERPROFILE: dir } });
    expect(p).toMatchObject({ command: exe, prefixArgs: [], source: 'path' });
  });

  it('Codex npm 입구(bin/codex.js)면 그것이 고르는 네이티브 실행 파일을 바로 띄운다', async () => {
    const root = mkdtempSync(join(work, 'codex-'));
    const pkg = join(root, '@openai', 'codex');
    const entry = join(pkg, 'bin', 'codex.js');
    mkdirSync(join(entry, '..'), { recursive: true });
    writeFileSync(entry, '');
    const triple = `${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}-${process.platform === 'win32' ? 'pc-windows-msvc' : process.platform === 'darwin' ? 'apple-darwin' : 'unknown-linux-musl'}`;
    const bin = join(pkg, 'node_modules', '@openai', `codex-${process.platform}-${process.arch}`, 'vendor', triple, 'bin', process.platform === 'win32' ? 'codex.exe' : 'codex');
    mkdirSync(join(bin, '..'), { recursive: true });
    writeFileSync(bin, '');
    chmodSync(bin, 0o755);
    const p = await locateSubscriptionProgram('codex', { configuredPath: entry, env: { PATH: '' }, managedInstallRoot: join(root, 'none'), commonDirs: [] });
    expect(p).toMatchObject({ command: bin, prefixArgs: [], env: { CODEX_MANAGED_BY_NPM: '1', CODEX_MANAGED_PACKAGE_ROOT: pkg } });
  });

  it('없으면 null (설정한 위치가 없어도 PATH 로 넘어가 찾는다)', async () => {
    expect(await locateSubscriptionProgram('claude-code', { configuredPath: join(work, 'nope', 'claude'), env: { PATH: '', USERPROFILE: work, HOME: work }, commonDirs: [] })).toBeNull();
  });

  it('자식 환경: 다른 요금 경로 변수를 뺀다 (Windows 는 대소문자 무시), PATH 앞에 프로그램 폴더', () => {
    const env = subscriptionChildEnv({ base: { Anthropic_Api_Key: 'a', OPENAI_BASE_URL: 'b', CLAUDE_CODE_USE_BEDROCK: '1', KEEP: 'k', Path: 'C:\\x' }, platform: 'win32', command: 'C:\\tools\\claude.exe' });
    expect(env).toEqual({ KEEP: 'k', Path: `C:\\tools${delimiter}C:\\x` });
    expect(subscriptionChildEnv({ base: { ANTHROPIC_API_KEY: 'a', anthropic_api_key: 'lower' }, platform: 'linux' })).toEqual({ anthropic_api_key: 'lower' });
  });
});

// 시험이 띄운 가짜가 하나도 남지 않았는지 (모든 길에서 프로세스를 끝냈는가) 본 뒤 치운다
afterAll(async () => {
  const logs = Array.from({ length: logN }, (_, i) => join(work, `log-${i + 1}.jsonl`));
  const pids = [...new Set(logs.flatMap((f) => readLog(f).filter((e) => e.kind === 'start').map((e) => e.pid!)))];
  for (const pid of pids) expect(await gone(pid, 3000)).toBe(true);
  rmSync(work, { recursive: true, force: true });
});
