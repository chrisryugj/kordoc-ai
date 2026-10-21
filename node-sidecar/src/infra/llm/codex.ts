/** 구독 계정(ChatGPT/Codex) 공급자 — PC 에 설치해 ChatGPT 계정으로 로그인해 둔 Codex 를 app-server(JSON-RPC, stdio)로 띄워 한 번 답하게 한다
 *
 * 이음오피스 packages/ai-provider/src/codex-app-server.ts(Apache-2.0, 커밋 9bda9ac)에서 옮김.
 * 바꾼 곳: 실행들이 나눠 쓰던 상주 프로세스·스레드 이어 쓰기(세션 지문)는 빼고 요청마다 띄워 끝냄(kordoc 요청은 한 번 묻고 끝),
 * 앱 도구 호출용 구조화 차례 대신 kordoc 공급자 계약(글 하나, schema 면 outputSchema), 실행 직전 로그인 확인을 account/read 로
 * (구독이 아닌 API 키 로그인이면 보내지 않음), 사용량 창 표시는 빼고 한도 시각만, 폐쇄망 관문·통신 기록, 오류는 한국어 할 일 안내,
 * 응답이 멈춘 시간 기준 시간 제한, item/agentMessage/delta 가 오면 글 조각으로 흘림.
 *
 * 지키는 것 (이음오피스 packages/ai-provider/AGENTS.md):
 * - Codex 에는 사용자 config.toml 을 통째로 무시하는 스위치가 없다 → CODEX_CONFIG_OVERRIDES 로 하나씩 덮고(hooks·plugins·apps·memories 끔,
 *   기본 OpenAI 공급자·주소), MCP 서버는 스레드마다 이름을 대 끈 뒤 mcpServerStatus/list 로 실제로 꺼졌는지 확인한다. 확인 못 하면 보내지 않는다.
 * - Codex 자신의 셸 도구는 끌 수 없다 → 권한 프로필로 읽기를 플랫폼 경로와 이번 임시 폴더로 좁히고, 안 먹으면 read-only 샌드박스.
 *   쓰기 권한·승인을 여는 값은 어느 경로에도 넣지 않는다. approvalPolicy 는 never.
 *   실측(2026-10, Windows · Codex 0.163 데스크톱 사본): 좁힌 프로필은 "elevated Windows sandbox requires effective `:root` read access"
 *   로 thread/start 가 거절돼 늘 read-only 로 내려간다(이음오피스와 같은 대체 경로). 이때 셸 도구는 디스크를 읽을 수 있다(쓰기는 막힘). 지시문으로 도구를 쓰지 말라고 하고 승인은 never,
 *   그래도 차례 안에 명령·파일·MCP·웹 검색 항목이 보이면(item/started) 결과가 모델로 가기 전에 차례를 끊고 프로세스를 끝낸다(TOOL_ITEM).
 * - 모델은 늘 이름을 댄다(비우면 Codex 가 사용자 설정 파일의 모델·공급자를 쓴다).
 * - 지시문·대화는 stdin 의 JSON-RPC 로만. 명령줄은 고정 값뿐. 끝나면·취소하면 프로세스 트리를 끝낸다.
 */

import type { ChildProcess } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { logger } from '../logger.js';
import { assertProgramEgress } from '../net-guard.js';
import { resolveSubscriptionProgram, type SubscriptionProgram } from './subscription/locate.js';
import { cancelledError, CliRunError } from './subscription/messages.js';
import { killProcessTree, readLines, spawnSubscriptionProgram, type SpawnFn } from './subscription/process.js';
import type { ChatImage, ChatRequest, LlmProvider } from './types.js';
import type { CliModel } from './claude-code.js';

const PROVIDER = 'codex';
const EGRESS_HOST = 'chatgpt.com';
const REQUEST_TIMEOUT_MS = 30_000;
const TEMP_PREFIX = 'kordoc-codex-';
const CLIENT_NAME = 'kordoc-ai';
const PERMISSION_PROFILE = 'kordoc';
const BASE_INSTRUCTIONS = '당신은 KorDoc AI 에 들어 있는 언어 모델 뒷단입니다. 로컬 파일을 보거나 고치지 않고, 셸 명령을 실행하지 않고, 웹을 보지 않고, MCP·앱·Codex 내장 도구를 부르지 않습니다. 호출하는 앱이 필요한 대화를 모두 주므로 글로만 답합니다.';

export interface CodexConfig {
  model: string;
  cli_path: string;
}

export interface CodexDeps {
  resolveProgram?: (configuredPath: string) => Promise<SubscriptionProgram>;
  spawn?: SpawnFn;
  killTree?: (child: { readonly pid?: number }) => void;
  baseEnv?: NodeJS.ProcessEnv;
}

/** app-server 가 사용자 config.toml 에서 끌어올 수 있는 것을 하나씩 덮는다. `--disable 모르는이름` 은 시작을 막아 -c features.<이름>=false 로 */
export const CODEX_CONFIG_OVERRIDES: readonly string[] = [
  'features.hooks=false',
  'features.plugins=false',
  'features.apps=false',
  'features.memories=false',
  'notify=[]',
  'history.persistence="none"',
  'model_provider="openai"',
  'openai_base_url=""',
  'skills.include_instructions=false',
];

export function codexAppServerArgs(): string[] {
  return ['app-server', ...CODEX_CONFIG_OVERRIDES.flatMap((o) => ['-c', o]), '--listen', 'stdio://'];
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : undefined);

export type McpOverrides = Record<string, { enabled: false }>;

/** config/read 가 알려 준 MCP 서버를 이름으로 모두 끄는 스레드 설정 (이름만 읽고 명령·환경은 보지 않는다) */
export function codexMcpServerOverrides(configRead: unknown): McpOverrides {
  const config = obj(obj(configRead)?.config);
  if (!config) throw new Error('no config');
  return Object.fromEntries(Object.keys(obj(config.mcp_servers) ?? {}).map((n) => [n, { enabled: false as const }]));
}

/** mcpServerStatus/list 에서 이 스레드가 쓸 수 있는 서버 (disabled 아닌 것, 도구가 있는 것). 목록 모양이 아니면 throw */
export function codexAttachedMcpServers(statusList: unknown): string[] {
  const data = obj(statusList)?.data;
  if (!Array.isArray(data)) throw new Error('no list');
  return data.flatMap((v) => {
    const e = obj(v);
    if (!e) throw new Error('bad entry');
    // disabled 라고 밝힌 것만 꺼진 것으로 본다 (상태 칸이 없으면 붙은 것으로)
    const enabled = e.runtimeStatus !== 'disabled';
    return enabled || Object.keys(obj(e.tools) ?? {}).length ? [typeof e.name === 'string' ? e.name : ''] : [];
  });
}

/** 권한 프로필(읽기는 플랫폼 경로 + 이번 임시 폴더) 또는 그게 안 될 때의 read-only 샌드박스 */
export function codexThreadStartParams(model: string, tempDir: string, mode: 'profile' | 'read-only', mcp: McpOverrides = {}): Obj {
  const base = { model, cwd: tempDir, approvalPolicy: 'never', serviceName: CLIENT_NAME, baseInstructions: BASE_INSTRUCTIONS, ephemeral: true };
  const mcpCfg = Object.keys(mcp).length ? { mcp_servers: mcp } : undefined;
  if (mode === 'read-only') return { ...base, sandbox: 'read-only', ...(mcpCfg ? { config: mcpCfg } : {}) };
  return { ...base, config: { default_permissions: PERMISSION_PROFILE, permissions: { [PERMISSION_PROFILE]: { filesystem: { ':minimal': 'read', [tempDir]: 'read' } } }, ...mcpCfg } };
}

/** 이번 차례의 글 — system·대화를 payload 하나로 (그림은 localImage 로 따로) */
export function buildCodexPrompt(req: Pick<ChatRequest, 'system' | 'messages' | 'json' | 'schema' | 'maxTokens'>): string {
  let n = 0;
  const conversation = req.messages.map((m) => ({ role: m.role, text: m.content, ...(m.images?.length ? { attachedImages: m.images.map(() => `image-${++n}`) } : {}) }));
  return [
    '아래 payload 를 이번 차례의 KorDoc AI 대화로 보고 그 system 지시를 따르세요. 마지막 사용자 차례에 답합니다.',
    'Codex 도구를 쓰지 마세요. 파일·명령·웹·MCP 없이 글로만 답합니다.',
    ...(req.json || req.schema ? ['JSON 객체 하나로만 답합니다: 앞뒤 설명·코드블록 없이.'] : []),
    ...(req.maxTokens ? [`답은 대략 ${req.maxTokens} 토큰 안으로 씁니다.`] : []),
    '<kordoc_payload>',
    JSON.stringify({ system: req.system ?? '', conversation }),
    '</kordoc_payload>',
  ].join('\n');
}

/** 실패한 차례(TurnError) → 할 일. rateLimits 는 마지막으로 받은 사용량 (다시 쓸 수 있는 시각) */
export function codexRunError(turnError: unknown, rateLimits?: unknown): CliRunError {
  const v = obj(turnError);
  const info = v?.codexErrorInfo;
  if (info === 'usageLimitExceeded') {
    const resets = ['primary', 'secondary'].map((k) => obj(obj(rateLimits)?.[k])).filter((w) => w && typeof w.usedPercent === 'number' && w.usedPercent >= 100 && typeof w.resetsAt === 'number').map((w) => (w!.resetsAt as number) * 1000);
    return new CliRunError('rate-limit', PROVIDER, undefined, { resetsAt: resets.length ? Math.max(...resets) : undefined });
  }
  const status = Object.values(obj(info) ?? {}).map((d) => obj(d)?.httpStatusCode).find((s) => typeof s === 'number');
  if (info === 'unauthorized' || status === 401) return new CliRunError('signed-out', PROVIDER);
  if (typeof v?.message === 'string') logger.warn(`[codex] 차례 실패: ${v.message.slice(0, 300)}`);
  return new CliRunError('failed', PROVIDER, 'Codex 가 답하지 못했습니다.');
}

// ── JSON-RPC 한 줄씩 ──

interface Pending { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }

class RpcClient {
  private readonly pending = new Map<number, Pending>();
  private readonly listeners = new Set<(m: Obj) => void>();
  private closeListeners = new Set<(e: Error) => void>();
  private nextId = 1;
  private stderr = '';
  closed = false;

  constructor(readonly child: ChildProcess, private readonly killTree: (c: ChildProcess) => void) {
    child.stdin?.on('error', () => undefined);
    child.stderr?.on('data', (c: Buffer) => { this.stderr = (this.stderr + c.toString()).slice(-4000); });
    if (child.stdout) readLines(child.stdout, (l) => this.onLine(l), () => this.stop(new CliRunError('failed', PROVIDER, 'Codex 가 줄바꿈 없이 너무 긴 줄을 써서 멈췄습니다.')));
    child.once('error', (err) => this.fail((err as NodeJS.ErrnoException).code === 'ENOENT'
      ? new CliRunError('not-installed', PROVIDER, 'Codex 프로그램을 실행하지 못했습니다.')
      : new CliRunError('failed', PROVIDER, 'Codex 를 실행하지 못했습니다.')));
    child.once('close', (code) => this.fail(/unknown|unexpected argument|unrecognized/i.test(this.stderr)
      ? new CliRunError('needs-update', PROVIDER, 'Codex 버전이 낮아 이 앱이 쓰는 기능(app-server)을 모릅니다.')
      : new CliRunError('failed', PROVIDER, `Codex 가 답하기 전에 끝났습니다(종료 코드 ${code ?? '없음'}).`)));
  }

  request(method: string, params: unknown, timeoutMs = REQUEST_TIMEOUT_MS): Promise<unknown> {
    if (this.closed) return Promise.reject(new CliRunError('failed', PROVIDER, 'Codex 가 이미 끝났습니다.'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new CliRunError('timeout', PROVIDER, undefined, { seconds: Math.round(timeoutMs / 1000) })); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.write({ method, id, params });
    });
  }

  notify(method: string): void { this.write({ method }); }
  onNotification(fn: (m: Obj) => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  onClose(fn: (e: Error) => void): () => void { this.closeListeners.add(fn); return () => this.closeListeners.delete(fn); }

  private write(m: unknown): void {
    if (!this.closed && this.child.stdin?.writable) this.child.stdin.write(`${JSON.stringify(m)}\n`);
  }

  private onLine(line: string): void {
    let m: Obj | undefined;
    try { m = obj(JSON.parse(line)); } catch { return; }
    if (!m) return;
    if (typeof m.method === 'string' && m.id !== undefined) {
      // 서버가 묻는 것(승인 등)은 하나도 받지 않는다 — 기다리게 두지 않고 거절
      this.write({ id: m.id, error: { code: -32601, message: `Unsupported server request: ${m.method}` } });
      return;
    }
    if (typeof m.id === 'number') {
      const p = this.pending.get(m.id);
      if (!p) return;
      clearTimeout(p.timer);
      this.pending.delete(m.id);
      if (m.error !== undefined) {
        const e = obj(m.error);
        p.reject(Object.assign(new Error(`rpc ${typeof e?.code === 'number' ? e.code : ''}`), { rpcCode: e?.code }));
      } else p.resolve(m.result);
      return;
    }
    if (typeof m.method === 'string') {
      // 모든 스레드의 MCP 를 껐으니 하나라도 뜨면 끄기가 안 먹은 것
      if (m.method === 'mcpServer/startupStatus/updated' && ['starting', 'ready'].includes(String(obj(m.params)?.status))) {
        this.stop(new CliRunError('unsafe-tools', PROVIDER, '끈 MCP 서버가 켜짐'));
        return;
      }
      for (const fn of this.listeners) fn(m);
    }
  }

  private fail(err: Error): void {
    if (this.closed) return;
    this.closed = true;
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(err); }
    this.pending.clear();
    this.listeners.clear();
    const ls = [...this.closeListeners];
    this.closeListeners.clear();
    for (const fn of ls) fn(err);
  }

  stop(reason?: Error): void {
    if (!this.closed) this.killTree(this.child);
    this.fail(reason ?? new CliRunError('failed', PROVIDER, 'Codex 를 멈췄습니다.'));
  }
}

/** 띄우기만 한다 — initialize 는 호출한 쪽이 client 를 쥔 뒤에(실패·취소해도 끝낼 수 있게) */
async function openClient(cfg: CodexConfig, deps: CodexDeps, cwd: string): Promise<RpcClient> {
  const program = await (deps.resolveProgram ?? ((p: string) => resolveSubscriptionProgram(PROVIDER, { configuredPath: p })))(cfg.cli_path);
  let child: ChildProcess;
  try {
    child = spawnSubscriptionProgram(program, codexAppServerArgs(), { cwd, baseEnv: deps.baseEnv, spawn: deps.spawn });
  } catch (err) {
    throw (err as NodeJS.ErrnoException).code === 'ENOENT' ? new CliRunError('not-installed', PROVIDER, 'Codex 프로그램을 실행하지 못했습니다.') : new CliRunError('failed', PROVIDER, 'Codex 를 실행하지 못했습니다.');
  }
  return new RpcClient(child, deps.killTree ?? ((c) => killProcessTree(c)));
}

async function initialize(client: RpcClient): Promise<void> {
  await client.request('initialize', { clientInfo: { name: CLIENT_NAME, title: 'KorDoc AI', version: '2' }, capabilities: { experimentalApi: false, requestAttestation: false } });
  client.notify('initialized');
}

/** 실행 직전 로그인 — 로그아웃이면 로그인 안내, 구독이 아닌 API 키 로그인이면 요금이 나가니 보내지 않는다 */
async function assertAccount(client: RpcClient): Promise<void> {
  const r = obj(await client.request('account/read', { refreshToken: false }));
  const account = obj(r?.account);
  if (!account) {
    if (r?.requiresOpenaiAuth === true) throw new CliRunError('signed-out', PROVIDER);
    return;
  }
  if (account.type === 'apiKey') throw new CliRunError('metered', PROVIDER);
}

async function modelEntries(client: RpcClient): Promise<Obj[]> {
  const out: Obj[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 10; page++) {
    const r = obj(await client.request('model/list', { cursor, limit: 100, includeHidden: false }));
    for (const v of Array.isArray(r?.data) ? r.data : []) { const e = obj(v); if (e && e.hidden !== true) out.push(e); }
    cursor = typeof r?.nextCursor === 'string' && r.nextCursor ? r.nextCursor : null;
    if (!cursor) break;
  }
  return out;
}

const entryId = (e: Obj) => (typeof e.id === 'string' ? e.id : typeof e.model === 'string' ? e.model : '');

/** 비워 둔 모델 → Codex 가 내놓은 목록의 기본값 (없으면 첫 번째) */
async function defaultModel(client: RpcClient): Promise<string> {
  let entries: Obj[];
  try { entries = await modelEntries(client); } catch (err) {
    if (err instanceof CliRunError) throw err;
    throw new CliRunError('needs-update', PROVIDER, 'Codex 가 모델 목록을 알려 주지 못했습니다(버전이 낮을 수 있음).');
  }
  const id = entryId(entries.find((e) => e.isDefault === true) ?? entries[0] ?? {});
  if (!id) throw new CliRunError('failed', PROVIDER, 'Codex 가 쓸 수 있는 모델을 알려 주지 않았습니다. 설정 > AI 연결에서 모델 이름을 넣으세요.');
  return id;
}

/** MCP 를 끈 스레드를 연다 — 권한 프로필이 먹었는지, MCP 가 정말 없는지 Codex 의 답으로 확인 */
async function startThread(client: RpcClient, model: string, tempDir: string): Promise<string> {
  let mcp: McpOverrides;
  try { mcp = codexMcpServerOverrides(await client.request('config/read', { includeLayers: false, cwd: tempDir })); } catch {
    throw new CliRunError('unsafe-tools', PROVIDER, '설정된 MCP 서버를 알려 주지 않음');
  }
  const threadOf = (r: unknown) => { const t = obj(obj(r)?.thread); return typeof t?.id === 'string' && t.id ? t.id : undefined; };
  let threadId: string | undefined;
  let tried: unknown;
  try {
    tried = await client.request('thread/start', codexThreadStartParams(model, tempDir, 'profile', mcp));
    if (obj(obj(tried)?.activePermissionProfile)?.id === PERMISSION_PROFILE) threadId = threadOf(tried);
  } catch { tried = undefined; /* 낮은 버전은 프로필 키를 거부 → 샌드박스로 */ }
  if (threadId) logger.info('[codex] 권한 프로필(읽기만, 임시 폴더) 적용');
  else {
    logger.warn('[codex] 권한 프로필이 적용되지 않아 read-only 샌드박스로 엽니다 (이 경우 Codex 셸 도구는 디스크를 읽을 수 있음)');
    const abandoned = threadOf(tried);
    if (abandoned) await client.request('thread/delete', { threadId: abandoned }).catch(() => undefined);
    threadId = threadOf(await client.request('thread/start', codexThreadStartParams(model, tempDir, 'read-only', mcp)));
  }
  if (!threadId) throw new CliRunError('needs-update', PROVIDER, 'Codex 가 대화 스레드를 열지 못했습니다.');
  let attached = 0;
  let checked = false;
  try {
    let cursor: string | null = null;
    for (let page = 0; page < 10; page++) {
      const r = await client.request('mcpServerStatus/list', { threadId, detail: 'toolsAndAuthOnly', cursor, limit: 100 });
      attached += codexAttachedMcpServers(r).length;
      const next = obj(r)?.nextCursor;
      cursor = typeof next === 'string' && next ? next : null;
      if (!cursor) break;
    }
    checked = cursor === null;
  } catch { checked = false; }
  if (!checked || attached > 0) throw new CliRunError('unsafe-tools', PROVIDER, checked ? '끈 MCP 서버가 붙어 있음' : 'MCP 서버가 없는지 확인하지 못함');
  return threadId;
}

/** 차례 안에서 보이면 멈추는 항목 — 명령 실행·파일 고치기·MCP·웹 검색·그 밖의 도구 호출 */
const TOOL_ITEM = /command|fileChange|mcpToolCall|webSearch|toolCall/i;

const EXT: Record<string, string> ={ 'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };

async function materializeImages(images: ChatImage[], dir: string): Promise<string[]> {
  const paths: string[] = [];
  for (const img of images) {
    const p = join(dir, `image-${paths.length + 1}${EXT[img.mime.toLowerCase()] ?? '.img'}`);
    await writeFile(p, Buffer.from(img.base64, 'base64'));
    paths.push(p);
  }
  return paths;
}

/** turn/start 뒤 turn/completed 까지 — 글 조각을 흘리고 마지막 답을 돌려준다 */
function waitForTurn(client: RpcClient, threadId: string, start: () => Promise<unknown>, req: ChatRequest, timeoutMs: number): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let turnId = '';
    let finalText = '';
    let emitted = '';
    let reported: unknown;
    let rateLimits: unknown;
    let settled = false;
    let idle: NodeJS.Timeout | undefined;
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(idle);
      clearTimeout(cap);
      unsub();
      unsubClose();
      req.signal.removeEventListener('abort', onAbort);
      if (err) { reject(err); return; }
      if (finalText.length > emitted.length && finalText.startsWith(emitted)) req.onToken?.(finalText.slice(emitted.length));
      else if (!emitted && finalText) req.onToken?.(finalText);
      resolve(finalText || emitted);
    };
    const touch = () => {
      clearTimeout(idle);
      idle = setTimeout(() => finish(new CliRunError('timeout', PROVIDER, undefined, { seconds: Math.round(timeoutMs / 1000) })), timeoutMs);
    };
    const cap = setTimeout(() => finish(new CliRunError('timeout', PROVIDER, undefined, { seconds: Math.round((timeoutMs * 4) / 1000) })), timeoutMs * 4);
    const onAbort = () => {
      if (turnId) void client.request('turn/interrupt', { threadId, turnId }).catch(() => undefined);
      finish(cancelledError());
    };
    const unsub = client.onNotification((m) => {
      const p = obj(m.params);
      if (m.method === 'account/rateLimits/updated') { rateLimits = p?.rateLimits; return; }
      if (p?.threadId !== threadId) return;
      if (m.method !== 'error' || p.willRetry !== true) touch();
      const evTurn = typeof p.turnId === 'string' ? p.turnId : '';
      if (turnId && evTurn && evTurn !== turnId) return;
      if (m.method === 'turn/started') {
        const t = obj(p.turn);
        if (typeof t?.id === 'string') turnId = t.id;
      } else if ((m.method === 'item/started' || m.method === 'item/completed') && TOOL_ITEM.test(String(obj(p.item)?.type ?? ''))) {
        // 끌 수 없는 Codex 자신의 도구(셸·파일·웹 검색·MCP)를 쓰기 시작하면 결과가 모델로 가기 전에 멈춘다
        void client.request('turn/interrupt', { threadId, turnId }).catch(() => undefined);
        const err = new CliRunError('unsafe-tools', PROVIDER, `도구를 쓰기 시작함(${String(obj(p.item)?.type).slice(0, 40)})`);
        finish(err);
        client.stop(err);
      } else if (m.method === 'item/agentMessage/delta') {
        if (typeof p.delta === 'string' && p.delta) { emitted += p.delta; req.onToken?.(p.delta); }
      } else if (m.method === 'item/completed') {
        const item = obj(p.item);
        if (item?.type === 'agentMessage' && typeof item.text === 'string') finalText = item.text;
      } else if (m.method === 'turn/completed') {
        const t = obj(p.turn);
        if (!finalText) {
          const items = Array.isArray(t?.items) ? t.items : [];
          for (let i = items.length - 1; i >= 0; i--) { const it = obj(items[i]); if (it?.type === 'agentMessage' && typeof it.text === 'string') { finalText = it.text; break; } }
        }
        if (t?.status === 'failed') finish(codexRunError(t.error ?? reported, rateLimits));
        else finish();
      } else if (m.method === 'error') {
        // willRetry: Codex 가 스스로 다시 붙는 중. 경고도 이 길로 와서 오류만으로 실패시키지 않는다(차례 결과가 정한다)
        if (p.willRetry !== true) reported = obj(p.error) ?? p;
      }
    });
    const unsubClose = client.onClose((err) => finish(reported && !(err instanceof CliRunError && err.kind === 'unsafe-tools') ? codexRunError(reported, rateLimits) : err));
    if (req.signal.aborted) { finish(cancelledError()); return; }
    req.signal.addEventListener('abort', onAbort, { once: true });
    touch();
    void start().then((r) => {
      const t = obj(obj(r)?.turn);
      if (typeof t?.id === 'string') turnId = t.id;
    }).catch((err) => finish(err instanceof Error ? err : new Error(String(err))));
  });
}

async function withClient<T>(cfg: CodexConfig, deps: CodexDeps, signal: AbortSignal, work: (client: RpcClient, tempDir: string) => Promise<T>): Promise<T> {
  // 이번 요청만의 빈 폴더 — 작업 폴더·권한 프로필의 읽기 허용·그림 파일 자리
  const tempDir = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
  let client: RpcClient | undefined;
  const onAbort = () => client?.stop(cancelledError());
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    if (signal.aborted) throw cancelledError();
    client = await openClient(cfg, deps, tempDir);
    if (signal.aborted) throw cancelledError();
    await initialize(client);
    return await work(client, tempDir);
  } catch (err) {
    if (signal.aborted) throw cancelledError();
    throw err instanceof CliRunError || err instanceof DOMException ? err : new CliRunError('failed', PROVIDER, 'Codex 와 주고받지 못했습니다.');
  } finally {
    signal.removeEventListener('abort', onAbort);
    client?.stop(); // 요청마다 띄웠으니 트리째 끝낸다
    await rm(tempDir, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined);
  }
}

export function createCodexProvider(cfg: CodexConfig, timeoutMs: number, deps: CodexDeps = {}): LlmProvider {
  return {
    id: PROVIDER,
    isCloud: true, // 문서가 OpenAI 서버로 간다 → 자동 마스킹·폐쇄망 차단
    supportsVision: true,
    async chat(req) {
      if (req.signal.aborted) throw cancelledError();
      assertProgramEgress(EGRESS_HOST, 'Codex');
      return withClient(cfg, deps, req.signal, async (client, tempDir) => {
        await assertAccount(client);
        const model = cfg.model.trim() || (await defaultModel(client));
        const threadId = await startThread(client, model, tempDir);
        const images = await materializeImages(req.messages.flatMap((m) => m.images ?? []), tempDir);
        const text = await waitForTurn(client, threadId, () => client.request('turn/start', {
          threadId,
          input: [{ type: 'text', text: buildCodexPrompt(req), text_elements: [] }, ...images.map((path) => ({ type: 'localImage', path }))],
          ...(req.schema ? { outputSchema: req.schema } : {}),
        }), req, timeoutMs);
        if (!text.trim()) throw new CliRunError('failed', PROVIDER, 'Codex 가 빈 답을 보냈습니다.');
        return text;
      });
    },
    listModels: (signal) => listCodexModels(cfg, signal ?? AbortSignal.timeout(30_000), deps).then((ms) => ms.map((m) => m.id)),
  };
}

/** Codex 가 고를 수 있게 내놓는 모델 (스레드를 열지 않아 모델을 부르지 않는다) */
export async function listCodexModels(cfg: CodexConfig, signal: AbortSignal, deps: CodexDeps = {}): Promise<CliModel[]> {
  if (signal.aborted) throw cancelledError();
  assertProgramEgress(EGRESS_HOST, 'Codex 모델 목록');
  return withClient(cfg, deps, signal, async (client) => {
    const seen = new Set<string>();
    const out: CliModel[] = [];
    for (const e of await modelEntries(client)) {
      const id = entryId(e);
      if (!id || seen.has(id) || !/^[A-Za-z0-9][A-Za-z0-9._:[\]/-]{0,127}$/.test(id)) continue;
      seen.add(id);
      out.push({ id, label: typeof e.displayName === 'string' && e.displayName.trim() ? e.displayName.trim().slice(0, 80) : id });
    }
    return out;
  });
}
