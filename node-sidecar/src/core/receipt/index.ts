/** 영수증 스캔 — Gemini Vision으로 영수증 구조화 추출 + JSON 저장 */

import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { dirname, basename, extname, join } from 'node:path';
import { callGeminiVision } from '../../infra/gemini.js';
import { getConfig } from '../../infra/config.js';
import { sendProgress } from '../../infra/progress.js';
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
  output_path: string;
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
  sendProgress({ current: 0, total: 3, message: '영수증 파일 읽는 중...' });

  // 파일 크기 체크
  const fileInfo = await stat(input_path);
  if (fileInfo.size > MAX_FILE_SIZE) {
    throw new Error(`파일이 너무 큽니다 (${Math.round(fileInfo.size / 1024 / 1024)}MB). 최대 ${MAX_FILE_SIZE / 1024 / 1024}MB까지 지원합니다.`);
  }

  const buffer = await readFile(input_path);
  const base64 = buffer.toString('base64');
  const ext = extname(input_path).toLowerCase();
  const mimeType = MIME_MAP[ext] ?? 'image/png';

  sendProgress({ current: 1, total: 3, message: 'Gemini Vision으로 영수증 분석 중...' });
  signal.throwIfAborted();

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

  sendProgress({ current: 2, total: 3, message: '결과 파싱 중...' });

  // 출력 경로
  const cfg = getConfig('convert');
  const outDir = cfg.output_dir || dirname(input_path);
  const stem = basename(input_path, extname(input_path));
  const outputPath = join(outDir, `${stem}_receipt.json`);

  // JSON 파싱 시도
  let result: ScanReceiptResult;

  try {
    const codeBlock = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
    const candidate = codeBlock ? codeBlock[1].trim() : rawText;
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');

    if (start !== -1 && end > start) {
      const parsed = JSON.parse(candidate.substring(start, end + 1));

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
      result = {
        success: true,
        store_name: typeof parsed.store_name === 'string' ? parsed.store_name : undefined,
        date: typeof parsed.date === 'string' ? parsed.date : undefined,
        items,
        total: typeof parsed.total === 'number' ? parsed.total : undefined,
        raw_text: rawText,
        output_path: outputPath,
      };
    } else {
      result = { success: true, items: [], raw_text: rawText, output_path: outputPath };
    }
  } catch {
    logger.warn('[scan_receipt] JSON 파싱 실패, raw text 반환');
    result = { success: true, items: [], raw_text: rawText, output_path: outputPath };
  }

  // JSON 파일 저장
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify({
    source: basename(input_path),
    store_name: result.store_name,
    date: result.date,
    items: result.items,
    total: result.total,
  }, null, 2), 'utf-8');

  sendProgress({ current: 3, total: 3, message: `영수증 분석 완료 → ${basename(outputPath)}` });

  return result;
}
