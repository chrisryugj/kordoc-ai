/** K팀장 — 문서 정합성 검사 (논리 구조, 숫자/날짜 표기, 오탈자 등) */

import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { parse } from 'kordoc';
import { callGemini } from '../../infra/gemini.js';
import { sendProgress } from '../../infra/progress.js';
import { logger } from '../../infra/logger.js';

export interface InspectDocumentParams {
  input_path: string;
}

export type IssueSeverity = 'error' | 'warning' | 'suggestion';
export type IssueCategory = 'logic' | 'number' | 'date' | 'terminology' | 'typo' | 'reference';

export interface DocumentIssue {
  category: IssueCategory;
  severity: IssueSeverity;
  location: string;
  description: string;
  original?: string;
  suggestion?: string;
}

export interface InspectDocumentResult {
  success: boolean;
  document_title?: string;
  issues: DocumentIssue[];
  summary: string;
  total_issues: number;
  error?: string;
}

const CATEGORY_LABELS: Record<IssueCategory, string> = {
  logic: '논리 구조',
  number: '숫자/금액',
  date: '날짜/기간',
  terminology: '용어 일관성',
  typo: '오탈자/맞춤법',
  reference: '내부 참조',
};

const PROMPT = `당신은 한국어 공문서 교열 전문가입니다. 아래 문서를 꼼꼼히 분석하여 문제를 찾아주세요.

검사 항목:
1. **논리 구조(logic)**: 서술 흐름 단절, 근거 없는 주장, 결론과 본문 불일치, 항목 순서 문제
2. **숫자/금액(number)**: 아라비아/한글 숫자 혼용, 단위 불일치, 표 합계 오류, 금액 계산 오류, 퍼센트 불일치
3. **날짜/기간(date)**: 날짜 형식 혼용(2025.03.15 vs 2025년 3월 15일), 기간 계산 오류, 앞뒤 날짜 불일치
4. **용어 일관성(terminology)**: 같은 개념을 다른 단어로 혼용, 띄어쓰기 불일치(예: "국토교통부" vs "국토 교통부")
5. **오탈자/맞춤법(typo)**: 오타, 맞춤법 오류, 띄어쓰기 오류
6. **내부 참조(reference)**: "제3조에 따라" 등 조항 참조 오류, 각주 번호 불일치

심각도 기준:
- error: 내용이 틀렸거나 문서의 신뢰성에 영향 (금액 오류, 날짜 오류, 논리 모순)
- warning: 표기 불일치나 혼용 (숫자 표기 혼용, 용어 불일치)
- suggestion: 개선 권고 사항 (표현 명확화, 구조 개선)

반드시 아래 JSON 형식으로만 출력하세요:
{
  "document_title": "문서 제목 또는 null",
  "summary": "전체 문서 상태 한 줄 요약",
  "issues": [
    {
      "category": "logic|number|date|terminology|typo|reference 중 하나",
      "severity": "error|warning|suggestion 중 하나",
      "location": "위치 설명 (예: '3페이지 2번째 단락', '표 2 합계행')",
      "description": "문제 설명",
      "original": "원문 텍스트 (해당하는 경우)",
      "suggestion": "수정 제안 (해당하는 경우)"
    }
  ]
}

문서:
---
{{DOCUMENT}}
---`;

interface RawIssue {
  category?: unknown;
  severity?: unknown;
  location?: unknown;
  description?: unknown;
  original?: unknown;
  suggestion?: unknown;
}

interface RawResult {
  document_title?: unknown;
  summary?: unknown;
  issues?: unknown;
}

const VALID_CATEGORIES = new Set<string>(['logic', 'number', 'date', 'terminology', 'typo', 'reference']);
const VALID_SEVERITIES = new Set<string>(['error', 'warning', 'suggestion']);

function parseResult(text: string): RawResult | null {
  try {
    const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const candidate = codeBlock ? codeBlock[1].trim() : text.trim();
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start === -1 || end <= start) return null;
    return JSON.parse(candidate.substring(start, end + 1)) as RawResult;
  } catch {
    return null;
  }
}

function normalizeIssues(raw: unknown): DocumentIssue[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is RawIssue => item !== null && typeof item === 'object')
    .filter((item) =>
      typeof item.category === 'string' && VALID_CATEGORIES.has(item.category) &&
      typeof item.severity === 'string' && VALID_SEVERITIES.has(item.severity) &&
      typeof item.description === 'string' && item.description.trim()
    )
    .map((item) => ({
      category: item.category as IssueCategory,
      severity: item.severity as IssueSeverity,
      location: typeof item.location === 'string' && item.location.trim() ? item.location.trim() : '위치 미상',
      description: (item.description as string).trim(),
      ...(typeof item.original === 'string' && item.original.trim() ? { original: item.original.trim() } : {}),
      ...(typeof item.suggestion === 'string' && item.suggestion.trim() ? { suggestion: item.suggestion.trim() } : {}),
    }));
}

export { CATEGORY_LABELS };

export async function inspectDocument(
  params: InspectDocumentParams,
  signal: AbortSignal,
): Promise<InspectDocumentResult> {
  const { input_path } = params;

  logger.info(`[inspect_document] ${input_path}`);
  sendProgress({ current: 0, total: 3, message: '문서 파싱 중...' });

  // 문서 파싱
  const buffer = await readFile(input_path);
  let markdown: string;

  try {
    signal.throwIfAborted();
    const parsed = await parse(buffer);
    markdown = parsed.success ? parsed.markdown : '';
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new Error(`문서 파싱 실패: ${String(err)}`);
  }

  if (!markdown.trim()) {
    return {
      success: true,
      issues: [],
      summary: '문서에서 텍스트를 추출할 수 없습니다.',
      total_issues: 0,
    };
  }

  // 텍스트가 너무 길면 앞 8000자만 (Gemini 컨텍스트 고려)
  const truncated = markdown.length > 8000
    ? markdown.substring(0, 8000) + '\n\n[...이하 내용 생략...]'
    : markdown;

  sendProgress({ current: 1, total: 3, message: 'K팀장이 검토 중...' });
  signal.throwIfAborted();

  const prompt = PROMPT.replace('{{DOCUMENT}}', truncated);

  let rawText: string;
  try {
    rawText = await callGemini({
      prompt,
      signal,
      systemInstruction: '당신은 한국어 공문서 교열 및 논리 검토 전문가입니다. 지시한 JSON 스키마만 정확히 출력하세요.',
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new Error(`Gemini 분석 실패: ${String(err)}`);
  }

  sendProgress({ current: 2, total: 3, message: '검토 결과 정리 중...' });

  const parsed = parseResult(rawText);

  if (!parsed) {
    logger.warn('[inspect_document] JSON 파싱 실패');
    return {
      success: true,
      issues: [],
      summary: 'AI 분석 결과를 처리하지 못했습니다.',
      total_issues: 0,
    };
  }

  const issues = normalizeIssues(parsed.issues);
  const summary = typeof parsed.summary === 'string' && parsed.summary.trim()
    ? parsed.summary.trim()
    : `총 ${issues.length}건의 검토 사항이 발견되었습니다.`;
  const documentTitle = typeof parsed.document_title === 'string' && parsed.document_title.trim()
    ? parsed.document_title.trim()
    : undefined;

  logger.info(`[inspect_document] 완료: ${issues.length}건 (error: ${issues.filter(i => i.severity === 'error').length}, warning: ${issues.filter(i => i.severity === 'warning').length})`);
  sendProgress({ current: 3, total: 3, message: `검토 완료 — ${issues.length}건 발견` });

  return {
    success: true,
    document_title: documentTitle,
    issues,
    summary,
    total_issues: issues.length,
  };
}
