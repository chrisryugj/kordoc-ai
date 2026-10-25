/** 구독 프로그램(Claude Code·Codex) 찾기·띄우기·끝내기
 *
 * - 셸 없이 띄운다. Windows 의 npm 껍데기(.cmd)는 셸이 있어야 돌아서, 껍데기가 부르는 실제 파일(.exe·.js)을 찾아 띄운다.
 *   JS 입구는 동봉 Node(process.execPath)로 띄운다: PC 에 Node 가 없어도 된다.
 * - 자식 환경은 허용 목록만 넘긴다. API 키·다른 요금 경로(Bedrock 등) 변수·NODE_OPTIONS·엔진 변수는 넘어가지 않는다.
 * - 글은 stdin 으로만 준다(명령줄은 다른 프로그램이 볼 수 있다). 작업 폴더는 매번 새 빈 임시 폴더, 끝나면 지운다.
 * - 끝낼 때는 프로세스 트리째(Windows taskkill /T, 그 밖은 프로세스 그룹).
 */

import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, posix, win32 } from 'node:path';
import { abortError, SubscriptionError, type SubscriptionProviderId } from './errors.js';

export interface Program {
  provider: SubscriptionProviderId;
  /** 띄울 실행 파일 (JS 입구면 동봉 Node) */
  command: string;
  /** 명령 인자 앞에 붙는 것 (JS 입구 경로) */
  lead: string[];
  /** 찾은 자리 (화면에 보여 줄 위치) */
  entry: string;
  /** 띄울 때 더하는 환경 (시험의 가짜 프로그램 조종용) */
  env?: Record<string, string>;
}

const BASE_NAME: Record<SubscriptionProviderId, string> = { 'claude-code': 'claude', codex: 'codex' };
const JS = /\.(c|m)?js$/i;

export interface FindOptions {
  /** 기관 배포 설정의 프로그램 위치 */
  configured?: string;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  /** PATH 다음에 볼 폴더 (기본: 공식 설치 프로그램들이 두는 곳) */
  dirs?: string[];
}

/** 폴더 아래 한 단계 하위 폴더들의 sub (nvm 의 Node 판마다 bin 같은 곳) */
function eachChild(dir: string, sub: string[], join2: (...p: string[]) => string): string[] {
  try { return readdirSync(dir).sort().reverse().map((v) => join2(dir, v, ...sub)); } catch { return []; }
}

/** PATH 에 없을 때 볼 폴더. 앱을 Finder·시작 메뉴로 켜면 PATH 가 짧아 셸에서 보이던 프로그램이 안 보인다.
 *  공식 설치 프로그램(~/.local/bin), Homebrew, npm 전역(기본·nvm·volta·pnpm·bun·yarn), winget */
function installDirs(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string[] {
  const home = (platform === 'win32' ? env.USERPROFILE : env.HOME) || homedir();
  const p = platform === 'win32' ? win32 : posix;
  const dirs: Array<string | undefined | false> = platform === 'win32'
    ? [
      p.join(home, '.local', 'bin'),
      env.APPDATA && p.join(env.APPDATA, 'npm'),
      env.NVM_HOME && p.join(env.NVM_HOME, '..', 'nodejs'),
      env.LOCALAPPDATA && p.join(env.LOCALAPPDATA, 'Volta', 'bin'),
      env.LOCALAPPDATA && p.join(env.LOCALAPPDATA, 'pnpm'),
      p.join(home, '.bun', 'bin'),
      env.LOCALAPPDATA && p.join(env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links'),
    ]
    : [
      p.join(home, '.local', 'bin'),
      p.join(home, '.claude', 'local'),
      '/opt/homebrew/bin', '/usr/local/bin',
      p.join(home, '.npm-global', 'bin'),
      ...eachChild(p.join(env.NVM_DIR || p.join(home, '.nvm'), 'versions', 'node'), ['bin'], p.join),
      p.join(home, '.volta', 'bin'),
      p.join(home, 'Library', 'pnpm'), p.join(home, '.local', 'share', 'pnpm'),
      p.join(home, '.bun', 'bin'),
      p.join(home, '.yarn', 'bin'),
    ];
  return dirs.filter((d): d is string => Boolean(d));
}

const isFile = (f: string) => { try { return statSync(f).isFile(); } catch { return false; } };

/** npm 이 만든 .cmd 껍데기가 부르는 파일: "%dp0%\…" 중 node.exe 가 아닌 마지막 .js·.exe */
export function cmdShimTarget(cmdPath: string): string | null {
  let text: string;
  try { text = readFileSync(cmdPath, 'utf-8'); } catch { return null; }
  const hits = [...text.matchAll(/"%~?dp0%?\\([^"%]+)"/gi)].map((m) => m[1]).filter((r) => /\.(exe|c?js|mjs)$/i.test(r) && !/(^|\\)node\.exe$/i.test(r));
  const rel = hits.at(-1);
  return rel ? win32.join(win32.dirname(cmdPath), rel) : null;
}

/** 찾은 파일 → 셸 없이 띄울 모양. 못 띄우는 꼴이면 null */
function launchable(provider: SubscriptionProviderId, file: string, platform: NodeJS.Platform): Program | null {
  let target = file;
  if (platform === 'win32' && /\.(cmd|bat)$/i.test(file)) {
    const t = cmdShimTarget(file);
    if (!t || !isFile(t)) return null;
    target = t;
  } else if (platform !== 'win32') {
    try { target = realpathSync(file); } catch { return null; }
  }
  if (JS.test(target)) return { provider, command: process.execPath, lead: [target], entry: file };
  if (platform === 'win32' && !/\.exe$/i.test(target)) return null;
  return { provider, command: target, lead: [], entry: file };
}

export async function findProgram(provider: SubscriptionProviderId, opts: FindOptions = {}): Promise<Program | null> {
  const platform = opts.platform ?? process.platform;
  const env = opts.env ?? process.env;
  // 기관이 위치를 정했으면 그 자리만 본다 (틀려도 다른 데서 찾지 않는다: 위치를 고정하려는 정책이니까)
  if (opts.configured) return isFile(opts.configured) ? launchable(provider, opts.configured, platform) : null;
  const pathVar = Object.entries(env).find(([k]) => k.toUpperCase() === 'PATH')?.[1] ?? '';
  const sep = platform === 'win32' ? win32.delimiter : posix.delimiter;
  const dirs = [...pathVar.split(sep).filter(Boolean), ...(opts.dirs ?? installDirs(platform, env))];
  const names = platform === 'win32' ? ['exe', 'cmd'].map((x) => `${BASE_NAME[provider]}.${x}`) : [BASE_NAME[provider]];
  const join2 = platform === 'win32' ? win32.join : posix.join;
  for (const dir of dirs) {
    for (const n of names) {
      const f = join2(dir, n);
      if (!isFile(f)) continue;
      const p = launchable(provider, f, platform);
      if (p) return p;
    }
  }
  return null;
}

/** 자식에게 넘기는 환경 변수 (대소문자 무시). 계정은 프로그램 자기 설정 폴더(HOME·CLAUDE_CONFIG_DIR·CODEX_HOME)에서 읽는다.
 *  API 키·다른 요금 경로(Bedrock·Vertex 등)·NODE_OPTIONS·엔진 변수는 목록에 없으니 넘어가지 않는다 */
const PASS = new Set([
  // 프로그램 자기 설정·구독 로그인 (setup-token 의 OAuth 토큰은 구독이라 넘긴다)
  'CLAUDE_CONFIG_DIR', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_GIT_BASH_PATH', 'CODEX_HOME',
  // 사용자·집 폴더
  'HOME', 'USER', 'LOGNAME', 'USERNAME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA',
  'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME', 'XDG_STATE_HOME', 'XDG_RUNTIME_DIR',
  // 실행 파일 찾기·운영체제
  'PATH', 'PATHEXT', 'SHELL', 'COMSPEC', 'SYSTEMROOT', 'SYSTEMDRIVE', 'WINDIR', 'OS', 'COMPUTERNAME',
  'PROGRAMDATA', 'PROGRAMFILES', 'PROGRAMFILES(X86)', 'PROGRAMW6432', 'COMMONPROGRAMFILES',
  'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE',
  // 임시 폴더
  'TMPDIR', 'TEMP', 'TMP',
  // 언어·시간대
  'LANG', 'LANGUAGE', 'TZ', '__CF_USER_TEXT_ENCODING',
  // 기관 프록시·인증서
  'HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY', 'NO_PROXY', 'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'SSL_CERT_DIR',
]);

export function childEnv(base: NodeJS.ProcessEnv = process.env, extra: Record<string, string> = {}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(base)) {
    const K = k.toUpperCase();
    if (v !== undefined && (PASS.has(K) || K.startsWith('LC_'))) out[k] = v;
  }
  return { ...out, ...extra };
}

export type SpawnFn = (command: string, args: string[], options: SpawnOptions) => ChildProcess;

const live = new Set<ChildProcess>();

function launch(program: Program, args: string[], o: { cwd: string; env: Record<string, string>; spawn?: SpawnFn }): ChildProcess {
  const child = (o.spawn ?? spawn)(program.command, [...program.lead, ...args], {
    cwd: o.cwd,
    env: o.env,
    shell: false,
    windowsHide: true,
    detached: process.platform !== 'win32', // 그룹째 끝내려고
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  live.add(child);
  child.once('exit', () => live.delete(child));
  child.once('error', () => live.delete(child));
  return child;
}

/** 프로세스 트리째 끝낸다 (이미 끝났으면 아무것도 안 함) */
export function stopTree(child: ChildProcess): void {
  if (child.exitCode !== null || child.signalCode !== null || !child.pid) return;
  if (process.platform === 'win32') {
    const sys = process.env.SystemRoot || process.env.SYSTEMROOT || 'C:\\Windows';
    spawn(win32.join(sys, 'System32', 'taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on('error', () => child.kill());
    return;
  }
  try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
}

/** 엔진이 꺼질 때 남은 자식 정리 */
process.once('exit', () => { for (const c of live) stopTree(c); });

const exited = (child: ChildProcess, ms: number) => new Promise<void>((res) => {
  if (child.exitCode !== null || child.signalCode !== null) return res();
  const t = setTimeout(res, ms);
  child.once('exit', () => { clearTimeout(t); res(); });
});

/** 한 줄 최대 크기 (넘으면 끊는다) */
const MAX_LINE = 8 * 1024 * 1024;

export interface RunOptions {
  signal: AbortSignal;
  /** 이 시간 동안 아무 출력이 없으면 끊는다 (ms) */
  idleMs: number;
  /** stdin 에 쓰고 닫을 글 */
  input?: string;
  cwd?: string;
  /** 자식 환경 바탕 (기본 process.env) */
  baseEnv?: NodeJS.ProcessEnv;
  extraEnv?: Record<string, string>;
  spawn?: SpawnFn;
  /** stdout 한 줄마다. throw 하면 프로세스를 끝내고(끝난 뒤) 그 오류로 실패.
   *  'done' 을 돌려주면 받을 것을 다 받은 것: 스스로 끝나기를 잠깐 기다렸다가 끝내고 정상으로 돌려준다 */
  onLine?: (line: string) => void | 'done';
}

export interface RunResult { code: number | null; stdout: string; stderr: string }

/** 띄우고 끝날 때까지. onLine 이 없으면 stdout 을 모아 돌려준다 (1MB 까지) */
export function runProgram(program: Program, args: string[], o: RunOptions): Promise<RunResult> {
  return new Promise<RunResult>((resolve, reject) => {
    if (o.signal.aborted) return reject(abortError());
    const child = launch(program, args, { cwd: o.cwd ?? tmpdir(), env: childEnv(o.baseEnv, { ...o.extraEnv, ...program.env }), spawn: o.spawn });
    let stdout = '';
    let stderr = '';
    let pending = '';
    let failure: unknown = null;
    let finished = false;
    let idle: NodeJS.Timeout;
    let linger: NodeJS.Timeout | undefined;
    const fail = (e: unknown) => {
      if (failure) return;
      failure = e;
      stopTree(child);
      // 끝난 것을 확인한 뒤에 알린다 (못 끝내도 5초 뒤엔 알린다)
      void exited(child, 5000).then(() => { cleanup(); reject(e); });
    };
    const arm = () => {
      clearTimeout(idle);
      if (finished) return;
      idle = setTimeout(() => fail(new SubscriptionError('timeout', program.provider, { seconds: Math.round(o.idleMs / 1000) })), o.idleMs);
    };
    const onAbort = () => fail(abortError());
    const cleanup = () => { clearTimeout(idle); clearTimeout(linger); o.signal.removeEventListener('abort', onAbort); };
    o.signal.addEventListener('abort', onAbort, { once: true });
    arm();
    child.on('error', (e: NodeJS.ErrnoException) => {
      if (failure) return;
      failure = e;
      cleanup();
      const missing = e.code === 'ENOENT' && !existsSync(program.command);
      reject(missing ? new SubscriptionError('not-installed', program.provider) : new SubscriptionError('failed', program.provider, { why: '프로그램을 띄우지 못함' }));
    });
    child.stderr!.setEncoding('utf-8');
    child.stderr!.on('data', (d: string) => { stderr = (stderr + d).slice(-20_000); });
    child.stdout!.setEncoding('utf-8');
    child.stdout!.on('data', (d: string) => {
      if (failure) return;
      arm();
      if (!o.onLine) { if (stdout.length < 1_000_000) stdout += d; return; }
      pending += d;
      let nl: number;
      while (!failure && (nl = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, nl).replace(/\r$/, '');
        pending = pending.slice(nl + 1);
        if (!line.trim()) continue;
        try {
          if (o.onLine(line) === 'done' && !finished) {
            finished = true;
            clearTimeout(idle);
            linger = setTimeout(() => stopTree(child), 3000);
          }
        } catch (e) { fail(e); }
      }
      if (pending.length > MAX_LINE) fail(new SubscriptionError('failed', program.provider, { why: '출력 한 줄이 너무 김' }));
    });
    // exit 뒤에도 stdout 이 덜 읽혔을 수 있다: 닫힐 때까지 (손자 프로세스가 붙잡고 있으면 1초까지만) 기다린다
    const stdoutClosed = new Promise<void>((res) => child.stdout!.once('close', res));
    child.on('exit', (code) => {
      void Promise.race([stdoutClosed, new Promise((r) => setTimeout(r, 1000))]).then(() => {
        if (failure) return;
        if (o.onLine && pending.trim() && !finished) { try { o.onLine(pending.trim()); } catch (e) { failure = e; cleanup(); return reject(e); } }
        cleanup();
        resolve({ code, stdout, stderr });
      });
    });
    child.stdin!.on('error', () => {}); // 먼저 끝난 자식에 쓰다 난 EPIPE 는 exit 쪽에서 다룬다
    child.stdin!.end(o.input ?? '');
  });
}

const PREFIX = 'kordoc-sub-';
/** 예전 판이 쓰던 이름도 함께 치운다 */
const OLD_PREFIXES = ['kordoc-claude-code-', 'kordoc-codex-'];

/** 한 번 쓰고 지우는 빈 작업 폴더 */
export function workDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), PREFIX));
}

export async function removeDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }).catch(() => {});
}

/** 엔진 시작 때: 한 시간 넘게 남은 작업 폴더(꺼지며 못 지운 것)를 지운다. 지운 수 */
export async function sweepStaleTempDirs(dir = tmpdir(), olderThanMs = 60 * 60_000): Promise<number> {
  let n = 0;
  for (const name of await readdir(dir).catch(() => [] as string[])) {
    if (![PREFIX, ...OLD_PREFIXES].some((p) => name.startsWith(p))) continue;
    const full = join(dir, name);
    const st = await stat(full).catch(() => null);
    if (!st?.isDirectory() || Date.now() - st.mtimeMs < olderThanMs) continue;
    await removeDir(full);
    if (!existsSync(full)) n++;
  }
  return n;
}

