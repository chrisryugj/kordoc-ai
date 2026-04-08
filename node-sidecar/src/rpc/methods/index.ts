/** RPC 메서드 등록 — 7개 유틸리티 + 10개 핵심 기능 */

import { execFile } from 'node:child_process';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { RpcHandler } from '../protocol.js';
import type { RpcRouter } from '../router.js';
import { getSettings, updateSettings } from '../../infra/config.js';
import { validatePath } from '../../infra/pathGuard.js';
import { logger } from '../../infra/logger.js';
import { convert } from '../../core/converter/index.js';
import { convertBatch } from '../../core/batch/index.js';
import { ocr } from '../../core/ocr/index.js';
import { summarize } from '../../core/summary/index.js';
import { diff } from '../../core/comparator/index.js';
import { formExtract, formExtractCandidates, formExtractBatch } from '../../core/form/index.js';
import { generateHwpx } from '../../core/generator/index.js';
import { extractTables } from '../../core/excel/index.js';
import { mergeFiles, splitPdf, extractPdfPages, getPdfPageCount } from '../../core/merge/index.js';
import { inspectDocument } from '../../core/inspect/index.js';

/** 모든 메서드를 라우터에 등록 */
export function registerAllMethods(router: RpcRouter): void {
  // ── 유틸리티 (7개) ──

  // 1. ping
  router.register('ping', () => 'pong');

  // 2. cancel — router에서 직접 처리 (등록 불필요)

  // 3. get_settings (API 키 마스킹)
  router.register('get_settings', (params) => {
    const section = params.section as string | undefined;
    const settings = structuredClone(getSettings());
    // 프론트엔드에 raw API key 노출 방지 (빈 문자열은 그대로)
    if (settings.gemini?.api_key && settings.gemini.api_key.trim()) {
      const key = settings.gemini.api_key;
      settings.gemini.api_key = key.length > 4 ? key.slice(0, 4) + '****' : '****';
    }
    if (section && section in settings) {
      return settings[section as keyof typeof settings];
    }
    return settings;
  });

  // 4. update_settings
  router.register('update_settings', async (params) => {
    const patch = params.settings as Record<string, unknown> | undefined;
    if (!patch) throw new Error('Missing "settings" parameter');
    return updateSettings(patch);
  });

  // 5. open_folder — 디렉토리 확인 후 열기
  router.register('open_folder', async (params) => {
    const folderPath = validatePath(params.path as string);
    const info = await stat(folderPath);
    if (!info.isDirectory()) throw new Error('경로가 디렉토리가 아닙니다');
    return new Promise<boolean>((resolve) => {
      if (process.platform === 'win32') {
        execFile('explorer', [folderPath.replace(/\//g, '\\')], (err, _stdout, stderr) => {
          // Windows explorer는 exit code 1을 자주 반환하므로 허용
          if (err && (err as NodeJS.ErrnoException).code !== 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
            const code = (err as { status?: number }).status;
            if (code !== undefined && code !== 0 && code !== 1) {
              logger.warn(`[open_folder] explorer exited with code ${code}: ${stderr}`);
            }
          }
          resolve(true);
        });
      } else {
        execFile('open', [folderPath], (err) => { if (err) throw err; resolve(true); });
      }
    });
  });

  // 6. open_file — 허용 확장자 화이트리스트 + 파일 확인 후 열기
  const OPENABLE_EXT = new Set(['.hwp', '.hwpx', '.pdf', '.xlsx', '.docx', '.txt', '.md', '.csv', '.png', '.jpg', '.jpeg']);
  router.register('open_file', async (params) => {
    const filePath = validatePath(params.path as string);
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error('경로가 파일이 아닙니다');
    const ext = filePath.toLowerCase().match(/\.[^.]+$/)?.[0] ?? '';
    if (!OPENABLE_EXT.has(ext)) throw new Error(`허용되지 않은 파일 형식입니다: ${ext}`);
    return new Promise<boolean>((resolve) => {
      if (process.platform === 'win32') {
        execFile('explorer', [filePath.replace(/\//g, '\\')], () => resolve(true));
      } else {
        execFile('open', [filePath], (err) => { if (err) throw err; resolve(true); });
      }
    });
  });

  // 7. list_files
  router.register('list_files', async (params) => {
    const dirPath = validatePath(params.path as string);
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
  router.register('convert', async (params, signal) => {
    const input_path = validatePath(params.input_path as string);
    signal.throwIfAborted();
    const output_path = params.output_path ? validatePath(params.output_path as string) : undefined;
    return convert({
      input_path,
      output_path,
      pages: params.pages as string | undefined,
    }, signal);
  });

  // 9. convert_batch — 배치 변환
  router.register('convert_batch', async (params, signal) => {
    const files = params.files as string[] | undefined;
    if (!files?.length) throw new Error('Missing "files" parameter');
    const validatedFiles = files.map((f) => validatePath(f));
    const output_dir = params.output_dir ? validatePath(params.output_dir as string) : undefined;
    return convertBatch({
      files: validatedFiles,
      output_dir,
      pages: params.pages as string | undefined,
    }, signal);
  });

  // 10. ocr — 이미지 PDF OCR (Gemini Vision)
  router.register('ocr', async (params, signal) => {
    const input_path = validatePath(params.input_path as string);
    const output_path = params.output_path ? validatePath(params.output_path as string) : undefined;
    return ocr({
      input_path,
      output_path,
      pages: params.pages as string | undefined,
    }, signal);
  });

  // 11. summarize — AI 요약 (Gemini)
  router.register('summarize', async (params, signal) => {
    const input_path = params.input_path ? validatePath(params.input_path as string) : undefined;
    return summarize({
      text: params.text as string | undefined,
      input_path,
      length: params.length as 'short' | 'medium' | 'long' | undefined,
      style: params.style as 'standard' | 'briefing' | 'review' | 'action' | undefined,
      language: params.language as string | undefined,
    }, signal);
  });

  // 12. diff — 문서 비교 (신구대조표)
  router.register('diff', async (params, signal) => {
    const file_a = validatePath(params.file_a as string);
    const file_b = validatePath(params.file_b as string);
    signal.throwIfAborted();
    return diff({
      file_a,
      file_b,
      pages: params.pages as string | undefined,
    }, signal);
  });

  // 13. form_extract — 양식 필드 추출
  router.register('form_extract', async (params, signal) => {
    const input_path = validatePath(params.input_path as string);
    signal.throwIfAborted();
    return formExtract({
      input_path,
      pages: params.pages as string | undefined,
    }, signal);
  });

  // 13b. form_extract_candidates — 필드 후보 추출
  router.register('form_extract_candidates', async (params, signal) => {
    const input_path = validatePath(params.input_path as string);
    signal.throwIfAborted();
    return formExtractCandidates({
      input_path,
      pages: params.pages as string | undefined,
    }, signal);
  });

  // 13c. form_extract_batch — 배치 양식 추출
  router.register('form_extract_batch', async (params, signal) => {
    const files = (params.files as string[]).map(validatePath);
    signal.throwIfAborted();
    return formExtractBatch({
      files,
      selected_fields: params.selected_fields as string[],
      use_ai: params.use_ai as boolean | undefined,
    }, signal);
  });

  // 14. generate_hwpx — 마크다운 → HWPX 역변환
  router.register('generate_hwpx', async (params, signal) => {
    signal.throwIfAborted();
    const input_path = params.input_path ? validatePath(params.input_path as string) : undefined;
    const output_path = params.output_path ? validatePath(params.output_path as string) : undefined;
    return generateHwpx({
      markdown: params.markdown as string | undefined,
      input_path,
      output_path,
    }, signal);
  });

  // 15. extract_tables — 문서에서 표 추출
  router.register('extract_tables', async (params, signal) => {
    const input_path = validatePath(params.input_path as string);
    signal.throwIfAborted();
    return extractTables({
      input_path,
      pages: params.pages as string | undefined,
      as_markdown: params.as_markdown as boolean | undefined,
    }, signal);
  });

  // 16. merge_files — 다중 문서 병합
  router.register('merge_files', async (params, signal) => {
    const files = params.files as string[] | undefined;
    if (!files?.length) throw new Error('Missing "files" parameter');
    const validatedFiles = files.map((f) => validatePath(f));
    const output_path = validatePath(params.output_path as string);
    return mergeFiles({
      files: validatedFiles,
      output_path,
      separator: params.separator as string | undefined,
      mode: params.mode as 'markdown' | 'native' | undefined,
    }, signal);
  });

  // 17. split_pdf — PDF 분리
  router.register('split_pdf', async (params, signal) => {
    const file = validatePath(params.file as string);
    const output_dir = validatePath(params.output_dir as string);
    return splitPdf({
      file,
      output_dir,
      mode: params.mode as 'each' | 'range' | undefined,
      ranges: params.ranges as string | undefined,
    }, signal);
  });

  // 18. pdf_page_count — PDF 페이지 수 조회 (경량)
  router.register('pdf_page_count', async (params) => {
    const file = validatePath(params.file as string);
    return getPdfPageCount(file);
  });

  // 19. pdf_extract_pages — PDF 페이지 추출 (포함/제외)
  router.register('pdf_extract_pages', async (params, signal) => {
    const file = validatePath(params.file as string);
    const output_path = validatePath(params.output_path as string);
    const pages = params.pages as string;
    if (!pages) throw new Error('Missing "pages" parameter');
    return extractPdfPages({
      file,
      output_path,
      pages,
      mode: params.mode as 'include' | 'exclude' | undefined,
    }, signal);
  });

  // 19. inspect_document — K팀장 문서 정합성 검사
  router.register('inspect_document', async (params, signal) => {
    const input_path = validatePath(params.input_path as string);
    return inspectDocument({ input_path }, signal);
  });
}
