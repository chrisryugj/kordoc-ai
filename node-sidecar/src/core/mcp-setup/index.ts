/** MCP 원클릭 — AI 클라이언트에 kordoc MCP 서버 등록
 *
 * npx 없이 동봉 Node(process.execPath) + 동봉 kordoc/dist/mcp.js 절대 경로로 등록한다 (폐쇄망 PC 에서도 동작).
 * 폐쇄망 모드면 KORDOC_OFFLINE=1, root_dir 을 주면 KORDOC_ROOT(그 폴더 밖 파일 차단), 앱이 받아 둔 OCR 모델을 같이 쓰게 KORDOC_MODEL_CACHE.
 * 설정 파일에 주석(JSONC)이 있으면 주석을 뺀 채 다시 쓰므로 원본을 `.kordoc-backup` 으로 남긴다.
 * 읽을 수 없는 설정 파일은 덮어쓰지 않는다 (사용자 설정 보호).
 */

import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { McpEnv } from '../../types/rpc-contract.js';
import { getSettings } from '../../infra/config.js';
import { logger } from '../../infra/logger.js';
import { kordocMcpPath } from '../kordoc-cli.js';
import { modelCacheDir } from '../system/index.js';

type Key = 'mcpServers' | 'servers' | 'context_servers';
interface ClientDef { id: string; name: string; configPath: string; key: Key; probes: string[] }

function clientDefs(): ClientDef[] {
  const home = homedir();
  const win = process.platform === 'win32';
  const mac = process.platform === 'darwin';
  const appData = process.env.APPDATA ?? join(home, 'AppData', 'Roaming');
  const local = process.env.LOCALAPPDATA ?? join(home, 'AppData', 'Local');
  const userCfg = win ? appData : mac ? join(home, 'Library', 'Application Support') : join(home, '.config');
  return [
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

function serverEntry(key: Key, env: Record<string, string>): Record<string, unknown> {
  const command = process.execPath;
  const args = [kordocMcpPath()];
  const withEnv = Object.keys(env).length ? { env } : {};
  if (key === 'servers') return { type: 'stdio', command, args, ...withEnv };
  if (key === 'context_servers') return { command: { path: command, args, ...withEnv } };
  return { command, args, ...withEnv };
}

export async function detectMcpEnv(): Promise<McpEnv> {
  const clients = await Promise.all(clientDefs().map(async (c) => {
    const installed = existsSync(c.configPath) || existsSync(dirname(c.configPath)) || c.probes.some((p) => existsSync(p));
    let configured = false;
    try {
      const servers = (await readConfig(c.configPath)).data[c.key];
      configured = !!servers && typeof servers === 'object' && 'kordoc' in (servers as object);
    } catch {
      /* 못 읽는 설정 — 등록 안 된 것으로 */
    }
    return { id: c.id, name: c.name, installed, configured, config_path: c.configPath };
  }));
  return { clients };
}

export async function installMcpConfig(ids: string[], rootDir?: string): Promise<{ installed: string[]; failed: Array<{ client: string; error: string }> }> {
  const env: Record<string, string> = { KORDOC_MODEL_CACHE: modelCacheDir() };
  if (getSettings().privacy.offline) env.KORDOC_OFFLINE = '1';
  if (rootDir) env.KORDOC_ROOT = rootDir;
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
      const { data, hadComments } = await readConfig(c.configPath);
      const servers = data[c.key] && typeof data[c.key] === 'object' ? (data[c.key] as Record<string, unknown>) : {};
      servers.kordoc = serverEntry(c.key, env);
      data[c.key] = servers;
      await mkdir(dirname(c.configPath), { recursive: true });
      if (hadComments) await copyFile(c.configPath, `${c.configPath}.kordoc-backup`);
      await writeFile(c.configPath, `${JSON.stringify(data, null, 2)}\n`, 'utf-8');
      logger.info(`[mcp-setup] ${c.name}: kordoc MCP 등록 → ${c.configPath}`);
      installed.push(id);
    } catch (err) {
      failed.push({ client: id, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { installed, failed };
}
