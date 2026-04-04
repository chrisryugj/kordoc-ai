/** 양식 필드 추출 — kordoc extractFormFields + JSON 저장 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, basename, extname, join } from 'node:path';
import { parse, extractFormFields, type FormResult } from 'kordoc';
import { getConfig } from '../../infra/config.js';
import { sendProgress } from '../../infra/progress.js';
import { logger } from '../../infra/logger.js';

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
