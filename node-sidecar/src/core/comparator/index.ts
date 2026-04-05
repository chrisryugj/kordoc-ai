/** 문서 비교 — kordoc diff 기반 신구대조표 */

import { readFile, stat } from 'node:fs/promises';
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
  let { file_a, file_b } = params;
  const { pages } = params;

  // 수정시간 비교 — 오래된 파일을 원본(file_a)으로
  const [statA, statB] = await Promise.all([stat(file_a), stat(file_b)]);
  if (statA.mtimeMs > statB.mtimeMs) {
    logger.info(`[diff] 파일 순서 교정: ${file_b} (이전) → ${file_a} (이후)`);
    [file_a, file_b] = [file_b, file_a];
  }

  logger.info(`[diff] ${file_a} (원본) ↔ ${file_b} (수정본)`);
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
