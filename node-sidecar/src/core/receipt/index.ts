/** 영수증 스캔 — Gemini Vision 구조화 추출 + 검증 + JSON 저장 */

import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { dirname, basename, extname, join } from 'node:path';
import { callGeminiVision } from '../../infra/gemini.js';
import { getConfig } from '../../infra/config.js';
import { sendProgress } from '../../infra/progress.js';
import { logger } from '../../infra/logger.js';

const MAX_FILE_SIZE = 20 * 1024 * 1024;

export interface ScanReceiptParams {
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
  date?: string | null;
  items: ReceiptItem[];
  tax?: number;
  total?: number;
  payment_method?: string;
  raw_text: string;
  output_path: string;
  output_md_path: string;
  warnings: string[];
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

/** 1차 시도용 — JSON 모드 + 상세 규칙 */
const PROMPT_DETAILED = `영수증 이미지를 분석해서 아래 JSON으로 추출하세요.

규칙:
- store_name: 영수증 최상단 상호명/가게명. 하단 "교환/환불 문의" 업체명, 카드사, 발급사는 절대 제외
- date: 거래 날짜 YYYY-MM-DD 형식. 영수증에 명확히 표기된 경우만. 확실하지 않으면 null
- items: 실제 구매 품목만. 소계·부가세·면세·과세물품가액·포인트·적립 행은 제외
- unit_price: 품목 단가 (원 단위 정수)
- amount: 품목 금액 = 단가 × 수량 (원 단위 정수)
- tax: 부가세 금액 (없으면 null)
- total: 최종 결제/합계 금액 (원 단위 정수)
- payment_method: "카드" / "현금" / "모바일" / null

JSON만 출력:
{
  "store_name": "상호명 또는 null",
  "date": "YYYY-MM-DD 또는 null",
  "items": [{"name": "품목명", "quantity": 1, "unit_price": 15500, "amount": 15500}],
  "tax": null,
  "total": 21000,
  "payment_method": null
}`;

/** 2차 시도용 (JSON 모드 없이 — 엣지케이스 폴백) */
const PROMPT_FALLBACK = `이 영수증에서 아래 JSON을 추출하세요. JSON만 출력하세요.
{
  "store_name": "가게명(없으면 null)",
  "date": "거래날짜 YYYY-MM-DD(없으면 null)",
  "items": [{"name":"품목명","quantity":수량,"unit_price":단가,"amount":금액}],
  "tax": 부가세(없으면 null),
  "total": 합계금액,
  "payment_method": "카드/현금/모바일 중 하나 또는 null"
}`;

interface RawReceipt {
  store_name?: unknown;
  date?: unknown;
  items?: unknown;
  tax?: unknown;
  total?: unknown;
  payment_method?: unknown;
}

function parseJsonFromText(text: string): RawReceipt | null {
  try {
    // 코드블록 안에 있으면 추출
    const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const candidate = codeBlock ? codeBlock[1].trim() : text.trim();
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start === -1 || end <= start) return null;
    return JSON.parse(candidate.substring(start, end + 1)) as RawReceipt;
  } catch {
    return null;
  }
}

function toPositiveInt(v: unknown): number | undefined {
  if (typeof v !== 'number' || !isFinite(v) || v < 0) return undefined;
  return Math.round(v);
}

function normalizeItems(raw: unknown): ReceiptItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is Record<string, unknown> => item !== null && typeof item === 'object')
    .map((item) => {
      const qty = typeof item.quantity === 'number' && item.quantity > 0 ? Math.round(item.quantity) : 1;
      const unitPrice = toPositiveInt(item.unit_price) ?? 0;
      // amount가 없거나 잘못되어 있으면 unit_price * qty로 보정
      let amount = toPositiveInt(item.amount);
      if (amount === undefined || (unitPrice > 0 && amount === 0)) {
        amount = unitPrice * qty;
      }
      return {
        name: typeof item.name === 'string' && item.name.trim() ? item.name.trim() : '(알 수 없음)',
        quantity: qty,
        unit_price: unitPrice,
        amount,
      };
    });
}

export function receiptToMarkdown(r: Omit<ScanReceiptResult, 'output_path' | 'output_md_path' | 'raw_text' | 'success'>): string {
  const lines: string[] = [];
  if (r.store_name) lines.push(`# ${r.store_name}`);
  const meta: string[] = [];
  if (r.date) meta.push(`날짜: ${r.date}`);
  if (r.payment_method) meta.push(`결제: ${r.payment_method}`);
  if (meta.length) lines.push(meta.join(' | '));
  lines.push('');
  if (r.items.length > 0) {
    lines.push('| 품목 | 수량 | 단가 | 금액 |');
    lines.push('|------|-----:|-----:|-----:|');
    for (const item of r.items) {
      lines.push(`| ${item.name} | ${item.quantity} | ${item.unit_price.toLocaleString()} | ${item.amount.toLocaleString()} |`);
    }
    lines.push('');
    if (r.tax != null) lines.push(`부가세: ${r.tax.toLocaleString()}원  `);
    if (r.total != null) lines.push(`**합계: ₩${r.total.toLocaleString()}**`);
  }
  if (r.warnings.length > 0) {
    lines.push('');
    lines.push('> ⚠️ ' + r.warnings.join('\n> ⚠️ '));
  }
  return lines.join('\n');
}

function buildResult(
  parsed: RawReceipt,
  rawText: string,
  outputPath: string,
): Omit<ScanReceiptResult, 'output_path' | 'output_md_path'> {
  const storeName = typeof parsed.store_name === 'string' && parsed.store_name.trim()
    ? parsed.store_name.trim()
    : undefined;

  // date: null이 명시적으로 내려온 경우와 문자열 둘 다 처리
  let date: string | null | undefined;
  if (parsed.date === null) {
    date = null;
  } else if (typeof parsed.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(parsed.date)) {
    date = parsed.date;
  } else {
    date = null;
  }

  const items = normalizeItems(parsed.items);
  const tax = toPositiveInt(parsed.tax);
  const total = toPositiveInt(parsed.total);
  const paymentMethod = typeof parsed.payment_method === 'string' && parsed.payment_method.trim()
    ? parsed.payment_method.trim()
    : undefined;

  const warnings: string[] = [];

  if (!storeName) warnings.push('가게명을 찾을 수 없습니다');
  if (date === null) warnings.push('거래 날짜를 찾을 수 없습니다');
  if (items.length === 0) warnings.push('구매 품목을 추출하지 못했습니다');

  // 합계 검증: items 합산과 total 차이가 1% 초과하면 경고
  if (items.length > 0 && total !== undefined) {
    const itemsSum = items.reduce((s, i) => s + i.amount, 0);
    const diff = Math.abs(itemsSum - total);
    if (total > 0 && diff / total > 0.01) {
      warnings.push(`품목 합산(${itemsSum.toLocaleString()}원)과 합계(${total.toLocaleString()}원)가 다릅니다`);
    }
  }

  return {
    success: true,
    store_name: storeName,
    date,
    items,
    tax,
    total,
    payment_method: paymentMethod,
    raw_text: rawText,
    warnings,
  };
}

export async function scanReceipt(
  params: ScanReceiptParams,
  signal: AbortSignal,
): Promise<ScanReceiptResult> {
  const { input_path } = params;

  logger.info(`[scan_receipt] ${input_path}`);
  sendProgress({ current: 0, total: 4, message: '영수증 파일 읽는 중...' });

  const fileInfo = await stat(input_path);
  if (fileInfo.size > MAX_FILE_SIZE) {
    throw new Error(`파일이 너무 큽니다 (${Math.round(fileInfo.size / 1024 / 1024)}MB). 최대 ${MAX_FILE_SIZE / 1024 / 1024}MB까지 지원합니다.`);
  }

  const buffer = await readFile(input_path);
  const base64 = buffer.toString('base64');
  const ext = extname(input_path).toLowerCase();
  const mimeType = MIME_MAP[ext] ?? 'image/png';

  // 출력 경로
  const cfg = getConfig('convert');
  const outDir = cfg.output_dir || dirname(input_path);
  const stem = basename(input_path, extname(input_path));
  const outputPath = join(outDir, `${stem}_receipt.json`);
  const outputMdPath = join(outDir, `${stem}_receipt.md`);

  // ── 1차 시도: JSON 모드 (응답이 항상 valid JSON) ──
  sendProgress({ current: 1, total: 4, message: 'Gemini Vision으로 영수증 분석 중...' });
  signal.throwIfAborted();

  let rawText = '';
  let parsed: RawReceipt | null = null;

  try {
    rawText = await callGeminiVision({
      prompt: PROMPT_DETAILED,
      imageBase64: base64,
      mimeType,
      signal,
      jsonMode: true,
      systemInstruction: '당신은 영수증 데이터 추출 전문가입니다. 지시한 JSON 스키마만 정확히 출력하세요.',
    });
    parsed = parseJsonFromText(rawText);
  } catch (err) {
    // JSON 모드 자체 실패 (rate limit 제외)는 2차 시도로 넘김
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    logger.warn(`[scan_receipt] 1차 시도 실패: ${String(err)}`);
  }

  // ── 2차 시도: JSON 모드 없이 — 1차가 빈 결과거나 실패한 경우 ──
  if (!parsed || (parsed.items === undefined && parsed.total === undefined)) {
    sendProgress({ current: 2, total: 4, message: '재분석 중...' });
    signal.throwIfAborted();

    try {
      rawText = await callGeminiVision({
        prompt: PROMPT_FALLBACK,
        imageBase64: base64,
        mimeType,
        signal,
        systemInstruction: '영수증 JSON 추출 전문가. JSON만 출력.',
      });
      parsed = parseJsonFromText(rawText);
      if (parsed) logger.info('[scan_receipt] 2차 시도 성공');
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') throw err;
      logger.warn(`[scan_receipt] 2차 시도 실패: ${String(err)}`);
    }
  }

  sendProgress({ current: 3, total: 4, message: '결과 검증 중...' });

  let result: ScanReceiptResult;

  if (parsed) {
    const built = buildResult(parsed, rawText, outputPath);
    result = { ...built, output_path: outputPath, output_md_path: outputMdPath };
    logger.info(`[scan_receipt] 완료: ${result.items.length}개 항목, 합계 ${result.total ?? '-'}원, 경고 ${result.warnings.length}건`);
  } else {
    // 완전 실패 — raw_text만 반환
    logger.warn('[scan_receipt] JSON 파싱 완전 실패, raw_text 반환');
    result = {
      success: true,
      items: [],
      raw_text: rawText,
      output_path: outputPath,
      output_md_path: outputMdPath,
      warnings: ['영수증 데이터를 구조화하지 못했습니다. 원본 텍스트를 확인하세요.'],
    };
  }

  // JSON + MD 저장
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify({
    source: basename(input_path),
    store_name: result.store_name ?? null,
    date: result.date ?? null,
    items: result.items,
    tax: result.tax ?? null,
    total: result.total ?? null,
    payment_method: result.payment_method ?? null,
    warnings: result.warnings,
  }, null, 2), 'utf-8');
  await writeFile(outputMdPath, receiptToMarkdown(result), 'utf-8');

  sendProgress({ current: 4, total: 4, message: `영수증 분석 완료 → ${basename(outputMdPath)}` });

  return result;
}
