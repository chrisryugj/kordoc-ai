/** RPC 메서드 등록 — 7개 유틸리티 + 10개 핵심 기능 */

import { execFile } from 'node:child_process';
import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
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
import { detectMcpEnv, installMcpConfig, installNode } from '../../core/mcp-setup/index.js';
import { printFiles, listPrinters } from '../../core/print/index.js';
import { formSchema, formFill, patchBlocks } from '../../core/fill/index.js';
import { aiExtractFields } from '../../core/form/ai-extract.js';
import { parse } from 'kordoc';
import { renderPreview } from '../../core/preview/index.js';
import { editOpen, editPatch, editUndo, editRedo, editSave, editClose } from '../../core/edit/index.js';
import type { BlockEdit } from 'kordoc';

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
        execFile('open', [folderPath], (err) => { if (err) { logger.warn(`[open_folder] open error: ${err.message}`); } resolve(true); });
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
        execFile('open', [filePath], (err) => { if (err) { logger.warn(`[open_file] open error: ${err.message}`); } resolve(true); });
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

  // 8. convert — 문서 변환 (HWP/HWPX/PDF → 마크다운). doc_b64 시 인메모리(편집 세션) 변환
  router.register('convert', async (params, signal) => {
    const doc_b64 = params.doc_b64 as string | undefined;
    const input_path = doc_b64 ? undefined : validatePath(params.input_path as string);
    signal.throwIfAborted();
    const output_path = params.output_path ? validatePath(params.output_path as string) : undefined;
    return convert({
      input_path,
      doc_b64,
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
    const output_dir = params.output_dir ? validatePath(params.output_dir as string) : undefined;
    signal.throwIfAborted();
    return formExtractBatch({
      files,
      selected_fields: params.selected_fields as string[],
      use_ai: params.use_ai as boolean | undefined,
      output_dir,
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

  // 15. extract_tables — 문서에서 표 추출. doc_b64 시 인메모리(편집 세션) 추출
  router.register('extract_tables', async (params, signal) => {
    const doc_b64 = params.doc_b64 as string | undefined;
    const input_path = doc_b64 ? undefined : validatePath(params.input_path as string);
    const output_dir = params.output_dir ? validatePath(params.output_dir as string) : undefined;
    signal.throwIfAborted();
    return extractTables({
      input_path,
      doc_b64,
      source_name: params.source_name as string | undefined,
      pages: params.pages as string | undefined,
      as_markdown: params.as_markdown as boolean | undefined,
      output_dir,
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

  // ── MCP 설치 (3개) ──

  // 20. detect_mcp_env — Node.js + AI 클라이언트 환경 감지
  router.register('detect_mcp_env', async () => {
    return detectMcpEnv();
  });

  // 21. install_mcp_config — 선택한 클라이언트에 kordoc MCP 등록
  router.register('install_mcp_config', async (params) => {
    const clientIds = params.client_ids as string[];
    if (!clientIds?.length) throw new Error('Missing "client_ids" parameter');
    return installMcpConfig(clientIds);
  });

  // 22. install_node — Node.js 설치 시작
  router.register('install_node', async () => {
    return installNode();
  });

  // ── Phase 2 W2: 인쇄 + deep-link batch (3개) ──

  // 23. print_files — 문서 → PDF → Windows PrintTo
  router.register('print_files', async (params, signal) => {
    return printFiles(
      {
        files: params.files as string[],
        printer: params.printer as string | undefined,
        preset: params.preset as 'default' | 'gov-formal' | 'compact' | undefined,
        copies: params.copies as number | undefined,
        duplex: params.duplex as boolean | undefined,
        color: params.color as boolean | undefined,
      },
      signal,
    );
  });

  // 24. list_printers — Windows 프린터 목록 (CIM Win32_Printer)
  router.register('list_printers', async () => {
    return listPrinters();
  });

  // ── KorDoc Studio Phase B: 양식 채우기 작업대 (4개) ──

  // 26. form_schema — 양식 필드 인식 + 타입 추론 (FillWizard 폼 자동 생성)
  router.register('form_schema', async (params, signal) => {
    const input_path = validatePath(params.input_path as string);
    signal.throwIfAborted();
    return formSchema({
      input_path,
      pages: params.pages as string | undefined,
      include_doc: params.include_doc as boolean | undefined,
    }, signal);
  });

  // 27. form_fill — fillHwpx 바이트 보존 채우기 + 재파싱 검증
  router.register('form_fill', async (params, signal) => {
    const input_path = validatePath(params.input_path as string);
    const output_path = params.output_path ? validatePath(params.output_path as string) : undefined;
    signal.throwIfAborted();
    return formFill({
      input_path,
      values: params.values as Record<string, string>,
      output_path,
      dry_run: params.dry_run as boolean | undefined,
      include_doc: params.include_doc as boolean | undefined,
    }, signal);
  });

  // 27-b. form_infer — 참고자료(파일/텍스트)에서 양식 필드값을 Gemini로 추론 (KorDoc Studio Phase R)
  //        문서 자체가 아니라 별도 참고자료에서 라벨별 값을 뽑아 채우기 폼에 제안한다.
  router.register('form_infer', async (params, signal) => {
    const labels = params.labels as string[] | undefined;
    if (!Array.isArray(labels) || labels.length === 0) throw new Error('추론할 필드 라벨이 없습니다 ("labels")');
    let markdown = ((params.reference_text as string | undefined) ?? '').trim();
    if (!markdown && params.reference_path) {
      const refPath = validatePath(params.reference_path as string);
      const buffer = await readFile(refPath);
      signal.throwIfAborted();
      const result = await parse(new Uint8Array(buffer).buffer);
      if (!result.success) throw new Error(`참고자료 파싱 실패: ${result.error}`);
      markdown = result.markdown;
    }
    if (!markdown) throw new Error('참고자료(텍스트 또는 파일)가 비어 있습니다');
    signal.throwIfAborted();
    const fields = await aiExtractFields(markdown, labels, signal);
    return { success: true, fields };
  });

  // 28. patch_blocks — 블록 단위 증분 패치 (kordoc v3.1 patchHwpxBlocks)
  router.register('patch_blocks', async (params, signal) => {
    const input_path = params.input_path ? validatePath(params.input_path as string) : undefined;
    const output_path = params.output_path ? validatePath(params.output_path as string) : undefined;
    if (!input_path && !params.doc_b64) throw new Error('input_path 또는 doc_b64가 필요합니다');
    signal.throwIfAborted();
    return patchBlocks({
      input_path,
      doc_b64: params.doc_b64 as string | undefined,
      edits: params.edits as BlockEdit[],
      output_path,
      include_doc: params.include_doc as boolean | undefined,
    }, signal);
  });

  // 29. render_preview — rhwp WASM SVG 렌더 (HEAVY 제외 — 미리보기 반응성)
  router.register('render_preview', async (params, signal) => {
    const input_path = params.input_path ? validatePath(params.input_path as string) : undefined;
    if (!input_path && !params.doc_b64) throw new Error('input_path 또는 doc_b64가 필요합니다');
    return renderPreview({
      input_path,
      doc_b64: params.doc_b64 as string | undefined,
      pages: params.pages as number[] | undefined,
      max_pages: params.max_pages as number | undefined,
    }, signal);
  });

  // ── KorDoc Studio Phase C: 클릭-편집 세션 (6개) ──

  // 30. edit_open — HwpxSession 열기 (blocks + capability 잠금 정보 + 미리보기 바이트)
  router.register('edit_open', async (params, signal) => {
    const input_path = params.input_path ? validatePath(params.input_path as string) : undefined;
    if (!input_path && !params.doc_b64) throw new Error('input_path 또는 doc_b64가 필요합니다');
    signal.throwIfAborted();
    return editOpen({
      input_path,
      doc_b64: params.doc_b64 as string | undefined,
      include_doc: params.include_doc as boolean | undefined,
    }, signal);
  });

  // 31. edit_patch — 세션 누적 블록 패치 (undo 스냅샷 자동 기록)
  router.register('edit_patch', async (params, signal) => {
    return editPatch({
      session_id: params.session_id as string,
      edits: params.edits as BlockEdit[],
      include_doc: params.include_doc as boolean | undefined,
    }, signal);
  });

  // 32-33. edit_undo / edit_redo — 바이트 스냅샷 복원
  router.register('edit_undo', async (params, signal) => {
    return editUndo({
      session_id: params.session_id as string,
      include_doc: params.include_doc as boolean | undefined,
    }, signal);
  });
  router.register('edit_redo', async (params, signal) => {
    return editRedo({
      session_id: params.session_id as string,
      include_doc: params.include_doc as boolean | undefined,
    }, signal);
  });

  // 34. edit_save — 현재 세션 바이트 저장 (수동 저장 + 30초 자동저장 공용)
  router.register('edit_save', async (params) => {
    const output_path = validatePath(params.output_path as string);
    return editSave({ session_id: params.session_id as string, output_path });
  });

  // 35. edit_close — 세션 해제
  router.register('edit_close', async (params) => {
    return editClose({ session_id: params.session_id as string });
  });

  // 25. read_batch_manifest — kordoc-launcher.exe 가 생성한
  //   `%TEMP%/kordoc-batch-*.json` manifest 파일 읽기. 보안: %TEMP% 하위 + 파일명 패턴 강제.
  router.register('read_batch_manifest', async (params) => {
    const rawPath = params.path as string;
    if (!rawPath || typeof rawPath !== 'string') {
      throw new Error('Missing "path" parameter');
    }
    const safePath = validatePath(rawPath);
    const fileName = basename(safePath);
    if (!/^kordoc-batch-\d+\.json$/.test(fileName)) {
      throw new Error(`허용되지 않은 manifest 파일명: ${fileName}`);
    }
    // tmpdir 검사 — Node tmpdir 과 동일 prefix 인지 확인 (case-insensitive on Windows)
    const tmpDir = (await import('node:os')).tmpdir();
    const norm = (s: string) => s.replace(/\\/g, '/').toLowerCase();
    if (!norm(safePath).startsWith(norm(tmpDir) + '/')) {
      throw new Error('manifest 는 임시 디렉토리에서만 읽을 수 있습니다');
    }

    const stats = await stat(safePath);
    if (stats.size > 1 * 1024 * 1024) {
      throw new Error('manifest 파일이 너무 큽니다 (>1MB)');
    }

    const text = await readFile(safePath, 'utf8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      throw new Error(`manifest JSON 파싱 실패: ${(e as Error).message}`);
    }
    if (
      typeof parsed !== 'object' || parsed === null ||
      typeof (parsed as { action?: unknown }).action !== 'string' ||
      !Array.isArray((parsed as { files?: unknown }).files)
    ) {
      throw new Error('manifest 형식 오류 (action + files 필요)');
    }
    const obj = parsed as { action: string; files: unknown[]; created_at?: unknown };
    const files = obj.files.filter((f): f is string => typeof f === 'string');
    return {
      action: obj.action,
      files,
      created_at: typeof obj.created_at === 'string' ? obj.created_at : undefined,
    };
  });
}
