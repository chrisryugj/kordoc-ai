/** 받은 공문 읽기 — 글에서 보낸 곳·문서번호·시행일·제목·요청 사항과 기한을 뽑는다 (AI 없이, 공문 서식 규칙으로)
 *
 * - 문서번호·기관: AI 회신 초안과 같은 규칙(receivedDocRef: 끝부분 "시행 부서-번호 (시행일)" 줄 + 발신명의).
 *   기관명을 못 찾으면 두문(수신 줄 바로 위 행정기관명) → 발신명의(끝. 아래 "…장") → 짧은 첫 줄.
 * - 요청: 요청 말(제출·회신·보고·참석…)이 든 "~주시기 바랍니다/바람" 문장, 기한("~까지")이 붙은 요청 문장,
 *   "~까지 … 제출" 꼴 개조식 줄. 하나도 없으면 "협조하여 주시기 바랍니다" 같은 일반 요청 문장.
 * - 기한: "~까지"가 붙은 날짜, "제출기한: 날짜" 줄, 표의 "기한" 칸, 제목의 "(10. 23.까지)".
 *   행사 "일시"처럼 까지·기한이 없는 날짜는 기한이 아니다.
 */

import { receivedDocRef } from '../ai/prompts.js';
import { dateAtStart, todayIso, untilDates } from './dates.js';
import { isChore, itemIndex, looseDeadlines, MARKER, mergeDeadlines, requestText, type Found } from './requests.js';

export interface Extracted {
  sender?: string;
  doc_number?: string;
  sent_date?: string;
  title?: string;
  requests: Array<{ text: string; due?: string }>;
}

/** 마크다운 → 읽기 좋은 줄: 이스케이프·강조·그림·제목 표지를 걷고 HTML 표는 "| 칸 | 칸 |" 줄로 */
export function cleanLines(md: string): string[] {
  const rows = md.replace(/<table[\s\S]*?<\/table>/gi, (t) => (t.match(/<tr[\s\S]*?<\/tr>/gi) ?? [])
    .map((tr) => `| ${(tr.match(/<t[hd][^>]*>[\s\S]*?<\/t[hd]>/gi) ?? []).map((c) => c.replace(/<[^>]+>/g, ' ').trim()).join(' | ')} |`)
    .join('\n'));
  return rows
    .replace(/\r\n?/g, '\n')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/?(?:u|b|i|em|strong|sup|sub|span|font|mark)\b[^>]*>/gi, '')
    .replace(/\*\*|__/g, '')
    .replace(/\\([\\`*_{}[\]()#+\-.!~|<>^])/g, '$1')
    .split('\n')
    .map((l) => l.replace(/^\s*#{1,6}\s+/, '').replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/[ \t ]+/g, ' ').trim())
    .filter((l) => l !== '');
}

/** 머리·끝 서식 줄 — 요청을 찾지 않고, 앞 줄에 이어 붙이지도 않는다 */
const HEADER = /^(?:수\s?신|\(경유\)|경\s?유(?:\s|$)|제\s?목|시\s?행\s+[가-힣A-Za-z0-9·]+-\d+|접\s?수\s*(?:\(|[가-힣A-Za-z0-9·]+-\d+)|붙\s?임\s*(?:\d+\.|[:：]|.*\d+\s*[부매권]\.)|우\s?\d|전화(?:번호)?\s*[\d(]|팩스(?:번호)?\s*[\d(]|기안자|검토자|협조자|결재권자)/;
const TERMINAL = /(?:[.。!?]["”’)]?|다)$/;
const HEAD_TITLE = /^[가-힣A-Za-z0-9·()\s]{1,30}?(?:장관|차관|지사|청장|시장|군수|구청장|교육감|이사장|위원장|원장|총장|사장|소장|의장|단장|센터장|본부장|국장|과장|대표이사|위원|장)$/;

/** 요청 문장 끝맺음 (바랍니다·바람·요망·주십시오·할 것) */
const ASK = /(?:바랍니다|바람|요망|주십시오|할\s*것)\.?$/;
/** 공식 요청 끝맺음 — 다른 요청이 없을 때만 쓴다 */
const FORMAL = /요청(?:합니다|드립니다)\.?$/;
/** 요청 말 — 이것이 든 요청 문장만 할 일로 친다 ("협조하여 주시기 바랍니다"만 있는 문장은 다른 요청이 없을 때만) */
const WANT = /제출|회신|회보|보고|참석|신청|작성|통보|송부|등록|입력|납부|제공|추천|지정|알려|보내|반납/;

interface Para {
  text: string;
  line: number;
  item: number;
}

/** 줄 → 문단. 문장이 안 끝난 줄은 다음 줄과 잇는다 (한컴 문단이 "붙임과 같이 / 제출합니다."로 갈라져 나오는 경우) */
function paragraphs(lines: string[]): Para[] {
  const items = itemIndex(lines);
  const out: Para[] = [];
  let open: Para | null = null;
  lines.forEach((line, i) => {
    if (line.startsWith('|')) { open = null; return; }
    const prev: Para | null = open;
    if (prev && !TERMINAL.test(prev.text) && prev.text.length >= 20 && !MARKER.test(line) && !HEADER.test(line) && !HEAD_TITLE.test(line) && !HEADER.test(prev.text)) {
      prev.text += ` ${line}`;
      return;
    }
    open = { text: line, line: i, item: items[i] };
    out.push(open);
  });
  return out;
}

/** 문단 → 문장 ("…바랍니다. 끝."은 두 문장) */
function sentences(text: string): string[] {
  return text.split(/(?<=(?:다|람|망|것|음|함|임|요|오)\.)\s+(?=\S)/).map((s) => s.trim()).filter(Boolean);
}

/** 수신 줄 바로 위의 행정기관명 (두문). 옛 서식은 머리 줄도 "수신자"라 제목 줄보다 앞의 수신 줄을 본다 */
function headAgency(lines: string[]): string | undefined {
  const title = lines.findIndex((l) => /^제\s?목/.test(l));
  const i = lines.findIndex((l, k) => /^수\s?신/.test(l) && (title < 0 ? !/^수\s?신자/.test(l) : k < title));
  const t = i > 0 ? lines[i - 1] : '';
  if (!t || MARKER.test(t) || HEADER.test(t)) return undefined;
  return /^[가-힣A-Za-z0-9·()\s]{2,30}$/.test(t) && /[가-힣]/.test(t) ? t : undefined;
}

/** 발신명의 — "끝." 아래의 "…장·…지사" 줄 */
function signer(lines: string[]): string | undefined {
  let end = -1;
  lines.forEach((l, i) => { if (/끝\.?$/.test(l)) end = i; });
  const from = end >= 0 ? end + 1 : Math.floor(lines.length * 0.6);
  return lines.slice(from, from + 6).find((l) => l.length <= 30 && HEAD_TITLE.test(l));
}

/** 짧은 첫 줄 (기관명처럼 생긴 것만) */
function firstLine(lines: string[]): string | undefined {
  const t = lines.find((l) => !l.startsWith('|'));
  return t && /^[가-힣A-Za-z·()\s]{2,20}$/.test(t) && !HEADER.test(t) ? t : undefined;
}

/** 제목 줄 → 없으면 제목처럼 생긴 첫 줄 (기관명·날짜 줄·항목 줄 빼고) */
function titleOf(lines: string[], agency?: string): string | undefined {
  for (const l of lines) {
    const m = /^제\s?목\s*[:：]?\s*(\S.*)$/.exec(l) ?? /^\|\s*제\s?목\s*\|\s*([^|]+?)\s*\|/.exec(l);
    if (m) return m[1].trim().slice(0, 120);
  }
  return lines.find((l) => !l.startsWith('|') && l !== agency && l.length >= 6 && l.length <= 80 && !MARKER.test(l) && !HEADER.test(l)
    && !/시점|배포|수\s?신|경\s?유/.test(l) && (l.match(/\d/g)?.length ?? 0) <= l.length * 0.2)?.slice(0, 120);
}

/** 기관·문서번호·시행일 */
function header(lines: string[], today: string): Pick<Extracted, 'sender' | 'doc_number' | 'sent_date'> {
  const ref = receivedDocRef(lines.join('\n'));
  const refAgency = ref ? ref.ref.slice(0, ref.ref.indexOf(ref.number)).trim() : '';
  const agency = refAgency || headAgency(lines);
  const sender = agency ?? signer(lines) ?? firstLine(lines);
  const sentRaw = ref ? /\(([^()]*)\)\s*$/.exec(ref.ref)?.[1] : undefined;
  const sent = sentRaw ? dateAtStart(sentRaw, today, true) : undefined;
  return {
    ...(sender ? { sender } : {}),
    ...(ref ? { doc_number: agency ? `${agency} ${ref.number}` : ref.number } : {}),
    ...(sent ? { sent_date: sent } : {}),
  };
}

/** 요청 문장 찾기 — found: 할 일 요청, general: "협조하여 주시기 바랍니다" 같은 일반 요청 */
function findRequests(lines: string[], ref: string): { found: Found[]; general: Found[] } {
  const found: Found[] = [];
  const general: Found[] = [];
  for (const p of paragraphs(lines)) {
    if (HEADER.test(p.text)) continue;
    for (const raw of sentences(p.text)) {
      // 끝의 "끝."과 끝맺음 뒤 괄호 덧말("…바랍니다.(향후 반영 검토)")은 뗀다
      const s = raw.replace(/\s*끝\.?$/, '').replace(/((?:바랍니다|바람|요망|주십시오)\.?)\s*\([^()]*\)$/, '$1').trim();
      if (!s) continue;
      const asks = ASK.test(s);
      const formal = !asks && FORMAL.test(s);
      if ((asks || formal) && isChore(s)) continue;
      const dues = untilDates(s, ref).sort();
      const entry = (): Found => ({ text: requestText(s), due: dues[0], line: p.line, item: p.item });
      if (asks && (WANT.test(s) || dues.length)) found.push(entry());
      else if (!asks && !formal && dues.length && WANT.test(s) && !/다\.?$/.test(s)) found.push(entry()); // 개조식 "~까지 … 제출"
      else if (asks || formal) general.push(entry());
    }
  }
  return { found, general };
}

/** 공문 글 → 뽑은 값. today(YYYY-MM-DD)는 시행일이 없을 때 연도 기준 */
export function extractInbox(markdown: string, today = todayIso()): Extracted {
  const lines = cleanLines(markdown);
  const head = header(lines, today);
  const title = titleOf(lines, head.sender);
  const ref = head.sent_date ?? today;
  const { found, general } = findRequests(lines, ref);
  const requests = mergeDeadlines(found.length ? found : general, looseDeadlines(lines, ref, title));
  return { ...head, ...(title ? { title } : {}), requests };
}
