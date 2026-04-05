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
export { splitPdf } from './concat-pdf.js';
export type { SplitPdfParams, SplitPdfResult } from './concat-pdf.js';

export async function mergeFiles(
  params: MergeFilesParams,
  signal: AbortSignal,
): Promise<MergeFilesResult> {
  // native 모드: 포맷별 서식 유지 수합
  if (params.mode === 'native') {
    const ext = extname(params.files[0]).toLowerCase();
    switch (ext) {
      case '.hwpx': return concatHwpx(params, signal);
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
