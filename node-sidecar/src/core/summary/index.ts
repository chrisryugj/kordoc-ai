/** AI 요약 — Gemini 텍스트 요약
 *
 * HWP/PDF 등 바이너리 문서는 kordoc으로 먼저 파싱 후 텍스트 추출하여 요약
 */

import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { parse } from 'kordoc';
import { callGemini } from '../../infra/gemini.js';
import { sendProgress } from '../../infra/progress.js';
import { logger } from '../../infra/logger.js';

/** kordoc 파싱이 필요한 바이너리 확장자 */
const BINARY_EXT = new Set(['.hwp', '.hwpx', '.pdf', '.xlsx', '.docx']);

export interface SummarizeParams {
  /** 요약할 텍스트 (직접 입력) */
  text?: string;
  /** 또는 파일 경로 (텍스트/마크다운/HWP/PDF) */
  input_path?: string;
  /** 요약 분량 지정 (예: "3문장", "500자", "1페이지") */
  length?: string;
  /** 요약 언어 (기본: 한국어) */
  language?: string;
}

export interface SummarizeResult {
  success: boolean;
  summary: string;
  original_length: number;
  summary_length: number;
  error?: string;
}

export async function summarize(
  params: SummarizeParams,
  signal: AbortSignal,
): Promise<SummarizeResult> {
  let text = params.text ?? '';

  if (!text && params.input_path) {
    const ext = extname(params.input_path).toLowerCase();

    if (BINARY_EXT.has(ext)) {
      // HWP/PDF 등 → kordoc으로 파싱 후 마크다운 텍스트 추출
      sendProgress({ current: 0, total: 3, message: '문서 파싱 중...' });
      logger.info(`[summarize] 바이너리 파일 파싱: ${params.input_path}`);
      const buffer = await readFile(params.input_path);
      signal.throwIfAborted();
      const result = await parse(new Uint8Array(buffer).buffer);
      if (!result.success) {
        throw new Error(`문서 파싱 실패: ${result.error}`);
      }
      text = result.markdown;
      sendProgress({ current: 1, total: 3, message: '파싱 완료, 요약 준비 중...' });
    } else {
      // .txt, .md 등 텍스트 파일 → 직접 읽기
      sendProgress({ current: 0, total: 3, message: '파일 읽는 중...' });
      text = await readFile(params.input_path, 'utf-8');
      sendProgress({ current: 1, total: 3, message: '요약 준비 중...' });
    }
  }

  if (!text) {
    throw new Error('text 또는 input_path 중 하나를 제공해야 합니다');
  }

  const MAX_INPUT_LENGTH = 100_000;
  if (text.length > MAX_INPUT_LENGTH) {
    throw new Error(`입력 텍스트가 너무 깁니다 (${text.length}자). 최대 ${MAX_INPUT_LENGTH}자까지 지원합니다.`);
  }

  const language = params.language ?? '한국어';
  const lengthGuide = params.length ? `분량: ${params.length}. ` : '';

  logger.info(`[summarize] ${text.length}자 요약 시작`);
  sendProgress({ current: 2, total: 3, message: `Gemini로 ${text.length.toLocaleString()}자 요약 중...` });

  const summary = await callGemini({
    prompt: `다음 문서를 요약해주세요.\n\n${lengthGuide}언어: ${language}\n\n---\n\n${text}`,
    signal,
    systemInstruction: '당신은 한국 공문서 요약 전문가입니다. 핵심 내용만 간결하게 정리하세요. 원문에 없는 내용을 추가하지 마세요.',
  });

  sendProgress({ current: 3, total: 3, message: '요약 완료' });
  logger.info(`[summarize] done: ${text.length}자 → ${summary.length}자`);

  return {
    success: true,
    summary,
    original_length: text.length,
    summary_length: summary.length,
  };
}
