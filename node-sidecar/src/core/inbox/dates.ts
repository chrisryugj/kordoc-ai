/** 받은 공문 날짜 읽기 — 공문 날짜 표기(2026. 10. 23.(금) · '26.6.18. · 10월 23일 · 10. 23.)를 YYYY-MM-DD 로
 *
 * 연도가 없으면 기준일(시행일, 없으면 오늘)의 연도. 그 해로는 기준일보다 반년 넘게 앞이면 다음 해(12월 시행 공문의 "1. 5.까지").
 * 연도 없이 요일이 적혀 있으면 요일이 맞는 해(기준일 앞뒤 한 해 가운데 가까운 쪽)를 고른다(10. 30.(토) → 2027년).
 * 연도가 적혀 있으면 요일이 날짜와 어긋나도 날짜를 믿는다.
 */

/** 날짜 하나 — 캡처하면 (4자리 연도)('26 꼴 연도)(월)(일).
 *  월과 일 사이 줄표는 연도가 앞에 있을 때만 받는다(2026-10-23). 연도 없는 "2-3"은 날짜보다 번호일 때가 많다
 *  ("서식 2-1부터 2-3까지"를 2월 3일 기한으로 읽으면 안 된다).
 *  두 자리 연도는 작은따옴표가 있거나('26.6.18.), 없으면 점으로 붙여 쓴 세 마디(25.10.23.)일 때만 연도로 읽는다.
 *  연도·요일·"일"·끝 점이 없는 한 자리 두 마디(4.5)는 날짜보다 소수일 때가 많아 날짜로 읽지 않는다("평점 4.5까지 인정") */
function datePattern(capture: boolean): string {
  const g = capture ? '(' : '(?:';
  const year = String.raw`(?:\d{4}|['‘’]?\d{2})\s*[.년/-]\s*`;
  const bareYear = String.raw`(?=\d{2}\.(?:0?[1-9]|1[0-2])\.(?:0?[1-9]|[12]\d|3[01])(?!\d))`;
  const notDecimal = String.raw`(?:(?<=[.년/-]\s*)|(?!\d\.\d(?![\d.]|\s*일|\s*\(\s*[월화수목금토일]|\s*[월화수목금토일]요일)))`;
  return String.raw`(?<![\d.])(?:${g}\d{4})\s*[.년/-]\s*|(?:['‘’]|${bareYear})${g}\d{2})\s*[.년/-]\s*)?${notDecimal}${g}\d{1,2})\s*(?:[.월/]|-(?<=${year}\d{1,2}\s*-))\s*${g}\d{1,2})(?:\s*일|\.(?!\d))?`;
}

const DATE = datePattern(true);
const DATE_NC = datePattern(false);
/** (금) · (금요일) · 금요일 */
const WDAY = String.raw`(?:\s*\(\s*[월화수목금토일](?:요일)?\s*\)|\s*[월화수목금토일]요일)?`;
/** 같은 꼴, 요일 글자를 잡는다 (기한 날짜 바로 뒤, 묶음 둘 중 하나) */
const WDAY_C = String.raw`(?:\s*\(\s*([월화수목금토일])(?:요일)?\s*\)|\s*([월화수목금토일])요일)?`;
/** 18:00 · 오후 6시 · 18시 30분 */
const TIME = String.raw`(?:\s*(?:오전|오후)?\s*\d{1,2}\s*(?::\s*\d{2}|시(?:\s*\d{1,2}\s*분)?))?`;
/** 범위의 앞 날짜(9월 28일~ · 10. 1.부터) — 지울 때 같이 지운다 */
const RANGE_HEAD = String.raw`(?:${DATE_NC}${WDAY}\s*(?:부터|[~∼～-])\s*)?`;

/** "~까지" 기한: 범위 앞 날짜 + 날짜 + 요일 + 시각 + 까지(PDF 글은 "까 지"로 갈라지기도 한다). 마지막 네 묶음이 기한 날짜 */
export const UNTIL_SRC = `${RANGE_HEAD}${DATE}${WDAY_C}${TIME}\\s*까\\s?지`;
/** 물결 기한 "~10.16." · "~ 2026. 10. 16." — 앞에 날짜·요일 괄호가 없는 물결만 (있으면 "10. 1.(목) ~ 10. 5." 같은 기간).
 *  괄호 속 물결("확정통보(~10월 28일)" · "과제공고(~5월4주)")은 보내는 쪽 일정이 많아 기한으로 보지 않는다 */
const TILDE_SRC = `(?<![\\d.)(]\\s*)[~∼～]\\s*${DATE}${WDAY_C}${TIME}(?![\\d.가-힣]|\\s*까\\s?지)`;
/** "제출기한: 날짜" · "기한 : 날짜" · "마감일: 날짜" (까지는 있어도 없어도) — 1묶음이 앞말(제출·납부…) */
const LABEL_SRC = String.raw`(?:^|[\s(·:])([가-힣]{0,6}?)\s*(?:기\s*한|마감(?:\s*일(?:시)?)?)\s*(?:은|는)?\s*[:：]?\s*${DATE}${WDAY_C}`;
/** "설문조사: ~10.23." — 쌍점 뒤 물결 날짜, 1묶음이 앞말 */
const TILDE_LABEL_SRC = String.raw`^(?:[가-하]\.\s*|\d{1,2}\)\s*|[-·○ㅇ]\s*)?([가-힣A-Za-z0-9·]{2,12}(?:\s[가-힣A-Za-z0-9·]{1,12}){0,2})\s*[:：]\s*[~∼～]\s*${DATE}${WDAY_C}`;
/** "신청기간: 10. 1. ~ 10. 23." — 끝 날짜가 기한 */
const PERIOD_SRC = String.raw`(신청|접수|제출|등록|모집)\s*기\s*간\s*(?:은|는)?\s*[:：]?\s*${DATE_NC}${WDAY}\s*[~∼～-]\s*${DATE}${WDAY_C}`;

const pad = (n: number) => String(n).padStart(2, '0');

const WEEKDAYS = '일월화수목금토';
const DAY_MS = 86_400_000;

/** 연도 없는 날짜의 해 — 기준 해로 두되 기준일보다 반년(183일) 넘게 앞이면 다음 해.
 *  요일이 있으면 그 해가 요일과 맞는지 보고, 안 맞으면 기준일 앞뒤 한 해에서 요일이 맞는 가까운 해 */
function guessYear(month: number, day: number, ref: string, wday?: string): number {
  const refYear = Number(ref.slice(0, 4));
  const refT = Date.UTC(refYear, Number(ref.slice(5, 7)) - 1, Number(ref.slice(8, 10)));
  const at = (y: number) => Date.UTC(y, month - 1, day);
  const year = refT - at(refYear) > 183 * DAY_MS ? refYear + 1 : refYear;
  if (!wday) return year;
  const fits = (y: number) => {
    const dt = new Date(at(y));
    return dt.getUTCMonth() === month - 1 && WEEKDAYS[dt.getUTCDay()] === wday;
  };
  if (fits(year)) return year;
  const near = [refYear - 1, refYear, refYear + 1].filter((y) => y !== year && fits(y)).sort((a, b) => Math.abs(at(a) - refT) - Math.abs(at(b) - refT));
  return near[0] ?? year;
}

/** 묶음 값 → YYYY-MM-DD (없는 날짜면 undefined). ref 는 기준일 YYYY-MM-DD, wday 는 날짜 뒤에 적힌 요일 글자(일~토) */
export function isoOf(y4: string | undefined, y2: string | undefined, m: string, d: string, ref: string, wday?: string): string | undefined {
  const month = Number(m);
  const day = Number(d);
  const year = y4 ? Number(y4) : y2 ? 2000 + Number(y2) : guessYear(month, day, ref, wday);
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
  const m = new RegExp(`^\\s*${DATE}${WDAY_C}`).exec(text);
  if (!m || (needYear && !m[1] && !m[2])) return undefined;
  return isoOf(m[1], m[2], m[3], m[4], ref, m[5] ?? m[6]);
}

/** 글 속 "~까지"·"~10.16." 기한 전부 */
export function untilDates(text: string, ref: string): string[] {
  const out: string[] = [];
  for (const src of [UNTIL_SRC, TILDE_SRC]) {
    for (const m of text.matchAll(new RegExp(src, 'g'))) {
      const iso = isoOf(m[1], m[2], m[3], m[4], ref, m[5] ?? m[6]);
      if (iso) out.push(iso);
    }
  }
  return out;
}

/** "~까지"·"~10.16." 기한 표현을 지운 글 (요청 문장 다듬기) */
export function stripUntil(text: string): string {
  return text.replace(new RegExp(`${UNTIL_SRC}\\s*`, 'g'), '').replace(new RegExp(`${TILDE_SRC}\\s*`, 'g'), '');
}

/** 기한 칸 한 줄 — "제출기한: 날짜" · "신청기간: 날짜~날짜" · "설문조사: ~날짜". label 은 앞말(제출·납부…, 없으면 빈 문자열) */
export function labeledDue(line: string, ref: string): { label: string; due: string } | undefined {
  const p = new RegExp(PERIOD_SRC).exec(line);
  if (p) {
    const due = isoOf(p[2], p[3], p[4], p[5], ref, p[6] ?? p[7]);
    if (due) return { label: p[1], due };
  }
  const m = new RegExp(LABEL_SRC).exec(line);
  if (m) {
    const due = isoOf(m[2], m[3], m[4], m[5], ref, m[6] ?? m[7]);
    return due ? { label: m[1], due } : undefined;
  }
  const t = new RegExp(TILDE_LABEL_SRC).exec(line);
  // "운영기간: ~12. 31." · "일시: ~" 같은 기간·일시 줄은 기한이 아니다
  const due = t && !/(?:기\s?간|일\s?시|일\s?정|시\s?간)$/.test(t[1]) ? isoOf(t[2], t[3], t[4], t[5], ref, t[6] ?? t[7]) : undefined;
  return t && due ? { label: t[1], due } : undefined;
}
