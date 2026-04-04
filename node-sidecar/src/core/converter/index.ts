/** 문서 변환 — HWP/HWPX/PDF → 마크다운 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, basename, extname, join } from 'node:path';
import { parse, type ParseResult, type OcrProvider } from 'kordoc';
import { getConfig } from '../../infra/config.js';
import { sendProgress } from '../../infra/progress.js';
import { logger } from '../../infra/logger.js';

export interface ConvertParams {
  /** 입력 파일 경로 */
  input_path: string;
  /** 출력 파일 경로 (생략 시 자동 생성) */
  output_path?: string;
  /** 페이지 범위 (예: "1-3", "1,3,5") */
  pages?: string;
  /** OCR 프로바이더 함수 (외부 주입) */
  ocrProvider?: OcrProvider;
}

export interface ConvertResult {
  success: boolean;
  output_path: string;
  markdown: string;
  file_type: string;
  page_count?: number;
  is_image_based?: boolean;
  warnings?: string[];
  error?: string;
  code?: string;
}

export async function convert(params: ConvertParams): Promise<ConvertResult> {
  const { input_path, pages, ocrProvider } = params;

  logger.info(`[convert] ${input_path}`);

  const buffer = await readFile(input_path);

  const result: ParseResult = await parse(new Uint8Array(buffer).buffer, {
    pages,
    ocr: ocrProvider,
    onProgress: (current, total) => {
      sendProgress({ current, total, message: `페이지 ${current}/${total} 처리 중` });
    },
  });

  // 출력 경로 결정
  const cfg = getConfig('convert');
  const outDir = cfg.output_dir || dirname(input_path);
  const outName = basename(input_path, extname(input_path)) + '.md';
  const outputPath = params.output_path ?? join(outDir, outName);

  if (!result.success) {
    return {
      success: false,
      output_path: outputPath,
      markdown: '',
      file_type: result.fileType,
      is_image_based: result.isImageBased,
      error: result.error,
      code: result.code,
    };
  }

  // 출력 디렉토리 생성 + 파일 저장
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, result.markdown, 'utf-8');

  logger.info(`[convert] done → ${outputPath}`);

  return {
    success: true,
    output_path: outputPath,
    markdown: result.markdown,
    file_type: result.fileType,
    page_count: result.pageCount,
    is_image_based: result.isImageBased,
    warnings: result.warnings?.map((w) => w.message),
  };
}
