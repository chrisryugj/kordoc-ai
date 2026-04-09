/** 파일 수합 — 마크다운 병합 또는 서식 유지 수합 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, basename, extname } from 'node:path';
import { parse } from 'kordoc';
import { sendProgress } from '../../infra/progress.js';
import { logger } from '../../infra/logger.js';
import { concatHwpx } from './concat-hwpx.js';
import { concatDocx } from './concat-docx.js';
import { concatXlsx } from './concat-xlsx.js';
import { concatPdf, splitPdf } from './concat-pdf.js';
import type { MergeFilesParams, MergeFilesResult } from './types.js';

export type { MergeFilesParams, MergeFilesResult } from './types.js';
export { splitPdf, extractPdfPages, getPdfPageCount } from './concat-pdf.js';
export type { SplitPdfParams, SplitPdfResult, ExtractPdfPagesParams, ExtractPdfPagesResult } from './concat-pdf.js';

/**
 * HWPX 서식 유지 수합 — COM 실패 시 kordoc 마크다운 병합으로 폴백.
 * COM(pyhwpx): 서식 완벽 보존, 한컴오피스+Python 필요
 * 폴백(kordoc): 텍스트/표 보존, 서식 손실, 의존성 없음
 */
async function concatHwpxWithFallback(
  params: MergeFilesParams,
  signal: AbortSignal,
): Promise<MergeFilesResult> {
  try {
    return await concatHwpx(params, signal);
  } catch (comErr) {
    // 사용자가 취소한 건 그대로 전파
    if (comErr instanceof DOMException && comErr.name === 'AbortError') throw comErr;

    const reason = comErr instanceof Error ? comErr.message : String(comErr);
    logger.warn(`[merge] HWPX COM 실패 → kordoc 마크다운 병합으로 전환: ${reason}`);
    sendProgress({ current: 0, total: params.files.length, message: 'COM 실패 — 마크다운 병합으로 전환' });

    // 마크다운 모드로 폴백 (output 확장자를 .md로 변경)
    const mdOutput = params.output_path.replace(/\.hwpx?$/i, '_병합.md');
    const fallbackResult = await mergeFiles(
      { ...params, mode: 'markdown', output_path: mdOutput },
      signal,
    );

    return {
      ...fallbackResult,
      warnings: [`COM 수합 실패(${reason}) — 마크다운으로 병합됨. 서식이 보존되지 않습니다.`],
    };
  }
}

export async function mergeFiles(
  params: MergeFilesParams,
  signal: AbortSignal,
): Promise<MergeFilesResult> {
  // native 모드: 포맷별 서식 유지 수합
  if (params.mode === 'native') {
    const ext = extname(params.files[0]).toLowerCase();
    switch (ext) {
      case '.hwp':
      case '.hwpx': return concatHwpxWithFallback(params, signal);
      case '.xlsx': return concatXlsx(params, signal);
      case '.docx': return concatDocx(params, signal);
      case '.pdf': return concatPdf(params, signal);
      default: throw new Error(`서식 유지 수합을 지원하지 않는 형식입니다: ${ext}`);
    }
  }

  // markdown 모드 (기본): 기존 로직
  const { files, output_path, separator } = params;
  const sections: string[] = [];
  const failedFiles: string[] = [];

  logger.info(`[merge] ${files.length}개 파일 병합 시작`);

  for (let i = 0; i < files.length; i++) {
    if (signal.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    sendProgress({
      current: i + 1,
      total: files.length,
      message: `파일 ${i + 1}/${files.length} 변환 중`,
    });

    const filePath = files[i];
    try {
      const buffer = await readFile(filePath);
      const result = await parse(new Uint8Array(buffer).buffer);

      if (result.success) {
        const fileName = basename(filePath);
        const divider = separator ?? `\n\n---\n\n## ${fileName}\n\n`;
        sections.push(i === 0 ? `## ${fileName}\n\n${result.markdown}` : `${divider}${result.markdown}`);
      } else {
        failedFiles.push(filePath);
        logger.warn(`[merge] 실패: ${filePath} — ${result.error}`);
      }
    } catch (err) {
      failedFiles.push(filePath);
      logger.warn(`[merge] 에러: ${filePath} — ${err instanceof Error ? err.message : err}`);
    }
  }

  const merged = sections.join('');

  await mkdir(dirname(output_path), { recursive: true });
  await writeFile(output_path, merged, 'utf-8');

  logger.info(`[merge] done → ${output_path} (${merged.length}자, ${failedFiles.length}개 실패)`);

  return {
    success: true,
    output_path,
    file_count: files.length,
    total_length: merged.length,
    failed_files: failedFiles,
  };
}
