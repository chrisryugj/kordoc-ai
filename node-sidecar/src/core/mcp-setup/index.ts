/** MCP 설치 마법사 — AI 클라이언트에 kordoc MCP 서버 자동 등록 */

import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { homedir, platform } from 'node:os';
import { existsSync } from 'node:fs';
import { logger } from '../../infra/logger.js';

// ── Types ────────────────────────────────────────────────────────

export interface McpClient {
  id: string;
  name: string;
  configPath: string;
  format: 'mcpServers' | 'servers' | 'context_servers';
  detected: boolean;
  installed: boolean;
}

export interface McpEnvInfo {
  nodeInstalled: boolean;
  nodeVersion: string | null;
  npxAvailable: boolean;
  clients: McpClient[];
}

export interface McpInstallResult {
  success: boolean;
  results: { clientId: string; clientName: string; ok: boolean; error?: string }[];
}

// ── Helpers ───────────────────────────────────────────────────────

function getClientConfigs(): { id: string; name: string; configPath: string; format: McpClient['format'] }[] {
  const home = homedir();
  const os = platform();
  const clients: { id: string; name: string; configPath: string; format: McpClient['format'] }[] = [];

  // Claude Desktop
  const claudePaths: Record<string, string> = {
    darwin: resolve(home, 'Library/Application Support/Claude/claude_desktop_config.json'),
    win32: resolve(process.env['APPDATA'] ?? resolve(home, 'AppData/Roaming'), 'Claude/claude_desktop_config.json'),
    linux: resolve(home, '.config/Claude/claude_desktop_config.json'),
  };
  const claudePath = claudePaths[os];
  if (claudePath) {
    clients.push({ id: 'claude-desktop', name: 'Claude Desktop', configPath: claudePath, format: 'mcpServers' });
  }

  // Cursor
  clients.push({
    id: 'cursor',
    name: 'Cursor',
    configPath: resolve(home, '.cursor/mcp.json'),
    format: 'mcpServers',
  });

  // VS Code (사용자 전역 설정)
  const vscodePaths: Record<string, string> = {
    win32: resolve(process.env['APPDATA'] ?? resolve(home, 'AppData/Roaming'), 'Code/User/settings.json'),
    darwin: resolve(home, 'Library/Application Support/Code/User/settings.json'),
    linux: resolve(home, '.config/Code/User/settings.json'),
  };
  const vscodePath = vscodePaths[os];
  if (vscodePath) {
    clients.push({ id: 'vscode', name: 'VS Code', configPath: vscodePath, format: 'mcpServers' });
  }

  // Windsurf
  clients.push({
    id: 'windsurf',
    name: 'Windsurf',
    configPath: resolve(home, '.codeium/windsurf/mcp_config.json'),
    format: 'mcpServers',
  });

  // Gemini CLI
  clients.push({
    id: 'gemini-cli',
    name: 'Gemini CLI',
    configPath: resolve(home, '.gemini/settings.json'),
    format: 'mcpServers',
  });

  // Zed
  const zedPaths: Record<string, string> = {
    darwin: resolve(home, '.zed/settings.json'),
    linux: resolve(home, '.config/zed/settings.json'),
    win32: resolve(home, '.zed/settings.json'),
  };
  const zedPath = zedPaths[os];
  if (zedPath) {
    clients.push({ id: 'zed', name: 'Zed', configPath: zedPath, format: 'context_servers' });
  }

  return clients;
}

async function readJsonFile(path: string): Promise<Record<string, unknown>> {
  try {
    const raw = await readFile(path, 'utf-8');
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function writeJsonFile(path: string, data: Record<string, unknown>): Promise<void> {
  const dir = dirname(path);
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
  await writeFile(path, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

function buildServerEntry(): Record<string, unknown> {
  return {
    command: 'npx',
    args: ['-y', 'kordoc@latest'],
  };
}

function buildZedEntry(): Record<string, unknown> {
  return {
    command: {
      path: 'npx',
      args: ['-y', 'kordoc@latest'],
    },
  };
}

/** shell 명령 실행 헬퍼 — Windows에서 .cmd 파일(npx 등) 실행을 위해 shell 사용 */
function exec(cmd: string, args: string[]): Promise<string> {
  const isWin = platform() === 'win32';
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 10_000, windowsHide: true, shell: isWin }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout.trim());
    });
  });
}

/** 시스템 PATH에서 Node.js 검사 */
async function checkSystemNode(): Promise<{ installed: boolean; version: string | null; npx: boolean }> {
  let installed = false;
  let version: string | null = null;
  let npx = false;

  try {
    const v = await exec('node', ['--version']);
    if (v.startsWith('v')) { installed = true; version = v; }
  } catch { /* not found */ }

  try {
    await exec('npx', ['--version']);
    npx = true;
  } catch { /* not found */ }

  return { installed, version, npx };
}

/** 앱 설치 여부 감지 — 설정파일, 부모 디렉토리, 알려진 설치 경로 순으로 확인 */
async function isAppDetected(configPath: string, id: string): Promise<boolean> {
  // 1) 설정 파일 자체가 존재
  try { await access(configPath); return true; } catch {}

  // 2) 설정 파일의 부모 디렉토리가 존재 (앱 설치됨, MCP 미설정)
  try { await access(dirname(configPath)); return true; } catch {}

  // 3) 알려진 앱 설치 경로 (Windows)
  if (platform() === 'win32') {
    const local = process.env['LOCALAPPDATA'] ?? '';
    const appdata = process.env['APPDATA'] ?? '';
    const home = homedir();
    const knownPaths: Record<string, string[]> = {
      'claude-desktop': [
        resolve(local, 'AnthropicClaude'),
        resolve(local, 'Programs/claude-desktop'),
        resolve(appdata, 'Claude'),
      ],
      'cursor': [
        resolve(local, 'Programs/cursor'),
        resolve(home, '.cursor'),
      ],
      'vscode': [
        resolve(local, 'Programs/Microsoft VS Code'),
        resolve(appdata, 'Code'),
      ],
      'windsurf': [
        resolve(local, 'Programs/windsurf'),
        resolve(home, '.codeium'),
      ],
      'gemini-cli': [
        resolve(home, '.gemini'),
      ],
      'zed': [
        resolve(home, '.zed'),
      ],
    };
    for (const dir of knownPaths[id] ?? []) {
      try { await access(dir); return true; } catch {}
    }
  } else {
    // macOS/Linux — 부모 디렉토리만으로 충분
    const home = homedir();
    const knownPaths: Record<string, string[]> = {
      'claude-desktop': [resolve(home, 'Library/Application Support/Claude')],
      'cursor': [resolve(home, '.cursor')],
      'windsurf': [resolve(home, '.codeium')],
      'gemini-cli': [resolve(home, '.gemini')],
      'zed': [resolve(home, '.zed')],
    };
    for (const dir of knownPaths[id] ?? []) {
      try { await access(dir); return true; } catch {}
    }
  }

  return false;
}

// ── Public API ────────────────────────────────────────────────────

/** 환경 감지: Node.js 설치 여부 + AI 클라이언트 목록 */
export async function detectMcpEnv(): Promise<McpEnvInfo> {
  // Node.js 검사 — 실패해도 클라이언트 감지는 계속
  let nodeInfo = { installed: false, version: null as string | null, npx: false };
  try {
    nodeInfo = await checkSystemNode();
  } catch (err) {
    logger.warn(`[mcp-setup] Node.js 검사 실패: ${err}`);
  }

  const clientConfigs = getClientConfigs();
  const clients: McpClient[] = [];

  for (const cc of clientConfigs) {
    let detected = false;
    let installed = false;

    try {
      // 앱 설치 감지 (설정파일 + 부모디렉토리 + 알려진 경로)
      detected = await isAppDetected(cc.configPath, cc.id);

      // 이미 kordoc이 등록되어 있는지 확인 (설정파일이 있을 때만)
      if (detected) {
        try {
          const config = await readJsonFile(cc.configPath);
          const servers = config[cc.format] as Record<string, unknown> | undefined;
          if (servers && ('kordoc' in servers)) {
            installed = true;
          }
        } catch { /* config 파일 없거나 파싱 실패 — 앱은 설치됨 */ }
      }
    } catch (err) {
      logger.warn(`[mcp-setup] ${cc.name} 감지 오류: ${err}`);
    }

    clients.push({
      id: cc.id,
      name: cc.name,
      configPath: cc.configPath,
      format: cc.format,
      detected,
      installed,
    });
  }

  return {
    nodeInstalled: nodeInfo.installed,
    nodeVersion: nodeInfo.version,
    npxAvailable: nodeInfo.npx,
    clients,
  };
}

/** 선택한 클라이언트에 kordoc MCP 설정 기록 */
export async function installMcpConfig(clientIds: string[]): Promise<McpInstallResult> {
  const clientConfigs = getClientConfigs();
  const results: McpInstallResult['results'] = [];
  const entry = buildServerEntry();

  for (const id of clientIds) {
    const cc = clientConfigs.find((c) => c.id === id);
    if (!cc) {
      results.push({ clientId: id, clientName: id, ok: false, error: '알 수 없는 클라이언트' });
      continue;
    }

    try {
      const config = await readJsonFile(cc.configPath);
      const serverEntry = cc.format === 'context_servers' ? buildZedEntry() : entry;
      const servers = (config[cc.format] ?? {}) as Record<string, unknown>;
      servers['kordoc'] = serverEntry;
      config[cc.format] = servers;
      await writeJsonFile(cc.configPath, config);
      logger.info(`[mcp-setup] ${cc.name}: kordoc MCP 등록 완료 → ${cc.configPath}`);
      results.push({ clientId: id, clientName: cc.name, ok: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`[mcp-setup] ${cc.name}: 등록 실패 — ${msg}`);
      results.push({ clientId: id, clientName: cc.name, ok: false, error: msg });
    }
  }

  return { success: results.every((r) => r.ok), results };
}

/** Node.js 설치 시작 (Windows: winget, macOS: brew, 그 외: 안내) */
export async function installNode(): Promise<{ started: boolean; method: string; error?: string }> {
  const os = platform();

  try {
    if (os === 'win32') {
      // winget 사용 가능 여부 확인
      try {
        await exec('where', ['winget']);
        // winget으로 Node.js LTS 설치 (비동기 — 새 창 열림)
        execFile('winget', ['install', 'OpenJS.NodeJS.LTS', '--accept-package-agreements', '--accept-source-agreements'], {
          windowsHide: false,
          detached: true,
          stdio: 'ignore',
        } as any).unref?.();
        return { started: true, method: 'winget' };
      } catch {
        // winget 없으면 다운로드 페이지 열기
        execFile('explorer', ['https://nodejs.org'], { windowsHide: true } as any);
        return { started: true, method: 'browser' };
      }
    } else if (os === 'darwin') {
      try {
        await exec('which', ['brew']);
        execFile('brew', ['install', 'node'], { detached: true, stdio: 'ignore' } as any).unref?.();
        return { started: true, method: 'brew' };
      } catch {
        execFile('open', ['https://nodejs.org'], {});
        return { started: true, method: 'browser' };
      }
    } else {
      // Linux — 안내만
      return { started: false, method: 'manual', error: 'https://nodejs.org 에서 수동 설치' };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { started: false, method: 'error', error: msg };
  }
}
