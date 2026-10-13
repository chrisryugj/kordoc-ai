/** 받은 공문 요청 사항 — 요청 문장을 할 일 한 줄로 다듬고, 따로 적힌 기한(기한 줄·표·제목)을 요청에 붙인다
 *
 * "참가를 희망하는 시·군은 참가 신청서와 선수 명단을 2026. 10. 23.(금)까지 공문으로 제출하여 주시기 바랍니다."
 *   → "참가 신청서와 선수 명단을 공문으로 제출" (기한 2026-10-23)
 */

import { dateAtStart, labeledDue, stripUntil, untilDates } from './dates.js';

export interface Found {
  text: string;
  due?: string;
  /** 문서 안 줄 번호·항목(1. 2. …) 번호 — 따로 적힌 기한을 가까운 요청에 붙일 때 */
  line: number;
  item: number;
}

export interface Deadline {
  label: string;
  due: string;
  line: number;
  item: number;
}

/** 문단 첫머리 항목 기호 (1. 가. (1) ① ○ - □ ※ …) */
export const MARKER = /^(?:\d{1,2}[.)](?!\d)|[가-하][.)]|\(\d{1,2}\)|\([가-하]\)|[①-⑳]|[○ㅇ◦●□■▪◆◇▶▷☞※*·•-])\s*/;

/** 줄마다 몇 번째 항목(1. 2. …) 안에 있는지 */
export function itemIndex(lines: string[]): number[] {
  let item = 0;
  return lines.map((l) => (/^\d{1,2}\.\s/.test(l) ? ++item : item));
}

/** 요청 끝맺음 걷기: "제출하여 주시기 바랍니다" → "제출", "회신 바람" → "회신", "알려 주시기 바랍니다" → "알려 주기" */
function stripEnding(s: string): string {
  return s
    .replace(/\s*(?:하여|해|하여서)\s*주(?:시기|시길)를?\s*(?:바랍니다|부탁드립니다)\.?$/, '')
    .replace(/\s*하(?:시기|시길|기)를?\s*(?:바랍니다|바람|부탁드립니다)\.?$/, '')
    .replace(/\s*(?:하여|해)\s*주십시오\.?$/, '')
    .replace(/\s*주(?:시기|시길)를?\s*(?:바랍니다|부탁드립니다)\.?$|\s*주십시오\.?$/, ' 주기')
    .replace(/\s*(?:을|를)?\s*(?:바랍니다|바람|요망|부탁드립니다)\.?$/, '')
    .replace(/\s*할\s*것\.?$/, '')
    .replace(/\s*(?:을|를)?\s*요청\s?(?:합니다|드립니다)\.?$/, ' 요청');
}

/** 할 일이 아닌 "바랍니다" (참고하시기·유의하시기·문의하시기·만전을 기하여 …) */
const CHORE = /(?:참고|참조|유의|양해|문의|숙지|기원|감사|노력|활용|표시|이해)$/;
export function isChore(sentence: string): boolean {
  const last = stripEnding(sentence).trim().split(/\s+/).pop() ?? '';
  return CHORE.test(last) || last === '기' || last === '다';
}

/** 앞 절을 가르는 말: 이유·배경(…하오니·…하니·…므로) 뒤가 할 일이다 */
const CLAUSE = /(?:오니|으니|하니|이니|므로|는바|인바|주시고|주시며)\s*,?\s+/g;
/** 약한 가름(…예정으로, …이며,): 뒤가 넉 낱말 넘게 남을 때만 */
const SOFT_CLAUSE = /(?:으로|이며|이고),\s+/g;
/** 조사·어미로 끝나는 낱말 (목적어 앞 꾸밈말을 모을 때 멈출 자리). 한 글자 조사는 세 글자 넘는 낱말에만 —
 *  결과·신청자·결과보고·자연재해처럼 그 글자로 끝나는 명사가 흔한 과·자·고·해·여·도는 넣지 않는다 */
const STOP = /(?:다|요|에서|으로|부터|까지|하고|되고|있고|없고|고자|하여|하며|하는|으니|하니|오니|이니|있어|없어|되어|해서|위해|같이|따라|관련|대해|통해)$/;
const STOP1 = /[며게께는은을를이가에의와만어아]$/;
const isStop = (w: string) => !/^[가-힣A-Za-z0-9·()「」『』[\]]+$/.test(w) || STOP.test(w) || (w.length >= 3 && STOP1.test(w));

/** 앞 절의 마지막 목적어(…을/…를)와 그 앞 꾸밈 명사: "아래와 같이 착수보고회(자문회의)를 개최하고자 하오니" → "착수보고회(자문회의)".
 *  목적어가 없으면 이유 절 동사 앞 명사: "지출요청 하오니" · "배정요청하오니" → "지출요청" · "배정요청" */
function objectPhrase(clause: string): string | undefined {
  const words = clause.trim().replace(/[\s,]+$/, '').split(/\s+/);
  let i = words.length - 1;
  while (i >= 0 && !/[을를]$/.test(words[i])) i--;
  let head: string;
  if (i >= 0) head = words[i].replace(/[을를]$/, '');
  else {
    const verb = words[words.length - 1].replace(/(?:하오니|이오니|오니|하니|으니|이니|하므로|므로)$/, '');
    i = verb ? words.length - 1 : words.length - 2;
    head = verb || words[i] || '';
    // "제출 하오니 처리"처럼 동사 명사 하나뿐이면 뜻이 없어 원문을 둔다
    if (head.length <= 2 || isStop(head)) return undefined;
  }
  const out = [head];
  for (let j = i - 1; j >= 0 && out.length < 5 && !isStop(words[j]); j--) out.unshift(words[j]);
  return out.join(' ');
}

/** 마지막 가름 자리에서 앞 절·뒤 할 일로 */
function splitLast(t: string, re: RegExp): { head: string; rest: string } | undefined {
  let at = -1;
  for (const m of t.matchAll(re)) at = (m.index ?? 0) + m[0].length;
  return at > 0 && t.slice(at).trim() ? { head: t.slice(0, at), rest: t.slice(at).trim() } : undefined;
}

const wordCount = (s: string) => s.split(/\s+/).length;

/** 뒤에 남은 말이 뭉뚱그린 요청뿐인가 ("적극 협조", "처리") — 그러면 앞 절의 목적어가 할 일이다 */
const GENERIC = /^(?:적극(?:적으로)?\s+)?(?:협조|협력|처리|조치|검토|승인)$/;

/** 이유·배경 절 걷기. 뒤에 한 낱말(참석·협조…)만 남으면 앞 절의 목적어를 붙인다 */
function cutClause(t: string): string {
  const soft = splitLast(t, SOFT_CLAUSE);
  if (soft && wordCount(soft.rest) >= 5) t = soft.rest;
  const hard = splitLast(t, CLAUSE);
  if (!hard) return t;
  if (wordCount(hard.rest) >= 2 && !GENERIC.test(hard.rest)) return hard.rest;
  const obj = objectPhrase(hard.head);
  return obj ? `${obj} ${hard.rest.replace(/^적극(?:적으로)?\s+/, '')}` : t;
}

/** "…는/은" 앞말(누가 하는지) 걷기: "참가를 희망하는 시·군은 참가 신청서와 …" → "참가 신청서와 …" */
const ADNOMINAL = /(?:하는|되는|있는|없는|않는|받는|드리는|주는|오는|가는|이는|라는|다는|또는|혹은|같은|많은|높은|받은|남은)$/;
function dropTopic(t: string): string {
  const words = t.split(/\s+/);
  let cut = -1;
  for (let i = 0; i < Math.min(words.length - 1, 6); i++) {
    if (/(?:은|는)$/.test(words[i]) && !ADNOMINAL.test(words[i])) { cut = i; break; }
  }
  if (cut < 0) return t;
  const rest = words.slice(cut + 1);
  if (rest.length >= 2) return rest.join(' ');
  // 남은 말이 한 낱말이면 "결과는 제출" → "결과 제출" (…에서는·…께서는 같은 자리말은 그대로)
  const w = words[cut];
  return /(?:에서|께서|에게|으로|로)(?:은|는)$/.test(w) ? t : [...words.slice(0, cut), w.replace(/(?:은|는)$/, ''), ...rest].join(' ');
}

/** 요청 문장 → 할 일 한 줄 (항목 기호·기한·끝맺음·배경 절·주어 걷기) */
export function requestText(sentence: string): string {
  let t = stripUntil(sentence).trim();
  while (MARKER.test(t)) t = t.replace(MARKER, '').trim();
  t = t
    .replace(/^(?:그리고|아울러|또한|이에|따라서|한편)\s*,?\s*/, '')
    .replace(/(?:위\s?호와|위와|이와)\s*관련(?:하여)?\s*,?\s*/g, '')
    .replace(/(?:다음|아래|붙임|별첨|위)(?:과|와)\s*같이\s*/g, '');
  t = stripEnding(t).replace(/[\s,.]+$/, '');
  t = dropTopic(cutClause(t));
  t = t.replace(/\s+/g, ' ').replace(/\s+([,.)])/g, '$1').replace(/^[\s,]+|[\s,]+$/g, '');
  return t.length > 160 ? `${t.slice(0, 159)}…` : t;
}

/** 표의 기한 칸 — 머리줄 "…기한" 칸 아래 값, 또는 "| 제출기한 | 날짜 |" */
function tableDeadlines(lines: string[], ref: string, items: number[]): Deadline[] {
  const out: Deadline[] = [];
  const LABEL = /기\s*한|마\s*감/;
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith('|')) continue;
    const start = i;
    const rows: string[][] = [];
    for (; i < lines.length && lines[i].startsWith('|'); i++) {
      const cells = lines[i].replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      if (!cells.every((c) => c === '' || /^:?-{2,}:?$/.test(c))) rows.push(cells);
    }
    const add = (label: string, cell?: string) => {
      const due = cell ? dateAtStart(cell, ref) : undefined;
      if (due) out.push({ label: label.replace(/\s+/g, ''), due, line: start, item: items[start] ?? 0 });
    };
    rows[0]?.forEach((h, j) => { if (LABEL.test(h)) rows.slice(1).forEach((r) => add(h, r[j])); });
    rows.forEach((r) => r.forEach((c, j) => { if (LABEL.test(c)) add(c, r[j + 1]); }));
  }
  return out;
}

/** 요청 문장 밖에 따로 적힌 기한: "가. 제출기한: 2026. 10. 23." 줄, 표의 기한 칸, 제목의 "(10. 23.까지)" */
export function looseDeadlines(lines: string[], ref: string, title?: string): Deadline[] {
  const items = itemIndex(lines);
  const out = tableDeadlines(lines, ref, items);
  lines.forEach((l, i) => {
    if (l.startsWith('|')) return;
    const d = labeledDue(l, ref);
    if (d) out.push({ label: `${d.label} 기한`.trim(), due: d.due, line: i, item: items[i] });
  });
  const t = title ? untilDates(title, ref)[0] : undefined;
  if (title && t) out.push({ label: stripUntil(title).replace(/[\s(]*\)?\s*$/, '').trim() || title, due: t, line: 0, item: 0 });
  return out;
}

/** 따로 적힌 기한을 기한 없는 요청에 붙인다(같은 항목 안 앞쪽 → 같은 항목 → 가장 가까운 것). 붙일 곳이 없으면 기한만으로 한 줄.
 *  결과: 기한 있는 것 먼저(이른 순), 그다음 문서 순서 */
export function mergeDeadlines(found: Found[], deadlines: Deadline[]): Array<{ text: string; due?: string }> {
  const reqs = found.filter((f) => f.text).map((f) => ({ ...f }));
  const nearest = (list: Found[], line: number) => [...list].sort((a, b) => Math.abs(a.line - line) - Math.abs(b.line - line))[0];
  for (const d of [...deadlines].sort((a, b) => a.line - b.line)) {
    if (reqs.some((r) => r.due === d.due)) continue;
    const open = reqs.filter((r) => !r.due);
    const target = nearest(open.filter((r) => r.item === d.item && r.line <= d.line), d.line)
      ?? nearest(open.filter((r) => r.item === d.item), d.line)
      ?? nearest(open, d.line);
    if (target) target.due = d.due;
    else reqs.push({ text: d.label, due: d.due, line: d.line, item: d.item });
  }
  const seen = new Set<string>();
  return reqs
    .filter((r) => !seen.has(r.text) && Boolean(seen.add(r.text)))
    .sort((a, b) => (a.due && b.due ? a.due.localeCompare(b.due) || a.line - b.line : a.due ? -1 : b.due ? 1 : a.line - b.line))
    .map((r) => (r.due ? { text: r.text, due: r.due } : { text: r.text }));
}
