/** 양식 필드 추출 — kordoc extractFormFields + JSON 저장 + 배치 + AI */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, basename, extname, join } from 'node:path';
import { parse, extractFormFields, type FormResult } from 'kordoc';
import { getConfig } from '../../infra/config.js';
import { sendProgress } from '../../infra/progress.js';
import { logger } from '../../infra/logger.js';
import { validateFileSize } from '../../infra/pathGuard.js';
import { buildCsv, type CsvRow } from './csv-export.js';
import { aiExtractFields } from './ai-extract.js';

export interface FormExtractParams {
  /** 입력 파일 경로 */
  input_path: string;
  /** 페이지 범위 */
  pages?: string;
}

export interface FormExtractResult {
  success: boolean;
  fields: FormResult['fields'];
  confidence: number;
  output_path: string;
  error?: string;
}

export async function formExtract(params: FormExtractParams, signal?: AbortSignal): Promise<FormExtractResult> {
  const { input_path, pages } = params;

  logger.info(`[form_extract] 시작: ${input_path}`);
  sendProgress({ current: 0, total: 3, message: '문서 읽는 중...' });
  signal?.throwIfAborted();

  await validateFileSize(input_path);
  const buffer = await readFile(input_path);
  signal?.throwIfAborted();

  sendProgress({ current: 1, total: 3, message: '문서 파싱 중...' });
  const result = await parse(new Uint8Array(buffer).buffer, { pages });

  if (!result.success) {
    logger.error(`[form_extract] 파싱 실패: ${result.error}`);
    return {
      success: false,
      fields: [],
      confidence: 0,
      output_path: '',
      error: result.error,
    };
  }

  sendProgress({ current: 2, total: 3, message: '양식 필드 추출 중...' });
  const form = extractFormFields(result.blocks);

  // 출력 경로 결정 + JSON 저장
  const cfg = getConfig('convert');
  const outDir = cfg.output_dir || dirname(input_path);
  const stem = basename(input_path, extname(input_path));
  const outputPath = join(outDir, `${stem}_fields.json`);

  const jsonContent = JSON.stringify({
    source: basename(input_path),
    confidence: form.confidence,
    field_count: form.fields.length,
    fields: form.fields,
  }, null, 2);

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, jsonContent, 'utf-8');

  sendProgress({ current: 3, total: 3, message: `${form.fields.length}개 필드 추출 완료 → ${basename(outputPath)}` });
  logger.info(`[form_extract] ${form.fields.length}개 필드 (confidence: ${form.confidence}) → ${outputPath}`);

  return {
    success: true,
    fields: form.fields,
    confidence: form.confidence,
    output_path: outputPath,
  };
}

// ── 필드 후보 추출 (1단계) ──

export interface FormCandidatesParams {
  input_path: string;
  pages?: string;
}

export interface FieldCandidate {
  label: string;
  source: 'table' | 'inline';
  count: number;
}

export interface FormCandidatesResult {
  success: boolean;
  candidates: FieldCandidate[];
  error?: string;
}

export async function formExtractCandidates(
  params: FormCandidatesParams,
  signal?: AbortSignal,
): Promise<FormCandidatesResult> {
  const { input_path, pages } = params;

  logger.info(`[form_candidates] 시작: ${input_path}`);
  sendProgress({ current: 0, total: 2, message: '문서 파싱 중...' });
  signal?.throwIfAborted();

  const buffer = await readFile(input_path);
  signal?.throwIfAborted();

  const result = await parse(new Uint8Array(buffer).buffer, { pages });
  if (!result.success) {
    return { success: false, candidates: [], error: result.error };
  }

  sendProgress({ current: 1, total: 2, message: '필드 후보 분석 중...' });
  const form = extractFormFields(result.blocks);

  // label 중복 카운트 + source 분류
  const labelMap = new Map<string, { count: number; source: 'table' | 'inline' }>();
  for (const field of form.fields) {
    const label = field.label.trim().replace(/\n/g, ' ');
    if (!label) continue;
    const existing = labelMap.get(label);
    const source = field.row === -1 ? 'inline' as const : 'table' as const;
    if (existing) {
      existing.count++;
    } else {
      labelMap.set(label, { count: 1, source });
    }
  }

  const candidates: FieldCandidate[] = [...labelMap.entries()]
    .map(([label, info]) => ({ label, source: info.source, count: info.count }));

  sendProgress({ current: 2, total: 2, message: `${candidates.length}개 필드 후보 발견` });
  logger.info(`[form_candidates] ${candidates.length}개 후보`);

  return { success: true, candidates };
}

// ── 배치 추출 (2단계) ──

/** 바이너리 확장자 (kordoc 파싱 필요) */
const BINARY_EXT = new Set(['.hwp', '.hwpx', '.pdf', '.xlsx', '.docx']);

export interface FormExtractBatchParams {
  files: string[];
  selected_fields: string[];
  use_ai?: boolean;
  /** 출력 디렉토리 (미지정 시 설정값 → 첫 파일 폴더) */
  output_dir?: string;
}

export interface FormExtractBatchResult {
  success: boolean;
  total: number;
  succeeded: number;
  failed: number;
  results: Array<{
    file: string;
    fields: Array<{ label: string; value: string }>;
    error?: string;
  }>;
  output_path: string;
}

export async function formExtractBatch(
  params: FormExtractBatchParams,
  signal: AbortSignal,
): Promise<FormExtractBatchResult> {
  const { files, selected_fields, use_ai, output_dir } = params;
  const results: FormExtractBatchResult['results'] = [];
  let succeeded = 0;
  let failed = 0;

  logger.info(`[form_batch] ${files.length}개 파일, ${selected_fields.length}개 필드, ai=${!!use_ai}`);

  for (let i = 0; i < files.length; i++) {
    signal.throwIfAborted();
    sendProgress({
      current: i + 1,
      total: files.length,
      message: `파일 ${i + 1}/${files.length} 추출 중`,
    });

    try {
      const filePath = files[i];
      const buffer = await readFile(filePath);
      const parsed = await parse(new Uint8Array(buffer).buffer);

      if (!parsed.success) {
        failed++;
        results.push({ file: basename(filePath), fields: [], error: parsed.error });
        continue;
      }

      let extractedFields: Array<{ label: string; value: string }>;

      if (use_ai) {
        // AI 모드: Gemini로 정밀 추출
        extractedFields = await aiExtractFields(parsed.markdown, selected_fields, signal);
      } else {
        // 로컬 모드: kordoc extractFormFields + 필터링
        const form = extractFormFields(parsed.blocks);
        const fieldMap = new Map<string, string>();
        for (const f of form.fields) {
          const label = f.label.trim().replace(/\n/g, ' ');
          if (selected_fields.includes(label) && !fieldMap.has(label)) {
            fieldMap.set(label, f.value.trim());
          }
        }
        extractedFields = selected_fields.map((label) => ({
          label,
          value: fieldMap.get(label) ?? '',
        }));
      }

      results.push({ file: basename(filePath), fields: extractedFields });
      succeeded++;
    } catch (err) {
      failed++;
      results.push({
        file: basename(files[i]),
        fields: [],
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // CSV 저장
  const cfg = getConfig('convert');
  const outDir = output_dir || cfg.output_dir || dirname(files[0]);
  const csvRows: CsvRow[] = results.map((r) => ({
    file: r.file,
    fields: Object.fromEntries(r.fields.map((f) => [f.label, f.value])),
  }));
  const csvContent = buildCsv(selected_fields, csvRows);
  const outputPath = join(outDir, `양식추출_${selected_fields.length}필드_${files.length}건.csv`);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, csvContent, 'utf-8');

  sendProgress({ current: files.length, total: files.length, message: `완료 → ${basename(outputPath)}` });
  logger.info(`[form_batch] 완료: ${succeeded}성공, ${failed}실패 → ${outputPath}`);

  return { success: true, total: files.length, succeeded, failed, results, output_path: outputPath };
}
