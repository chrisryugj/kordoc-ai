/** 받은 공문 날짜 읽기 — 공문 날짜 표기(2026. 10. 23.(금) · '26.6.18. · 10월 23일 · 10. 23.)를 YYYY-MM-DD 로
 *
 * 연도가 없으면 기준일(시행일, 없으면 오늘)의 연도. 기준일보다 이른 달이면 다음 해(12월 시행 공문의 "1. 5.까지").
 * 요일은 보지 않는다: 요일이 날짜와 어긋나면 날짜를 믿는다.
 */

/** 날짜 하나 — 캡처하면 (4자리 연도)('26 꼴 연도)(월)(일) */
function datePattern(capture: boolean): string {
  const g = capture ? '(' : '(?:';
  return String.raw`(?<![\d.])(?:${g}\d{4})\s*[.년/-]\s*|['‘’]${g}\d{2})\s*[.년/-]\s*)?${g}\d{1,2})\s*[.월/-]\s*${g}\d{1,2})(?:\s*일|\.(?!\d))?`;
}

const DATE = datePattern(true);
const DATE_NC = datePattern(false);
/** (금) · (금요일) · 금요일 */
const WDAY = String.raw`(?:\s*\(\s*[월화수목금토일](?:요일)?\s*\)|\s*[월화수목금토일]요일)?`;
/** 18:00 · 오후 6시 · 18시 30분 */
const TIME = String.raw`(?:\s*(?:오전|오후)?\s*\d{1,2}\s*(?::\s*\d{2}|시(?:\s*\d{1,2}\s*분)?))?`;
/** 범위의 앞 날짜(9월 28일~ · 10. 1.부터) — 지울 때 같이 지운다 */
const RANGE_HEAD = String.raw`(?:${DATE_NC}${WDAY}\s*(?:부터|[~∼～-])\s*)?`;

/** "~까지" 기한: 범위 앞 날짜 + 날짜 + 요일 + 시각 + 까지. 마지막 네 묶음이 기한 날짜 */
export const UNTIL_SRC = `${RANGE_HEAD}${DATE}${WDAY}${TIME}\\s*까지`;
/** "제출기한: 날짜" · "기한 : 날짜" · "마감일: 날짜" (까지는 있어도 없어도) — 1묶음이 앞말(제출·납부…) */
const LABEL_SRC = String.raw`(?:^|[\s(·:])([가-힣]{0,6}?)\s*(?:기\s*한|마감(?:\s*일(?:시)?)?)\s*(?:은|는)?\s*[:：]?\s*${DATE}`;
/** "신청기간: 10. 1. ~ 10. 23." — 끝 날짜가 기한 */
const PERIOD_SRC = String.raw`(신청|접수|제출|등록|모집)\s*기\s*간\s*(?:은|는)?\s*[:：]?\s*${DATE_NC}${WDAY}\s*[~∼～-]\s*${DATE}`;

const pad = (n: number) => String(n).padStart(2, '0');

/** 묶음 값 → YYYY-MM-DD (없는 날짜면 undefined). ref 는 기준일 YYYY-MM-DD */
export function isoOf(y4: string | undefined, y2: string | undefined, m: string, d: string, ref: string): string | undefined {
  const month = Number(m);
  const day = Number(d);
  const refYear = Number(ref.slice(0, 4));
  const refMonth = Number(ref.slice(5, 7));
  let year = y4 ? Number(y4) : y2 ? 2000 + Number(y2) : refYear;
  if (!y4 && !y2 && month < refMonth) year += 1;
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (year < 2000 || year > 2099 || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) return undefined;
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** 오늘 (이 PC 시각 기준) YYYY-MM-DD */
export function todayIso(now = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** YYYY-MM-DD 이고 실제 있는 날짜인가 */
export function isIsoDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return Boolean(m && isoOf(m[1], undefined, m[2], m[3], s) === s);
}

/** 글 첫머리의 날짜 (표 칸·시행일) — 연도가 꼭 있어야 하면 needYear */
export function dateAtStart(text: string, ref: string, needYear = false): string | undefined {
  const m = new RegExp(`^\\s*${DATE}`).exec(text);
  if (!m || (needYear && !m[1] && !m[2])) return undefined;
  return isoOf(m[1], m[2], m[3], m[4], ref);
}

/** 글 속 "~까지" 기한 전부 (나온 순서) */
export function untilDates(text: string, ref: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(new RegExp(UNTIL_SRC, 'g'))) {
    const iso = isoOf(m[1], m[2], m[3], m[4], ref);
    if (iso) out.push(iso);
  }
  return out;
}

/** "~까지" 기한 표현을 지운 글 (요청 문장 다듬기) */
export function stripUntil(text: string): string {
  return text.replace(new RegExp(`${UNTIL_SRC}\\s*`, 'g'), '');
}

/** 기한 칸 한 줄 — "제출기한: 날짜" 또는 "신청기간: 날짜~날짜". label 은 앞말(제출·납부…, 없으면 빈 문자열) */
export function labeledDue(line: string, ref: string): { label: string; due: string } | undefined {
  const p = new RegExp(PERIOD_SRC).exec(line);
  if (p) {
    const due = isoOf(p[2], p[3], p[4], p[5], ref);
    if (due) return { label: p[1], due };
  }
  const m = new RegExp(LABEL_SRC).exec(line);
  if (!m) return undefined;
  const due = isoOf(m[2], m[3], m[4], m[5], ref);
  return due ? { label: m[1], due } : undefined;
}
