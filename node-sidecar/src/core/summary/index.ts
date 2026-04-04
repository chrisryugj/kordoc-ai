/** AI 요약 — Gemini 텍스트 요약 */

import { readFile } from 'node:fs/promises';
import { callGemini } from '../../infra/gemini.js';
import { logger } from '../../infra/logger.js';

export interface SummarizeParams {
  /** 요약할 텍스트 (직접 입력) */
  text?: string;
  /** 또는 파일 경로 (텍스트/마크다운) */
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
    text = await readFile(params.input_path, 'utf-8');
  }

  if (!text) {
    throw new Error('text 또는 input_path 중 하나를 제공해야 합니다');
  }

  const language = params.language ?? '한국어';
  const lengthGuide = params.length ? `분량: ${params.length}. ` : '';

  logger.info(`[summarize] ${text.length}자 요약 시작`);

  const summary = await callGemini({
    prompt: `다음 문서를 요약해주세요.\n\n${lengthGuide}언어: ${language}\n\n---\n\n${text}`,
    signal,
    systemInstruction: '당신은 한국 공문서 요약 전문가입니다. 핵심 내용만 간결하게 정리하세요. 원문에 없는 내용을 추가하지 마세요.',
  });

  logger.info(`[summarize] done: ${text.length}자 → ${summary.length}자`);

  return {
    success: true,
    summary,
    original_length: text.length,
    summary_length: summary.length,
  };
}
