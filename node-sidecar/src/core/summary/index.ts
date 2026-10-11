/** AI 요약 (ai_summarize) — 설정된 AI 공급자(내장·서버·클라우드)로 요약
 *
 * 문서는 kordoc 으로 읽고(core/ai/docs 캐시), 모델 컨텍스트보다 길면 조각별 요점 → 합쳐서 최종 요약(core/ai/condense).
 */

import { ask, contextCharBudget } from '../../infra/llm/index.js';
import { sendProgress } from '../../infra/progress.js';
import { logger } from '../../infra/logger.js';
import { condense } from '../ai/condense.js';
import { loadDoc } from '../ai/docs.js';
import { cleanOutput, escapeLineDates, FIDELITY_RULES } from '../ai/prompts.js';

/** 요약 스타일 — 목적에 따라 프롬프트가 달라짐 */
export type SummarizeStyle = 'standard' | 'briefing' | 'review' | 'action';

export interface SummarizeParams {
  /** 요약할 텍스트 (직접 입력) */
  text?: string;
  /** 또는 파일 경로 (HWP·HWPX·PDF·DOCX·XLSX·PPTX·이미지·md·txt) */
  path?: string;
  /** 요약 분량: short (3~5문장), medium (기본), long (1쪽) */
  length?: 'short' | 'medium' | 'long';
  /** 요약 스타일 (기본: standard) */
  style?: SummarizeStyle;
}

const LENGTH_TOKENS = { short: 500, medium: 1000, long: 1800 } as const;

const LENGTH_GUIDE: Record<string, string> = {
  short: '3~5문장으로 핵심만 간결하게 요약하세요.',
  medium: '주요 내용을 빠짐없이 정리하되, 간결하게 요약하세요.',
  long: 'A4 1쪽 분량으로 상세하게 요약하세요. 세부 사항과 근거도 포함하세요.',
};

const STYLE_PROMPT: Record<SummarizeStyle, string> = {
  standard: '다음 문서를 요약해 주세요.',
  briefing: '다음 문서를 상급자 보고용으로 요약해 주세요. 결론을 먼저, 배경은 간략히.',
  review: '다음 문서를 검토 관점에서 정리해 주세요. 쟁점, 리스크, 확인 필요 사항을 중심으로.',
  action: '다음 문서에서 해야 할 일만 추출해 주세요. 담당, 기한, 내용을 구조화하세요. 날짜·숫자는 원문 그대로 옮기세요.',
};

/** 긴 문서를 줄일 때 무엇을 남길지 */
const STYLE_FOCUS: Record<SummarizeStyle, string> = {
  standard: '목적·핵심 내용·요청 사항·일정, 숫자·날짜·고유명사',
  briefing: '결론·핵심 숫자·주요 내용',
  review: '쟁점·리스크·확인이 필요한 사항·근거',
  action: '해야 할 일·담당·기한',
};

const STYLE_FORMAT: Record<SummarizeStyle, string> = {
  standard: `아래 형식으로 정리하세요:

## 배경 및 목적
(1~2문장)

## 핵심 내용
(핵심 사항을 불릿으로)

## 요청 및 후속 사항
(있는 경우만)

## 주요 일정
(있는 경우만)`,
  briefing: `아래 형식으로 정리하세요:

## 결론
(1~2문장: 가장 중요한 결론 먼저)

## 주요 내용
(3~5개 불릿)

## 참고 사항
(배경, 경과 등: 간략히)`,
  review: `아래 형식으로 정리하세요:

## 문서 개요
(1~2문장)

## 주요 쟁점
(쟁점별 불릿)

## 리스크 및 확인 필요 사항
(구체적으로)

## 검토 의견
(있으면)`,
  action: `아래 표로만 정리하세요. 기한의 날짜·연도는 원문에 적힌 그대로 옮기고, 담당·기한이 없으면 "-"로 두세요. 비고는 짧게.

| 할 일 | 담당 | 기한 | 비고 |
|-------|------|------|------|
| (내용) | (해당자) | (원문 그대로) | (참고) |`,
};

function buildSystemInstruction(style: SummarizeStyle): string {
  const base = [
    '당신은 한국 공문서 요약 전문가입니다.',
    FIDELITY_RULES,
    '- 법적 근거, 결재 사항, 기한이 있으면 반드시 포함하세요.',
    '- 마크다운 형식으로 작성하고, 요약 본문만 쓰세요(머리말·맺음말 없이).',
  ];
  if (style === 'briefing') base.push('- 결론부터 쓰세요. 상급자가 30초 안에 핵심을 파악할 수 있어야 합니다.');
  else if (style === 'action') base.push('- 할 일이 없으면 "해당 없음"으로 명시하세요.');
  return base.join('\n');
}

function buildPrompt(text: string, style: SummarizeStyle, length: string, condensed: boolean): string {
  return [
    STYLE_PROMPT[style],
    condensed ? '(문서가 길어 부분별로 먼저 정리한 요점을 드립니다. 요점에 있는 내용만 쓰세요.)' : '',
    LENGTH_GUIDE[length] ?? LENGTH_GUIDE.medium,
    '',
    STYLE_FORMAT[style],
    '',
    '---',
    '',
    text,
  ].filter((l, i) => i !== 1 || l).join('\n');
}

export async function summarize(params: SummarizeParams, signal: AbortSignal): Promise<{ summary: string; redacted: number }> {
  let text = params.text ?? '';
  if (!text.trim() && params.path) {
    sendProgress({ current: 0, total: 3, message: '문서 읽는 중...' });
    text = (await loadDoc(params.path, signal)).text;
  }
  if (!text.trim()) throw new Error('요약할 내용이 없습니다. 글을 넣거나 문서를 고르세요.');

  const style: SummarizeStyle = params.style && params.style in STYLE_PROMPT ? params.style : 'standard';
  const length = params.length && params.length in LENGTH_TOKENS ? params.length : 'medium';
  const system = buildSystemInstruction(style);
  const maxTokens = LENGTH_TOKENS[length];
  const budget = await contextCharBudget({ reserveTokens: maxTokens, signal });
  const room = Math.max(1000, budget - system.length - STYLE_FORMAT[style].length - 300);
  logger.info(`[ai_summarize] ${text.length}자 (style=${style}, length=${length}, room=${room})`);

  const c = await condense(text, room, signal, STYLE_FOCUS[style]);
  sendProgress({ current: 2, total: 3, message: `${text.length.toLocaleString()}자 요약 중...` });
  const r = await ask({
    system,
    messages: [{ role: 'user', content: buildPrompt(c.text, style, length, c.text !== text) }],
    maxTokens,
    signal,
  });
  const summary = cleanOutput(r.text);
  if (!summary) throw new Error('요약 결과가 비어 있습니다. 다시 시도하세요.');
  sendProgress({ current: 3, total: 3, message: '요약 완료' });
  const note = c.partial ? `\n\n※ 문서가 길어 ${c.partial.total}부분으로 나눈 뒤 처음부터 끝까지 고르게 ${c.partial.read}부분만 읽고 요약했습니다.` : '';
  return { summary: escapeLineDates(summary) + note, redacted: c.redacted + r.redacted };
}
