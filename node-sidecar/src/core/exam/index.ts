/**
 * 시험지 문항 생성 (KorDoc Studio W4) — Gemini로 시험 문항을 생성한다.
 *
 * 플랜 목표①("시험지를 열어 문항을 AI로 생성/수정하고 서식 그대로 저장")의 PoC.
 * 입력은 참고자료(지문/교과 텍스트·파일)와 과목·범위 지정을 모두 지원하고,
 * 출력은 3가지 모드:
 *  - fill:     열린 양식의 라벨(문항 자리)별 값 생성 → 채우기 폼에 제안(form_infer와 동일 흐름)
 *  - text:     문항을 마크다운으로 구성(+ 선택 저장)
 *  - document: 마크다운 → HWPX 생성(doc_b64 + 파일 저장)
 *
 * 보안: 참고자료·생성 결과가 외부 Gemini API로 오간다(프론트에 경고 표시).
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { parse, markdownToHwpx } from 'kordoc';
import { callGemini } from '../../infra/gemini.js';
import { logger } from '../../infra/logger.js';

export type ExamQuestionType = 'mc' | 'short' | 'essay' | 'ox';

const TYPE_KO: Record<ExamQuestionType, string> = {
  mc: '객관식(4지선다)',
  short: '단답형',
  essay: '서술형',
  ox: 'O/X형',
};

const DIFFICULTY_KO: Record<string, string> = {
  easy: '쉬움', medium: '보통', hard: '어려움',
};

export interface ExamQuestion {
  number: number;
  type: ExamQuestionType;
  /** 발문 */
  stem: string;
  /** 객관식 보기 (mc 한정) */
  choices?: string[];
  /** 정답 */
  answer?: string;
  /** 해설 */
  explanation?: string;
}

export interface ExamGenerateParams {
  // 입력 — 참고자료(둘 중 하나, 선택)
  reference_text?: string;
  reference_path?: string;
  // 입력 — 과목·범위 지정(선택)
  subject?: string;
  scope?: string;
  difficulty?: 'easy' | 'medium' | 'hard';
  // 생성 옵션
  count?: number;
  types?: ExamQuestionType[];
  include_answers?: boolean;
  // 출력
  mode: 'fill' | 'text' | 'document';
  /** fill 모드 — 채울 양식 라벨(문항 자리) */
  labels?: string[];
  /** text/document 모드 — 저장 경로(미지정 시 임시 디렉토리) */
  output_path?: string;
}

export interface ExamGenerateResult {
  success: boolean;
  mode: 'fill' | 'text' | 'document';
  questions?: ExamQuestion[];
  /** text/document 모드 — 구성된 마크다운 */
  markdown?: string;
  /** text/document 모드 — 저장 경로 */
  output_path?: string;
  /** document 모드 — 생성된 HWPX(base64) */
  doc_b64?: string;
  /** fill 모드 — 라벨별 생성 값(채우기 폼 제안) */
  fields?: Array<{ label: string; value: string }>;
  error?: string;
}

const SYSTEM_INSTRUCTION = [
  '당신은 한국 교육과정에 맞는 시험 문항을 출제하는 전문가입니다.',
  '- 교육적으로 정확하고 명확한 문항을 생성하세요.',
  '- 객관식은 정답 1개와 그럴듯한 오답으로 보기를 구성하세요.',
  '- 반드시 JSON만 반환하세요. 다른 설명 텍스트는 포함하지 마세요.',
].join('\n');

/** 참고자료 텍스트 확보 — reference_text 우선, 없으면 reference_path 파싱 */
async function resolveReference(params: ExamGenerateParams, signal?: AbortSignal): Promise<string> {
  const text = (params.reference_text ?? '').trim();
  if (text) return text;
  if (params.reference_path) {
    const buffer = await readFile(params.reference_path);
    signal?.throwIfAborted();
    const result = await parse(new Uint8Array(buffer).buffer);
    if (!result.success) throw new Error(`참고자료 파싱 실패: ${result.error}`);
    return result.markdown;
  }
  return '';
}

/** 과목/범위/난이도/참고자료를 프롬프트 컨텍스트 블록으로 */
function buildContext(params: ExamGenerateParams, reference: string): string {
  const lines: string[] = [];
  if (params.subject) lines.push(`- 과목/주제: ${params.subject}`);
  if (params.scope) lines.push(`- 출제 범위: ${params.scope}`);
  if (params.difficulty) lines.push(`- 난이도: ${DIFFICULTY_KO[params.difficulty] ?? params.difficulty}`);
  const ctx = lines.length ? ['## 출제 조건', ...lines].join('\n') : '';
  const ref = reference ? ['## 참고자료', '---', reference].join('\n') : '';
  return [ctx, ref].filter(Boolean).join('\n\n');
}

/** ```json ... ``` 또는 bare JSON 추출 */
function extractJson(raw: string): string | null {
  const m = raw.match(/```(?:json)?\s*([\s\S]*?)```/) ?? raw.match(/(\[[\s\S]*\]|\{[\s\S]*\})/);
  return m ? m[1].trim() : null;
}

/** text/document 모드 — 문항 배열 생성 */
async function generateQuestions(params: ExamGenerateParams, reference: string, signal: AbortSignal): Promise<ExamQuestion[]> {
  const count = Math.max(1, Math.min(params.count ?? 5, 30));
  const types = (params.types?.length ? params.types : ['mc']) as ExamQuestionType[];
  const typeList = types.map((t) => TYPE_KO[t] ?? t).join(', ');
  const context = buildContext(params, reference);

  const prompt = [
    `다음 조건으로 시험 문항 ${count}개를 생성하세요.`,
    '',
    context,
    '',
    '## 생성 규칙',
    `- 문항 유형: ${typeList} (유형을 적절히 섞어 출제)`,
    '- 각 문항은 발문(stem)을 포함하고, 객관식(mc)은 choices 4개를 포함하세요.',
    '- answer(정답), explanation(해설)을 포함하세요.',
    '',
    '## 응답 형식 (JSON 배열만)',
    '```json',
    '[{"number":1,"type":"mc","stem":"발문","choices":["①…","②…","③…","④…"],"answer":"②","explanation":"해설"}]',
    '```',
  ].filter((l) => l !== undefined).join('\n');

  const raw = await callGemini({ prompt, signal, systemInstruction: SYSTEM_INSTRUCTION });
  const json = extractJson(raw);
  if (!json) { logger.warn('[exam] 문항 JSON 파싱 실패'); return []; }
  try {
    const parsed = JSON.parse(json) as ExamQuestion[];
    if (!Array.isArray(parsed)) throw new Error('not array');
    return parsed.map((q, i) => ({
      number: q.number ?? i + 1,
      type: (q.type ?? 'mc') as ExamQuestionType,
      stem: q.stem ?? '',
      ...(Array.isArray(q.choices) ? { choices: q.choices } : {}),
      ...(q.answer ? { answer: q.answer } : {}),
      ...(q.explanation ? { explanation: q.explanation } : {}),
    }));
  } catch (e) {
    logger.warn(`[exam] 문항 JSON 파싱 에러: ${e}`);
    return [];
  }
}

/** fill 모드 — 양식 라벨별 값 생성 */
async function generateFields(params: ExamGenerateParams, reference: string, signal: AbortSignal): Promise<Array<{ label: string; value: string }>> {
  const labels = params.labels ?? [];
  const context = buildContext(params, reference);
  const prompt = [
    '아래는 시험지 양식의 빈칸(라벨) 목록입니다. 각 라벨 자리에 들어갈 문항 또는 내용을 생성하세요.',
    '',
    context,
    '',
    '## 양식 라벨',
    labels.map((l, i) => `${i + 1}. ${l}`).join('\n'),
    '',
    '## 응답 형식 (JSON 배열만)',
    '```json',
    '[{"label":"라벨명","value":"생성된 문항/내용"}]',
    '```',
  ].join('\n');

  const raw = await callGemini({ prompt, signal, systemInstruction: SYSTEM_INSTRUCTION });
  const json = extractJson(raw);
  if (!json) return labels.map((label) => ({ label, value: '' }));
  try {
    const parsed = JSON.parse(json) as Array<{ label: string; value: string }>;
    if (!Array.isArray(parsed)) throw new Error('not array');
    const map = new Map(parsed.map((f) => [f.label, f.value ?? '']));
    return labels.map((label) => ({ label, value: map.get(label) ?? '' }));
  } catch {
    return labels.map((label) => ({ label, value: '' }));
  }
}

/** 문항 배열 → 마크다운 (정답·해설은 별지로) */
function questionsToMarkdown(questions: ExamQuestion[], params: ExamGenerateParams): string {
  const title = params.subject ? `${params.subject} 시험지` : '시험지';
  const lines: string[] = [`# ${title}`, ''];
  for (const q of questions) {
    lines.push(`**${q.number}.** ${q.stem}`);
    if (q.choices?.length) {
      lines.push('');
      for (const c of q.choices) lines.push(`- ${c}`);
    }
    lines.push('');
  }
  if (params.include_answers !== false) {
    lines.push('---', '', '## 정답 및 해설', '');
    for (const q of questions) {
      const ans = q.answer ? `정답: ${q.answer}` : '';
      const exp = q.explanation ? ` — ${q.explanation}` : '';
      lines.push(`**${q.number}.** ${ans}${exp}`);
    }
  }
  return lines.join('\n');
}

export async function examGenerate(params: ExamGenerateParams, signal: AbortSignal): Promise<ExamGenerateResult> {
  const reference = await resolveReference(params, signal);
  signal.throwIfAborted();

  // 입력 가드 — 참고자료도, 과목 지정도 없으면 생성 근거가 없음
  if (!reference && !params.subject && !params.scope) {
    throw new Error('참고자료(텍스트/파일) 또는 과목·범위 중 하나는 입력해야 합니다');
  }

  if (params.mode === 'fill') {
    if (!params.labels?.length) throw new Error('fill 모드에는 양식 라벨이 필요합니다 ("labels")');
    const fields = await generateFields(params, reference, signal);
    logger.info(`[exam_generate] fill — ${fields.filter((f) => f.value).length}/${fields.length} 라벨 생성`);
    return { success: true, mode: 'fill', fields };
  }

  const questions = await generateQuestions(params, reference, signal);
  if (questions.length === 0) throw new Error('문항을 생성하지 못했습니다 — 입력을 보강해 다시 시도하세요');
  const markdown = questionsToMarkdown(questions, params);
  logger.info(`[exam_generate] ${params.mode} — 문항 ${questions.length}개`);

  if (params.mode === 'text') {
    let outputPath = params.output_path;
    if (outputPath) {
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, markdown, 'utf-8');
    }
    return { success: true, mode: 'text', questions, markdown, output_path: outputPath };
  }

  // document 모드 — 마크다운 → HWPX
  signal.throwIfAborted();
  const hwpxBuffer = await markdownToHwpx(markdown);
  const outputPath = params.output_path ?? join(tmpdir(), `kordoc-exam-${randomUUID().slice(0, 8)}.hwpx`);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, Buffer.from(hwpxBuffer));
  logger.info(`[exam_generate] document → ${outputPath} (${hwpxBuffer.byteLength} bytes)`);

  return {
    success: true,
    mode: 'document',
    questions,
    markdown,
    output_path: outputPath,
    doc_b64: Buffer.from(hwpxBuffer).toString('base64'),
  };
}
