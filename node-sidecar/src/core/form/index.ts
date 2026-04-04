/** 양식 필드 추출 — kordoc extractFormFields */

import { readFile } from 'node:fs/promises';
import { parse, extractFormFields, type FormResult } from 'kordoc';
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
  error?: string;
}

export async function formExtract(params: FormExtractParams): Promise<FormExtractResult> {
  const { input_path, pages } = params;

  logger.info(`[form_extract] ${input_path}`);

  const buffer = await readFile(input_path);
  const result = await parse(buffer.buffer as ArrayBuffer, { pages });

  if (!result.success) {
    return {
      success: false,
      fields: [],
      confidence: 0,
      error: result.error,
    };
  }

  const form = extractFormFields(result.blocks);

  logger.info(`[form_extract] ${form.fields.length}개 필드 (confidence: ${form.confidence})`);

  return {
    success: true,
    fields: form.fields,
    confidence: form.confidence,
  };
}
