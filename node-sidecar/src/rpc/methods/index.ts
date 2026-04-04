/** RPC 메서드 등록 — 7개 실구현 + 10개 스텁 */

import { exec } from 'node:child_process';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { RPC_ERRORS, type RpcHandler } from '../protocol.js';
import type { RpcRouter } from '../router.js';
import { getSettings, updateSettings } from '../../infra/config.js';

/** 스텁 핸들러 생성 */
function stub(name: string): RpcHandler {
  return () => {
    throw new Error(`${name}: not implemented yet`);
  };
}

/** 모든 메서드를 라우터에 등록 */
export function registerAllMethods(router: RpcRouter): void {
  // ── Phase 2 실구현 (7개) ──

  // 1. ping
  router.register('ping', () => 'pong');

  // 2. cancel — router에서 직접 처리 (등록 불필요)

  // 3. get_settings
  router.register('get_settings', (params) => {
    const section = params.section as string | undefined;
    const settings = getSettings();
    if (section && section in settings) {
      return settings[section as keyof typeof settings];
    }
    return settings;
  });

  // 4. update_settings
  router.register('update_settings', (params) => {
    const patch = params.settings as Record<string, unknown> | undefined;
    if (!patch) throw new Error('Missing "settings" parameter');
    return updateSettings(patch);
  });

  // 5. open_folder
  router.register('open_folder', (params) => {
    const folderPath = params.path as string;
    if (!folderPath) throw new Error('Missing "path" parameter');
    return new Promise<boolean>((resolve, reject) => {
      const cmd = process.platform === 'win32'
        ? `explorer "${folderPath.replace(/\//g, '\\')}"`
        : `open "${folderPath}"`;
      exec(cmd, (err) => {
        if (err) reject(err);
        else resolve(true);
      });
    });
  });

  // 6. open_file
  router.register('open_file', (params) => {
    const filePath = params.path as string;
    if (!filePath) throw new Error('Missing "path" parameter');
    return new Promise<boolean>((resolve, reject) => {
      const cmd = process.platform === 'win32'
        ? `start "" "${filePath.replace(/\//g, '\\')}"`
        : `open "${filePath}"`;
      exec(cmd, { shell: process.platform === 'win32' ? 'cmd.exe' : undefined }, (err) => {
        if (err) reject(err);
        else resolve(true);
      });
    });
  });

  // 7. list_files
  router.register('list_files', async (params) => {
    const dirPath = params.path as string;
    if (!dirPath) throw new Error('Missing "path" parameter');
    const entries = await readdir(dirPath);
    const results = await Promise.all(
      entries.map(async (name) => {
        const full = join(dirPath, name);
        try {
          const s = await stat(full);
          return { name, is_dir: s.isDirectory(), size: s.size };
        } catch {
          return { name, is_dir: false, size: 0 };
        }
      }),
    );
    return results;
  });

  // ── Phase 4~5 스텁 (10개) ──

  router.register('convert', stub('convert'));
  router.register('convert_batch', stub('convert_batch'));
  router.register('diff', stub('diff'));
  router.register('form_extract', stub('form_extract'));
  router.register('generate_hwpx', stub('generate_hwpx'));
  router.register('extract_tables', stub('extract_tables'));
  router.register('merge_files', stub('merge_files'));
  router.register('ocr', stub('ocr'));
  router.register('summarize', stub('summarize'));
  router.register('scan_receipt', stub('scan_receipt'));
}
