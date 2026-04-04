/** OCR — 이미지 PDF를 Gemini Vision으로 텍스트 추출
 *
 * 전략:
 * 1. kordoc parse() 시도 (텍스트 기반 PDF는 여기서 성공)
 * 2. IMAGE_BASED_PDF 에러 시 → PDF 전체를 Gemini Vision에 직접 전송
 *    (pdfjs-dist canvas 렌더링 불필요 — Gemini가 PDF를 네이티브 지원)
 */

import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { dirname, basename, extname, join } from 'node:path';
import { parse } from 'kordoc';
import { callGeminiVision } from '../../infra/gemini.js';
import { sendProgress } from '../../infra/progress.js';
import { logger } from '../../infra/logger.js';
import { getConfig } from '../../infra/config.js';

/** Gemini 인라인 데이터 상한 (20MB) */
const MAX_FILE_SIZE = 20 * 1024 * 1024;

export interface OcrParams {
  /** 입력 PDF 경로 */
  input_path: string;
  /** 출력 파일 경로 */
  output_path?: string;
  /** 페이지 범위 */
  pages?: string;
}

export interface OcrResult {
  success: boolean;
  output_path: string;
  markdown: string;
  page_count?: number;
  warnings?: string[];
  error?: string;
}

/** Gemini Vision으로 PDF 직접 OCR (PDF MIME 네이티브 지원) */
async function ocrWithGemini(
  pdfBuffer: Buffer,
  signal: AbortSignal,
): Promise<string> {
  logger.info('[ocr] Gemini Vision PDF 직접 전송');

  sendProgress({ current: 1, total: 2, message: 'Gemini Vision으로 PDF OCR 중...' });

  const base64 = pdfBuffer.toString('base64');
  const text = await callGeminiVision({
    prompt: '이 PDF 문서의 모든 페이지 텍스트를 정확하게 추출해주세요. 표가 있으면 마크다운 테이블로 변환하세요. 원본 구조와 순서를 유지하세요. 페이지 구분은 "---"으로 표시하세요.',
    imageBase64: base64,
    mimeType: 'application/pdf',
    signal,
    systemInstruction: '당신은 한국어 문서 OCR 전문가입니다. 텍스트만 정확히 추출하세요. 설명이나 주석을 추가하지 마세요.',
  });

  sendProgress({ current: 2, total: 2, message: 'OCR 완료' });

  return text;
}

export async function ocr(params: OcrParams, signal: AbortSignal): Promise<OcrResult> {
  const { input_path, pages } = params;

  logger.info(`[ocr] ${input_path}`);

  // 파일 크기 체크 — Gemini 인라인 데이터 상한 초과 시 즉시 에러
  const fileInfo = await stat(input_path);
  if (fileInfo.size > MAX_FILE_SIZE) {
    throw new Error(`파일이 너무 큽니다 (${Math.round(fileInfo.size / 1024 / 1024)}MB). 최대 ${MAX_FILE_SIZE / 1024 / 1024}MB까지 지원합니다.`);
  }

  const buffer = await readFile(input_path);

  // 1단계: kordoc parse 시도 (텍스트 기반 PDF면 바로 성공)
  const result = await parse(new Uint8Array(buffer).buffer, {
    pages,
    onProgress: (current, total) => {
      sendProgress({ current, total, message: `페이지 ${current}/${total} 처리 중` });
    },
  });

  const cfg = getConfig('convert');
  const outDir = cfg.output_dir || dirname(input_path);
  const outName = basename(input_path, extname(input_path)) + '.md';
  const outputPath = params.output_path ?? join(outDir, outName);

  // 텍스트 기반 PDF → 바로 성공
  if (result.success) {
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, result.markdown, 'utf-8');
    logger.info(`[ocr] 텍스트 기반 PDF → ${outputPath}`);
    return {
      success: true,
      output_path: outputPath,
      markdown: result.markdown,
      page_count: result.pageCount,
      warnings: result.warnings?.map((w) => w.message),
    };
  }

  // 2단계: IMAGE_BASED_PDF → Gemini Vision으로 직접 OCR
  if (result.isImageBased) {
    logger.info('[ocr] 이미지 기반 PDF 감지 → Gemini Vision 폴백');

    const markdown = await ocrWithGemini(buffer, signal);

    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, markdown, 'utf-8');

    logger.info(`[ocr] done → ${outputPath} (${markdown.length}자)`);

    return {
      success: true,
      output_path: outputPath,
      markdown,
      page_count: result.pageCount,
      warnings: ['Gemini Vision OCR 사용 (이미지 기반 PDF)'],
    };
  }

  // 기타 에러
  return {
    success: false,
    output_path: outputPath,
    markdown: '',
    error: result.error,
  };
}
