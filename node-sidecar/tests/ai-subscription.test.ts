/** 구독 계정(Claude Code·Codex) 다리: 가짜 프로그램(tests/fixtures/fake-*.mjs)으로만. 실제 claude·codex 는 구독 사용량을 쓴다
 *
 * 고정 인자(도구 0개), stdin 으로만 가는 글, 자식 환경 허용 목록, 도구가 보이면 끝내기, 실패 → 할 일,
 * 시간 제한·취소 때 프로세스 트리 끝내기, 로그인 상태(계정 정보를 옮기지 않음), 프로그램 찾기
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';
import { updateSettings } from '../src/infra/config.js';
import { netLogSnapshot, OfflineBlockedError } from '../src/infra/net-guard.js';
import { claudeArgs, createClaudeCodeProvider, listClaudeCodeModels, type SubscriptionDeps } from '../src/infra/llm/claude-code.js';
import { createCodexProvider, forgetCodexSafety, listCodexModels, strictSchema } from '../src/infra/llm/codex.js';
import { createGeminiCliProvider, geminiArgs, listGeminiCliModels } from '../src/infra/llm/gemini-cli.js';
import { SubscriptionError, type SubscriptionProviderId } from '../src/infra/llm/subscription/errors.js';
import { checkLogin, forgetLogins, readClaudeAuth, readCodexLogin, requireSubscription } from '../src/infra/llm/subscription/login.js';
import { appDirs, childEnv, cmdShimTarget, findProgram, sweepStaleTempDirs, type Program, type SpawnFn } from '../src/infra/llm/subscription/program.js';
import type { ChatRequest } from '../src/infra/llm/types.js';
import { tempDir } from './tmp-dirs.js';

process.env.KORDOC_AI_DATA_DIR = tempDir('kordoc-ai-sub-');
const FAKE_CLAUDE = fileURLToPath(new URL('./fixtures/fake-claude.mjs', import.meta.url));
const FAKE_CODEX = fileURLToPath(new URL('./fixtures/fake-codex.mjs', import.meta.url));
const FAKE_GEMINI = fileURLToPath(new URL('./fixtures/fake-gemini.mjs', import.meta.url));
// macOS tmpdir 은 /var → /private/var 심링크: 실경로로 비교
const work = realpathSync(tempDir('kordoc-ai-sub-work-'));
let logN = 0;

/** 가짜를 동봉 Node 로 띄우는 프로그램. FAKE_* 는 허용 목록에 없어 program.env 로 넣는다 */
const program = (provider: SubscriptionProviderId, script: string, env: Record<string, string> = {}): Program => ({ provider, command: process.execPath, lead: [script], entry: script, env });
type Entry = { kind: string; pid?: number; args?: string[]; cwd?: string; env?: Record<string, string | null>; line?: string; text?: string; schema?: string | null; images?: Array<{ path: string; exists: boolean }>; settings?: string | null; policy?: string | null; system?: string | null };
const readLog = (file: string): Entry[] => (existsSync(file) ? readFileSync(file, 'utf-8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function gone(pid: number, ms = 5000) {
  const until = Date.now() + ms;
  while (alive(pid) && Date.now() < until) await new Promise((r) => setTimeout(r, 50));
  return !alive(pid);
}
const lastRun = (log: string) => readLog(log).filter((e) => e.kind === 'run').at(-1)!;

/** 가짜 프로그램·기록 파일, 띄운 모양을 엿보는 spawn, 다른 요금 경로 키가 든 환경 */
function rig(script: string, provider: SubscriptionProviderId, env: Record<string, string>) {
  const log = join(work, `log-${++logN}.jsonl`);
  const spawned: Array<{ args: string[]; shell: unknown }> = [];
  const deps: SubscriptionDeps = {
    find: async () => program(provider, script, { ...env, FAKE_LOG: log }),
    login: async () => {},
    baseEnv: { ...process.env, ANTHROPIC_API_KEY: 'sk-ant-x', OPENAI_API_KEY: 'sk-x', CODEX_API_KEY: 'x', NODE_OPTIONS: '--max-old-space-size=4000', KORDOC_SECRET: 's' },
    spawn: ((command: string, args: string[], opts: Parameters<typeof spawn>[2]) => {
      spawned.push({ args, shell: opts.shell });
      return spawn(command, args, opts);
    }) as unknown as SpawnFn,
  };
  return { log, spawned, deps };
}

const req = (over: Partial<ChatRequest> = {}): ChatRequest & { tokens: string[] } => {
  const tokens: string[] = [];
  return { messages: [{ role: 'user', content: '가온시 민원 처리 현황을 요약하세요' }], signal: new AbortController().signal, onToken: (t) => tokens.push(t), tokens, ...over };
};
const failOf = (p: Promise<unknown>) => p.then(() => { throw new Error('실패해야 함'); }, (e) => e);

beforeAll(async () => { await updateSettings({ privacy: { offline: false } }); });
beforeEach(() => { forgetLogins(); forgetCodexSafety(); });

describe('Claude Code', () => {
  it('고정 인자: 도구 0개·MCP·사용자 설정·슬래시 명령 끔, 허락 없는 일 거절. 가변 값은 지시문 파일과 모델 이름뿐', () => {
    const a = claudeArgs('sonnet', '/w/system.txt');
    for (const f of ['-p', '--strict-mcp-config', '--disable-slash-commands', '--no-session-persistence', '--restricted']) expect(a).toContain(f);
    expect(a[a.indexOf('--tools') + 1]).toBe('');
    expect(a[a.indexOf('--setting-sources') + 1]).toBe('');
    expect(a[a.indexOf('--permission-mode') + 1]).toBe('dontAsk');
    expect(a).not.toContain('--json-schema');
    expect(a.slice(-4)).toEqual(['--system-prompt-file', '/w/system.txt', '--model', 'sonnet']);
    expect(claudeArgs('', 'f')).not.toContain('--model');
    expect(() => claudeArgs('--dangerously-skip-permissions', 'f')).toThrow(SubscriptionError);
  });

  it('글은 stdin·작업 폴더 파일로만, 셸 없이, 허용 목록 환경, 새 빈 폴더(끝나면 지움). 글 조각만 흘린다', async () => {
    const { log, spawned, deps } = rig(FAKE_CLAUDE, 'claude-code', { FAKE_CLAUDE_MODE: 'ok' });
    const r = req({ system: '당신은 공문 비서입니다', messages: [{ role: 'user', content: '앞 질문' }, { role: 'assistant', content: '앞 답' }, { role: 'user', content: '가온시 민원 처리 현황을 요약하세요' }] });
    expect(await createClaudeCodeProvider({ model: 'sonnet', cli_path: '' }, 5000, deps).chat(r)).toBe('안녕하세요');
    expect(r.tokens.join('')).toBe('안녕하세요'); // 생각 조각은 버린다
    expect(spawned[0].shell).toBe(false);
    expect(spawned[0].args.join(' ')).not.toMatch(/가온시|공문 비서/);
    const run = lastRun(log);
    expect(run.env).toEqual({ ANTHROPIC_API_KEY: null, OPENAI_API_KEY: null, CODEX_API_KEY: null, NODE_OPTIONS: null, KORDOC_SECRET: null, DISABLE_AUTOUPDATER: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' });
    expect(run.cwd).toMatch(/kordoc-sub-/);
    const system = readLog(log).find((e) => e.kind === 'system')!.text!;
    expect(system).toMatch(/도구는 없습니다/);
    expect(system).toContain('당신은 공문 비서입니다');
    const user = JSON.parse(readLog(log).find((e) => e.kind === 'stdin')!.line!);
    expect(user.type).toBe('user');
    const text = user.message.content.at(-1).text as string;
    expect(text).toContain('<assistant>\n앞 답');
    expect(text.endsWith('가온시 민원 처리 현황을 요약하세요')).toBe(true);
    expect(existsSync(run.cwd!)).toBe(false);
  });

  it('그림은 같은 사용자 메시지의 image 블록으로', async () => {
    const { log, deps } = rig(FAKE_CLAUDE, 'claude-code', { FAKE_CLAUDE_MODE: 'ok' });
    await createClaudeCodeProvider({ model: '', cli_path: '' }, 5000, deps).chat(req({ messages: [{ role: 'user', content: '이 그림', images: [{ mime: 'image/png', base64: 'AAAA' }] }] }));
    const content = JSON.parse(readLog(log).find((e) => e.kind === 'stdin')!.line!).message.content;
    expect(content[0]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } });
  });

  it('schema 는 지시문의 <response_schema> 로 (--json-schema 는 도구를 하나 만들어 쓰지 않는다)', async () => {
    const { log, spawned, deps } = rig(FAKE_CLAUDE, 'claude-code', { FAKE_CLAUDE_MODE: 'ok', FAKE_CLAUDE_REPLY: '{"a":"1"}' });
    expect(await createClaudeCodeProvider({ model: '', cli_path: '' }, 5000, deps).chat(req({ schema: { type: 'object', properties: { a: { type: 'string' } } }, json: true }))).toBe('{"a":"1"}');
    expect(spawned[0].args).not.toContain('--json-schema');
    expect(readLog(log).find((e) => e.kind === 'system')!.text).toMatch(/<response_schema>\n\{"type":"object"/);
  });

  for (const [mode, kind, why] of [
    ['tools', 'unsafe-tools', '도구 2개가 켜져 있음'],
    ['mcp', 'unsafe-tools', 'MCP 서버 1개'],
    ['early', 'unsafe-tools', '시작 보고 전에'],
    ['permission', 'unsafe-tools', '허락을 물음'],
    ['apikey', 'metered', '쓴 만큼 요금'],
    ['nokeysrc', 'needs-update', '로그인 방식을 알려 주지 않음'],
    ['noinit', 'unsafe-tools', '시작 보고 전에'],
    ['servertool', 'unsafe-tools', '도구를 쓰려 함'],
    ['userevent', 'unsafe-tools', '도구 결과가 돌아옴'],
  ] as const) {
    it(`시작 보고가 안전하지 않으면 답 전에 끝낸다: ${mode}`, async () => {
      const { log, deps } = rig(FAKE_CLAUDE, 'claude-code', { FAKE_CLAUDE_MODE: mode });
      const err = await failOf(createClaudeCodeProvider({ model: '', cli_path: '' }, 5000, deps).chat(req()));
      expect(err).toBeInstanceOf(SubscriptionError);
      expect(err.kind).toBe(kind);
      expect(err.message).toContain(why);
      expect(alive(lastRun(log).pid!)).toBe(false); // 끝난 뒤에 알린다
    });
  }

  it('로그인 안 됨 → claude 로 로그인하라는 안내, 프로그램이 찍은 계정 이메일은 없다', async () => {
    const { deps } = rig(FAKE_CLAUDE, 'claude-code', { FAKE_CLAUDE_MODE: 'auth' });
    const err = await failOf(createClaudeCodeProvider({ model: '', cli_path: '' }, 5000, deps).chat(req()));
    expect(err.kind).toBe('signed-out');
    expect(err.message).toMatch(/로그인되어 있지 않습니다.*claude 명령을 실행해/);
    expect(err.message).not.toContain('kim@example.com');
  });

  it('답을 받은 뒤 프로세스가 안 끝나도 답을 돌려주고 끝낸다, 빈 답은 실패', async () => {
    const linger = rig(FAKE_CLAUDE, 'claude-code', { FAKE_CLAUDE_MODE: 'linger' });
    expect(await createClaudeCodeProvider({ model: '', cli_path: '' }, 1000, linger.deps).chat(req())).toBe('안녕하세요');
    expect(await gone(lastRun(linger.log).pid!)).toBe(true);
    const empty = rig(FAKE_CLAUDE, 'claude-code', { FAKE_CLAUDE_MODE: 'empty' });
    expect(await failOf(createClaudeCodeProvider({ model: '', cli_path: '' }, 5000, empty.deps).chat(req()))).toMatchObject({ kind: 'failed', message: expect.stringContaining('빈 답') });
  });

  it('다시 시도한 답이면 마지막 시도의 답 전체', async () => {
    const { deps } = rig(FAKE_CLAUDE, 'claude-code', { FAKE_CLAUDE_MODE: 'retry' });
    expect(await createClaudeCodeProvider({ model: '', cli_path: '' }, 5000, deps).chat(req())).toBe('다시 쓴 답입니다');
  });

  it('너무 긴 문서·사용량 한도(다시 쓸 시각)', async () => {
    const long = rig(FAKE_CLAUDE, 'claude-code', { FAKE_CLAUDE_MODE: 'toolong' });
    expect(await failOf(createClaudeCodeProvider({ model: '', cli_path: '' }, 5000, long.deps).chat(req()))).toMatchObject({ kind: 'too-long', message: expect.stringMatching(/^문서가 너무 깁니다/) });
    const limit = rig(FAKE_CLAUDE, 'claude-code', { FAKE_CLAUDE_MODE: 'ratelimit' });
    expect(await failOf(createClaudeCodeProvider({ model: '', cli_path: '' }, 5000, limit.deps).chat(req()))).toMatchObject({ kind: 'rate-limit', message: expect.stringMatching(/\d\d:\d\d부터 다시 쓸 수 있습니다/) });
  });

  it('응답이 멈추면 시간 제한으로 끊고 프로세스를 끝낸다, 취소하면 AbortError', async () => {
    const slow = rig(FAKE_CLAUDE, 'claude-code', { FAKE_CLAUDE_MODE: 'hang' });
    const err = await failOf(createClaudeCodeProvider({ model: '', cli_path: '' }, 600, slow.deps).chat(req()));
    expect(err.kind).toBe('timeout');
    expect(err.message).toMatch(/초 동안 응답하지 않아 멈췄습니다/);
    expect(await gone(lastRun(slow.log).pid!)).toBe(true);
    const held = rig(FAKE_CLAUDE, 'claude-code', { FAKE_CLAUDE_MODE: 'hang' });
    const ctl = new AbortController();
    const run = failOf(createClaudeCodeProvider({ model: '', cli_path: '' }, 8000, held.deps).chat(req({ signal: ctl.signal })));
    const until = Date.now() + 6000;
    while (!readLog(held.log).some((e) => e.kind === 'stdin') && Date.now() < until) await new Promise((r) => setTimeout(r, 50));
    ctl.abort();
    expect((await run).name).toBe('AbortError');
    expect(await gone(lastRun(held.log).pid!)).toBe(true);
  });

  it('낡은 버전(모르는 옵션) → claude update 안내, 그냥 끝나면 종료 코드', async () => {
    const old = rig(FAKE_CLAUDE, 'claude-code', { FAKE_CLAUDE_MODE: 'old' });
    const e1 = await failOf(createClaudeCodeProvider({ model: '', cli_path: '' }, 5000, old.deps).chat(req()));
    expect(e1.kind).toBe('needs-update');
    expect(e1.message).toContain('claude update');
    const exit = rig(FAKE_CLAUDE, 'claude-code', { FAKE_CLAUDE_MODE: 'exit' });
    expect((await failOf(createClaudeCodeProvider({ model: '', cli_path: '' }, 5000, exit.deps).chat(req()))).message).toContain('종료 코드 3');
  });

  it('모델 목록은 공식 별칭 (프로그램을 띄우지 않음, 기본 모델은 빈 id)', async () => {
    const models = await listClaudeCodeModels({ model: '', cli_path: '' }, AbortSignal.timeout(1000));
    expect(models[0].id).toBe('');
    expect(models.map((m) => m.id)).toEqual(expect.arrayContaining(['opus', 'sonnet', 'haiku']));
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

describe('Codex', () => {
  const runs = (log: string) => readLog(log).filter((e) => e.kind === 'run');

  it('exec 고정 인자·사용자 설정 무시·읽기 샌드박스·도구 기능 끄기, 글은 stdin, 답은 마지막 글. 기능 확인은 한 번만', async () => {
    const { log, spawned, deps } = rig(FAKE_CODEX, 'codex', { FAKE_CODEX_MODE: 'ok' });
    const p = createCodexProvider({ model: '', cli_path: '' }, 5000, deps);
    const r = req({ system: '공문 비서' });
    expect(await p.chat(r)).toBe('안녕하세요');
    expect(r.tokens.join('')).toBe('안녕하세요');
    expect(spawned.every((s) => s.shell === false)).toBe(true);
    const exec = runs(log).find((e) => e.args![0] === 'exec')!;
    const a = exec.args!;
    for (const f of ['--json', '--ignore-user-config', '--ignore-rules', '--ephemeral', '--skip-git-repo-check', 'approval_policy="never"', 'web_search="disabled"']) expect(a).toContain(f);
    expect(a[a.indexOf('--sandbox') + 1]).toBe('read-only');
    for (const f of ['shell_tool', 'view_image', 'apps', 'plugins']) expect(a.join(' ')).toContain(`--disable ${f}`);
    expect(a.join(' ')).not.toContain('search_tool'); // 없어진 기능은 건드리지 않는다
    expect(a.at(-1)).toBe('-');
    expect(a.join(' ')).not.toMatch(/가온시|공문 비서/);
    expect(exec.env).toMatchObject({ OPENAI_API_KEY: null, CODEX_API_KEY: null, NODE_OPTIONS: null, KORDOC_SECRET: null });
    const stdin = readLog(log).find((e) => e.kind === 'stdin')!.text!;
    expect(stdin).toContain('<instructions>\n공문 비서');
    expect(stdin).toContain('가온시 민원 처리 현황');
    await p.chat(req());
    expect(runs(log).filter((e) => e.args![0] === 'features')).toHaveLength(2);
    expect(existsSync(exec.cwd!)).toBe(false);
  });

  it('schema → --output-schema 파일, 모델 이름', async () => {
    const { log, deps } = rig(FAKE_CODEX, 'codex', { FAKE_CODEX_MODE: 'ok' });
    const schema = { type: 'object', properties: { a: { type: 'string' } }, required: ['a'], additionalProperties: false };
    expect(await createCodexProvider({ model: 'gpt-test', cli_path: '' }, 5000, deps).chat(req({ schema, json: true }))).toBe('{"a":"1"}');
    expect(JSON.parse(readLog(log).find((e) => e.kind === 'stdin')!.schema!)).toEqual(schema);
    const a = runs(log).find((e) => e.args![0] === 'exec')!.args!;
    expect(a[a.indexOf('--model') + 1]).toBe('gpt-test');
  });

  for (const [mode, kind, text] of [
    ['oldcodex', 'needs-update', '셸 도구를 끄는 설정이 없음'],
    ['stuck', 'unsafe-tools', 'shell_tool 기능이 꺼지지 않음'],
  ] as const) {
    it(`도구 기능을 못 끄면 보내지 않는다: ${mode}`, async () => {
      const { log, deps } = rig(FAKE_CODEX, 'codex', { FAKE_CODEX_MODE: mode });
      const err = await failOf(createCodexProvider({ model: '', cli_path: '' }, 5000, deps).chat(req()));
      expect(err).toMatchObject({ kind, message: expect.stringContaining(text) });
      expect(runs(log).some((e) => e.args![0] === 'exec')).toBe(false);
    });
  }

  for (const [mode, kind, text] of [
    ['usage', 'rate-limit', '잠시 뒤'],
    ['toolong', 'too-long', '문서가 너무 깁니다'],
    ['signedout', 'signed-out', 'codex login'],
    ['server', 'server-error', '서버에 오류'],
    ['badflag', 'needs-update', 'codex update'],
  ] as const) {
    it(`${mode} → ${kind}`, async () => {
      const { deps } = rig(FAKE_CODEX, 'codex', { FAKE_CODEX_MODE: mode });
      expect(await failOf(createCodexProvider({ model: '', cli_path: '' }, 5000, deps).chat(req()))).toMatchObject({ kind, message: expect.stringContaining(text) });
    });
  }

  it('계획 항목은 도구가 아니다, 끝 알림 뒤 안 끝나도 답을 돌려준다, 빈 답은 실패', async () => {
    const todo = rig(FAKE_CODEX, 'codex', { FAKE_CODEX_MODE: 'todo' });
    expect(await createCodexProvider({ model: '', cli_path: '' }, 5000, todo.deps).chat(req())).toBe('안녕하세요');
    const linger = rig(FAKE_CODEX, 'codex', { FAKE_CODEX_MODE: 'linger' });
    expect(await createCodexProvider({ model: '', cli_path: '' }, 1000, linger.deps).chat(req())).toBe('안녕하세요');
    expect(await gone(runs(linger.log).find((e) => e.args![0] === 'exec')!.pid!)).toBe(true);
    const empty = rig(FAKE_CODEX, 'codex', { FAKE_CODEX_MODE: 'empty' });
    expect(await failOf(createCodexProvider({ model: '', cli_path: '' }, 5000, empty.deps).chat(req()))).toMatchObject({ kind: 'failed', message: expect.stringContaining('빈 답') });
  });

  it('동시에 보낸 두 요청 중 하나를 취소해도 다른 하나는 기능 확인을 마치고 답을 받는다', async () => {
    const { deps } = rig(FAKE_CODEX, 'codex', { FAKE_CODEX_MODE: 'slowfeatures' });
    const p = createCodexProvider({ model: '', cli_path: '' }, 5000, deps);
    const ctl = new AbortController();
    const first = failOf(p.chat(req({ signal: ctl.signal })));
    const second = p.chat(req());
    setTimeout(() => ctl.abort(), 100);
    expect((await first).name).toBe('AbortError');
    expect(await second).toBe('안녕하세요');
  });

  it('실행 중 명령 실행 항목이 보이면 끊고, 끝난 뒤에 알린다', async () => {
    const { log, deps } = rig(FAKE_CODEX, 'codex', { FAKE_CODEX_MODE: 'toolitem' });
    const err = await failOf(createCodexProvider({ model: '', cli_path: '' }, 5000, deps).chat(req()));
    expect(err).toMatchObject({ kind: 'unsafe-tools', message: expect.stringContaining('명령 실행 항목') });
    expect(err.message).not.toContain('command_execution'); // 프로그램 원문은 문장에 넣지 않는다
    expect(alive(runs(log).find((e) => e.args![0] === 'exec')!.pid!)).toBe(false);
  });

  it('그림은 작업 폴더 파일(--image)로, 답을 돌려주기 전에 폴더를 지운다', async () => {
    const { log, deps } = rig(FAKE_CODEX, 'codex', { FAKE_CODEX_MODE: 'ok' });
    await createCodexProvider({ model: '', cli_path: '' }, 5000, deps).chat(req({ messages: [{ role: 'user', content: '이 그림', images: [{ mime: 'image/png', base64: 'AAAA' }] }] }));
    const exec = runs(log).find((e) => e.args![0] === 'exec')!;
    const images = readLog(log).find((e) => e.kind === 'stdin')!.images!;
    const bare = (p: string) => p.replace(/^\/private(?=\/var\/)/, ''); // macOS /var 은 /private/var 심링크 (폴더는 이미 지워져 실경로를 못 구한다)
    expect(images.map((i) => [bare(i.path), i.exists])).toEqual([[bare(join(exec.cwd!, 'image-1.png')), true]]);
    expect(existsSync(exec.cwd!)).toBe(false);
  });

  it('응답이 멈추면 끊고 프로세스를 끝낸다', async () => {
    const { log, deps } = rig(FAKE_CODEX, 'codex', { FAKE_CODEX_MODE: 'hang' });
    expect((await failOf(createCodexProvider({ model: '', cli_path: '' }, 600, deps).chat(req()))).kind).toBe('timeout');
    expect(await gone(runs(log).find((e) => e.args![0] === 'exec')!.pid!)).toBe(true);
  });

  it('모델 목록은 debug models 중 보이는 것, 우선순위 차례, 맨 앞은 기본 모델', async () => {
    const { deps } = rig(FAKE_CODEX, 'codex', { FAKE_CODEX_MODE: 'ok' });
    expect(await listCodexModels({ model: '', cli_path: '' }, AbortSignal.timeout(5000), deps)).toEqual([
      { id: '', label: '기본 모델 (Codex 기본값)' }, { id: 'gpt-test', label: 'Test' }, { id: 'gpt-test-mini', label: 'Test Mini' },
    ]);
  });
});

describe('Gemini CLI', () => {
  /** 가짜가 대화 기록을 남길 집 폴더 (진짜 ~/.gemini 는 건드리지 않는다). Gemini·Google 키가 든 환경 */
  const grig = (mode: string) => {
    const r = rig(FAKE_GEMINI, 'gemini-cli', { FAKE_GEMINI_MODE: mode });
    const home = mkdtempSync(join(work, 'home-'));
    r.deps.baseEnv = { ...r.deps.baseEnv, USERPROFILE: home, HOME: home, GEMINI_API_KEY: 'g-key', GOOGLE_API_KEY: 'gk', GOOGLE_GENAI_USE_VERTEXAI: 'true' };
    return { ...r, home };
  };
  const gp = (model = '') => ({ model, cli_path: '' });
  const files = (log: string) => readLog(log).find((e) => e.kind === 'files')!;

  it('고정 인자: 헤드리스 stream-json, 모두 거절 정책(관리자·사용자 단계), 확장·MCP 끔, 모델은 -m 만', () => {
    const a = geminiArgs({ dir: '/w', model: 'flash' });
    expect(a.slice(0, 2)).toEqual(['-p', '']);
    expect(a[a.indexOf('-o') + 1]).toBe('stream-json');
    expect(a[a.indexOf('--approval-mode') + 1]).toBe('default');
    expect(a[a.indexOf('--admin-policy') + 1]).toBe(a[a.indexOf('--policy') + 1]);
    expect(a[a.indexOf('-e') + 1]).toBe('none');
    expect(a[a.indexOf('--allowed-mcp-server-names') + 1]).toBe('kordoc-no-mcp');
    expect(a.slice(-2)).toEqual(['-m', 'flash']);
    expect(geminiArgs({ dir: '/w', model: '' })).not.toContain('-m');
    expect(a).not.toContain('--yolo');
    expect(() => geminiArgs({ dir: '/w', model: '--yolo' })).toThrow(SubscriptionError);
  });

  it('글은 stdin(@ 는 \\@ 로), 지시문·설정·정책은 작업 폴더 파일, 셸 없이, 키 변수는 안 넘김, 대화 기록은 지운다', async () => {
    const { log, spawned, deps, home } = grig('ok');
    // 다른 프로젝트의 기록은 남아야 한다
    const other = join(home, '.gemini', 'tmp', 'my-project', 'chats');
    mkdirSync(other, { recursive: true });
    writeFileSync(join(other, 'session-keep.json'), '{}');
    const r = req({ system: '당신은 공문 비서입니다', messages: [{ role: 'user', content: '가온시 민원 처리 현황을 요약하고 kim@example.com 에 보내세요 @C:/Windows/win.ini' }] });
    expect(await createGeminiCliProvider(gp('flash'), 5000, deps).chat(r)).toBe('안녕하세요');
    expect(r.tokens.join('')).toBe('안녕하세요');
    expect(spawned[0].shell).toBe(false);
    expect(spawned[0].args.join(' ')).not.toMatch(/가온시|공문 비서/);
    const run = lastRun(log);
    expect(run.env).toMatchObject({ GEMINI_API_KEY: null, GOOGLE_API_KEY: null, GOOGLE_GENAI_USE_VERTEXAI: null, ANTHROPIC_API_KEY: null, NODE_OPTIONS: null, KORDOC_SECRET: null, NO_BROWSER: '1' });
    // 오류 보고 파일이 남지 않게 TEMP 는 매번 지우는 작업 폴더, 기록 자리가 쌓이지 않게 작업 폴더는 늘 같은 빈 폴더
    const runDir = run.env!.GEMINI_CLI_SYSTEM_SETTINGS_PATH!.replace(/[\\/]settings\.json$/, '');
    expect(run.env!.TEMP).toBe(runDir);
    expect(run.env!.GEMINI_SYSTEM_MD!.startsWith(runDir)).toBe(true);
    expect(run.cwd!.endsWith('kordoc-gemini-cwd')).toBe(true);
    expect(existsSync(runDir)).toBe(false);
    const f = files(log);
    const settings = JSON.parse(f.settings!);
    expect(settings.security.auth).toMatchObject({ selectedType: 'oauth-personal', enforcedType: 'oauth-personal' });
    expect(settings.admin).toMatchObject({ mcp: { enabled: false }, extensions: { enabled: false }, skills: { enabled: false } });
    expect(settings.tools).toMatchObject({ core: [], discoveryCommand: '', sandbox: false });
    expect(settings.hooksConfig.enabled).toBe(false);
    expect(settings.billing.overageStrategy).toBe('never');
    expect(f.policy).toMatch(/decision = "deny"/);
    expect(f.policy).not.toMatch(/toolName/); // 이름 없는 규칙 = 모든 도구
    expect(f.system).toMatch(/도구는 없습니다/);
    expect(f.system).toContain('당신은 공문 비서입니다');
    const stdin = readLog(log).find((e) => e.kind === 'stdin')!.text!;
    expect(stdin.startsWith('[KorDoc AI 요청]\n')).toBe(true);
    expect(stdin).toContain('kim\\@example.com');
    expect(stdin).toContain('\\@C:/Windows/win.ini');
    expect(stdin).not.toMatch(/(?<!\\)@/);
    expect(existsSync(join(home, '.gemini', 'tmp', 'kordoc-gemini-cwd', 'chats', 'session-2026-11-04T00-00-a1b2c3d4.json'))).toBe(false);
    expect(existsSync(join(other, 'session-keep.json'))).toBe(true);
  });

  it('답의 \\@ 는 @ 로 되돌린다, 여러 차례 대화는 한 글로', async () => {
    const { log, deps } = grig('at');
    const r = req({ messages: [{ role: 'user', content: '앞 질문' }, { role: 'assistant', content: '앞 답' }, { role: 'user', content: '보낼 곳' }] });
    expect(await createGeminiCliProvider(gp(), 5000, deps).chat(r)).toBe('kim@example.com 으로 보냅니다');
    expect(r.tokens.join('')).toBe('kim@example.com 으로 보냅니다');
    const stdin = readLog(log).find((e) => e.kind === 'stdin')!.text!;
    expect(stdin).toContain('<assistant>\n앞 답');
    expect(stdin).toMatch(/마지막 user 말에 답하세요\.$/);
  });

  for (const [mode, kind, text] of [
    ['tool', 'unsafe-tools', '도구를 쓰려 함'],
    ['early', 'unsafe-tools', '시작 보고 전에'],
    ['quota', 'rate-limit', '사용량 한도'],
    ['toolong', 'too-long', '문서가 너무 깁니다'],
    ['server', 'server-error', '서버에 오류'],
    ['badmodel', 'bad-request', '모델 칸을 비워'],
    ['auth', 'signed-out', 'gemini 명령을 실행해 Google 계정으로 로그인'],
    ['badflag', 'needs-update', 'npm install -g @google/gemini-cli@latest'],
    ['exit', 'failed', '종료 코드 3'],
    ['empty', 'failed', '빈 답'],
  ] as const) {
    it(`${mode} → ${kind}, 끝난 뒤에 알린다`, async () => {
      const { log, deps } = grig(mode);
      const err = await failOf(createGeminiCliProvider(gp(), 5000, deps).chat(req()));
      expect(err).toBeInstanceOf(SubscriptionError);
      expect(err).toMatchObject({ kind, message: expect.stringContaining(text) });
      expect(err.message).not.toMatch(/run_shell_command|exhausted|Requested entity/); // 프로그램 원문은 문장에 넣지 않는다
      expect(alive(lastRun(log).pid!)).toBe(false);
    });
  }

  it('끝 보고 뒤 안 끝나도 답을 돌려주고 끝낸다, 멈추면 시간 제한', async () => {
    const linger = grig('linger');
    expect(await createGeminiCliProvider(gp(), 1000, linger.deps).chat(req())).toBe('안녕하세요');
    expect(await gone(lastRun(linger.log).pid!)).toBe(true);
    const hang = grig('hang');
    expect((await failOf(createGeminiCliProvider(gp(), 600, hang.deps).chat(req()))).kind).toBe('timeout');
    expect(await gone(lastRun(hang.log).pid!)).toBe(true);
  });

  it('그림은 보내지 않는다 (띄우기 전에 거절)', async () => {
    const { spawned, deps } = grig('ok');
    const p = createGeminiCliProvider(gp(), 5000, deps);
    expect(p.supportsVision).toBe(false);
    expect(await failOf(p.chat(req({ messages: [{ role: 'user', content: '이 그림', images: [{ mime: 'image/png', base64: 'AAAA' }] }] })))).toMatchObject({ kind: 'bad-request' });
    expect(spawned).toHaveLength(0);
  });

  it('로그인 확인: 빈 입력 실행의 종료 코드(42 = 로그인됨, 41 = 안 됨), 같은 안전 인자, 계정 정보 없음', async () => {
    const log = join(work, `log-${++logN}.jsonl`);
    const ready = await checkLogin('gemini-cli', program('gemini-cli', FAKE_GEMINI, { FAKE_LOG: log }));
    expect(ready).toEqual({ provider: 'gemini-cli', login_command: 'gemini', state: 'ready', version: '0.35.0' });
    const probe = readLog(log).filter((e) => e.kind === 'run').at(-1)!;
    expect(probe.args).toContain('--admin-policy');
    expect(readLog(log).find((e) => e.kind === 'stdin')!.text).toBe('');
    const out = program('gemini-cli', FAKE_GEMINI, { FAKE_LOG: log, FAKE_GEMINI_AUTH: 'out' });
    expect(await checkLogin('gemini-cli', out)).toMatchObject({ state: 'signed-out', message: expect.stringContaining('Google 계정') });
    await expect(requireSubscription('gemini-cli', out)).rejects.toMatchObject({ kind: 'signed-out' });
  });

  it('모델 목록은 CLI 별칭·정식 이름 (프로그램을 띄우지 않음, 기본 모델은 빈 id)', async () => {
    const models = await listGeminiCliModels(gp(), AbortSignal.timeout(1000));
    expect(models[0].id).toBe('');
    expect(models.map((m) => m.id)).toEqual(expect.arrayContaining(['pro', 'flash', 'flash-lite', 'gemini-2.5-pro', 'gemini-2.5-flash']));
  });

  it('폐쇄망 모드면 띄우지 않고 막으며 통신 기록에 남긴다', async () => {
    await updateSettings({ privacy: { offline: true } });
    try {
      const { spawned, deps } = grig('ok');
      await expect(createGeminiCliProvider(gp(), 5000, deps).chat(req())).rejects.toBeInstanceOf(OfflineBlockedError);
      expect(spawned).toHaveLength(0);
      expect(netLogSnapshot().entries[0]).toMatchObject({ host: 'cloudcode-pa.googleapis.com (Gemini CLI)', external: true, allowed: false });
    } finally {
      await updateSettings({ privacy: { offline: false } });
    }
  });
});

describe('로그인 상태: 프로그램 자신의 답으로, 계정 정보는 옮기지 않는다', () => {
  it('claude auth status: 구독·종량제·로그아웃, 이메일·조직 이름은 결과에 없다', () => {
    expect(readClaudeAuth('{"loggedIn":true,"authMethod":"claude.ai","apiProvider":"firstParty","subscriptionType":"max","email":"kim@example.com","orgName":"가온시청"}')).toEqual({ signedIn: true, method: 'subscription', plan: 'max' });
    expect(readClaudeAuth('{"loggedIn":true,"authMethod":"api_key","apiProvider":"firstParty"}')).toEqual({ signedIn: true, method: 'metered' });
    expect(readClaudeAuth('{"loggedIn":true,"authMethod":"claude.ai","apiProvider":"bedrock"}')).toEqual({ signedIn: true, method: 'metered' });
    expect(readClaudeAuth('{"loggedIn":true,"authMethod":"oauth_token"}')).toEqual({ signedIn: true, method: 'unknown' });
    expect(readClaudeAuth('{"loggedIn":false,"authMethod":"none"}')).toEqual({ signedIn: false });
    expect(readClaudeAuth('이상한 출력')).toBeNull();
  });

  it('codex login status 의 알려진 줄만', () => {
    expect(readCodexLogin('Logged in using ChatGPT')).toEqual({ signedIn: true, method: 'subscription' });
    expect(readCodexLogin('Logged in using an API key - sk-proj-***ABCD')).toEqual({ signedIn: true, method: 'metered' });
    expect(readCodexLogin('Not logged in')).toEqual({ signedIn: false });
    expect(readCodexLogin('Logged in using something new')).toEqual({ signedIn: true, method: 'unknown' });
    expect(readCodexLogin('Logged in using Amazon Bedrock')).toEqual({ signedIn: true, method: 'metered' });
    expect(readCodexLogin('')).toBeNull();
  });

  it('가짜 프로그램으로: ready + 버전·요금제(이메일 없음) / 종량제는 보내기 전에 거절 / 없으면 설치 안내', async () => {
    const ready = await checkLogin('claude-code', program('claude-code', FAKE_CLAUDE));
    expect(ready).toEqual({ provider: 'claude-code', login_command: 'claude', state: 'ready', version: '2.1.302', plan: 'max' });
    const apikey = program('claude-code', FAKE_CLAUDE, { FAKE_CLAUDE_AUTH: 'apikey' });
    expect((await checkLogin('claude-code', apikey)).state).toBe('metered');
    await expect(requireSubscription('claude-code', apikey)).rejects.toMatchObject({ kind: 'metered' });
    expect(await checkLogin('codex', program('codex', FAKE_CODEX))).toMatchObject({ state: 'ready', version: '0.157.0' });
    await expect(requireSubscription('codex', program('codex', FAKE_CODEX, { FAKE_CODEX_AUTH: 'out' }))).rejects.toMatchObject({ kind: 'signed-out' });
    // 로그인 안 됨은 기억하지 않는다: 로그인한 뒤 바로 다시 확인된다
    const out = program('claude-code', FAKE_CLAUDE, { FAKE_CLAUDE_AUTH: 'out' });
    expect((await checkLogin('claude-code', out)).state).toBe('signed-out');
    expect((await checkLogin('claude-code', { ...out, env: { ...out.env } })).state).toBe('signed-out');
    const missing = await checkLogin('codex', null);
    expect(missing).toMatchObject({ state: 'not-installed', login_command: 'codex login', message: expect.stringMatching(/설치/) });
  });
});

describe('프로그램 찾기·환경·임시 폴더', () => {
  it('npm .cmd 껍데기: node.exe 말고 그것이 부르는 파일', () => {
    const f = join(work, 'codex.cmd');
    writeFileSync(f, '@ECHO off\r\nIF EXIST "%dp0%\\node.exe" (\r\n  SET "_prog=%dp0%\\node.exe"\r\n)\r\n"%_prog%"  "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*\r\n');
    expect(cmdShimTarget(f)!.endsWith('node_modules\\@openai\\codex\\bin\\codex.js')).toBe(true);
    writeFileSync(f, '@ECHO off\r\necho hi\r\n');
    expect(cmdShimTarget(f)).toBeNull();
  });

  it.runIf(process.platform === 'win32')('Windows: PATH 의 claude.cmd 뒤 claude.exe 를 셸 없이 띄울 모양으로', async () => {
    const dir = mkdtempSync(join(work, 'npm-'));
    const exe = join(dir, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
    mkdirSync(join(exe, '..'), { recursive: true });
    writeFileSync(exe, '');
    writeFileSync(join(dir, 'claude.cmd'), '@ECHO off\r\n"%dp0%\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe" %*\r\n');
    expect(await findProgram('claude-code', { env: { PATH: dir }, dirs: [] })).toMatchObject({ command: exe, lead: [] });
  });

  it('JS 입구는 동봉 Node 로, 못 찾으면 null', async () => {
    const entry = join(work, 'codex.js');
    writeFileSync(entry, '');
    expect(await findProgram('codex', { configured: entry, env: { PATH: '' }, dirs: [] })).toMatchObject({ command: process.execPath, lead: [entry], entry });
    expect(await findProgram('claude-code', { configured: join(work, 'nope'), env: { PATH: '' }, dirs: [] })).toBeNull();
    // 기관이 정한 위치가 틀리면 PATH 에 있어도 쓰지 않는다
    const bin = mkdtempSync(join(work, 'bin-'));
    writeFileSync(join(bin, process.platform === 'win32' ? 'claude.exe' : 'claude'), '');
    expect(await findProgram('claude-code', { configured: join(work, 'nope'), env: { PATH: bin }, dirs: [] })).toBeNull();
    expect(await findProgram('claude-code', { env: { PATH: bin }, dirs: [] })).not.toBeNull();
  });

  it('자식 환경: 허용 목록만 (API 키·다른 요금 경로·NODE_OPTIONS·엔진 변수는 빠짐), 더하는 값은 그대로', () => {
    const env = childEnv({ Anthropic_Api_Key: 'a', OPENAI_BASE_URL: 'b', CLAUDE_CODE_USE_BEDROCK: '1', AWS_PROFILE: 'p', NODE_OPTIONS: '--require x', KORDOC_AI_DATA_DIR: 'd', Path: 'C:\\x', TEMP: 'C:\\t', https_proxy: 'http://p', LC_ALL: 'ko_KR', CODEX_HOME: 'C:\\c' }, { DISABLE_AUTOUPDATER: '1' });
    expect(env).toEqual({ Path: 'C:\\x', TEMP: 'C:\\t', https_proxy: 'http://p', LC_ALL: 'ko_KR', CODEX_HOME: 'C:\\c', DISABLE_AUTOUPDATER: '1' });
    expect(win32.delimiter).toBe(';');
  });

  it('엔진 시작 때 한 시간 넘은 작업 폴더만 치운다 (예전 이름 포함, 다른 폴더·새 폴더는 둔다)', async () => {
    const root = mkdtempSync(join(work, 'sweep-'));
    for (const n of ['kordoc-sub-old', 'kordoc-codex-old', 'kordoc-sub-new', 'other-old']) mkdirSync(join(root, n));
    const past = new Date(Date.now() - 2 * 3600_000);
    for (const n of ['kordoc-sub-old', 'kordoc-codex-old', 'other-old']) utimesSync(join(root, n), past, past);
    expect(await sweepStaleTempDirs(root)).toBe(2);
    expect(['kordoc-sub-new', 'other-old'].every((n) => existsSync(join(root, n)))).toBe(true);
  });
});

// 시험이 띄운 가짜가 하나도 남지 않았는지 본 뒤 치운다
afterAll(async () => {
  const logs = Array.from({ length: logN }, (_, i) => join(work, `log-${i + 1}.jsonl`));
  const pids = [...new Set(logs.flatMap((f) => readLog(f).filter((e) => e.kind === 'run').map((e) => e.pid!)))];
  // PC 가 바쁘면(다른 빌드와 함께 돌 때) Windows 는 끈 프로세스를 치우는 데 3초를 넘긴다 (실측) → 15초까지 기다린다
  const until = Date.now() + 15_000;
  let left = stillRunning(pids);
  while (left.length && Date.now() < until) { await new Promise((r) => setTimeout(r, 500)); left = stillRunning(left); }
  expect(left).toEqual([]);
  rmSync(work, { recursive: true, force: true });
}, 30_000);

/** 아직 도는 가짜. Windows 는 끝난 프로세스 번호를 금방 다른 프로그램(브라우저 등)에 다시 줘서(실측) 번호만으로는 모른다:
 *  명령줄에 가짜 프로그램 경로가 든 node 만 센다 */
function stillRunning(pids: number[]): number[] {
  if (process.platform !== 'win32') return pids.filter(alive);
  const ps = "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | ForEach-Object { \"$($_.ProcessId) $($_.CommandLine)\" }";
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf-8', windowsHide: true });
  if (r.status !== 0) return pids.filter(alive);
  const live = new Set((r.stdout ?? '').split(/\r?\n/).filter((l) => /fixtures[\\/]fake-(claude|codex|gemini)\.mjs/.test(l)).map((l) => Number(l.split(' ')[0])));
  return pids.filter((p) => live.has(p));
}

describe('Codex 앱에 든 CLI 를 먼저 본다', () => {
  it('LOCALAPPDATA\OpenAI\Codex\bin 의 판 폴더를 최근 것부터, 다른 프로그램·운영체제는 비움', () => {
    const base = mkdtempSync(join(tmpdir(), 'kd-codexapp-'));
    try {
      const bin = join(base, 'OpenAI', 'Codex', 'bin');
      mkdirSync(join(bin, 'old'), { recursive: true });
      mkdirSync(join(bin, 'new'), { recursive: true });
      utimesSync(join(bin, 'old'), new Date(2020, 0, 1), new Date(2020, 0, 1));
      const dirs = appDirs('codex', 'win32', { LOCALAPPDATA: base });
      expect(dirs.map((d) => win32.basename(d))).toEqual(['new', 'old']);
      expect(appDirs('claude-code', 'win32', { LOCALAPPDATA: base })).toEqual([]);
      expect(appDirs('codex', 'darwin', { LOCALAPPDATA: base })).toEqual([]);
    } finally { rmSync(base, { recursive: true, force: true }); }
  });
});

describe('Codex 답 꼴: 엄격한 꼴만 --output-schema 로', () => {
  it('additionalProperties·required 를 다 갖춘 꼴만 엄격, 아무 칸 객체(args)는 아님', () => {
    expect(strictSchema({ type: 'object', properties: { a: { type: 'string' } }, required: ['a'], additionalProperties: false })).toBe(true);
    expect(strictSchema({ type: 'object', properties: { say: { type: 'string' }, calls: { type: 'array', items: { type: 'object', properties: { tool: { type: 'string' }, args: { type: 'object' } }, required: ['tool', 'args'] } } }, required: ['say', 'calls'] })).toBe(false);
    expect(strictSchema({ type: 'object', properties: { a: { type: 'string' }, b: { type: 'string' } }, required: ['a'], additionalProperties: false })).toBe(false);
  });
});
