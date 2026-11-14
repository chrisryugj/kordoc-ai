/** MCP 원클릭 — PC 의 AI 에이전트에 KorDoc AI MCP 서버('kordoc-ai') 등록
 *
 * npx 없이 동봉 Node(process.execPath) + 이 엔진 번들 + --mcp 로 등록한다 (폐쇄망 PC 에서도 동작).
 * 도구는 앱의 'AI에게 일 시키기'와 같은 목록(core/agent-tools). 예전 판이 등록한 'kordoc'(앱에 든 kordoc/dist/mcp.js)은 지운다.
 * 폐쇄망 모드면 KORDOC_OFFLINE=1, root_dir 을 주면 KORDOC_ROOT(그 폴더 밖 파일 차단), 앱이 받아 둔 OCR 모델을 같이 쓰게 KORDOC_MODEL_CACHE.
 * 설정 파일에 주석(JSONC)이 있으면 주석을 뺀 채 다시 쓰므로 원본을 `.kordoc-backup` 으로 남긴다.
 * 읽을 수 없는 설정 파일은 덮어쓰지 않는다 (사용자 설정 보호). Codex 는 TOML 이라 우리 서버 표만 바꿔 쓴다.
 */

import { existsSync } from 'node:fs';
import { chmod, copyFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { McpEnv } from '../../types/rpc-contract.js';
import { getSettings } from '../../infra/config.js';
import { logger } from '../../infra/logger.js';
import { renameRetry } from '../../infra/rename.js';
import { kordocMcpPath } from '../kordoc-cli.js';
import { modelCacheDir } from '../system/index.js';

type Key = 'mcpServers' | 'servers' | 'context_servers' | 'toml';
/** probeOnly: 설정 파일의 위 폴더가 늘 있어(홈) 설치 여부를 probes 로만 본다 */
interface ClientDef { id: string; name: string; configPath: string; key: Key; probes: string[]; probeOnly?: boolean }

export const SERVER_NAME = 'kordoc-ai';

/** MCP 로 띄울 엔진 진입 파일 — 설치본은 이 번들 자신(dist/bundle.mjs). 소스·tsc 출력에서 개발할 땐 레포의 dist/bundle.mjs */
export function engineEntryPath(): string {
  const self = fileURLToPath(import.meta.url);
  return /bundle\.mjs$/.test(self) ? self : resolve(dirname(self), '..', '..', '..', 'dist', 'bundle.mjs');
}

function clientDefs(): ClientDef[] {
  const home = homedir();
  const win = process.platform === 'win32';
  const mac = process.platform === 'darwin';
  const appData = process.env.APPDATA ?? join(home, 'AppData', 'Roaming');
  const local = process.env.LOCALAPPDATA ?? join(home, 'AppData', 'Local');
  const userCfg = win ? appData : mac ? join(home, 'Library', 'Application Support') : join(home, '.config');
  return [
    { id: 'claude-code', name: 'Claude Code', key: 'mcpServers', configPath: join(home, '.claude.json'), probes: [join(home, '.claude')], probeOnly: true },
    { id: 'codex', name: 'Codex', key: 'toml', configPath: join(home, '.codex', 'config.toml'), probes: [join(home, '.codex')] },
    { id: 'claude-desktop', name: 'Claude Desktop', key: 'mcpServers', configPath: join(userCfg, 'Claude', 'claude_desktop_config.json'),
      probes: win ? [join(local, 'AnthropicClaude'), join(local, 'Programs', 'claude-desktop')] : mac ? ['/Applications/Claude.app'] : [] },
    { id: 'cursor', name: 'Cursor', key: 'mcpServers', configPath: join(home, '.cursor', 'mcp.json'),
      probes: win ? [join(local, 'Programs', 'cursor')] : mac ? ['/Applications/Cursor.app'] : [] },
    { id: 'vscode', name: 'VS Code', key: 'servers', configPath: join(userCfg, 'Code', 'User', 'mcp.json'),
      probes: win ? [join(local, 'Programs', 'Microsoft VS Code')] : mac ? ['/Applications/Visual Studio Code.app'] : [] },
    { id: 'windsurf', name: 'Windsurf', key: 'mcpServers', configPath: join(home, '.codeium', 'windsurf', 'mcp_config.json'),
      probes: win ? [join(local, 'Programs', 'windsurf')] : mac ? ['/Applications/Windsurf.app'] : [] },
    { id: 'gemini-cli', name: 'Gemini CLI', key: 'mcpServers', configPath: join(home, '.gemini', 'settings.json'), probes: [] },
    { id: 'zed', name: 'Zed', key: 'context_servers', configPath: win || mac ? join(home, '.zed', 'settings.json') : join(home, '.config', 'zed', 'settings.json'),
      probes: mac ? ['/Applications/Zed.app'] : [] },
  ];
}

/** 주석·끝 쉼표를 뺀 JSON (문자열 안은 건드리지 않음) */
function stripJsonc(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j;
    } else if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
    } else if (ch === '/' && text[i + 1] === '*') {
      i = text.indexOf('*/', i + 2);
      if (i < 0) break;
      i++;
    } else out += ch;
  }
  return out.replace(/,(\s*[}\]])/g, '$1');
}

/** 설정 파일 읽기 — 없으면 {}, JSONC 면 hadComments, 아예 못 읽으면 오류 */
async function readConfig(path: string): Promise<{ data: Record<string, unknown>; hadComments: boolean }> {
  if (!existsSync(path)) return { data: {}, hadComments: false };
  const raw = (await readFile(path, 'utf-8')).replace(/^﻿/, '');
  if (!raw.trim()) return { data: {}, hadComments: false };
  try {
    return { data: JSON.parse(raw) as Record<string, unknown>, hadComments: false };
  } catch {
    try {
      return { data: JSON.parse(stripJsonc(raw)) as Record<string, unknown>, hadComments: true };
    } catch {
      throw new Error(`설정 파일을 읽을 수 없어 건드리지 않았습니다. 직접 확인하세요: ${path}`);
    }
  }
}

const serverArgs = (): string[] => [engineEntryPath(), '--mcp'];

function serverEntry(key: Key, env: Record<string, string>): Record<string, unknown> {
  const command = process.execPath;
  const args = serverArgs();
  const withEnv = Object.keys(env).length ? { env } : {};
  if (key === 'servers') return { type: 'stdio', command, args, ...withEnv };
  if (key === 'context_servers') return { command: { path: command, args, ...withEnv } };
  return { command, args, ...withEnv };
}

/** 예전 판 앱이 등록한 kordoc 항목 (앱에 든 kordoc/dist/mcp.js) — 사용자가 따로 등록한 kordoc(npx 등)은 둔다 */
function isOldAppEntry(v: unknown): boolean {
  const e = v as { args?: unknown; command?: { args?: unknown } } | undefined;
  const args = Array.isArray(e?.args) ? e.args : Array.isArray(e?.command?.args) ? e.command.args : [];
  return typeof args[0] === 'string' && resolve(args[0]) === resolve(kordocMcpPath());
}

/** TOML 표 머리 [a.b]·[[a.b]] — 값 줄의 배열("[1, 2],")·여러 줄 배열 조각과 가르려고 ] 뒤에는 주석만 허용 */
const TOML_HEADER = /^\s*\[\[?\s*([^[\]=]+?)\s*\]\]?\s*(#.*)?$/;
const TOML_KEY = /^\s*([A-Za-z0-9_\-.'" ]+?)\s*=/;
const tomlParts = (k: string) => k.split('.').map((s) => s.trim().replace(/^(["'])(.*)\1$/, '$2'));
const isOurs = (parts: string[]) => parts[0] === 'mcp_servers' && parts[1] === SERVER_NAME;

/** Codex config.toml 에서 우리 서버를 뺀 줄들 — [mcp_servers.kordoc-ai] 표(하위 표 포함, 머리 뒤 주석·따옴표 키),
 *  [mcp_servers] 안의 kordoc-ai = { … } 인라인 표·점 키, 맨 위의 mcp_servers.kordoc-ai.… 점 키 */
function stripTomlServer(text: string): { kept: string[]; found: boolean } {
  const kept: string[] = [];
  let table: string[] = [];
  let skipping = false;
  let found = false;
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    const head = TOML_HEADER.exec(line);
    if (head) {
      table = tomlParts(head[1]);
      skipping = isOurs(table);
      found ||= skipping;
      if (!skipping) kept.push(line);
      continue;
    }
    if (skipping) continue;
    const key = TOML_KEY.exec(line);
    if (key && isOurs([...table, ...tomlParts(key[1])])) { found = true; continue; }
    kept.push(line);
  }
  return { kept, found };
}

/** Codex config.toml: 우리 서버를 빼고 끝에 새로 붙인다. JSON 문자열은 TOML 기본 문자열과 같은 꼴이라 그대로 쓴다 */
export function withTomlServer(text: string, env: Record<string, string>): string {
  const keep = stripTomlServer(text).kept;
  while (keep.length && !keep[keep.length - 1].trim()) keep.pop();
  const q = (s: string) => JSON.stringify(s);
  const block = [
    `[mcp_servers.${SERVER_NAME}]`,
    `command = ${q(process.execPath)}`,
    `args = [${serverArgs().map(q).join(', ')}]`,
    ...(Object.keys(env).length ? [`env = { ${Object.entries(env).map(([k, v]) => `${k} = ${q(v)}`).join(', ')} }`] : []),
  ];
  return `${keep.length ? `${keep.join('\n')}\n\n` : ''}${block.join('\n')}\n`;
}

/** 사용자 원래 설정을 한 번만 남긴다 (두 번째 등록부터 앱이 고친 것으로 덮이지 않게) */
async function backupOnce(path: string): Promise<void> {
  const bak = `${path}.kordoc-backup`;
  if (!existsSync(bak)) await copyFile(path, bak);
}

/** 설정 파일을 통째로 바꿔 쓴다 (옆에 다 쓴 뒤 바꿔치기). 다른 프로그램(Claude·Codex 등)의 설정이라,
 *  쓰는 도중에 꺼지거나 디스크가 차면 반쯤 쓴 파일이 남아 그 프로그램의 설정이 통째로 날아간다 */
async function writeWhole(path: string, text: string): Promise<void> {
  const tmp = `${path}.kordoc-tmp`;
  // 원래 권한을 그대로 — 다른 MCP 서버의 토큰을 흔히 담은 0600 파일(~/.claude.json 등)이 기본 0644 임시 파일로 바꿔치기돼 다른 계정이 읽게 됐다
  const mode = await stat(path).then((st) => st.mode & 0o777, () => 0o600);
  try {
    await writeFile(tmp, text, { encoding: 'utf-8', mode });
    await chmod(tmp, mode);
    await renameRetry(tmp, path);
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw err;
  }
}

async function isConfigured(c: ClientDef): Promise<boolean> {
  if (!existsSync(c.configPath)) return false;
  if (c.key === 'toml') return stripTomlServer(await readFile(c.configPath, 'utf-8')).found;
  const servers = (await readConfig(c.configPath)).data[c.key];
  return !!servers && typeof servers === 'object' && SERVER_NAME in (servers as object);
}

export async function detectMcpEnv(): Promise<McpEnv> {
  const clients = await Promise.all(clientDefs().map(async (c) => {
    const installed = c.probes.some((p) => existsSync(p)) || (!c.probeOnly && (existsSync(c.configPath) || existsSync(dirname(c.configPath))));
    const configured = await isConfigured(c).catch(() => false); // 못 읽는 설정 — 등록 안 된 것으로
    return { id: c.id, name: c.name, installed, configured, config_path: c.configPath };
  }));
  return { clients };
}

export async function installMcpConfig(ids: string[], rootDir?: string): Promise<{ installed: string[]; failed: Array<{ client: string; error: string }> }> {
  const env: Record<string, string> = { KORDOC_MODEL_CACHE: modelCacheDir() };
  // AI 프로그램은 자식에게 정해진 환경 변수만 넘긴다. 기관 정책 파일 자리(%ProgramData%)를 엔진이 찾을 수 있게 함께 적는다
  if (process.platform === 'win32' && process.env.ProgramData) env.ProgramData = process.env.ProgramData;
  if (getSettings().privacy.offline) env.KORDOC_OFFLINE = '1';
  if (rootDir) env.KORDOC_ROOT = rootDir;
  if (!existsSync(engineEntryPath())) throw new Error('엔진 번들(dist/bundle.mjs)이 없어 등록할 수 없습니다. 개발 중이면 node scripts/build-sidecar.mjs 로 먼저 만드세요.');
  const defs = clientDefs();
  const installed: string[] = [];
  const failed: Array<{ client: string; error: string }> = [];
  for (const id of ids) {
    const c = defs.find((d) => d.id === id);
    if (!c) {
      failed.push({ client: id, error: '모르는 프로그램입니다.' });
      continue;
    }
    try {
      await mkdir(dirname(c.configPath), { recursive: true });
      if (c.key === 'toml') {
        const old = existsSync(c.configPath) ? await readFile(c.configPath, 'utf-8') : '';
        if (old) await backupOnce(c.configPath);
        await writeWhole(c.configPath, withTomlServer(old, env));
      } else {
        const { data, hadComments } = await readConfig(c.configPath);
        const servers = data[c.key] && typeof data[c.key] === 'object' ? (data[c.key] as Record<string, unknown>) : {};
        if (isOldAppEntry(servers.kordoc)) delete servers.kordoc;
        servers[SERVER_NAME] = serverEntry(c.key, env);
        data[c.key] = servers;
        if (hadComments) await backupOnce(c.configPath);
        await writeWhole(c.configPath, `${JSON.stringify(data, null, 2)}\n`);
      }
      logger.info(`[mcp-setup] ${c.name}: ${SERVER_NAME} MCP 등록 → ${c.configPath}`);
      installed.push(id);
    } catch (err) {
      failed.push({ client: id, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { installed, failed };
}
