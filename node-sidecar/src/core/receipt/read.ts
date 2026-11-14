/** 영수증 읽기 — 그림·PDF → 줄 → 값 (core/receipt/parse)
 *
 * 내장 OCR(PP-OCRv5, 이 PC 안에서)로 읽고 줄 좌표(ocrLines)로 같은 높이의 조각을 한 줄로 묶는다.
 * 글자층이 있는 PDF 쪽은 OCR 하지 않고 그 글을 쓴다 (kordoc 이 OCR 이 필요한 쪽만 읽는다).
 * AI 는 선택: 켜져 있으면 적요(용도) 한 줄과 품목 이름 정리만 맡긴다 (금액·날짜는 규칙 값 그대로).
 */

import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import type { OcrPageLines } from 'kordoc';
import type { ReceiptRead } from '../../types/rpc-contract.js';
import { aiConfigured, ask, parseJsonLoose } from '../../infra/llm/index.js';
import { logger } from '../../infra/logger.js';
import { sendProgress } from '../../infra/progress.js';
import { parseBytes } from '../converter/index.js';
import { errorText, parseFailure } from '../errors.js';
import { formatOf } from '../files/format.js';
import { ocrModelsReady } from '../system/index.js';
import { openPdf } from '../render/pdfium.js';
import { linesFromMarkdown, linesFromOcr, looksRefund, maskCardLines, parseReceipt, purposeOf, type ReceiptLine } from './parse.js';

/** PDF 한 파일에서 영수증으로 볼 쪽 수 상한 */
const MAX_PAGES = 30;

/** OCR 모델 없이 글자층 없는 PDF 쪽을 읽었을 때 */
const NEEDS_OCR_MODEL = '글자층이 없는 스캔 PDF라 글자 읽기(OCR) 모델이 있어야 읽습니다. 설정 › 엔진과 모델에서 모델을 넣은 뒤 다시 하세요.';

function fromLines(path: string, raw: ReceiptLine[], via: 'text' | 'ocr', page?: number, emptyError = '글자를 찾지 못했습니다. 영수증이 잘 보이게 다시 찍거나 스캔하세요.'): ReceiptRead {
  // 화면·AI 로 가는 읽은 줄도 카드번호는 앞 네 자리만
  const lines = maskCardLines(raw);
  const { fields, items } = parseReceipt(lines);
  const ok = lines.length > 0;
  return {
    path, ...(page ? { page } : {}), ok, via, fields, items, purpose: purposeOf(items), lines: lines.map((l) => l.text),
    ...(ok ? {} : { error: emptyError }),
  };
}

/** 세로로 긴 감열지는 글줄 검출 크기를 키운다 (기본 960 이면 좁은 글자가 뭉개진다) */
async function detLongSide(buf: Buffer): Promise<number | undefined> {
  try {
    const sharp = (await import('sharp')).default;
    const m = await sharp(buf).metadata();
    const w = m.width ?? 0;
    const h = m.height ?? 0;
    const long = Math.max(w, h);
    const short = Math.min(w, h) || 1;
    return long / short > 2 && long > 1400 ? Math.min(2048, long) : undefined;
  } catch {
    return undefined;
  }
}

/** PDF 쪽 수 (못 세면 0) */
async function pdfPages(buf: Buffer): Promise<number> {
  try {
    const doc = await openPdf(new Uint8Array(buf));
    try { return doc.getPageCount(); } finally { doc.destroy(); }
  } catch {
    return 0;
  }
}

export async function readOne(path: string, signal?: AbortSignal, warn?: (message: string) => void): Promise<ReceiptRead[]> {
  const fmt = formatOf(path);
  if (fmt !== 'image' && fmt !== 'pdf') {
    return [{ path, ok: false, error: '영수증은 그림(PNG·JPG·WEBP)이나 PDF만 읽습니다.', fields: {}, items: [], purpose: { value: '', confidence: 0 }, lines: [] }];
  }
  const ready = ocrModelsReady();
  if (fmt === 'image' && !ready) throw new Error('글자 읽기(OCR) 모델이 없습니다. 설정 › 엔진과 모델에서 모델을 넣은 뒤 다시 하세요.');
  const buf = await readFile(path);
  signal?.throwIfAborted();
  const longSide = fmt === 'image' ? await detLongSide(buf) : undefined;
  // 한 파일에서 읽는 쪽 수에는 상한이 있다. 넘는 쪽을 말없이 빼면 지출조서의 건수와 합계가 줄어든 채 저장된다 → 알린다
  const total = fmt === 'pdf' ? await pdfPages(buf) : 0;
  if (total > MAX_PAGES) warn?.(`${basename(path)}: ${total}쪽 가운데 앞 ${MAX_PAGES}쪽만 읽었습니다. 뒤쪽 영수증 ${total - MAX_PAGES}쪽은 빠졌으니 PDF를 나눠서 다시 넣으세요.`);
  const r = await parseBytes(buf, {
    filePath: path,
    ocr: ready ? true : false,
    ocrLines: true,
    ...(longSide ? { ocrDetLongSide: longSide } : {}),
    ...(fmt === 'pdf' ? { pages: `1-${MAX_PAGES}` } : {}),
  }, undefined, signal);
  if (!r.success) throw parseFailure(r);
  // 모델이 없으면 PDF 의 스캔 쪽은 그림 자리 글만 나온다: 빈 값으로 "읽음" 대신 할 일을
  const emptyError = !ready ? NEEDS_OCR_MODEL : undefined;
  const ocrPages = new Map<number, OcrPageLines>((r.ocrLines ?? []).map((p) => [p.pageNumber, p]));
  const pages = fmt === 'pdf' && r.pages && r.pages.length > 1 ? r.pages : null;
  // 취소·환불 전표는 금액이 부호 없이 읽힌다 → 말없이 지출에 더해지지 않게 알린다
  const flagged = (list: ReceiptRead[]): ReceiptRead[] => {
    for (const one of list) {
      if (!one.fields.total || !looksRefund(one.lines, one.fields.total.source)) continue;
      warn?.(`${basename(path)}${one.page ? ` ${one.page}쪽` : ''}: 취소·환불 전표로 보입니다. 금액은 부호 없이 읽었으니 지출조서에 넣을지, 금액을 빼야 하는지 확인하세요.`);
    }
    return list;
  };
  if (!pages) {
    const ocr = [...ocrPages.values()];
    if (ocr.length && !ocr[0].regionsOnly) return flagged([fromLines(path, ocr.flatMap((p) => linesFromOcr(p)), 'ocr')]);
    return flagged([fromLines(path, linesFromMarkdown(r.markdown), ocr.length ? 'ocr' : 'text', undefined, emptyError)]);
  }
  // 여러 쪽 PDF: 쪽마다 영수증 한 장 (빈 쪽은 건너뜀)
  const out: ReceiptRead[] = [];
  const unread: number[] = [];
  for (const p of pages) {
    const o = ocrPages.get(p.pageNumber);
    const lines = o && !o.regionsOnly ? linesFromOcr(o) : linesFromMarkdown(p.markdown);
    if (lines.length) out.push(fromLines(path, lines, o ? 'ocr' : 'text', p.pageNumber));
    else if (o || p.markdown.trim()) unread.push(p.pageNumber);
  }
  // 그림·글이 있는데 줄을 못 뽑은 쪽(모델 없는 스캔 쪽·흐린 감열지)을 말없이 빼면 지출조서의 건수와 합계가 줄어든 채 저장된다 → 알린다
  if (unread.length && out.length) {
    const list = unread.length > 10 ? `${unread.slice(0, 10).join('·')}쪽 외 ${unread.length - 10}쪽` : `${unread.join('·')}쪽`;
    warn?.(`${basename(path)}: ${list}은 글자를 읽지 못해 빠졌습니다. ${ready ? '그 쪽을 더 또렷하게 찍거나 스캔해 따로 넣으세요.' : '설정 › 엔진과 모델에서 글자 읽기(OCR) 모델을 넣은 뒤 다시 하세요.'}`);
  }
  return out.length ? flagged(out) : [fromLines(path, [], 'text', undefined, emptyError)];
}

const AI_SYSTEM = `당신은 공공기관 회계 담당자입니다. 영수증마다 지출조서 적요(용도) 한 줄과 품목 이름 정리를 JSON 으로만 답하세요.
- purpose: 무엇을 샀는지 20자 안의 명사형 (예: "사무용품 구입", "업무 협의 식대"). 영수증에 없는 사실(행사 이름·사람)을 지어내지 마세요.
- names: 주어진 품목 이름을 같은 차례·같은 개수로, 잘못 읽힌 글자만 바로잡아서. 품목이 없으면 빈 배열.
답 꼴: {"receipts":[{"i":0,"purpose":"…","names":["…"]}]}`;

/** 적요·품목 이름을 AI 로 (한 번에). 실패하면 규칙 요약을 그대로 두고 경고만 */
async function aiPolish(list: ReceiptRead[], signal: AbortSignal): Promise<{ used: boolean; redacted: number; warning?: string }> {
  const targets = list.map((r, i) => ({ r, i })).filter(({ r }) => r.ok);
  if (!targets.length) return { used: false, redacted: 0 };
  const payload = targets.map(({ r, i }) => ({
    i, vendor: r.fields.vendor?.value ?? '', items: r.items.map((it) => it.name), lines: r.lines.slice(0, 40),
  }));
  try {
    sendProgress({ current: 0, total: 0, message: 'AI가 적요를 정리하는 중' });
    const { text, redacted } = await ask({ system: AI_SYSTEM, messages: [{ role: 'user', content: JSON.stringify({ receipts: payload }) }], json: true, signal, stream: false });
    const ans = parseJsonLoose<{ receipts?: Array<{ i?: number; purpose?: string; names?: unknown }> }>(text);
    for (const a of ans.receipts ?? []) {
      const r = typeof a.i === 'number' ? list[a.i] : undefined;
      if (!r?.ok) continue;
      const purpose = typeof a.purpose === 'string' ? a.purpose.trim().slice(0, 40) : '';
      if (purpose) r.purpose = { value: purpose, confidence: 0.75, source: 'AI 제안' };
      if (Array.isArray(a.names) && a.names.length === r.items.length && a.names.every((n) => typeof n === 'string' && n.trim())) {
        r.items = r.items.map((it, k) => ({ ...it, name: String((a.names as string[])[k]).trim() }));
      }
    }
    return { used: true, redacted };
  } catch (err) {
    if (signal.aborted) throw err;
    logger.warn(`[receipt] AI 적요 실패: ${errorText(err)}`);
    return { used: false, redacted: 0, warning: `AI가 적요를 정리하지 못해 품목 첫 줄로 적었습니다: ${errorText(err)}` };
  }
}

export async function receiptRead(p: { paths: string[]; ai?: boolean }, signal: AbortSignal): Promise<{ receipts: ReceiptRead[]; ai_used: boolean; redacted: number; warnings: string[] }> {
  const receipts: ReceiptRead[] = [];
  const warnings: string[] = [];
  for (const [i, path] of p.paths.entries()) {
    signal.throwIfAborted();
    sendProgress({ current: i + 1, total: p.paths.length, message: `${basename(path)} 읽는 중 (${i + 1}/${p.paths.length})` });
    try {
      receipts.push(...await readOne(path, signal, (m) => warnings.push(m)));
    } catch (err) {
      if (signal.aborted) throw err;
      receipts.push({ path, ok: false, error: errorText(err), fields: {}, items: [], purpose: { value: '', confidence: 0 }, lines: [] });
    }
  }
  let ai = { used: false, redacted: 0 } as { used: boolean; redacted: number; warning?: string };
  if (p.ai && aiConfigured()) ai = await aiPolish(receipts, signal);
  if (ai.warning) warnings.push(ai.warning);
  return { receipts, ai_used: ai.used, redacted: ai.redacted, warnings };
}
