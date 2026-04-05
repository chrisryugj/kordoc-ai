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

/** 요약 스타일 — 목적에 따라 프롬프트가 달라짐 */
export type SummarizeStyle = 'standard' | 'briefing' | 'review' | 'action';

export interface SummarizeParams {
  /** 요약할 텍스트 (직접 입력) */
  text?: string;
  /** 또는 파일 경로 (텍스트/마크다운/HWP/PDF) */
  input_path?: string;
  /** 요약 분량: short (3-5문장), medium (기본), long (1페이지) */
  length?: 'short' | 'medium' | 'long';
  /** 요약 스타일 (기본: standard) */
  style?: SummarizeStyle;
  /** 요약 언어 (기본: 한국어) */
  language?: string;
}

export interface SummarizeResult {
  success: boolean;
  summary: string;
  style: SummarizeStyle;
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
      signal.throwIfAborted();
      text = await readFile(params.input_path, 'utf-8');
      sendProgress({ current: 1, total: 3, message: '요약 준비 중...' });
    }
  }

  if (!text || !text.trim()) {
    throw new Error('요약할 내용이 없습니다. 텍스트가 비어 있거나 공백만 포함되어 있습니다.');
  }

  const MAX_INPUT_LENGTH = 100_000;
  if (text.length > MAX_INPUT_LENGTH) {
    throw new Error(`입력 텍스트가 너무 깁니다 (${text.length}자). 최대 ${MAX_INPUT_LENGTH}자까지 지원합니다.`);
  }

  const language = params.language ?? '한국어';
  const style = params.style ?? 'standard';
  const length = params.length ?? 'medium';

  const prompt = buildPrompt(text, style, length, language);
  const systemInstruction = buildSystemInstruction(style);

  logger.info(`[summarize] ${text.length}자 요약 시작 (style=${style}, length=${length})`);
  sendProgress({ current: 2, total: 3, message: `Gemini로 ${text.length.toLocaleString()}자 요약 중...` });

  const summary = await callGemini({ prompt, signal, systemInstruction });

  if (!summary || !summary.trim()) {
    throw new Error('요약 결과가 비어 있습니다. 다시 시도해 주세요.');
  }

  sendProgress({ current: 3, total: 3, message: '요약 완료' });
  logger.info(`[summarize] done: ${text.length}자 → ${summary.length}자`);

  return {
    success: true,
    summary,
    style,
    original_length: text.length,
    summary_length: summary.length,
  };
}

// ── 프롬프트 빌더 ──

const LENGTH_GUIDE: Record<string, string> = {
  short: '3~5문장으로 핵심만 간결하게 요약하세요.',
  medium: '주요 내용을 빠짐없이 정리하되, 간결하게 요약하세요.',
  long: 'A4 1페이지 분량으로 상세하게 요약하세요. 세부 사항과 근거도 포함하세요.',
};

const STYLE_PROMPT: Record<SummarizeStyle, string> = {
  standard: '다음 문서를 요약해 주세요.',
  briefing: '다음 문서를 상급자 보고용으로 요약해 주세요. 결론을 먼저, 배경은 간략히.',
  review: '다음 문서를 검토 관점에서 정리해 주세요. 쟁점, 리스크, 확인 필요 사항을 중심으로.',
  action: '다음 문서에서 조치해야 할 사항만 추출해 주세요. 담당, 기한, 내용을 구조화하세요.',
};

const STYLE_FORMAT: Record<SummarizeStyle, string> = {
  standard: `아래 형식으로 정리하세요:

## 배경 및 목적
(1~2문장)

## 핵심 내용
(핵심 사항을 불릿으로)

## 요청/조치 사항
(있는 경우만)

## 주요 일정
(있는 경우만)`,
  briefing: `아래 형식으로 정리하세요:

## 결론
(1~2문장 — 가장 중요한 결론 먼저)

## 주요 내용
(3~5개 불릿)

## 참고 사항
(배경, 경과 등 — 간략히)`,
  review: `아래 형식으로 정리하세요:

## 문서 개요
(1~2문장)

## 주요 쟁점
(쟁점별 불릿)

## 리스크 및 확인 필요 사항
(구체적으로)

## 검토 의견
(있으면)`,
  action: `아래 형식으로 정리하세요:

| 조치 사항 | 담당 | 기한 | 비고 |
|-----------|------|------|------|
| (내용)    | (해당자) | (날짜) | (참고) |

표 아래에 추가 설명이 필요하면 간략히 기술하세요.`,
};

function buildPrompt(text: string, style: SummarizeStyle, length: string, language: string): string {
  const parts = [
    STYLE_PROMPT[style],
    '',
    LENGTH_GUIDE[length] ?? LENGTH_GUIDE.medium,
    `언어: ${language}`,
    '',
    STYLE_FORMAT[style],
    '',
    '---',
    '',
    text,
  ];
  return parts.join('\n');
}

function buildSystemInstruction(style: SummarizeStyle): string {
  const base = [
    '당신은 한국 공문서 요약 전문가입니다.',
    '- 법적 근거, 결재 사항, 기한이 있으면 반드시 포함하세요.',
    '- 숫자(예산, 인원, 기한)는 정확히 보존하세요.',
    '- 원문에 없는 내용을 추가하지 마세요.',
    '- 마크다운 형식으로 작성하세요.',
  ];
  if (style === 'briefing') {
    base.push('- 결론부터 쓰세요. 상급자가 30초 안에 핵심을 파악할 수 있어야 합니다.');
  } else if (style === 'action') {
    base.push('- 조치 사항이 없으면 "조치 사항 없음"으로 명시하세요.');
  }
  return base.join('\n');
}
