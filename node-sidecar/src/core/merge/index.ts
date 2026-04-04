/** 파일 수합 — 다중 문서 변환 후 단일 마크다운으로 병합 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, basename, extname } from 'node:path';
import { parse } from 'kordoc';
import { sendProgress } from '../../infra/progress.js';
import { logger } from '../../infra/logger.js';

export interface MergeFilesParams {
  /** 입력 파일 경로 배열 */
  files: string[];
  /** 출력 파일 경로 */
  output_path: string;
  /** 파일 간 구분자 (기본: 제목 + 구분선) */
  separator?: string;
}

export interface MergeFilesResult {
  success: boolean;
  output_path: string;
  file_count: number;
  total_length: number;
  failed_files: string[];
}

export async function mergeFiles(
  params: MergeFilesParams,
  signal: AbortSignal,
): Promise<MergeFilesResult> {
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
      const result = await parse(buffer.buffer as ArrayBuffer);

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
