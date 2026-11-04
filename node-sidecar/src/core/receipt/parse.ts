/** 영수증 글 → 값 (AI 없이 규칙만)
 *
 * 입력은 "줄" 목록: 내장 OCR 은 같은 높이의 글 조각을 한 줄로 묶고(조각 = 칸), PDF 글자층·마크다운은 표 칸을 칸으로.
 * 값마다 신뢰도(0~1)와 근거 줄을 붙인다. 화면은 0.8 아래를 강조해 사람이 확인하게 한다.
 */

import type { OcrPageLines } from 'kordoc';
import type { ReceiptFields, ReceiptItem, ReceiptValue } from '../../types/rpc-contract.js';

export interface ReceiptLine {
  text: string;
  cells: string[];
  /** OCR 평균 신뢰도 (글자층은 1) */
  confidence: number;
  /** 글자 높이 (px, OCR 만). 큰 글은 가게 이름일 때가 많다 */
  height?: number;
}

/** 신뢰도가 이보다 낮으면 화면이 강조한다 */
export const LOW_CONFIDENCE = 0.8;

const squash = (s: string) => s.replace(/\s+/g, '');
const round2 = (n: number) => Math.round(n * 100) / 100;
const val = (value: string, confidence: number, line?: ReceiptLine): ReceiptValue =>
  ({ value, confidence: round2(Math.max(0, Math.min(1, confidence * (line?.confidence ?? 1)))), ...(line ? { source: line.text } : {}) });

// ── 줄 만들기 ──

/** OCR 한 쪽의 글 조각을 같은 높이끼리 한 줄로 (위→아래, 줄 안은 왼→오른) */
export function linesFromOcr(page: Pick<OcrPageLines, 'lines'>): ReceiptLine[] {
  const pieces = page.lines.filter((l) => !l.dropped && l.text.trim()).map((l) => ({ ...l, cy: l.box.y + l.box.h / 2 }));
  pieces.sort((a, b) => a.cy - b.cy);
  const rows: Array<typeof pieces> = [];
  for (const p of pieces) {
    const row = rows[rows.length - 1];
    if (row) {
      const top = Math.min(...row.map((r) => r.box.y));
      const bottom = Math.max(...row.map((r) => r.box.y + r.box.h));
      const h = Math.min(p.box.h, bottom - top);
      const overlap = Math.min(bottom, p.box.y + p.box.h) - Math.max(top, p.box.y);
      if (overlap > h * 0.5) { row.push(p); continue; }
    }
    rows.push([p]);
  }
  return rows.map((r) => {
    r.sort((a, b) => a.box.x - b.box.x);
    const cells = r.map((p) => p.text.trim());
    return { text: cells.join(' '), cells, confidence: r.reduce((s, p) => s + p.confidence, 0) / r.length, height: Math.max(...r.map((p) => p.box.h)) };
  });
}

/** 마크다운(글자층 PDF·AI 글자 읽기) → 줄. 표는 행마다 한 줄, 칸은 칸으로 */
export function linesFromMarkdown(md: string): ReceiptLine[] {
  const out: ReceiptLine[] = [];
  const unesc = (s: string) => s.replace(/\\([*_|\\`#])/g, '$1').replace(/<[^>]+>/g, ' ').trim();
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || /^\|?\s*:?-{3,}/.test(line)) continue;
    if (/^<tr>/i.test(line)) {
      const cells = [...line.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((m) => unesc(m[1])).filter(Boolean);
      if (cells.length) out.push({ text: cells.join(' '), cells, confidence: 1 });
      continue;
    }
    if (/^<\/?table/i.test(line)) continue;
    if (line.startsWith('|')) {
      const cells = line.replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map(unesc).filter(Boolean);
      if (cells.length) out.push({ text: cells.join(' '), cells, confidence: 1 });
      continue;
    }
    const text = unesc(line.replace(/^#+\s*/, '').replace(/^[-*]\s+/, ''));
    if (text) out.push({ text, cells: [text], confidence: 1 });
  }
  return out;
}

// ── 숫자·날짜 ──

/** 금액 꼴 (천 단위 쉼표, OCR 이 점으로 읽은 것까지). 원화 표시(₩·W·\)와 "원"은 뗀다 */
// 앞뒤 경계를 두지 않는다: 수량·단가·금액이 붙어 읽힌 "1,6003,200" 도 1,600 · 3,200 으로 가른다
const MONEY = /(\d{1,3}(?:[,.]\d{3})+|\d+)/g;
export function amountsIn(text: string): number[] {
  // 사업자번호·카드·날짜·시각·전화는 금액이 아니다 (사업자번호를 먼저: 날짜 꼴로 잘못 잡히지 않게)
  const clean = text
    .replace(/\d{3}-\d{2}-\d{5}/g, ' ')
    .replace(/[\d*]{4}-[\d*]{2,4}-[\d*]{4}-[\d*]{3,4}/g, ' ')
    .replace(/\d{2,4}\s*[.\-/년]\s*\d{1,2}\s*[.\-/월]\s*\d{1,2}(?!\d)일?/g, ' ')
    .replace(/\d{1,2}:\d{2}(:\d{2})?/g, ' ')
    .replace(/\d{2,4}-\d{3,4}-\d{4}/g, ' ');
  return [...clean.matchAll(MONEY)].map((m) => Number(m[1].replace(/[,.]/g, ''))).filter((n) => Number.isFinite(n));
}

/** 줄의 마지막 금액 (쉼표 있는 꼴을 먼저, 없으면 1~9자리 숫자) */
function lastAmount(line: ReceiptLine, from = 0): number | undefined {
  const text = line.cells.slice(from).join(' ');
  const withComma = [...text.matchAll(/(?<![\d,.])\d{1,3}(?:[,.]\d{3})+(?!\d)/g)].map((m) => Number(m[0].replace(/[,.]/g, '')));
  if (withComma.length) return withComma[withComma.length - 1];
  const all = amountsIn(text).filter((n) => n > 0 && n < 1e9);
  return all.length ? all[all.length - 1] : undefined;
}

const pad = (n: number) => String(n).padStart(2, '0');
function okDate(y: number, m: number, d: number, now = new Date()): string | null {
  if (y < 2000 || y > now.getFullYear() + 1 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** 줄에서 날짜 하나 (YYYY-MM-DD). 네 자리 연도 꼴을 먼저, 없으면 두 자리 연도 */
export function dateIn(text: string): string | null {
  for (const m of text.matchAll(/(?<!\d)(20\d{2})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})/g)) {
    const d = okDate(Number(m[1]), Number(m[2]), Number(m[3]));
    if (d) return d;
  }
  for (const m of text.matchAll(/(?<![\d\-.])(\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})(?![\d\-])/g)) {
    const d = okDate(2000 + Number(m[1]), Number(m[2]), Number(m[3]));
    if (d) return d;
  }
  return null;
}

/** 사업자등록번호 검증 숫자 (국세청 공개 규칙) */
export function brnValid(digits: string): boolean {
  if (!/^\d{10}$/.test(digits)) return false;
  const w = [1, 3, 7, 1, 3, 7, 1, 3, 5];
  let s = 0;
  for (let i = 0; i < 9; i++) s += Number(digits[i]) * w[i];
  s += Math.floor((Number(digits[8]) * 5) / 10);
  return (10 - (s % 10)) % 10 === Number(digits[9]);
}

// ── 이름표 ──

const TOTAL_TIERS: RegExp[] = [
  /^(총)?(결제|결재)(할)?금액|^받을금액|^청구금액|^승인금액|^총결제/,
  /^(합계|총)금액|^총합계|^총액|^합계|^총계|^공급대가(총액)?|^판매(합계|금액)|^매출합계|^금액합계|^계$/,
];
const NOT_TOTAL = /수량|받은|거스름|잔돈|할인|과세|면세|부가|공급가|포인트|잔액|적립|봉사료|점수/;
const SUPPLY = /^(공급가액|공급가|과세물품가액|과세물품|과세매출|과세금액|물품가액)/;
const VAT = /^(부가세|부가가치세|세액|vat)/i;
const DATE_LABEL = /거래일|거래일시|일자|일시|날짜|작성년월일|작성일|판매일|결제일|승인일|매출일|등록|발행일/;
const VENDOR_LABEL = /^(가맹점명|가맹점|상호명|상호|업체명|판매처|판매자|매장명|점포명)[:：]?/;
const BRN_LABEL = /사업자|등록번호/;
const OWNER_LABEL = /(대표자명|대표자|대표|성명)[:：]?\s*([가-힣]{2,4})(?![가-힣])/;
const ADDRESS_LABEL = /^(사업장소재지|사업장주소|소재지|주소)[:：]?/;
const ADDRESS_LIKE = /[가-힣]+(시|도|군|구)\s?[가-힣\d]*?\s?[가-힣\d]+(로|길|동|가|리)\s?\d+/;
/** 가게 이름이 아닌 머리 글 */
const GENERIC = /(전자|간이|카드|현금|신용카드|매출)?\s*(영\s*수\s*증|매출전표|거래명세서|명세서)|\(?(공급받는자|고객|가맹점)용\)?|감사합니다|어서\s*오세요|신용카드|고객용/g;

const head = (line: ReceiptLine) => squash(line.cells[0] ?? line.text);

// ── 값 뽑기 ──

function findDate(lines: ReceiptLine[]): ReceiptValue | undefined {
  let best: { d: string; score: number; line: ReceiptLine } | undefined;
  lines.forEach((line, i) => {
    const d = dateIn(line.text);
    if (!d) return;
    // 이름표 줄(또는 바로 위 칸 머리 줄)이면 높게, 앞쪽 줄일수록 조금 높게
    const labeled = DATE_LABEL.test(squash(line.text)) || (i > 0 && DATE_LABEL.test(squash(lines[i - 1].text)) && !dateIn(lines[i - 1].text));
    const score = (labeled ? 2 : 1) - i / 1000;
    if (!best || score > best.score) best = { d, score, line };
  });
  if (!best) return undefined;
  return val(best.d, best.score >= 2 ? 0.95 : 0.85, best.line);
}

function findBrn(lines: ReceiptLine[]): ReceiptValue | undefined {
  for (const line of lines) {
    const m = /(?<!\d)(\d{3})\s*[-–.]\s*(\d{2})\s*[-–.]\s*(\d{5})(?!\d)/.exec(line.text)
      ?? (BRN_LABEL.test(line.text) ? /(?<!\d)(\d{3})(\d{2})(\d{5})(?!\d)/.exec(squash(line.text)) : null);
    if (!m) continue;
    const digits = `${m[1]}${m[2]}${m[3]}`;
    const c = (BRN_LABEL.test(line.text) ? 0.92 : 0.85) + (brnValid(digits) ? 0.05 : 0);
    return val(`${m[1]}-${m[2]}-${m[3]}`, c, line);
  }
  return undefined;
}

function cleanVendor(s: string): string {
  return s.replace(GENERIC, ' ').replace(/^[\s:：\-·*]+|[\s:：\-·*]+$/g, '').replace(/\s+/g, ' ').trim();
}

const looksLikeName = (s: string) =>
  /[가-힣A-Za-z]/.test(s) && !/\d{3}-\d{2}-\d{5}|tel|전화|\d{2,4}-\d{3,4}-\d{4}/i.test(s) && !dateIn(s) && !ADDRESS_LIKE.test(squash(s)) && s.length <= 30;

function findVendor(lines: ReceiptLine[]): ReceiptValue | undefined {
  // 이름표가 있는 줄: "가맹점명 가온문구" · "상호: 한결인쇄"
  for (const line of lines) {
    const label = VENDOR_LABEL.exec(head(line));
    if (!label) continue;
    const rest = line.cells.length > 1 && squash(line.cells[0]) === label[0].replace(/[:：]$/, '')
      ? line.cells.slice(1).join(' ')
      : line.text.replace(/^\s*(가맹점명|가맹점|상호명|상호|업체명|판매처|판매자|매장명|점포명)\s*[:：]?\s*/, '');
    const name = cleanVendor(rest);
    if (name && looksLikeName(name)) return val(name, 0.92, line);
  }
  // 이름표가 없으면 위쪽 몇 줄 가운데 가게 이름처럼 보이는 것 (OCR 은 가장 큰 글)
  const top = lines.slice(0, 5).map((line) => ({ line, name: cleanVendor(line.text) })).filter((x) => x.name && looksLikeName(x.name) && !/귀하$/.test(x.name));
  if (!top.length) return undefined;
  const sized = top.filter((x) => x.line.height);
  const pick = sized.length ? sized.reduce((a, b) => ((b.line.height ?? 0) > (a.line.height ?? 0) ? b : a)) : top[0];
  return val(pick.name, 0.8, pick.line);
}

function findTotal(lines: ReceiptLine[], hints: number[]): ReceiptValue | undefined {
  const cands: Array<{ tier: number; amount: number; line: ReceiptLine; i: number }> = [];
  lines.forEach((line, i) => {
    const h = head(line);
    if (NOT_TOTAL.test(h)) return;
    const tier = TOTAL_TIERS.findIndex((re) => re.test(h));
    if (tier < 0) return;
    // 값이 같은 줄에 없으면(칸 머리 줄) 바로 아래 줄의 같은 자리
    let amount = lastAmount(line, 1);
    let src = line;
    if (amount === undefined && lines[i + 1]) { amount = lastAmount(lines[i + 1]); src = lines[i + 1]; }
    if (amount !== undefined && amount > 0) cands.push({ tier, amount, line: src, i });
  });
  if (cands.length) {
    const best = cands.reduce((a, b) => (b.tier < a.tier ? b : a));
    const agree = hints.includes(best.amount) || cands.some((c) => c !== best && c.amount === best.amount);
    return val(String(best.amount), agree ? 0.97 : 0.88, best.line);
  }
  // 이름표가 없으면 가장 큰 금액 (받은금액·거스름돈 줄은 빼고)
  let max: { amount: number; line: ReceiptLine } | undefined;
  for (const line of lines) {
    if (/받은|거스름|잔돈|승인|카드번호/.test(squash(line.text))) continue;
    for (const a of amountsIn(line.text)) if (a >= 100 && a < 1e8 && (!max || a > max.amount)) max = { amount: a, line };
  }
  return max ? val(String(max.amount), 0.5, max.line) : undefined;
}

function findLabeledAmount(lines: ReceiptLine[], re: RegExp): ReceiptValue | undefined {
  for (const line of lines) {
    if (!re.test(head(line))) continue;
    const a = lastAmount(line, 1);
    if (a !== undefined) return val(String(a), 0.9, line);
  }
  return undefined;
}

function findPayment(lines: ReceiptLine[]): { payment?: ReceiptValue; card?: ReceiptValue; paid: number[] } {
  let payment: ReceiptValue | undefined;
  let card: ReceiptValue | undefined;
  const paid: number[] = [];
  for (const line of lines) {
    const s = squash(line.text);
    const c = /([\d]{4})[-\s]?[\d*xX#]{2,4}[-\s]?[\d*xX#]{4}[-\s]?[\d*xX#]{3,4}/.exec(line.text);
    if (c && (/[*xX#]/.test(c[0]) || /카드/.test(s)) && !card) card = val(`${c[1]}-****-****-****`, 0.9, line);
    if (/^(신용카드|체크카드|카드결제|카드|현금|현금결제|계좌이체)/.test(head(line))) {
      const a = lastAmount(line, 1);
      if (a) paid.push(a);
    }
    if (!payment && /신용카드|체크카드|카드결제|카드번호|카드종류|신용승인|^카드/.test(s)) payment = val('카드', 0.92, line);
  }
  if (!payment) {
    const t = lines.find((l) => /계좌이체|무통장/.test(squash(l.text)));
    if (t) payment = val('계좌이체', 0.85, t);
  }
  if (!payment) {
    const t = lines.find((l) => /현금/.test(squash(l.text)));
    if (t) payment = val('현금', 0.85, t);
  }
  return { payment, card, paid };
}

function findApproval(lines: ReceiptLine[]): ReceiptValue | undefined {
  for (const [i, line] of lines.entries()) {
    const m = /승인\s*(?:번호|No\.?)?\s*[:：]?\s*(\d{6,10})(?!\d)/i.exec(line.text);
    if (m) return val(m[1], 0.92, line);
    // "… 승인" 다음 줄에 번호만
    if (/승인(번호)?\s*[:：]?$/.test(line.text.trim()) && lines[i + 1] && /^\d{6,10}$/.test(squash(lines[i + 1].text))) {
      return val(squash(lines[i + 1].text), 0.85, lines[i + 1]);
    }
  }
  return undefined;
}

function findOwner(lines: ReceiptLine[]): ReceiptValue | undefined {
  for (const line of lines) {
    const m = OWNER_LABEL.exec(squash(line.text));
    if (m) return val(m[2], 0.85, line);
  }
  return undefined;
}

function findAddress(lines: ReceiptLine[]): ReceiptValue | undefined {
  for (const line of lines) {
    if (!ADDRESS_LABEL.test(head(line))) continue;
    const rest = line.cells.length > 1 ? line.cells.slice(1).join(' ') : line.text.replace(/^\s*(사업장소재지|사업장주소|소재지|주소)\s*[:：]?\s*/, '');
    if (rest.trim()) return val(rest.trim(), 0.88, line);
  }
  const like = lines.find((l) => ADDRESS_LIKE.test(squash(l.text)) && !/사업자|tel|전화/i.test(l.text));
  return like ? val(like.text.replace(/^.*?(?=[가-힣]+(시|도)\s?)/, '').trim(), 0.65, like) : undefined;
}

// ── 품목 ──

const ITEM_HEAD = /품명|품목|상품명|메뉴|내역/;
const ITEM_COLS = /수량|단가|금액/;
const ITEM_STOP = /^(합계|총|과세|면세|부가|결제|받을|받은|공급|소계|할인|카드|현금|계$|신용|봉사료|거스름)/;

/** 수량과 단가가 붙어 읽힌 것("21,300" = 2 × 1,300)을 금액에 맞춰 가른다 */
function splitGlued(n: number, amount: number): { qty: number; unit: number } | null {
  const s = String(n);
  for (let k = 1; k <= 2 && k < s.length; k++) {
    const qty = Number(s.slice(0, k));
    const unit = Number(s.slice(k));
    if (qty > 0 && unit > 0 && qty * unit === amount) return { qty, unit };
  }
  return null;
}

function itemOf(line: ReceiptLine): ReceiptItem | null {
  let name: string;
  let rest: string;
  if (line.cells.length > 1 && /[가-힣A-Za-z]/.test(line.cells[0])) {
    name = line.cells[0];
    rest = line.cells.slice(1).join(' ');
  } else {
    const m = /^(.*?[가-힣A-Za-z)][^\s]*)\s+(\d[\d,.\s]*)$/.exec(line.text.trim());
    if (!m) return null;
    name = m[1];
    rest = m[2];
  }
  name = name.replace(/^[*\d]{1,3}[.)\s]+(?=[가-힣A-Za-z])/, '').trim();
  const nums = amountsIn(rest);
  if (!name || !nums.length) return null;
  const amount = nums[nums.length - 1];
  if (nums.length >= 3) {
    const [qty, unit] = nums.slice(-3);
    return { name, qty, unit_price: unit, amount };
  }
  if (nums.length === 2) {
    const a = nums[0];
    const glued = a !== amount ? splitGlued(a, amount) : null;
    if (glued) return { name, qty: glued.qty, unit_price: glued.unit, amount };
    if (a === amount) return { name, qty: 1, unit_price: a, amount };
    if (a < 1000 && a > 0 && amount % a === 0) return { name, qty: a, unit_price: amount / a, amount };
    return { name, unit_price: a, amount };
  }
  return { name, amount };
}

export function findItems(lines: ReceiptLine[]): ReceiptItem[] {
  const start = lines.findIndex((l) => ITEM_HEAD.test(squash(l.text)) && ITEM_COLS.test(squash(l.text)) && !amountsIn(l.text).length);
  if (start < 0) return [];
  const items: ReceiptItem[] = [];
  for (const line of lines.slice(start + 1)) {
    if (ITEM_STOP.test(head(line))) break;
    const it = itemOf(line);
    if (!it) { if (items.length) break; continue; }
    items.push(it);
    if (items.length >= 60) break;
  }
  return items;
}

/** 적요(용도) 규칙 요약: 품목 첫 줄 + 외 n건. 품목이 없으면 빈칸(사람이 적게 강조) */
export function purposeOf(items: ReceiptItem[]): ReceiptValue {
  if (!items.length) return { value: '', confidence: 0 };
  const first = items[0].name.replace(/\s+/g, ' ').trim();
  return { value: items.length > 1 ? `${first} 외 ${items.length - 1}건` : first, confidence: 0.7 };
}

export function parseReceipt(lines: ReceiptLine[]): { fields: ReceiptFields; items: ReceiptItem[] } {
  const items = findItems(lines);
  const supply = findLabeledAmount(lines, SUPPLY);
  const vat = findLabeledAmount(lines, VAT);
  const pay = findPayment(lines);
  const hints = [...pay.paid];
  if (supply && vat) hints.push(Number(supply.value) + Number(vat.value));
  const itemSum = items.reduce((s, i) => s + (i.amount ?? 0), 0);
  if (itemSum) hints.push(itemSum);
  const fields: ReceiptFields = {};
  const set = <K extends keyof ReceiptFields>(k: K, v: ReceiptFields[K] | undefined) => { if (v) fields[k] = v; };
  set('date', findDate(lines));
  set('vendor', findVendor(lines));
  set('brn', findBrn(lines));
  set('owner', findOwner(lines));
  set('address', findAddress(lines));
  set('total', findTotal(lines, hints));
  set('supply', supply);
  set('vat', vat);
  set('payment', pay.payment);
  set('card', pay.card);
  set('approval', findApproval(lines));
  return { fields, items };
}
