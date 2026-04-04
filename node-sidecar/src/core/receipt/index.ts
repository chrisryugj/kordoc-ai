/** 영수증 스캔 — Gemini Vision으로 영수증 구조화 추출 */

import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { callGeminiVision } from '../../infra/gemini.js';
import { logger } from '../../infra/logger.js';

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

  // JSON 파싱 시도
  try {
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      logger.info(`[scan_receipt] done: ${parsed.items?.length ?? 0}개 항목`);
      return {
        success: true,
        store_name: parsed.store_name,
        date: parsed.date,
        items: parsed.items ?? [],
        total: parsed.total,
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
