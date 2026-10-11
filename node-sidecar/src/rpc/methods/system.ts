/** RPC 메서드 — 시스템·설정·파일 열기·목록 펼치기·MCP·모델·배치 매니페스트 */

import { execFile } from 'node:child_process';
import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import type { RpcRouter } from '../router.js';
import { getSettings, updateSettings, maskSecrets } from '../../infra/config.js';
import { syncOfflineEnv } from '../../infra/net-guard.js';
import { unloadEmbedded } from '../../infra/llm/embedded.js';
import { logger } from '../../infra/logger.js';
import { detectMcpEnv, installMcpConfig } from '../../core/mcp-setup/index.js';
import { modelsImport, modelsStatus, selftest, systemInfo } from '../../core/system/index.js';
import { scanPaths } from '../../core/files/index.js';
import { optPath, registrar, reqPath, reqPaths, strList } from './params.js';

/** 탐색기·Finder·기본 앱 실행 — 윈도 explorer 는 성공해도 종료 코드 1 을 자주 내므로 결과를 따지지 않는다 */
function launch(cmd: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: false }, (err) => {
      const code = (err as { code?: unknown } | null)?.code;
      if (err && !(process.platform === 'win32' && code === 1)) logger.warn(`[open] ${cmd} 실패: ${err.message}`);
      resolve(true);
    });
  });
}

const winPath = (p: string) => p.replace(/\//g, '\\');
const opener = () => (process.platform === 'darwin' ? 'open' : 'xdg-open');

/** 기본 앱으로 열어도 되는 확장자 (실행 파일 차단) */
const OPENABLE_EXT = new Set(['.hwp', '.hwpx', '.hml', '.hwpml', '.pdf', '.xls', '.xlsx', '.docx', '.pptx', '.txt', '.md', '.csv', '.html', '.json', '.png', '.jpg', '.jpeg', '.webp']);

export function registerSystem(router: RpcRouter): void {
  const reg = registrar(router);

  reg('ping', () => 'pong');
  reg('system_info', () => systemInfo());
  reg('engine_selftest', (p) => selftest({ ocr: p.ocr as boolean | undefined, llama: p.llama as boolean | undefined }));

  // 설정 — API 키는 가려서 보낸다. 바뀌면 폐쇄망 env·내장 모델 상태를 맞춘다
  reg('get_settings', () => maskSecrets(getSettings()));
  reg('update_settings', async (p) => {
    const patch = p.settings as Record<string, unknown> | undefined;
    if (!patch) throw new Error('바꿀 설정이 없습니다.');
    const prev = getSettings().ai.embedded;
    const next = await updateSettings(patch);
    syncOfflineEnv();
    if (JSON.stringify(prev) !== JSON.stringify(next.ai.embedded)) await unloadEmbedded();
    return maskSecrets(next);
  });

  reg('open_folder', async (p) => {
    const dir = reqPath(p.path);
    if (!(await stat(dir)).isDirectory()) throw new Error('폴더가 아닙니다. 폴더를 고르세요.');
    return launch(process.platform === 'win32' ? 'explorer' : opener(), [process.platform === 'win32' ? winPath(dir) : dir]);
  });

  reg('open_file', async (p) => {
    const file = reqPath(p.path);
    if (!(await stat(file)).isFile()) throw new Error('파일이 아닙니다. 파일을 고르세요.');
    const ext = file.toLowerCase().match(/\.[^.\\/]+$/)?.[0] ?? '';
    if (!OPENABLE_EXT.has(ext)) throw new Error(`이 형식은 앱에서 열 수 없습니다: ${ext || '확장자 없음'}`);
    return launch(process.platform === 'win32' ? 'explorer' : opener(), [process.platform === 'win32' ? winPath(file) : file]);
  });

  // 탐색기·Finder 에서 파일을 고른 채로 폴더 열기
  reg('reveal_file', async (p) => {
    const file = reqPath(p.path);
    await stat(file);
    if (process.platform === 'win32') return launch('explorer', [`/select,${winPath(file)}`]);
    if (process.platform === 'darwin') return launch('open', ['-R', file]);
    return launch('xdg-open', [dirname(file)]);
  });

  reg('list_files', async (p) => {
    const dir = reqPath(p.path);
    const entries = await readdir(dir);
    return Promise.all(entries.map(async (name) => {
      const s = await stat(join(dir, name)).catch(() => null);
      return { name, is_dir: !!s?.isDirectory(), size: s?.size ?? 0 };
    }));
  });

  reg('scan_paths', (p) => scanPaths(reqPaths(p.paths)));

  reg('detect_mcp_env', () => detectMcpEnv());
  reg('install_mcp_config', (p) => {
    const clients = strList(p.clients);
    if (!clients?.length) throw new Error('등록할 프로그램을 하나 이상 고르세요.');
    return installMcpConfig(clients, optPath(p.root_dir));
  });

  reg('models_status', () => modelsStatus());
  reg('models_import', (p) => modelsImport(reqPath(p.dir)));

  // kordoc-launcher(우클릭 메뉴)가 남긴 %TEMP%/kordoc-batch-*.json — 임시 폴더 + 파일 이름 패턴만
  reg('read_batch_manifest', async (p) => {
    const path = reqPath(p.path);
    const name = basename(path);
    if (!/^kordoc-batch-\d+\.json$/.test(name)) throw new Error(`허용되지 않은 manifest 파일명: ${name}`);
    const norm = (s: string) => s.replace(/\\/g, '/').toLowerCase();
    if (!norm(path).startsWith(`${norm(tmpdir())}/`)) throw new Error('manifest는 임시 폴더에서만 읽을 수 있습니다.');
    if ((await stat(path)).size > 1024 * 1024) throw new Error('manifest 파일이 너무 큽니다 (1MB까지).');
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(path, 'utf8'));
    } catch (e) {
      throw new Error(`manifest JSON을 읽지 못했습니다: ${(e as Error).message}`);
    }
    const obj = parsed as { action?: unknown; files?: unknown; created_at?: unknown };
    if (!obj || typeof obj.action !== 'string' || !Array.isArray(obj.files)) throw new Error('manifest 형식 오류 (action + files 필요)');
    return {
      action: obj.action,
      files: obj.files.filter((f): f is string => typeof f === 'string'),
      created_at: typeof obj.created_at === 'string' ? obj.created_at : undefined,
    };
  });
}
