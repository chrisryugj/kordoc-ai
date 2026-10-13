/** 그 당시 조문 — 문서 날짜(시행일) 찾기, 그날 시행 중이던 조문과 현행 비교
 *
 * 날짜: 공문 끝 "시행 부서-번호 (2026. 3. 2.)" 줄(회신 초안·접수함과 같은 규칙) → 없으면 "2026. 3. 2." 만 있는 날짜 줄·"작성일: …" 줄.
 */

import { receivedDocRef } from '../ai/prompts.js';
import { dateAtStart } from '../inbox/dates.js';

export interface DocDate { date: string; source: '시행일' | '문서 날짜' }

const LABEL = /^(?:시행\s?일(?:자)?|작성\s?일(?:자)?|기안\s?일(?:자)?|보고\s?일(?:자)?|일\s?자|날\s?짜)\s*[:：]?\s*/;

/** 문서 날짜 (YYYY-MM-DD). 연도가 적힌 날짜만 믿는다 */
export function documentDate(text: string, today: string): DocDate | undefined {
  const ref = receivedDocRef(text);
  const raw = ref ? /\(([^()]*)\)\s*$/.exec(ref.ref)?.[1] : undefined;
  const sent = raw ? dateAtStart(raw, today, true) : undefined;
  if (sent) return { date: sent, source: '시행일' };
  for (const l of text.split('\n')) {
    const line = l.replace(/\|/g, ' ').replace(/[*#]/g, '').trim();
    if (!line || line.length > 40) continue;
    const labeled = LABEL.test(line);
    const rest = line.replace(LABEL, '');
    const d = dateAtStart(rest, today, true);
    if (!d) continue;
    // 날짜 뒤에 요일 정도만 남아야 날짜 줄 (본문 속 날짜는 빼고)
    const tail = rest.replace(/^\s*\d{4}\s*[.년/-]\s*\d{1,2}\s*[.월/-]\s*\d{1,2}\s*(?:일|\.)?/, '').replace(/\(\s*[월화수목금토일](?:요일)?\s*\)/, '').trim();
    if (tail.length <= 2 || (labeled && tail.length <= 12)) return { date: d, source: labeled && /^시행/.test(line) ? '시행일' : '문서 날짜' };
  }
  return undefined;
}

/** 2026-03-02 → 2026. 3. 2. */
export const koDate = (iso: string) => `${Number(iso.slice(0, 4))}. ${Number(iso.slice(5, 7))}. ${Number(iso.slice(8, 10))}.`;
export const ymd = (iso: string) => iso.replace(/-/g, '');

/** 비교용: 공백·문장부호 차이는 무시 */
export const sameText = (a: string, b: string) => {
  const n = (s: string) => s.replace(/[\s.,·ㆍ'"“”‘’()]/g, '').replace(/…$/, '');
  return n(a) === n(b);
};

/** 어절 단위 차이 — 빠진 덩이·더해진 덩이 (각 4개, 덩이당 60자) */
export function wordDiff(before: string, after: string): { removed: string[]; added: string[] } {
  const a = before.replace(/…$/, '').split(/\s+/).filter(Boolean).slice(0, 400);
  const b = after.replace(/…$/, '').split(/\s+/).filter(Boolean).slice(0, 400);
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const removed: string[] = [];
  const added: string[] = [];
  let i = 0;
  let j = 0;
  let del: string[] = [];
  let add: string[] = [];
  const flush = () => {
    if (del.length) removed.push(del.join(' '));
    if (add.length) added.push(add.join(' '));
    del = [];
    add = [];
  };
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) { flush(); i++; j++; }
    else if (j < b.length && (i >= a.length || dp[i][j + 1] >= dp[i + 1][j])) add.push(b[j++]);
    else del.push(a[i++]);
  }
  flush();
  const short = (xs: string[]) => xs.slice(0, 4).map((x) => (x.length > 60 ? `${x.slice(0, 60)}…` : x));
  return { removed: short(removed), added: short(added) };
}
