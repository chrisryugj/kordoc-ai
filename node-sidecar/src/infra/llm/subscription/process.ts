/** 구독 프로그램 띄우기·끝내기 — 찾아 둔 실제 실행 파일 + 인자 배열, 셸 없이, 정리한 환경으로
 *
 * 이음오피스 packages/ai-provider/src/subscription/{process,env}.ts 와 claude-code-cli.ts 의 readLines
 * (Apache-2.0, 커밋 9bda9ac)에서 옮김. 바꾼 곳: 강제 종료 뒤 남은 자식 기록 파일(leftovers)은 빼고
 * 엔진이 끝날 때(process 'exit') 띄운 자식을 모두 끝내는 것만 남김, 짧은 명령 실행의 출력 상한·오류를 한국어로.
 */

import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, isAbsolute, join, win32 } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import type { SubscriptionProgram } from './locate.js';

/** 이 변수들은 구독이 아닌 다른 요금 경로(API 키·다른 클라우드·다른 주소)로 옮기므로 자식에게 넘기지 않는다 */
export const STRIPPED_ENV_VARS: readonly string[] = [
  'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL',
  'OPENAI_API_KEY', 'OPENAI_BASE_URL',
  'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY', 'CLAUDE_CODE_USE_MANTLE',
  'CLAUDE_CODE_USE_ANTHROPIC_AWS', 'CLAUDE_CODE_USE_ANTHROPIC_GOOGLE_CLOUD',
  'ANTHROPIC_CUSTOM_HEADERS', 'ANTHROPIC_PROFILE', 'ANTHROPIC_FEDERATION_RULE_ID',
  'CODEX_API_KEY', 'CODEX_ACCESS_TOKEN',
];

/** 자식에게 넘기는 변수 (허용 목록) — 경로·사용자 폴더·임시 폴더·언어·프록시·인증서·프로그램 설정 폴더만.
 *  엔진의 NODE_OPTIONS·ELECTRON_*·KORDOC_* 와 그 밖의 비밀 값은 넘기지 않는다. 이름은 대문자로 비교 */
const CHILD_ENV_ALLOW = new Set([
  'PATH', 'PATHEXT', 'HOME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA', 'PROGRAMDATA',
  'PROGRAMFILES', 'PROGRAMFILES(X86)', 'PROGRAMW6432', 'COMMONPROGRAMFILES', 'COMMONPROGRAMFILES(X86)', 'SYSTEMROOT', 'SYSTEMDRIVE',
  'WINDIR', 'COMSPEC', 'TEMP', 'TMP', 'TMPDIR', 'USERNAME', 'USERDOMAIN', 'COMPUTERNAME', 'OS', 'PROCESSOR_ARCHITECTURE',
  'NUMBER_OF_PROCESSORS', 'PUBLIC', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'LANGUAGE', 'TERM', 'TZ', '__CF_USER_TEXT_ENCODING',
  'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'ALL_PROXY', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'NODE_EXTRA_CA_CERTS', 'REQUESTS_CA_BUNDLE',
  'CODEX_HOME', 'CLAUDE_CONFIG_DIR', 'CLAUDE_CODE_OAUTH_TOKEN',
]);
const CHILD_ENV_ALLOW_PREFIX = ['LC_', 'XDG_'];

/** 자식 환경 — base 에서 허용 목록만 옮기고, 위 요금 경로 변수는 다시 한 번 뺀다 (Windows 는 이름 대소문자 무시). process.env 는 고치지 않는다 */
export function subscriptionChildEnv(opts: { base?: NodeJS.ProcessEnv; platform?: NodeJS.Platform; command?: string; extra?: Record<string, string> } = {}): NodeJS.ProcessEnv {
  const platform = opts.platform ?? process.platform;
  const stripped = new Set(STRIPPED_ENV_VARS);
  const env: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(opts.base ?? process.env)) {
    const up = name.toUpperCase();
    if (stripped.has(platform === 'win32' ? up : name)) continue;
    if (CHILD_ENV_ALLOW.has(up) || CHILD_ENV_ALLOW_PREFIX.some((p) => up.startsWith(p))) env[name] = value;
  }
  // 프로그램이 로그인·설정 폴더를 HOME 으로 찾는다
  if (platform === 'win32' && !env.HOME && env.USERPROFILE) env.HOME = env.USERPROFILE;
  if (opts.command && isAbsolute(opts.command)) {
    const key = Object.keys(env).find((n) => n.toLowerCase() === 'path') ?? 'PATH';
    env[key] = `${dirname(opts.command)}${delimiter}${env[key] ?? ''}`;
  }
  return { ...env, ...opts.extra };
}

/** 시험에서 가짜를 넣을 수 있는 spawn 모양 */
export type SpawnFn = (command: string, args: string[], options: SpawnOptions) => ChildProcess;

const WINDOWS_ROOT = /^[A-Za-z]:(?:\\[^\\/:*?"<>|%\r\n]+)+\\?$/;

/** %SystemRoot%\System32 — 시스템 도구는 PATH 를 믿지 않고 전체 경로로, 작업 폴더도 여기로 */
export function windowsSystemDir(env: NodeJS.ProcessEnv = process.env): string {
  const root = [env.SystemRoot, env.SYSTEMROOT, env.windir].find((v) => v !== undefined && WINDOWS_ROOT.test(v));
  return win32.join(root ?? 'C:\\Windows', 'System32');
}

/** 프로세스와 그것이 띄운 것까지 끝낸다. Windows 는 taskkill /T /F, 그 밖은 프로세스 묶음에 신호. 던지지 않는다 */
export function killProcessTree(target: { readonly pid?: number } | number, opts: { platform?: NodeJS.Platform; spawn?: SpawnFn } = {}): void {
  const pid = typeof target === 'number' ? target : target.pid;
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) return;
  const platform = opts.platform ?? process.platform;
  const single = (signal?: NodeJS.Signals) => { try { process.kill(pid, signal); } catch { /* 이미 끝남 */ } };
  if (platform === 'win32') {
    try {
      const sys = windowsSystemDir();
      const killer = (opts.spawn ?? nodeSpawn)(win32.join(sys, 'taskkill.exe'), ['/PID', String(pid), '/T', '/F'], { cwd: sys, stdio: 'ignore', windowsHide: true });
      killer.once('error', () => single());
      killer.unref();
    } catch { single(); }
    return;
  }
  try { process.kill(-pid, 'SIGKILL'); } catch { single('SIGKILL'); }
}

// ── 이 엔진이 띄운 자식 — 엔진이 끝나면 함께 끝낸다 ──

const children = new Set<ChildProcess>();
let exitHooked = false;

/** 띄운 자식을 모두 끝낸다 (동기, 여러 번 불러도 됨) */
export function shutdownSubscriptionChildren(): void {
  for (const c of [...children]) {
    children.delete(c);
    if (c.exitCode === null && c.signalCode === null) killProcessTree(c);
  }
}

export function trackedChildCount(): number {
  return children.size;
}

/** 찾아 둔 프로그램을 띄운다: 실제 파일·인자 배열·정리한 환경·셸 없음. POSIX 는 묶음을 끝낼 수 있게 detached */
export function spawnSubscriptionProgram(program: SubscriptionProgram, args: string[], opts: {
  cwd?: string; stdio?: SpawnOptions['stdio']; baseEnv?: NodeJS.ProcessEnv; env?: Record<string, string>; spawn?: SpawnFn;
} = {}): ChildProcess {
  const platform = process.platform;
  const child = (opts.spawn ?? nodeSpawn)(program.command, [...program.prefixArgs, ...args], {
    cwd: opts.cwd,
    env: subscriptionChildEnv({ base: opts.baseEnv, platform, command: program.command, extra: { ...program.env, ...opts.env } }),
    stdio: opts.stdio ?? ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    shell: false,
    detached: platform !== 'win32',
  });
  children.add(child);
  child.once('exit', () => children.delete(child));
  child.once('error', () => children.delete(child));
  if (!exitHooked) {
    exitHooked = true;
    process.once('exit', shutdownSubscriptionChildren);
  }
  return child;
}

export interface CommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

const MAX_COMMAND_OUTPUT = 256 * 1024;

/** 짧은 명령(버전·로그인 상태)을 끝까지 돌려 출력을 모은다. stdin 은 처음부터 닫는다(두 프로그램 모두 열린 stdin 을 기다림) */
export function runSubscriptionProgram(program: SubscriptionProgram, args: string[], opts: { signal: AbortSignal; timeoutMs: number; baseEnv?: NodeJS.ProcessEnv; spawn?: SpawnFn }): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    if (opts.signal.aborted) { reject(new DOMException('취소했습니다', 'AbortError')); return; }
    let child: ChildProcess;
    try {
      child = spawnSubscriptionProgram(program, args, { cwd: tmpdir(), stdio: ['ignore', 'pipe', 'pipe'], baseEnv: opts.baseEnv, spawn: opts.spawn });
    } catch (err) { reject(err); return; }
    const out: Buffer[] = [];
    const errOut: Buffer[] = [];
    let size = 0;
    let settled = false;
    const collect = (into: Buffer[]) => (chunk: Buffer) => { if (size < MAX_COMMAND_OUTPUT) { size += chunk.length; into.push(chunk); } };
    const finish = (err: Error | null, code: number | null = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      opts.signal.removeEventListener('abort', onAbort);
      if (err) { killProcessTree(child); reject(err); return; }
      resolve({ code, stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(errOut).toString('utf8') });
    };
    const onAbort = () => finish(new DOMException('취소했습니다', 'AbortError'));
    const timer = setTimeout(() => finish(Object.assign(new Error(`명령이 ${Math.round(opts.timeoutMs / 1000)}초 안에 끝나지 않았습니다`), { code: 'ETIMEDOUT' })), opts.timeoutMs);
    timer.unref?.();
    opts.signal.addEventListener('abort', onAbort, { once: true });
    child.stdout?.on('data', collect(out));
    child.stderr?.on('data', collect(errOut));
    child.once('error', (e) => finish(e));
    child.once('close', (code) => finish(null, code));
  });
}

/** 자식이 완전히 끝날 때까지(최대 ms) 기다린다 — Windows 는 열린 파일을 못 지우니 임시 폴더를 지우기 전에, 결과를 알리기 전에 */
export function waitExit(child: ChildProcess, ms = 5000): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) return Promise.resolve();
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    t.unref?.();
    child.once('close', () => { clearTimeout(t); resolve(); });
  });
}

/** 구독 프로그램용 임시 폴더 이름 앞부분 — 엔진이 시작할 때 지난번에 못 지운 것을 치운다 */
export const TEMP_PREFIXES = ['kordoc-claude-code-', 'kordoc-codex-'];

/** 한 시간 넘은 남은 임시 폴더(그림 파일이 남았을 수 있음)를 지운다. 실패해도 조용히 */
export async function sweepStaleTempDirs(dir = tmpdir(), olderThanMs = 60 * 60_000): Promise<number> {
  let n = 0;
  for (const name of await readdir(dir).catch(() => [] as string[])) {
    if (!TEMP_PREFIXES.some((p) => name.startsWith(p))) continue;
    const full = join(dir, name);
    const st = await stat(full).catch(() => null);
    if (!st?.isDirectory() || Date.now() - st.mtimeMs < olderThanMs) continue;
    await rm(full, { recursive: true, force: true, maxRetries: 3 }).then(() => { n += 1; }, () => undefined);
  }
  return n;
}

/** 한 줄의 상한 — 줄바꿈 없이 끝없이 쓰는 자식 때문에 버퍼가 커지지 않게 */
export const MAX_LINE_BYTES = 4 * 1024 * 1024;

/** 스트림을 줄로 나눈다. 상한을 넘는 줄이 오면 그만 읽고 onOverflow */
export function readLines(stream: NodeJS.ReadableStream, onLine: (line: string) => void, onOverflow: () => void): void {
  const decoder = new StringDecoder('utf8'); // 조각 경계에 걸친 한글도 깨지지 않게
  let pending = '';
  let pendingBytes = 0;
  let stopped = false;
  const flush = () => {
    if (stopped) return;
    stopped = true;
    const tail = pending + decoder.end();
    pending = '';
    if (tail.trim()) onLine(tail.replace(/\r$/, ''));
  };
  stream.on('end', flush);
  stream.on('close', flush);
  stream.on('data', (chunk: Buffer) => {
    if (stopped) return;
    pending += decoder.write(chunk);
    const parts = pending.split('\n');
    pending = parts.pop() ?? '';
    pendingBytes = parts.length ? Buffer.byteLength(pending, 'utf8') : pendingBytes + chunk.length;
    for (const part of parts) {
      if (stopped) return;
      if (part.trim()) onLine(part.replace(/\r$/, ''));
    }
    if (pendingBytes > MAX_LINE_BYTES) {
      stopped = true;
      pending = '';
      onOverflow();
    }
  });
}
