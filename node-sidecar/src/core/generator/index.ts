/** HWPX 생성 — 마크다운 → HWPX 역변환 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, basename, extname, join } from 'node:path';
import { markdownToHwpx } from 'kordoc';
import { logger } from '../../infra/logger.js';

export interface GenerateHwpxParams {
  /** 마크다운 텍스트 (직접 입력) */
  markdown?: string;
  /** 또는 마크다운 파일 경로 */
  input_path?: string;
  /** 출력 HWPX 경로 */
  output_path?: string;
}

export interface GenerateHwpxResult {
  success: boolean;
  output_path: string;
  size: number;
  error?: string;
}

export async function generateHwpx(params: GenerateHwpxParams): Promise<GenerateHwpxResult> {
  let markdown = params.markdown ?? '';

  if (!markdown && params.input_path) {
    markdown = await readFile(params.input_path, 'utf-8');
  }

  if (!markdown) {
    throw new Error('markdown 또는 input_path 중 하나를 제공해야 합니다');
  }

  logger.info(`[generate_hwpx] ${markdown.length}자 → HWPX`);

  const hwpxBuffer = await markdownToHwpx(markdown);

  // 출력 경로 결정
  let outputPath = params.output_path;
  if (!outputPath && params.input_path) {
    const dir = dirname(params.input_path);
    const name = basename(params.input_path, extname(params.input_path));
    outputPath = join(dir, `${name}.hwpx`);
  }
  if (!outputPath) {
    outputPath = 'output.hwpx';
  }

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, Buffer.from(hwpxBuffer));

  logger.info(`[generate_hwpx] done → ${outputPath} (${hwpxBuffer.byteLength} bytes)`);

  return {
    success: true,
    output_path: outputPath,
    size: hwpxBuffer.byteLength,
  };
}
