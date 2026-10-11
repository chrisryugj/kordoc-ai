/** 파일 수합 — 마크다운 병합 또는 서식 유지 수합 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, basename, extname } from 'node:path';
import { sendProgress } from '../../infra/progress.js';
import { logger } from '../../infra/logger.js';
import { mergeHwpx } from './hwpx-merge.js';
import { rhwpConvert, tooBigForRhwp } from '../render/rhwp.js';
import { parseBytes } from '../converter/index.js';
import { concatDocx } from './concat-docx.js';
import { concatXlsx } from './concat-xlsx.js';
import { concatPdf, splitPdf } from './concat-pdf.js';
import type { MergeFilesParams, MergeFilesResult } from './types.js';

export type { MergeFilesParams, MergeFilesResult } from './types.js';
export { splitPdf, extractPdfPages, getPdfPageCount } from './concat-pdf.js';
export type { SplitPdfParams, SplitPdfResult, ExtractPdfPagesParams, ExtractPdfPagesResult } from './concat-pdf.js';

/** HWPX·HWP 서식 유지 수합 — 한컴오피스 없이 XML 수준으로 이어 붙인다 (HWP 는 rhwp 로 HWPX 로 바꿔서) */
async function mergeHangul(params: MergeFilesParams, signal: AbortSignal): Promise<MergeFilesResult> {
  const inputs: Uint8Array[] = [];
  const failed: string[] = [];
  for (const [i, f] of params.files.entries()) {
    signal.throwIfAborted();
    sendProgress({ current: i, total: params.files.length + 1, message: `${basename(f)} 읽는 중` });
    try {
      const bytes = new Uint8Array(await readFile(f));
      if (extname(f).toLowerCase() === '.hwp') {
        const big = await tooBigForRhwp(bytes);
        if (big) throw new Error(`문서가 너무 큽니다(약 ${big}쪽)`);
        inputs.push(await rhwpConvert(bytes, 'hwpx', signal));
      } else inputs.push(bytes);
    } catch (err) {
      if (signal.aborted) throw err;
      failed.push(f);
      logger.warn(`[merge] ${f} 읽기 실패: ${err instanceof Error ? err.message : err}`);
    }
  }
  if (inputs.length < 2) throw new Error('합칠 수 있는 한글 문서가 두 개 이상 필요합니다.');
  sendProgress({ current: params.files.length, total: params.files.length + 1, message: '서식 그대로 합치는 중' });
  const merged = await mergeHwpx(inputs);
  let out = merged.bytes;
  if (extname(params.output_path).toLowerCase() === '.hwp') out = await rhwpConvert(out, 'hwp', signal);
  await mkdir(dirname(params.output_path), { recursive: true });
  await writeFile(params.output_path, out);
  return {
    success: true,
    output_path: params.output_path,
    file_count: inputs.length,
    total_length: out.byteLength,
    failed_files: failed,
    ...(merged.warnings.length ? { warnings: merged.warnings } : {}),
  };
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
      case '.hwpx': return mergeHangul(params, signal);
      case '.xlsx': return concatXlsx(params, signal);
      case '.docx': return concatDocx(params, signal);
      case '.pdf': return concatPdf(params, signal);
      default: throw new Error(`서식 유지 합치기를 지원하지 않는 형식입니다: ${ext}`);
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
      const result = await parseBytes(buffer, {}, undefined, signal);

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
