/** RPC 메서드 등록 — 7개 유틸리티 + 10개 핵심 기능 */

import { exec } from 'node:child_process';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { RpcHandler } from '../protocol.js';
import type { RpcRouter } from '../router.js';
import { getSettings, updateSettings } from '../../infra/config.js';
import { convert } from '../../core/converter/index.js';
import { convertBatch } from '../../core/batch/index.js';
import { ocr } from '../../core/ocr/index.js';
import { summarize } from '../../core/summary/index.js';
import { diff } from '../../core/comparator/index.js';
import { formExtract } from '../../core/form/index.js';
import { generateHwpx } from '../../core/generator/index.js';
import { extractTables } from '../../core/excel/index.js';
import { mergeFiles } from '../../core/merge/index.js';
import { scanReceipt } from '../../core/receipt/index.js';

/** 모든 메서드를 라우터에 등록 */
export function registerAllMethods(router: RpcRouter): void {
  // ── 유틸리티 (7개) ──

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

  // ── 핵심 기능 (10개) ──

  // 8. convert — 문서 변환 (HWP/HWPX/PDF → 마크다운)
  router.register('convert', async (params) => {
    const input_path = params.input_path as string;
    if (!input_path) throw new Error('Missing "input_path" parameter');
    return convert({
      input_path,
      output_path: params.output_path as string | undefined,
      pages: params.pages as string | undefined,
    });
  });

  // 9. convert_batch — 배치 변환
  router.register('convert_batch', async (params, signal) => {
    const files = params.files as string[] | undefined;
    if (!files?.length) throw new Error('Missing "files" parameter');
    return convertBatch({
      files,
      output_dir: params.output_dir as string | undefined,
      pages: params.pages as string | undefined,
    }, signal);
  });

  // 10. ocr — 이미지 PDF OCR (Gemini Vision)
  router.register('ocr', async (params, signal) => {
    const input_path = params.input_path as string;
    if (!input_path) throw new Error('Missing "input_path" parameter');
    return ocr({
      input_path,
      output_path: params.output_path as string | undefined,
      pages: params.pages as string | undefined,
    }, signal);
  });

  // 11. summarize — AI 요약 (Gemini)
  router.register('summarize', async (params, signal) => {
    return summarize({
      text: params.text as string | undefined,
      input_path: params.input_path as string | undefined,
      length: params.length as string | undefined,
      language: params.language as string | undefined,
    }, signal);
  });

  // 12. diff — 문서 비교 (신구대조표)
  router.register('diff', async (params) => {
    const file_a = params.file_a as string;
    const file_b = params.file_b as string;
    if (!file_a || !file_b) throw new Error('Missing "file_a" or "file_b" parameter');
    return diff({
      file_a,
      file_b,
      pages: params.pages as string | undefined,
    });
  });

  // 13. form_extract — 양식 필드 추출
  router.register('form_extract', async (params) => {
    const input_path = params.input_path as string;
    if (!input_path) throw new Error('Missing "input_path" parameter');
    return formExtract({
      input_path,
      pages: params.pages as string | undefined,
    });
  });

  // 14. generate_hwpx — 마크다운 → HWPX 역변환
  router.register('generate_hwpx', async (params) => {
    return generateHwpx({
      markdown: params.markdown as string | undefined,
      input_path: params.input_path as string | undefined,
      output_path: params.output_path as string | undefined,
    });
  });

  // 15. extract_tables — 문서에서 표 추출
  router.register('extract_tables', async (params) => {
    const input_path = params.input_path as string;
    if (!input_path) throw new Error('Missing "input_path" parameter');
    return extractTables({
      input_path,
      pages: params.pages as string | undefined,
      as_markdown: params.as_markdown as boolean | undefined,
    });
  });

  // 16. merge_files — 다중 문서 병합
  router.register('merge_files', async (params, signal) => {
    const files = params.files as string[] | undefined;
    const output_path = params.output_path as string;
    if (!files?.length) throw new Error('Missing "files" parameter');
    if (!output_path) throw new Error('Missing "output_path" parameter');
    return mergeFiles({
      files,
      output_path,
      separator: params.separator as string | undefined,
    }, signal);
  });

  // 17. scan_receipt — 영수증 스캔 (Gemini Vision)
  router.register('scan_receipt', async (params, signal) => {
    const input_path = params.input_path as string;
    if (!input_path) throw new Error('Missing "input_path" parameter');
    return scanReceipt({ input_path }, signal);
  });
}
