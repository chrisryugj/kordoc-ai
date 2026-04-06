/** AI 기반 양식 필드 추출 — Gemini API */

import { callGemini } from '../../infra/gemini.js';
import { logger } from '../../infra/logger.js';

const SYSTEM_INSTRUCTION = [
  '당신은 한국 공문서에서 양식 필드를 추출하는 전문가입니다.',
  '- 사용자가 지정한 필드명에 해당하는 값을 문서에서 정확히 찾아 추출하세요.',
  '- 값이 문서에 없으면 빈 문자열("")로 반환하세요.',
  '- 숫자, 날짜, 고유명사는 원문 그대로 보존하세요.',
  '- 반드시 JSON 배열만 반환하세요. 다른 텍스트는 포함하지 마세요.',
].join('\n');

export interface AiExtractedField {
  label: string;
  value: string;
}

/**
 * Gemini를 사용하여 문서에서 지정된 필드 값을 추출.
 * @param markdown - kordoc parse()로 추출한 문서 마크다운
 * @param selectedFields - 추출할 필드명 리스트
 * @param signal - AbortSignal
 */
export async function aiExtractFields(
  markdown: string,
  selectedFields: string[],
  signal: AbortSignal,
): Promise<AiExtractedField[]> {
  const prompt = buildPrompt(markdown, selectedFields);
  const raw = await callGemini({ prompt, signal, systemInstruction: SYSTEM_INSTRUCTION });
  return parseResponse(raw, selectedFields);
}

function buildPrompt(markdown: string, fields: string[]): string {
  const fieldList = fields.map((f, i) => `${i + 1}. ${f}`).join('\n');
  return [
    '다음 문서에서 아래 필드의 값을 추출해 주세요.',
    '',
    '## 추출할 필드',
    fieldList,
    '',
    '## 응답 형식',
    'JSON 배열로만 응답하세요:',
    '```json',
    '[{"label": "필드명", "value": "추출된 값"}, ...]',
    '```',
    '',
    '## 문서 내용',
    '---',
    markdown,
  ].join('\n');
}

function parseResponse(raw: string, selectedFields: string[]): AiExtractedField[] {
  // JSON 블록 추출 (```json ... ``` 또는 bare JSON)
  const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/) ?? raw.match(/(\[[\s\S]*\])/);
  if (!jsonMatch) {
    logger.warn('[ai-extract] JSON 파싱 실패, 빈 결과 반환');
    return selectedFields.map((label) => ({ label, value: '' }));
  }

  try {
    const parsed = JSON.parse(jsonMatch[1].trim()) as AiExtractedField[];
    if (!Array.isArray(parsed)) throw new Error('not array');

    // 선택된 필드 순서대로 정렬 + 누락 필드 보충
    const map = new Map(parsed.map((f) => [f.label, f.value ?? '']));
    return selectedFields.map((label) => ({
      label,
      value: map.get(label) ?? '',
    }));
  } catch (e) {
    logger.warn(`[ai-extract] JSON 파싱 에러: ${e}`);
    return selectedFields.map((label) => ({ label, value: '' }));
  }
}
