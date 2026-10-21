/** 구독 프로그램(Claude Code·Codex) 찾기 — 셸 없이 바로 띄울 수 있는 실제 실행 파일로
 *
 * 이음오피스 packages/ai-provider/src/subscription/locate.ts(Apache-2.0, 커밋 9bda9ac)에서 옮김.
 * 바꾼 곳: Electron 실행(ELECTRON_RUN_AS_NODE) 대신 동봉 Node(process.execPath)로 JS 입구를 띄움,
 * 못 찾았을 때의 오류를 한국어 안내로(resolveSubscriptionProgram), 화면용 이름표·설치 출처 일부 정리.
 *
 * Windows 의 npm 명령(%APPDATA%\npm\claude.cmd)은 .cmd 껍데기라 Node 가 셸 없이 띄우지 못한다 →
 * 그 뒤의 실제 프로그램(claude.exe, Codex 는 JS 입구가 띄우는 네이티브 codex.exe)을 찾는다.
 * macOS 는 Finder 로 켠 앱의 PATH 가 짧아 Homebrew·~/.local/bin·nvm 폴더를 따로 본다.
 */

import { constants } from 'node:fs';
import { access, open, readdir, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, delimiter, dirname, extname, isAbsolute, join, resolve, sep } from 'node:path';
import { CliRunError, PROGRAM_LABEL, type SubscriptionProviderId } from './messages.js';

export type ProgramSource = 'configured' | 'managed' | 'path' | 'npm' | 'native-installer' | 'winget';

/** spawn 으로 바로 띄울 수 있게 풀어 둔 구독 프로그램 */
export interface SubscriptionProgram {
  provider: SubscriptionProviderId;
  /** 띄울 파일의 절대 경로. .cmd 껍데기는 절대 아님 */
  command: string;
  /** 프로그램 인자 앞에 붙는 것 (command 가 Node 면 JS 입구) */
  prefixArgs: string[];
  /** 정리한 환경 위에 더할 변수 */
  env: Record<string, string>;
  /** 프로그램 자체 (command 거나 그것이 돌리는 JS 입구) */
  entry: string;
  source: ProgramSource;
}

export interface LocateOptions {
  /** 사용자가 정한 위치 (설정의 cli_path). 자동 찾기보다 먼저 */
  configuredPath?: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  arch?: string;
  /** JS 입구를 돌릴 Node. 없으면 이 프로세스(동봉 Node) */
  nodeRuntime?: string;
  /** 시험용: Codex 데스크톱 앱의 bin 폴더 */
  managedInstallRoot?: string;
  /** 시험용: PATH 뒤에 볼 POSIX 폴더 */
  commonDirs?: string[];
}

interface Layout {
  name: string;
  npmPackage: string[];
  npmEntry: string[];
}

const LAYOUTS: Record<SubscriptionProviderId, Layout> = {
  'claude-code': { name: 'claude', npmPackage: ['@anthropic-ai', 'claude-code'], npmEntry: ['bin', 'claude.exe'] },
  codex: { name: 'codex', npmPackage: ['@openai', 'codex'], npmEntry: ['bin', 'codex.js'] },
};

const SHIM_READ_LIMIT = 64 * 1024;
const JS_EXTENSIONS = new Set(['.js', '.cjs', '.mjs']);

interface Context {
  provider: SubscriptionProviderId;
  layout: Layout;
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  arch: string;
  nodeRuntime: string;
  commonDirs: string[] | undefined;
}

function cleanPath(value: string | undefined): string {
  const t = (value ?? '').trim();
  if (t.length >= 2 && ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")))) return t.slice(1, -1);
  return t;
}

function homeOf(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string {
  return (platform === 'win32' ? (env.USERPROFILE ?? env.HOME) : env.HOME) || homedir();
}

function expandHome(value: string, home: string): string {
  if (value === '~') return home;
  if (value.startsWith('~/') || value.startsWith('~\\')) return join(home, value.slice(2));
  return value;
}

async function fileExists(path: string): Promise<boolean> {
  try { return (await stat(path)).isFile(); } catch { return false; }
}

async function isDirectory(path: string): Promise<boolean> {
  try { return (await stat(path)).isDirectory(); } catch { return false; }
}

function isInside(path: string, root: string, platform: NodeJS.Platform): boolean {
  const p = platform === 'win32' ? resolve(path).toLowerCase() : resolve(path);
  const r = platform === 'win32' ? resolve(root).toLowerCase() : resolve(root);
  return p === r || p.startsWith(`${r}${sep}`);
}

/** 온전한 절대 폴더만 — 상대 경로는 작업 폴더(문서가 있는 폴더일 수 있음)에서 풀리므로 버린다 */
function isFullDir(dir: string): boolean {
  return isAbsolute(dir) && !(sep === '\\' && /^[\\/](?![\\/])/.test(dir));
}

function pathDirs(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string[] {
  const value = env.PATH ?? env.Path ?? env.path ?? '';
  if (!value) return [];
  return value.split(platform === 'win32' ? ';' : delimiter).map(cleanPath).filter(isFullDir);
}

function native(ctx: Context, command: string, source: ProgramSource, env: Record<string, string> = {}): SubscriptionProgram {
  return { provider: ctx.provider, command, prefixArgs: [], env, entry: command, source };
}

// ── Codex: 데스크톱 앱이 깔아 둔 사본 (Windows %LOCALAPPDATA%\OpenAI\Codex\bin\<해시>\codex.exe) ──

function managedCodexRoot(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string | undefined {
  if (platform !== 'win32') return undefined;
  const local = env.LOCALAPPDATA ?? env.LocalAppData;
  return local ? join(local, 'OpenAI', 'Codex', 'bin') : undefined;
}

async function newestManagedCodex(root: string, platform: NodeJS.Platform): Promise<string | null> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const exe = platform === 'win32' ? 'codex.exe' : 'codex';
  const found = (await Promise.all(entries.filter((e) => e.isDirectory()).map(async (e) => {
    const path = join(root, e.name, exe);
    try {
      const [info, dirInfo] = await Promise.all([stat(path), stat(join(root, e.name))]);
      if (!info.isFile()) return null;
      const companion = platform !== 'win32' || (await fileExists(join(root, e.name, 'codex-code-mode-host.exe')));
      return { path, modified: Math.max(info.mtimeMs, dirInfo.mtimeMs), companion };
    } catch { return null; }
  }))).filter((c) => c !== null);
  const complete = found.filter((c) => c.companion);
  const pool = complete.length ? complete : found;
  pool.sort((a, b) => b.modified - a.modified || b.path.localeCompare(a.path));
  return pool[0]?.path ?? null;
}

// ── Codex: npm 꾸러미의 JS 입구(bin/codex.js)가 고르는 네이티브 실행 파일 ──

function codexTargetTriple(platform: NodeJS.Platform, arch: string): string | null {
  const cpu = arch === 'x64' ? 'x86_64' : arch === 'arm64' ? 'aarch64' : null;
  if (!cpu) return null;
  if (platform === 'win32') return `${cpu}-pc-windows-msvc`;
  if (platform === 'darwin') return `${cpu}-apple-darwin`;
  if (platform === 'linux') return `${cpu}-unknown-linux-musl`;
  return null;
}

async function codexNativeBehindEntry(ctx: Context, entry: string, source: ProgramSource): Promise<SubscriptionProgram | null> {
  const pkg = dirname(dirname(entry));
  if (basename(entry) !== 'codex.js' || basename(dirname(entry)) !== 'bin' || basename(pkg) !== 'codex' || basename(dirname(pkg)) !== '@openai') return null;
  const triple = codexTargetTriple(ctx.platform, ctx.arch);
  if (!triple) return null;
  const platformPackage = `codex-${ctx.platform}-${ctx.arch}`;
  const exe = ctx.platform === 'win32' ? 'codex.exe' : 'codex';
  for (const vendor of [join(pkg, 'node_modules', '@openai', platformPackage, 'vendor'), join(dirname(pkg), platformPackage, 'vendor'), join(pkg, 'vendor')]) {
    const candidate = join(vendor, triple, 'bin', exe);
    if (await fileExists(candidate)) return native(ctx, candidate, source, { CODEX_MANAGED_BY_NPM: '1', CODEX_MANAGED_PACKAGE_ROOT: pkg });
  }
  return null;
}

async function jsEntryProgram(ctx: Context, entry: string, source: ProgramSource, shimDir: string | undefined): Promise<SubscriptionProgram> {
  if (ctx.provider === 'codex') {
    const direct = await codexNativeBehindEntry(ctx, entry, source);
    if (direct) return direct;
  }
  // npm 껍데기는 옆의 node.exe 를 먼저 쓴다
  const adjacent = shimDir ? join(shimDir, ctx.platform === 'win32' ? 'node.exe' : 'node') : undefined;
  const command = adjacent && (await fileExists(adjacent)) ? adjacent : ctx.nodeRuntime;
  return { provider: ctx.provider, command, prefixArgs: [entry], env: {}, entry, source };
}

// ── Windows: .cmd 껍데기 뒤의 프로그램 ──

/** 껍데기가 자기 폴더 기준으로 부르는 대상(%dp0%\… · %~dp0\…) */
async function shimTargets(shim: string): Promise<string[]> {
  let text = '';
  const handle = await open(shim, 'r').catch(() => null);
  if (!handle) return [];
  try {
    const buf = Buffer.alloc(SHIM_READ_LIMIT);
    const { bytesRead } = await handle.read(buf, 0, SHIM_READ_LIMIT, 0);
    text = buf.subarray(0, bytesRead).toString('utf8');
  } catch { return []; } finally { await handle.close().catch(() => undefined); }
  const out: string[] = [];
  for (const m of text.matchAll(/"%(?:~dp0|dp0%)[\\/]?([^"\r\n%]+)"/gi)) {
    const rel = m[1].split(/[\\/]+/).filter(Boolean);
    if (!rel.length || rel.includes('..')) continue;
    out.push(join(dirname(shim), ...rel));
  }
  return out;
}

async function programBehindShim(ctx: Context, shim: string, source: ProgramSource): Promise<SubscriptionProgram | null> {
  const shimDir = dirname(shim);
  for (const candidate of [...(await shimTargets(shim)), join(shimDir, 'node_modules', ...ctx.layout.npmPackage, ...ctx.layout.npmEntry)]) {
    const ext = extname(candidate).toLowerCase();
    const name = basename(candidate).toLowerCase();
    if (name === 'node.exe' || name === 'node') continue; // 껍데기의 Node 는 프로그램이 아니다
    if (!(await fileExists(candidate))) continue;
    if (ext === '.exe') return native(ctx, candidate, source);
    if (JS_EXTENSIONS.has(ext)) return jsEntryProgram(ctx, candidate, source, shimDir);
  }
  return null;
}

async function programFromFile(ctx: Context, file: string, source: ProgramSource): Promise<SubscriptionProgram | null> {
  const ext = extname(file).toLowerCase();
  if (ctx.platform === 'win32') {
    if (ext === '.exe') return native(ctx, file, source);
    if (ext === '.cmd' || ext === '.bat') return programBehindShim(ctx, file, source);
    if (JS_EXTENSIONS.has(ext)) return jsEntryProgram(ctx, file, source, undefined);
    // npm 은 .cmd 옆에 .ps1 과 확장자 없는 sh 껍데기도 둔다
    const sibling = join(dirname(file), `${basename(file, extname(file))}.cmd`);
    if ((ext === '.ps1' || ext === '') && (await fileExists(sibling))) return programBehindShim(ctx, sibling, source);
    return null;
  }
  const real = await realpath(file).catch(() => file);
  if (ctx.provider === 'codex' && JS_EXTENSIONS.has(extname(real).toLowerCase())) {
    const direct = await codexNativeBehindEntry(ctx, real, source);
    if (direct) return direct;
  }
  return native(ctx, file, source);
}

async function programInDir(ctx: Context, dir: string, name: string, source: ProgramSource): Promise<SubscriptionProgram | null> {
  if (ctx.platform === 'win32') {
    for (const ext of ['.exe', '.cmd']) {
      const candidate = join(dir, `${name}${ext}`);
      if (!(await fileExists(candidate))) continue;
      const program = await programFromFile(ctx, candidate, source);
      if (program) return program;
    }
    return null;
  }
  const candidate = join(dir, name);
  if (!(await fileExists(candidate))) return null;
  try { await access(candidate, constants.X_OK); } catch { return null; }
  return programFromFile(ctx, candidate, source);
}

/** Finder·Dock 으로 켠 앱은 PATH 가 짧다 → npm·Homebrew·버전 관리자·Claude 설치기 폴더를 직접 본다 */
async function commonUnixBinDirs(home: string): Promise<string[]> {
  const dirs = ['/opt/homebrew/bin', '/usr/local/bin'];
  if (home) {
    dirs.push(join(home, '.local', 'bin'), join(home, '.npm-global', 'bin'), join(home, '.volta', 'bin'), join(home, '.bun', 'bin'), join(home, '.yarn', 'bin'));
    const nvm = join(home, '.nvm', 'versions', 'node');
    for (const v of (await readdir(nvm).catch(() => [] as string[])).sort().reverse()) dirs.push(join(nvm, v, 'bin'));
  }
  return dirs;
}

/** winget 이 Links 에 잇지 못하면 이 아래에 풀어 둔다 */
async function wingetCodexPackage(localAppData: string): Promise<string | null> {
  const packages = join(localAppData, 'Microsoft', 'WinGet', 'Packages');
  for (const entry of (await readdir(packages).catch(() => [] as string[])).filter((n) => /^OpenAI\.Codex_/i.test(n)).sort()) {
    const exes = (await readdir(join(packages, entry)).catch(() => [] as string[])).filter((n) => /^codex(-[\w.-]+)?\.exe$/i.test(n)).sort();
    const best = exes.find((n) => n.toLowerCase() === 'codex.exe') ?? exes[0];
    if (best && (await fileExists(join(packages, entry, best)))) return join(packages, entry, best);
  }
  return null;
}

function windowsFallbackDirs(ctx: Context): Array<{ dir: string; source: ProgramSource }> {
  const home = homeOf(ctx.env, 'win32');
  const appData = ctx.env.APPDATA ?? (home ? join(home, 'AppData', 'Roaming') : undefined);
  const local = ctx.env.LOCALAPPDATA ?? ctx.env.LocalAppData;
  const dirs: Array<{ dir: string; source: ProgramSource }> = [];
  // `irm https://claude.ai/install.ps1 | iex` 가 claude.exe 를 두는 곳
  if (ctx.provider === 'claude-code' && home) dirs.push({ dir: join(home, '.local', 'bin'), source: 'native-installer' });
  if (appData) dirs.push({ dir: join(appData, 'npm'), source: 'npm' });
  if (local) dirs.push({ dir: join(local, 'Microsoft', 'WinGet', 'Links'), source: 'winget' });
  return dirs;
}

async function searchByName(ctx: Context, name: string, pathSource: ProgramSource, fallbackSource?: ProgramSource): Promise<SubscriptionProgram | null> {
  for (const dir of pathDirs(ctx.env, ctx.platform)) {
    const p = await programInDir(ctx, dir, name, pathSource);
    if (p) return p;
  }
  if (ctx.platform === 'win32') {
    for (const { dir, source } of windowsFallbackDirs(ctx)) {
      const p = await programInDir(ctx, dir, name, fallbackSource ?? source);
      if (p) return p;
    }
    return null;
  }
  for (const dir of ctx.commonDirs ?? (await commonUnixBinDirs(homeOf(ctx.env, ctx.platform)))) {
    const p = await programInDir(ctx, dir, name, fallbackSource ?? 'path');
    if (p) return p;
  }
  return null;
}

/** 구독 프로그램을 셸 없이 띄울 수 있는 모양으로. 없으면 null.
 *  순서: 사용자가 정한 위치 → Codex 데스크톱 사본 → PATH → PATH 에 아직 없을 수 있는 설치 위치 */
export async function locateSubscriptionProgram(provider: SubscriptionProviderId, options: LocateOptions = {}): Promise<SubscriptionProgram | null> {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const ctx: Context = {
    provider, layout: LAYOUTS[provider], env, platform,
    arch: options.arch ?? process.arch,
    nodeRuntime: options.nodeRuntime ?? process.execPath,
    commonDirs: options.commonDirs,
  };
  const { name } = ctx.layout;
  const managedRoot = provider === 'codex' ? (options.managedInstallRoot ?? managedCodexRoot(platform, env)) : undefined;

  const configured = expandHome(cleanPath(options.configuredPath), homeOf(env, platform));
  if (configured) {
    if (isAbsolute(configured) || /[\\/]/.test(configured)) {
      const abs = resolve(configured);
      if (!(managedRoot && isInside(abs, managedRoot, platform))) {
        const p = (await isDirectory(abs)) ? await programInDir(ctx, abs, name, 'configured')
          : (await fileExists(abs)) ? await programFromFile(ctx, abs, 'configured') : null;
        if (p) return p;
      }
    } else {
      const bare = /\.(exe|cmd|bat)$/i.test(configured) ? configured.slice(0, -extname(configured).length) : configured;
      const p = await searchByName(ctx, bare, 'configured', 'configured');
      if (p) return p;
    }
  }

  if (managedRoot) {
    const managed = await newestManagedCodex(managedRoot, platform);
    if (managed) return native(ctx, managed, 'managed');
  }
  const found = await searchByName(ctx, name, 'path');
  if (found) return found;
  if (provider === 'codex' && platform === 'win32') {
    const local = env.LOCALAPPDATA ?? env.LocalAppData;
    const packaged = local ? await wingetCodexPackage(local) : null;
    if (packaged) return native(ctx, packaged, 'winget');
  }
  return null;
}

/** locateSubscriptionProgram — 없으면 설치·로그인 방법을 적은 오류 */
export async function resolveSubscriptionProgram(provider: SubscriptionProviderId, options: LocateOptions = {}): Promise<SubscriptionProgram> {
  const p = await locateSubscriptionProgram(provider, options);
  if (p) return p;
  throw new CliRunError('not-installed', provider, `${PROGRAM_LABEL[provider]} 프로그램을 이 PC에서 찾지 못했습니다.`);
}
