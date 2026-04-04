/** 문서 비교 — kordoc diff 기반 신구대조표 */

import { readFile } from 'node:fs/promises';
import { compare, type DiffResult } from 'kordoc';
import { logger } from '../../infra/logger.js';

export interface DiffParams {
  /** 원본 파일 경로 */
  file_a: string;
  /** 비교 파일 경로 */
  file_b: string;
  /** 페이지 범위 */
  pages?: string;
}

export interface DiffResponse {
  success: boolean;
  stats: DiffResult['stats'];
  diffs: DiffResult['diffs'];
}

export async function diff(params: DiffParams, signal?: AbortSignal): Promise<DiffResponse> {
  const { file_a, file_b, pages } = params;

  logger.info(`[diff] ${file_a} ↔ ${file_b}`);
  signal?.throwIfAborted();

  const [bufA, bufB] = await Promise.all([
    readFile(file_a),
    readFile(file_b),
  ]);

  signal?.throwIfAborted();

  const result = await compare(
    new Uint8Array(bufA).buffer,
    new Uint8Array(bufB).buffer,
    { pages },
  );

  logger.info(`[diff] done: +${result.stats.added} -${result.stats.removed} ~${result.stats.modified}`);

  return {
    success: true,
    stats: result.stats,
    diffs: result.diffs,
  };
}
