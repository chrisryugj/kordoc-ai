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
    // 그림 자리 글 (스캔 쪽을 OCR 없이 읽으면 이것만 나온다)
    if (/^!\[[^\]]*\]\([^)]*\)$/.test(line)) continue;
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
  // 이름표와 값이 한 조각("합계 18,000")이면 이름표·괄호 말("(VAT포함)"·"(1건)")을 뺀 뒤 글
  const text = from > 0 && line.cells.length <= from
    ? line.text.replace(/\([^)]*\)/g, ' ').replace(/^[^\d]*/, '')
    : line.cells.slice(from).join(' ');
  const withComma = [...text.matchAll(/(?<![\d,.])\d{1,3}(?:[,.]\d{3})+(?!\d)/g)].map((m) => Number(m[0].replace(/[,.]/g, '')));
  if (withComma.length) return withComma[withComma.length - 1];
  const all = amountsIn(text).filter((n) => n > 0 && n < 1e9);
  return all.length ? all[all.length - 1] : undefined;
}

const pad = (n: number) => String(n).padStart(2, '0');
function okDate(y: number, m: number, d: number, now = new Date()): string | null {
  if (y < 2000 || y > now.getFullYear() + 1 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  // 없는 날 (2월 30일·4월 31일)
  if (new Date(Date.UTC(y, m - 1, d)).getUTCDate() !== d) return null;
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
/** 합계 이름표에 붙는 "(부가세포함)"·"(VAT포함)" (붙은 머리 글 기준). 떼고 본다: "부가세(VAT포함)" 는 떼도 부가세라 합계가 아니다 */
const TAX_INCLUDED = /\((부가세|부가가치세|vat)포함\)/gi;
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

/** 가게가 아닌 쪽(카드사·결제대행·가맹점번호)의 사업자번호가 놓이는 줄. "신용카드·체크카드" 같은 결제 수단 이름은 빼고 "한빛카드" 같은 카드사 이름 */
const BRN_AWAY = /카드사|매입사|발급사|\bVAN|밴\s*사|결제\s*대행|PG사|가맹점\s*번호|[가-힣A-Za-z]{2,}(?<!신용|체크|선불|직불)카드(?![가-힣])/i;

/** 사업자번호 후보 가운데: 이름표가 있고, 검증 숫자가 맞고, 가게 이름 줄에 가깝고, 카드사·결제대행 쪽이 아닌 것.
 *  검증 숫자가 틀렸거나 카드사 쪽 번호뿐이면 신뢰도를 0.8 아래로 (사람이 확인하게) */
function findBrn(lines: ReceiptLine[], vendorAt = -1): ReceiptValue | undefined {
  let best: { value: string; score: number; c: number; line: ReceiptLine } | undefined;
  lines.forEach((line, i) => {
    const m = /(?<!\d)(\d{3})\s*[-–.]\s*(\d{2})\s*[-–.]\s*(\d{5})(?!\d)/.exec(line.text)
      ?? (BRN_LABEL.test(line.text) ? /(?<!\d)(\d{3})(\d{2})(\d{5})(?!\d)/.exec(squash(line.text)) : null);
    if (!m) return;
    const labeled = BRN_LABEL.test(line.text);
    const valid = brnValid(`${m[1]}${m[2]}${m[3]}`);
    const away = BRN_AWAY.test(line.text) || (i > 0 && BRN_AWAY.test(lines[i - 1].text));
    const near = vendorAt >= 0 && Math.abs(i - vendorAt) <= 2;
    const score = (labeled ? 1 : 0) + (valid ? 1 : 0) + (near ? 1.5 : 0) - (away ? 3 : 0) - i / 1000;
    const c = !valid || away ? 0.6 : labeled ? 0.97 : 0.9;
    if (!best || score > best.score) best = { value: `${m[1]}-${m[2]}-${m[3]}`, score, c, line };
  });
  return best ? val(best.value, best.c, best.line) : undefined;
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
  const cands: Array<{ tier: number; amount: number; line: ReceiptLine; i: number; shaky: boolean }> = [];
  lines.forEach((line, i) => {
    const h = head(line).replace(TAX_INCLUDED, '');
    if (NOT_TOTAL.test(h)) return;
    const tier = TOTAL_TIERS.findIndex((re) => re.test(h));
    if (tier < 0) return;
    // 값이 같은 줄에 없으면(칸 머리 줄) 바로 아래 줄의 같은 자리
    let amount = lastAmount(line, 1);
    let src = line;
    let shaky = false;
    const next = lines[i + 1];
    if (amount === undefined && next) {
      // "합계금액 | 공급가액 | 세액" 아래 "110,000 | 100,000 | 10,000": 맨 끝 금액을 집으면 세액이 합계가 된다 → 이름표와 같은 칸(첫 칸)의 값.
      // 칸이 맞지 않는데 금액이 여럿이면 어느 것이 합계인지 알 수 없다: 값은 내되 사람이 보게 낮은 믿음으로
      const aligned = line.cells.length > 1 && next.cells.length === line.cells.length;
      amount = aligned ? lastAmount({ ...next, text: next.cells[0], cells: [next.cells[0]] }) : lastAmount(next);
      shaky = !aligned && amountsIn(next.text).filter((n) => n >= 100).length > 1;
      src = next;
    }
    if (amount !== undefined && amount > 0) cands.push({ tier, amount, line: src, i, shaky });
  });
  if (cands.length) {
    const best = cands.reduce((a, b) => (b.tier < a.tier ? b : a));
    const agree = hints.includes(best.amount) || cands.some((c) => c !== best && c.amount === best.amount);
    return val(String(best.amount), agree ? 0.97 : best.shaky ? 0.7 : 0.88, best.line);
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

/** 카드번호 꼴 (네 자리 · 2~4 · 4 · 3~4, 가린 글자 *·x·# 포함) */
const CARD_NO = /(?<!\d)\d{4}[-\s]?[\d*xX#]{2,4}[-\s]?[\d*xX#]{4}[-\s]?[\d*xX#]{3,4}(?!\d)/g;

/** 카드번호는 앞 네 자리만 두고 가린다. 카드 줄(카드 글자·바로 위 "카드번호")이거나 이미 가린 꼴·네 자리씩 띄운 꼴만 카드번호로 본다 */
function maskCardText(text: string, cardLine: boolean): string {
  return text.replace(CARD_NO, (m) => (cardLine || /[*xX#]/.test(m) || /^\d{4}[-\s]\d{4}[-\s]\d{4}[-\s]\d{3,4}$/.test(m)
    ? m.slice(0, 4) + m.slice(4).replace(/[\dxX#]/g, '*')
    : m));
}

/** 읽은 줄의 카드번호 가리기 (근거 줄·화면·AI 로 가는 줄 모두 이것을 거친다) */
export function maskCardLines(lines: ReceiptLine[]): ReceiptLine[] {
  return lines.map((line, i) => {
    const cardLine = /카드/.test(squash(line.text)) || (i > 0 && /카드번호[:：]?$/.test(squash(lines[i - 1].text)));
    const text = maskCardText(line.text, cardLine);
    if (text === line.text) return line;
    const cells = line.cells.map((c) => maskCardText(c, cardLine));
    // 번호가 여러 칸에 걸쳐 갈라졌으면 칸으로는 못 가리니 줄 하나로
    return { ...line, text, cells: cells.join(' ') === text || line.cells.join(' ') !== line.text ? cells : [text] };
  });
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

/** 취소·환불 전표로 보이는가 — 거래 종류를 적은 말(승인취소·환불금액…)이나 음수로 적힌 합계(-11,000 · △11,000).
 *  "교환·환불은 7일 이내" 같은 안내 글의 낱말만으로는 보지 않는다 */
export function looksRefund(lines: readonly string[], totalLine = ''): boolean {
  const kind = /(?:신용|체크|카드|현금|현금영수증|승인|결제|거래|매출|전표)취소|취소(?:승인|매출|전표|영수증|금액|일시|거래)|(?:전표|영수증)[(\[]취소[)\]]|환불(?:금액|승인|영수증|완료)|반품영수증/;
  // 안내 글("결제취소 시 영수증 지참"·"거래취소는 14일 이내"·"결제취소 요청 기한")은 거래 종류가 아니다.
  // "카드취소 가맹점용"의 "취소가", 같은 줄의 "유효기간·할부기간"은 안내 글이 아니다
  const notice = /취소(?:시|는|은|가(?!맹)|를|하|할(?!부)|및|요청)|이내|지참|가능|불가|문의|경우|바랍니다|하세요|하십시오|안내|기한|까지|소요|(?<!유효|할부|사용)기간/;
  if (lines.some((l) => { const s = squash(l); return /^\[?취소\]?$|^반품$/.test(s) || (kind.test(s) && !notice.test(s)); })) return true;
  // 음수로 적힌 합계: -11,000 · -11000 · -11.000 · △11,000 · 합계금액-11,000.
  // 날짜·번호의 줄표(앞이 숫자·영문), 줄 긋기("------"), 수량과 금액 사이의 줄표("3개 - 12,000원")는 음수가 아니다.
  // 줄표가 금액에 붙어 있으면("합계 1 -11,000") 앞이 수량이어도 음수다
  return /(?<![\dA-Za-z-−–])(?:[-−–△▽](?=[₩￦\\]?\d)|(?<![\d개건명매장]\s+)[-−–△▽]\s*)[₩￦\\]?\s*\d{1,3}(?:[,.]?\d{3})*(?!\d)\s*원?\s*$/.test(totalLine.trim());
}

export function parseReceipt(raw: ReceiptLine[]): { fields: ReceiptFields; items: ReceiptItem[] } {
  // 카드번호는 처음부터 가린 줄로 (근거 줄에 남지 않게)
  const lines = maskCardLines(raw);
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
  const vendor = findVendor(lines);
  set('vendor', vendor);
  set('brn', findBrn(lines, vendor ? lines.findIndex((l) => l.text === vendor.source) : -1));
  set('owner', findOwner(lines));
  set('address', findAddress(lines));
  const total = findTotal(lines, hints);
  // 취소·환불 전표의 금액은 부호 없이 읽힌다 → 그대로 더하면 지출 합계가 늘어난다. 사람이 보게 낮은 믿음으로
  set('total', total && looksRefund(lines.map((l) => l.text), total.source) ? { ...total, confidence: Math.min(total.confidence, 0.6) } : total);
  set('supply', supply);
  set('vat', vat);
  set('payment', pay.payment);
  set('card', pay.card);
  set('approval', findApproval(lines));
  return { fields, items };
}
