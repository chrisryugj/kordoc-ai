/** 인용 검증 — 답의 문장마다 숫자·날짜·금액·비율을 뽑아, 그 문장이 단 근거 조각 [n] 의 원문에 실제로 있는지 대조
 *
 * 표기 차이는 정규화한다: 2026. 10. 13. = 2026년 10월 13일 = 2026-10-13 (연도 없는 "10월 13일"은 월·일만 맞으면),
 * 1,200만 원 = 12,000,000원, 30% = 30퍼센트, 14:00 = 오후 2시. 계산해서 만든 숫자(합계 등)는 원문에 없으니 불일치로 잡힌다.
 */

import type { Citation } from '../../types/rpc-contract.js';
import type { Passage } from './docs.js';

export interface NumToken {
  /** 답에 적힌 그대로 (불일치 보고용) */
  raw: string;
  /** 정규화 키 — 하나라도 근거에 있으면 맞음 */
  keys: string[];
}

const MARKER = /\[(\d{1,3}(?:\s*[,，]\s*\d{1,3})*)\]/g;
const UNIT: Record<string, number> = { 조: 1e12, 억: 1e8, 천만: 1e7, 백만: 1e6, 십만: 1e5, 만: 1e4, 천: 1e3 };
const num = (s: string) => Number(s.replace(/,/g, ''));
const okMd = (m: number, d: number) => m >= 1 && m <= 12 && d >= 1 && d <= 31;

function wonValue(s: string): number | undefined {
  let total = 0;
  let any = false;
  for (const m of s.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(조|억|천만|백만|십만|만|천)?/g)) {
    const n = num(m[1]);
    if (!Number.isFinite(n)) continue;
    total += n * (m[2] ? UNIT[m[2]] : 1);
    any = true;
  }
  return any ? Math.round(total) : undefined;
}

/** 글에서 숫자 표현을 뽑는다 — 구조 있는 것(날짜·시각·금액·비율)부터 지워 가며, 남은 숫자는 값으로 */
export function extractNumbers(text: string): NumToken[] {
  const out: NumToken[] = [];
  let rest = text;
  const take = (re: RegExp, fn: (m: RegExpMatchArray) => string[] | null) => {
    rest = rest.replace(re, (...args) => {
      const m = args.slice(0, -2) as unknown as RegExpMatchArray;
      const keys = fn(m);
      if (!keys) return m[0];
      out.push({ raw: m[0].trim(), keys });
      return ' '.repeat(m[0].length);
    });
  };
  // 연·월·일
  take(/(\d{4})\s*(?:년\s*|[.\-/]\s*)(\d{1,2})\s*(?:월\s*|[.\-/]\s*)(\d{1,2})\s*(?:일|\.)?/g, (m) => {
    const [y, mo, d] = [num(m[1]), num(m[2]), num(m[3])];
    return okMd(mo, d) ? [`d:${y}-${mo}-${d}`] : null;
  });
  // 월·일 (10월 13일 / 3. 27.)
  take(/(?<!\d)(\d{1,2})\s*월\s*(\d{1,2})\s*일/g, (m) => (okMd(num(m[1]), num(m[2])) ? [`md:${num(m[1])}-${num(m[2])}`] : null));
  take(/(?<![\d.])(\d{1,2})\.\s(\d{1,2})\.(?!\d)/g, (m) => (okMd(num(m[1]), num(m[2])) ? [`md:${num(m[1])}-${num(m[2])}`] : null));
  // 연·월 (2025년 11월 / 2025. 11.)
  take(/(\d{4})\s*(?:년\s*(\d{1,2})\s*월|\.\s*(\d{1,2})\.)(?!\s*\d)/g, (m) => {
    const mo = num(m[2] ?? m[3]);
    return mo >= 1 && mo <= 12 ? [`ym:${num(m[1])}-${mo}`] : null;
  });
  // 시각 (14:00 / 오후 2시 30분)
  take(/(?<!\d)(\d{1,2}):(\d{2})/g, (m) => [`t:${num(m[1])}:${m[2]}`]);
  take(/(?:(오전|오후)\s*)?(?<!\d)(\d{1,2})\s*시(?!간|경|대|민|청|군|도)(?:\s*(\d{1,2})\s*분)?/g, (m) => {
    const h = num(m[2]);
    if (h > 24) return null;
    const mm = String(m[3] ? num(m[3]) : 0).padStart(2, '0');
    if (m[1] === '오후' && h < 12) return [`t:${h + 12}:${mm}`];
    if (m[1] === '오전' || h >= 12) return [`t:${h}:${mm}`];
    return [`t:${h}:${mm}`, `t:${h + 12}:${mm}`];
  });
  // 금액 (1,200만 원 / 1억 2천만 원 / 금113,560원)
  take(/(?:금\s*)?((?:\d[\d,]*(?:\.\d+)?\s*(?:조|억|천만|백만|십만|만|천)\s*)*\d[\d,]*(?:\.\d+)?\s*(?:조|억|천만|백만|십만|만|천)?)\s*원/g, (m) => {
    const v = wonValue(m[1]);
    return v === undefined ? null : [`w:${v}`, `n:${v}`];
  });
  // 비율
  take(/(\d+(?:\.\d+)?)\s*(?:%|％|퍼센트|프로)/g, (m) => [`p:${num(m[1])}`, `n:${num(m[1])}`]);
  // 나머지 숫자 (만·억 단위가 붙으면 값으로 환산, 뒤의 세는 단위는 보고용 글에만 붙인다)
  take(/(\d[\d,]*(?:\.\d+)?(?:\s*(?:조|억|천만|백만|십만|만))?)(?:\s*(?:개월|시간|가구|명|건|곳|개|회|번|일|년|주|분|쪽|장|부|차|배|점|톤|대|채|호|위|세|인))?/g, (m) => {
    const v = /[조억만]/.test(m[1]) ? wonValue(m[1]) : num(m[1]);
    return v === undefined || !Number.isFinite(v) ? null : [`n:${v}`, `w:${v}`];
  });
  return out;
}

/** 근거 원문의 키 모음 — 연월일은 연·월(ym)과 "연도 있는 월·일"(xmd)로도, 숫자는 낱낱의 값으로도 넣는다 */
export function indexKeys(text: string): Set<string> {
  const keys = new Set<string>();
  for (const t of extractNumbers(text)) {
    for (const k of t.keys) {
      keys.add(k);
      const d = /^d:(\d+)-(\d+)-(\d+)$/.exec(k);
      if (d) { keys.add(`xmd:${d[2]}-${d[3]}`); keys.add(`ym:${d[1]}-${d[2]}`); }
    }
  }
  for (const m of text.matchAll(/\d[\d,]*(?:\.\d+)?/g)) keys.add(`n:${num(m[0])}`);
  return keys;
}

function supported(t: NumToken, idx: Set<string>): boolean {
  return t.keys.some((k) => {
    if (idx.has(k)) return true;
    // 답의 연월일: 원문이 연도 없이 월·일만 썼을 때만 인정 (원문 "3. 27.(금)까지" → 답 "2026. 3. 27.").
    // 원문에 다른 연도로 적힌 날짜(2026. 3. 27.)와는 맞추지 않는다 → 답 "2027. 3. 27."은 불일치
    const d = /^d:\d+-(\d+)-(\d+)$/.exec(k);
    if (d) return idx.has(`md:${d[1]}-${d[2]}`);
    // 답의 월·일: 원문의 연월일과 월·일이 같으면 인정
    const md = /^md:(\d+-\d+)$/.exec(k);
    return md ? idx.has(`xmd:${md[1]}`) : false;
  });
}

/** 문장 나누기 — 문장 끝 온점 뒤에 붙은 [n] 은 앞 문장 것. 날짜의 온점(숫자 뒤)에서는 자르지 않는다 */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  const boundary = /(?<=[^\d\s][.!?。])(?:\s*\[\d{1,3}(?:\s*[,，]\s*\d{1,3})*\])*(?=\s|$)/g;
  for (const line of text.split('\n')) {
    let start = 0;
    for (const m of line.matchAll(boundary)) {
      const end = (m.index ?? 0) + m[0].length;
      const s = line.slice(start, end).trim();
      if (s) out.push(s);
      start = end;
    }
    const tail = line.slice(start).trim();
    if (tail) out.push(tail);
  }
  return out;
}

const citedIn = (s: string) => [...new Set([...s.matchAll(MARKER)].flatMap((m) => m[1].split(/[,，]/).map((x) => Number(x.trim()))))];
/** 숫자 뽑을 때 빼는 것: [n] 표지, 줄머리 목록 번호(1. / 2) ) */
const bodyOf = (s: string) => s.replace(MARKER, ' ').replace(/^\s*(?:[-*•]\s+|\d{1,2}[.)]\s+)/, '');

/** citations 에 verified·mismatch 를 채우고, 숫자가 있는데 [n] 이 없는 문장을 unsupported 로.
 *  fallback = 모델이 번호를 하나도 안 달아 근거를 추정으로 붙인 경우 — 답 전체 숫자를 그 근거들과 대조한다 */
export function verifyCitations(answer: string, shown: Passage[], citations: Array<Omit<Citation, 'verified' | 'mismatch'>>, fallback = false): { citations: Citation[]; unsupported: string[] } {
  const idxCache = new Map<number, Set<string>>();
  const idxOf = (n: number) => {
    let idx = idxCache.get(n);
    if (!idx) {
      const p = shown[n - 1];
      idx = indexKeys(`${p.heading ?? ''} ${p.page ? `${p.page}쪽` : ''}\n${p.text}`);
      idxCache.set(n, idx);
    }
    return idx;
  };
  const mismatch = new Map<number, Set<string>>();
  const unsupported: string[] = [];
  const valid = (n: number) => n >= 1 && n <= shown.length;

  for (const s of splitSentences(answer)) {
    const tokens = extractNumbers(bodyOf(s));
    let refs = citedIn(s);
    if (!refs.length) {
      if (!tokens.length) continue;
      unsupported.push(s);
      if (!fallback) continue;
      refs = citations.map((c) => c.n);
    }
    const union = new Set(refs.filter(valid).flatMap((n) => [...idxOf(n)]));
    const bad = tokens.filter((t) => !supported(t, union)).map((t) => t.raw);
    for (const n of refs) {
      const set = mismatch.get(n) ?? new Set<string>();
      for (const b of bad) set.add(b);
      mismatch.set(n, set);
    }
  }
  return {
    citations: citations.map((c) => {
      const miss = [...(mismatch.get(c.n) ?? [])];
      return { ...c, verified: valid(c.n) && miss.length === 0, ...(miss.length ? { mismatch: miss } : {}) };
    }),
    unsupported,
  };
}
