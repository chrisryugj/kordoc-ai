/** OCR — 스캔 PDF·이미지에서 글자 읽기
 *
 * 기본: kordoc 내장 OCR(PP-OCRv5 korean, 이 PC 안에서, 키·인터넷 불필요). 스캔 표 구조도 복원.
 * 선택: engine="ai" 면 쪽 이미지를 설정된 비전 AI 에 보낸다 (kordoc OcrProvider 훅 — 쪽 단위).
 */

import { readFile, writeFile } from 'node:fs/promises';
import { parse, type OcrProvider } from 'kordoc';
import { ask, getProvider } from '../../infra/llm/index.js';
import { sendProgress } from '../../infra/progress.js';
import { logger } from '../../infra/logger.js';
import { outputFile, stemOf } from '../output/index.js';
import { cleanMessage } from '../errors.js';

export interface OcrParams {
  input_path: string;
  output_path?: string;
  pages?: string;
  /** local(기본) · ai(비전 AI) */
  engine?: 'local' | 'ai';
  /** 텍스트층이 있어도 전 쪽 OCR */
  force?: boolean;
}

export interface OcrResult {
  success: boolean;
  output_path: string;
  markdown: string;
  page_count?: number;
  engine: 'local' | 'ai';
  warnings?: string[];
  error?: string;
}

const AI_OCR_SYSTEM = '당신은 한국어 문서 OCR 전문가입니다. 이미지의 글자만 정확히 옮기세요. 표는 마크다운 표로. 설명·주석을 붙이지 마세요. 숫자·날짜·고유명사는 보이는 그대로.';

function aiOcrProvider(signal: AbortSignal): OcrProvider {
  const provider = getProvider();
  if (!provider.supportsVision) {
    throw new Error('지금 연결된 AI는 이미지를 못 읽습니다. 내장 OCR을 쓰거나 설정 > AI 연결에서 비전 모델을 고르세요.');
  }
  return async (pageImage, pageNumber, mimeType) => {
    sendProgress({ current: pageNumber, total: 0, message: `AI가 ${pageNumber}쪽을 읽는 중...` });
    const { text } = await ask({
      system: AI_OCR_SYSTEM,
      messages: [{ role: 'user', content: '이 쪽의 모든 글자를 옮겨 주세요.', images: [{ mime: mimeType, base64: Buffer.from(pageImage).toString('base64') }] }],
      signal,
      stream: false,
    });
    return text;
  };
}

export async function ocr(params: OcrParams, signal: AbortSignal): Promise<OcrResult> {
  const { input_path, pages } = params;
  const engine = params.engine ?? 'local';
  logger.info(`[ocr] ${input_path} engine=${engine}`);

  const buffer = await readFile(input_path);
  signal.throwIfAborted();

  const result = await parse(new Uint8Array(buffer).buffer, {
    pages,
    ocr: engine === 'ai' ? aiOcrProvider(signal) : params.force ? 'force' : true,
    onProgress: (current, total) => { signal.throwIfAborted(); sendProgress({ current, total, message: `${current}/${total}쪽 읽는 중` }); },
  });
  signal.throwIfAborted();

  if (!result.success) {
    return { success: false, output_path: '', markdown: '', engine, error: cleanMessage(result.error) };
  }
  const outputPath = outputFile({ output_path: params.output_path, source: input_path, name: `${stemOf(input_path)}.md` });
  await writeFile(outputPath, result.markdown, 'utf-8');
  logger.info(`[ocr] done → ${outputPath} (${result.markdown.length}자)`);
  return {
    success: true,
    output_path: outputPath,
    markdown: result.markdown,
    page_count: result.pageCount,
    engine,
    warnings: result.warnings?.map((w) => w.message),
  };
}
