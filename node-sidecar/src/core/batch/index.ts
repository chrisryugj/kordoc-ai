/** 배치 변환 — 다중 파일 순차 처리 + progress */

import { basename, extname, join } from 'node:path';
import { convert, type ConvertParams, type ConvertResult } from '../converter/index.js';
import { sendProgress } from '../../infra/progress.js';
import { logger } from '../../infra/logger.js';

export interface BatchConvertParams {
  /** 입력 파일 경로 배열 */
  files: string[];
  /** 출력 디렉토리 (생략 시 각 파일 옆에 생성) */
  output_dir?: string;
  /** 페이지 범위 */
  pages?: string;
}

export interface BatchConvertResult {
  total: number;
  succeeded: number;
  failed: number;
  results: ConvertResult[];
}

export async function convertBatch(
  params: BatchConvertParams,
  signal: AbortSignal,
): Promise<BatchConvertResult> {
  const { files, output_dir, pages } = params;
  const results: ConvertResult[] = [];
  let succeeded = 0;
  let failed = 0;

  logger.info(`[batch] ${files.length}개 파일 변환 시작`);

  for (let i = 0; i < files.length; i++) {
    if (signal.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    sendProgress({
      current: i + 1,
      total: files.length,
      message: `파일 ${i + 1}/${files.length} 변환 중`,
    });

    try {
      const convertParams: ConvertParams = {
        input_path: files[i],
        pages,
        ...(output_dir ? { output_path: undefined } : {}),
      };

      // output_dir이 지정된 경우 출력 경로를 수동 설정
      if (output_dir) {
        const outName = basename(files[i], extname(files[i])) + '.md';
        convertParams.output_path = join(output_dir, outName);
      }

      const result = await convert(convertParams);
      results.push(result);
      if (result.success) succeeded++;
      else failed++;
    } catch (err) {
      failed++;
      results.push({
        success: false,
        output_path: '',
        markdown: '',
        file_type: 'unknown',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  logger.info(`[batch] 완료: ${succeeded} 성공, ${failed} 실패`);

  return { total: files.length, succeeded, failed, results };
}
