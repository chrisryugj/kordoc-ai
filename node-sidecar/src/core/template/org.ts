/** 내 기관 정보로 서식 칸 채우기 (org_autofill) — 칸 이름 동의어 표 + 오늘 날짜(공문 표기) + 결재직위N */

import { getSettings } from '../../infra/config.js';
import type { Settings } from '../../types/index.js';

type Org = Settings['org'];

/** 공문 날짜 표기 "2026. 10. 10." */
export function gongmunDate(d = new Date()): string {
  return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.`;
}

const today = () => gongmunDate();

/** 발신명의 — 기관명으로 기관장 직함 (광진구 → 광진구청장, 경기도 → 경기도지사). 이미 "…장" 이면 그대로 */
export function headTitle(name: string): string {
  let n = name.trim();
  if (!n || /(장|지사|군수|교육감|장관|총장)$/.test(n)) return n;
  if (n.endsWith('교육지원청')) return `${n}교육장`;
  if (n.endsWith('교육청')) return `${n.slice(0, -1)}감`;
  if (n.endsWith('위원회')) return `${n.slice(0, -1)}장`;
  if (n.endsWith('대학교')) return `${n}총장`;
  // 청사 이름(수원시청·경기도청)은 기관 이름으로
  if (/(시|군|구|도)청$/.test(n)) n = n.slice(0, -1);
  if (n.endsWith('도')) return `${n}지사`;
  if (n.endsWith('구')) return `${n}청장`;
  if (n.endsWith('군')) return `${n}수`;
  // 중앙부처(행정안전부)만 장관. 본부·지부 같은 하부 조직은 장
  if (n.endsWith('부') && !/(본부|지부|분부)$/.test(n)) return `${n}장관`;
  return `${n}장`;
}

/** [동의어들, 값] — 비교는 공백·괄호를 뺀 소문자 *//** [동의어들, 값] — 비교는 공백·괄호를 뺀 소문자 */
const SYNONYMS: Array<[string[], (o: Org) => string]> = [
  [['기관명', '행정기관명', '기관', '기관이름', '소속기관', '작성기관'], (o) => o.name],
  [['발신명의', '기관장', '발신기관장'], (o) => headTitle(o.name)],
  [['부서', '부서명', '담당부서', '소속부서', '처리과', '처리과명'], (o) => o.dept],
  [['기안자', '작성자'], (o) => [o.position, o.person].filter(Boolean).join(' ')],
  [['담당자', '담당자명', '담당', '담당자성명'], (o) => o.person],
  [['직위', '직급', '직위직급'], (o) => o.position],
  [['전화', '전화번호', '담당자전화번호', '연락처', '담당자연락처', 'tel'], (o) => o.phone],
  [['팩스', '팩스번호', 'fax', '전송'], (o) => o.fax],
  [['이메일', '전자우편', 'email', 'e-mail', '메일', '공무원의전자우편주소'], (o) => o.email],
  [['주소', '도로명주소', '기관주소'], (o) => o.address],
  [['홈페이지', '홈페이지주소', '누리집'], (o) => o.homepage],
  [['시행일', '작성일', '작성일자', '기안일', '보도일시', '등록일', '일자', '날짜'], () => today()],
  [['문서번호', '시행번호', '생산등록번호'], (o) => o.doc_number_prefix],
];

const norm = (s: string) => s.replace(/[\s()[\]{}<>「」『』（）]/g, '').toLowerCase();

const LOOKUP = new Map<string, (o: Org) => string>();
for (const [names, get] of SYNONYMS) for (const n of names) LOOKUP.set(norm(n), get);

export function orgAutofill(fields: string[]): { values: Record<string, string>; matched: string[] } {
  const org = getSettings().org;
  const values: Record<string, string> = {};
  const matched: string[] = [];
  for (const field of fields) {
    const key = norm(field);
    const approval = /^결재직위(\d+)$/.exec(key);
    let value = '';
    if (approval) value = org.approval_line[Number(approval[1]) - 1] ?? '';
    else {
      // "전화번호(담당자)" 처럼 괄호 안 설명이 붙은 칸도 괄호째 뺀 이름으로 한 번 더
      const get = LOOKUP.get(key) ?? LOOKUP.get(norm(field.replace(/[(（[].*?[)）\]]/g, '')));
      value = get ? get(org).trim() : '';
    }
    if (value) {
      values[field] = value;
      matched.push(field);
    }
  }
  return { values, matched };
}
