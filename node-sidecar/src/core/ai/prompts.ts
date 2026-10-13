/** AI 공통 문구·후처리 — 모든 AI 기능이 같은 원칙을 따르게 한 곳에 둔다 */

import { getSettings } from '../../infra/config.js';
import { overlapRatio } from './bm25.js';

/** 원문 충실 원칙 (시스템 지시에 붙임) */
export const FIDELITY_RULES = [
  '- 한국어로 쓰세요.',
  '- 날짜·숫자·금액·고유명사·법령 이름은 원문 그대로 옮기세요. 바꾸거나 반올림하거나 형식을 고치지 마세요.',
  '- 원문에 없는 사실을 지어내거나 추측해 덧붙이지 마세요. 모르면 모른다고 쓰세요.',
].join('\n');

/** 사용자에게 바로 보일 글의 군더더기 걷기 — 전체를 감싼 코드펜스·따옴표, "요청하신 …입니다" 같은 머리말·작업 꼬리말.
 *  source(원문)를 주면 원문에 있던 문장과 많이 겹치는 줄은 머리말·꼬리말처럼 보여도 지우지 않는다(고쳐 쓰기에서 사용자 글 보호) */
export function cleanOutput(text: string, source = ''): string {
  const fromSource = (line: string) => Boolean(source) && overlapRatio(line, source) >= 0.5;
  const stripHead = (t: string) => {
    // 머리말: 작업을 가리키는 낱말이 있는 첫 줄, 또는 "다음은/아래는 …:" 첫 줄만 (# 제목 줄·원문 문장은 남김)
    const m = t.match(/^(?!#)(?:네[,.!]?\s*)?[^\n]{0,30}(?:요청하신|다듬은|고친|수정한|바꾼|작성한|정리한|변환한|옮긴|초안)[^\n]{0,30}(?:입니다|드립니다|같습니다)[.!:：]?[ \t]*\n+/)
      ?? t.match(/^(?!#)(?:네[,.!]?\s*)?(?:다음은|아래는)[^\n]{0,40}[:：][ \t]*\n+/);
    return m && !fromSource(m[0]) ? t.slice(m[0].length) : t;
  };
  let t = stripHead(text.replace(/\r\n/g, '\n').trim());
  const fence = t.match(/^```[\w-]*\n([\s\S]*?)\n?```$/);
  if (fence) t = stripHead(fence[1].trim());
  // 꼬리말: 빈 줄 뒤 "수정이 필요하면 말씀해 주세요" 같은 작업 안내만 (공문의 "…알려 주시기 바랍니다"는 남김)
  const tail = t.match(/\n\s*\n(?:-{3,}\n+)?([^\n]{0,40}(?:수정|추가|다듬|고쳐|바꿔)[^\n]{0,30}(?:말씀해|알려)\s?주세요[.!]?)\s*$/);
  if (tail && !fromSource(tail[1])) t = t.slice(0, tail.index);
  const q = t.match(/^["“'‘「]([\s\S]*)["”'’」]$/);
  if (q && !/["“”]/.test(q[1])) t = q[1].trim();
  return t.trim();
}

/** 줄 첫머리 날짜("2026. 10. 5.", "2026.")는 CommonMark 순서 목록으로 읽혀 kordoc 이 "1. 5." 같은 번호 문단을 만든다.
 *  첫 마침표를 이스케이프(2026\. 10. 5.)한다 — 앞 공백·인용 ">"·목록 기호("- ", "1. ") 뒤 포함.
 *  단 첫 "# 제목" 바로 뒤 인용문(보고서·계획서·개조식·방침서 요약 상자)은 목록으로 읽지 않고 이스케이프가 글자로 남아 그대로 둔다. */
export function escapeLineDates(md: string): string {
  let seenTitle = false;
  let summary = false;
  return md.split('\n').map((line) => {
    if (!seenTitle && /^#\s/.test(line)) { seenTitle = true; summary = true; return line; }
    if (summary) {
      if (!line.trim() || /^\s*>/.test(line)) return line;
      summary = false;
    }
    return line.replace(/^(\s*(?:>\s*)*(?:(?:[-*+]|\d{1,9}[.)])\s+)?)(\d{4})\.(?=\s|$)/, '$1$2\\.');
  }).join('\n');
}

/** 지시에 사용자가 직접 적은 문서번호(체육진흥과-2203) — 있으면 관련 줄을 바로잡지 않는다. 전화번호(031-123)는 아님 */
export const DOC_NO = /[가-힣][가-힣A-Za-z0-9·]*-\d+/;

const HEAD_TITLE = '(?:장관|지사|청장|시장|군수|구청장|교육감|이사장|위원장|원장|총장|사장|소장|장)';

/** 맨 윗줄 행정기관명과 같은 이름의 발신명의(가온도 → 가온도지사, 광진구 → 광진구청장) — 둘 다 있을 때만 (제목 줄을 기관으로 오인하지 않게) */
function senderOf(text: string): { agency: string; sender: string } | undefined {
  const first = text.split('\n').find((l) => l.trim())?.replace(/^#+\s*/, '').trim() ?? '';
  if (!/^[가-힣]{2,20}$/.test(first)) return undefined;
  const m = new RegExp(`${first}\\s?${HEAD_TITLE}(?![가-힣])`).exec(text);
  return m ? { agency: first, sender: m[0].replace(/\s/g, '') } : undefined;
}

export interface ReceivedRef {
  /** 체육진흥과-2203 */
  number: string;
  /** 관련 줄에 쓸 꼴: 가온도 체육진흥과-2203(2026. 10. 2.) */
  ref: string;
  /** 처리과: 체육진흥과 */
  dept: string;
  /** 회신의 수신: 가온도지사(체육진흥과장) — 발신명의를 못 찾으면 없음 */
  recipient?: string;
}

/** 결문 "시행 부서-번호 (시행일)" — 시행일 괄호는 없거나 비어 있을 수 있고("시행 감사관-8697 접수"), 옛 서식은 "시 행"·"시행:",
 *  처리과명은 "119대응과"·"경상북도교육청 의성안전체험관"·"신비전·신사업 추진 TF" 처럼 숫자로 시작하거나 띄어 쓴 것도 있고,
 *  번호는 "부서-2026-5648" 처럼 여러 마디일 수 있다. 시행일이 괄호 없이 "2026.09.30." 로만 적힌 것도 있다. 본문에도 "시행" 이 나오므로 마지막 것을 쓴다 */
const SIHAENG = /시\s?행(?:\s*[:：]\s*|\s+)(\d*[가-힣][가-힣A-Za-z0-9·]*(?:[ \t][가-힣A-Za-z][가-힣A-Za-z0-9·]*){0,3}(?:\s?-\s?\d+)+)(?:\s*\(\s*([^)]*?)\s*\)|[ \t]+(\d{4}\.\s?\d{1,2}\.\s?\d{1,2}\.?))?/g;

/** 받은 공문 자기 번호 — 끝부분 "시행 부서-번호 (시행일)" 줄(없으면 "| 문서번호 | … |" 칸) + 기관명·발신명의.
 *  공문 본문의 "1. 관련:" 은 그 공문이 근거로 든 이전 문서, "수신"은 우리 기관이라 회신에 옮기면 틀린다(소형 모델이 자주 베낀다). */
export function receivedDocRef(text: string): ReceivedRef | undefined {
  const m = [...text.matchAll(SIHAENG)].pop() ?? text.match(/\|\s*문서번호\s*\|\s*([가-힣A-Za-z0-9·]+-\d+)\s*\|/);
  if (!m) return undefined;
  const s = senderOf(text);
  const number = m[1].replace(/\s*-\s*/g, '-');
  const date = (m[2] ?? m[3] ?? '').trim();
  const dept = number.replace(/(?:-\d+)+$/, '');
  return { number, ref: `${s ? `${s.agency} ` : ''}${number}${date ? `(${date})` : ''}`, dept, ...(s ? { recipient: `${s.sender}(${dept}장)` } : {}) };
}

/** "1. 관련:" 줄이 받은 공문이 아닌 번호를 가리키면 받은 공문 번호로 바로잡는다 */
export function fixRelatedLine(text: string, received: ReceivedRef): string {
  return text.replace(/^(\s*1\.\s*관련\s*[:：]\s*)(.*)$/m, (line, head: string, rest: string) => (rest.includes(received.number) ? line : `${head}${received.ref}`));
}

/** 회신의 "수신" 줄(수신자 줄 아님)이 받은 공문을 보낸 부서를 가리키지 않으면 [회신 받을 곳]으로 바로잡는다 */
export function fixRecipientLine(text: string, received: ReceivedRef): string {
  if (!received.recipient) return text;
  return text.replace(/^(\s*수신(?!자)\s*[:：]?\s*)(.*)$/m, (line, head: string, rest: string) => (rest.includes(received.dept) ? line : `${head}${received.recipient}`));
}

// 인사 관용구만: "귀 기관의 무궁한 발전을 기원합니다(드립니다)." 문장이나 "…기원하며, " 앞 구절 (귀·여러분·무궁한 으로 시작).
// "시민 건강과 안전을 기원하고" 처럼 관용구가 아닌 본문 속 '기원'은 건드리지 않는다
const GREETING = /(?:귀\s?[가-힣]{0,4}|여러분|무궁한)[^.,\n]{0,30}?(?:발전|번영|건승|평안|건강)[^.\n]{0,15}?(?:기원|축원)(?:합니다|드립니다|하며|하오며|하고)[.,]?\s*/;
/** "…주시기 바라며 귀 기관의 … 기원합니다." 는 요청 문장을 살려 "…주시기 바랍니다." 로 */
const ASK_THEN_GREETING = /바라며,?\s*(?:귀\s?[가-힣]{0,4}|여러분|무궁한)[^.\n]*?(?:기원|축원)(?:합니다|드립니다)\.?/;

/** 지시에 없는 안부·축원 인사 걷기 — 문장만 지우고, 항목 전체가 인사면 들여 쓴 다음 줄을 끌어올리거나 항목을 빼고 번호를 당긴다 */
export function dropGreeting(text: string): string {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    lines[i] = lines[i].replace(ASK_THEN_GREETING, '바랍니다.');
    if (!GREETING.test(lines[i])) continue;
    const item = lines[i].match(/^(\s*)(\d{1,2})\.\s+(.*)$/);
    const rest = (item ? item[3] : lines[i]).replace(GREETING, '').trim();
    if (rest) { lines[i] = item ? `${item[1]}${item[2]}. ${rest}` : lines[i].replace(GREETING, ''); continue; }
    if (!item) { lines.splice(i--, 1); continue; }
    const next = lines[i + 1];
    if (next !== undefined && /^\s+\S/.test(next) && !/^\s*(?:\d{1,2}|[가-하])\.\s/.test(next)) {
      lines[i] = `${item[1]}${item[2]}. ${next.trim()}`;
      lines.splice(i + 1, 1);
      continue;
    }
    lines.splice(i, 1);
    for (let j = i; j < lines.length && !/^\s*(?:#|붙임)/.test(lines[j]); j++) {
      const n = lines[j].match(/^(\s*)(\d{1,2})\.(\s.*)$/);
      if (n && n[1] === item[1]) lines[j] = `${n[1]}${Number(n[2]) - 1}.${n[3]}`;
    }
    i--;
  }
  return lines.join('\n');
}

/** 공문서 날짜 표기 (2026. 10. 10.) */
export function todayText(d = new Date()): string {
  return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.`;
}

/** 내 기관 정보를 사람이 읽는 줄로 (빈 칸은 뺌). 개인정보가 섞이니 system 이 아닌 messages 로 보낼 것 */
export function orgContext(): string {
  const o = getSettings().org;
  if (!o) return '';
  const rows: Array<[string, string]> = [
    ['기관명', o.name], ['부서', o.dept], ['직위', o.position], ['담당자', o.person],
    ['전화', o.phone], ['팩스', o.fax], ['전자우편', o.email], ['주소', o.address], ['누리집', o.homepage],
  ];
  return rows.filter(([, v]) => v && v.trim()).map(([k, v]) => `${k}: ${v.trim()}`).join('\n');
}

/** 글자 수를 대략의 토큰 수로 (답변 길이 상한 잡을 때) */
export function tokensFor(chars: number): number {
  return Math.ceil(chars / 1.2);
}
