/** 영수증 스캔 — Gemini Vision으로 영수증 구조화 추출 */

import { readFile, stat } from 'node:fs/promises';
import { extname } from 'node:path';
import { callGeminiVision } from '../../infra/gemini.js';
import { logger } from '../../infra/logger.js';

/** Gemini 인라인 데이터 상한 (20MB) */
const MAX_FILE_SIZE = 20 * 1024 * 1024;

export interface ScanReceiptParams {
  /** 영수증 이미지 또는 PDF 경로 */
  input_path: string;
}

export interface ReceiptItem {
  name: string;
  quantity: number;
  unit_price: number;
  amount: number;
}

export interface ScanReceiptResult {
  success: boolean;
  store_name?: string;
  date?: string;
  items: ReceiptItem[];
  total?: number;
  raw_text: string;
  error?: string;
}

const MIME_MAP: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
};

export async function scanReceipt(
  params: ScanReceiptParams,
  signal: AbortSignal,
): Promise<ScanReceiptResult> {
  const { input_path } = params;

  logger.info(`[scan_receipt] ${input_path}`);

  // 파일 크기 체크 — Gemini 인라인 데이터 상한 초과 시 즉시 에러
  const fileInfo = await stat(input_path);
  if (fileInfo.size > MAX_FILE_SIZE) {
    throw new Error(`파일이 너무 큽니다 (${Math.round(fileInfo.size / 1024 / 1024)}MB). 최대 ${MAX_FILE_SIZE / 1024 / 1024}MB까지 지원합니다.`);
  }

  const buffer = await readFile(input_path);
  const base64 = buffer.toString('base64');
  const ext = extname(input_path).toLowerCase();
  const mimeType = MIME_MAP[ext] ?? 'image/png';

  const rawText = await callGeminiVision({
    prompt: `이 영수증 이미지를 분석해서 다음 JSON 형식으로 추출해주세요:
{
  "store_name": "가게명",
  "date": "YYYY-MM-DD",
  "items": [{"name": "품목명", "quantity": 1, "unit_price": 10000, "amount": 10000}],
  "total": 10000
}
JSON만 출력하세요.`,
    imageBase64: base64,
    mimeType,
    signal,
    systemInstruction: '당신은 영수증 데이터 추출 전문가입니다. 정확한 JSON만 출력하세요.',
  });

  // JSON 파싱 시도 — 코드블록 먼저, 그 다음 전체 매칭
  try {
    // 1) ```json ... ``` 코드블록 우선
    const codeBlock = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
    const candidate = codeBlock ? codeBlock[1].trim() : rawText;

    // 2) 후보에서 첫 번째 { 부터 마지막 } 까지 추출
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start !== -1 && end > start) {
      const parsed = JSON.parse(candidate.substring(start, end + 1));

      // 스키마 검증 — LLM 출력은 예측 불가능하므로 필수
      const items: ReceiptItem[] = Array.isArray(parsed.items)
        ? parsed.items
            .filter((item: unknown): item is Record<string, unknown> =>
              item !== null && typeof item === 'object')
            .map((item: Record<string, unknown>) => ({
              name: typeof item.name === 'string' ? item.name : '(알 수 없음)',
              quantity: typeof item.quantity === 'number' ? item.quantity : 1,
              unit_price: typeof item.unit_price === 'number' ? item.unit_price : 0,
              amount: typeof item.amount === 'number' ? item.amount : 0,
            }))
        : [];

      logger.info(`[scan_receipt] done: ${items.length}개 항목`);
      return {
        success: true,
        store_name: typeof parsed.store_name === 'string' ? parsed.store_name : undefined,
        date: typeof parsed.date === 'string' ? parsed.date : undefined,
        items,
        total: typeof parsed.total === 'number' ? parsed.total : undefined,
        raw_text: rawText,
      };
    }
  } catch {
    // JSON 파싱 실패 시 raw text 반환
  }

  logger.warn('[scan_receipt] JSON 파싱 실패, raw text 반환');
  return {
    success: true,
    items: [],
    raw_text: rawText,
  };
}
