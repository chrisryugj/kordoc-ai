/** 조문 구조 — 법제처 조문단위 JSON(조문내용·항[]·호[]·목[])을 항·호·목 번호가 붙은 모양으로, 인용한 항·호·목 찾기
 *
 * 실측 모양(DRF lawService target=law·eflaw 같음):
 * - 항: [{ 항번호: '①', 항내용, 호: [...] }] 또는 객체 하나. 항으로 나뉘지 않은 조문(제2조 정의 등)은 항번호 없는 { 호: [...] } 하나
 * - 호: { 호번호: '1.' | '1의2.', 호내용, 목: [...] }, 목: { 목번호: '가.', 목내용 }
 * - 내용은 문자열이거나 문자열 배열(표·줄 나눔). 개정 표시 <개정 2020.2.4>·[본조신설 …] 는 뺀다
 */

type Obj = Record<string, unknown>;

export interface SubInfo { no: string; text: string }
export interface ItemInfo { no: string; text: string; subs?: SubInfo[] }
/** no 0 = 번호 없는 항 (항으로 나뉘지 않은 조문의 몸) */
export interface ParaInfo { no: number; text: string; items?: ItemInfo[] }

export interface ArticleInfo {
  title?: string;
  /** 앞부분 (머리 "제N조(제목)"·개정 표시 뺌) */
  text: string;
  deleted?: boolean;
  /** 조문내용에서 머리를 뺀 첫 문장 (항이 없는 조문은 이것이 몸) */
  lead?: string;
  paras?: ParaInfo[];
}

const PREVIEW = 160;
/** 항·호·목 한 칸 글 상한 (캐시가 끝없이 커지지 않게) */
const PIECE = 600;

export const list = (v: unknown): Obj[] => (Array.isArray(v) ? v : v && typeof v === 'object' ? [v] : []) as Obj[];
export const str = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');

function flatten(v: unknown): string {
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map(flatten).filter(Boolean).join(' ');
  return '';
}

/** 개정 표시·태그·HTML 엔티티를 걷고 공백을 한 칸으로. "삭제 <2023.3.14>" 의 날짜는 남긴다 */
export function clean(s: string): string {
  return s
    .replace(/<(?:개정|신설|전문개정|제목개정|타법개정)[^>]*>/g, '')
    .replace(/\[(?:본조신설|전문개정|제목개정|종전|시행일)[^\]]*\]/g, '')
    .replace(/<\/?[A-Za-z][^>]*>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

const cut = (s: string, n = PIECE) => (s.length > n ? `${s.slice(0, n).trimEnd()}…` : s);

/** ① → 1 (⑳ 넘어 ㉑~㊿ 까지), 숫자 글자도 */
export function circled(s: string): number {
  const c = s.trim().codePointAt(0) ?? 0;
  if (c >= 0x2460 && c <= 0x2473) return c - 0x2460 + 1;
  if (c >= 0x3251 && c <= 0x325f) return c - 0x3251 + 21;
  if (c >= 0x32b1 && c <= 0x32bf) return c - 0x32b1 + 36;
  const d = /^\d+/.exec(s.trim());
  return d ? Number(d[0]) : 0;
}

const CIRCLED_HEAD = /^[①-⑳㉑-㉟㊱-㊿]/;
/** "1." · "1의2." · "제1호" → "1" · "1의2" */
const itemNo = (s: string) => {
  const m = /(\d+)\s*(?:의\s*(\d+))?/.exec(s);
  return m ? (m[2] ? `${Number(m[1])}의${Number(m[2])}` : String(Number(m[1]))) : '';
};
const subNo = (s: string) => /[가-힣]/.exec(s)?.[0] ?? '';

/** 조문단위 하나 → 구조 */
export function parseArticle(u: Obj): ArticleInfo {
  const lead = clean(flatten(u['조문내용']).replace(/^\s*제\s?\d+\s?조(?:\s?의\s?\d+)?\s*(?:\([^)]*\))?/, ''));
  const paras: ParaInfo[] = [];
  for (const h of list(u['항'])) {
    const text = clean(flatten(h['항내용']));
    const no = circled(str(h['항번호'])) || (CIRCLED_HEAD.test(text) ? circled(text) : 0);
    const items: ItemInfo[] = [];
    for (const ho of list(h['호'])) {
      const t = clean(flatten(ho['호내용']));
      const subs: SubInfo[] = list(ho['목']).map((mk) => {
        const mt = clean(flatten(mk['목내용']));
        return { no: subNo(str(mk['목번호']) || mt), text: cut(mt) };
      }).filter((x) => x.no);
      items.push({ no: itemNo(str(ho['호번호']) || t), text: cut(t), ...(subs.length ? { subs } : {}) });
    }
    paras.push({ no, text: cut(text), ...(items.length ? { items } : {}) });
  }
  const body = [lead, ...paras.flatMap((p) => [p.text, ...(p.items ?? []).flatMap((i) => [i.text, ...(i.subs ?? []).map((s) => s.text)])])].filter(Boolean).join(' ');
  const title = str(u['조문제목']);
  return {
    ...(title ? { title } : {}),
    text: cut(body, PREVIEW),
    ...(/^삭제/.test(body) ? { deleted: true } : {}),
    ...(lead ? { lead: cut(lead) } : {}),
    ...(paras.length ? { paras } : {}),
  };
}

/** 조 전체 글 (줄마다 항·호·목) */
export function articleFull(a: ArticleInfo, max = 1500): string {
  const lines = [a.lead ?? '', ...(a.paras ?? []).flatMap((p) => [p.text, ...(p.items ?? []).flatMap((i) => [i.text, ...(i.subs ?? []).map((s) => s.text)])])].filter(Boolean);
  return cut(lines.join('\n'), max);
}

export interface Level { paragraph?: number; item?: string; subitem?: string }

export interface LevelHit {
  /** 인용한 항·호·목의 글 (항이면 딸린 호까지, 호면 딸린 목까지). 항·호를 인용하지 않았으면 조 전체 */
  text?: string;
  /** 없는 단계와 쉬운 설명 */
  missing?: 'paragraph' | 'item' | 'subitem';
  deleted?: boolean;
  reason?: string;
}

/** 받침 따라 조사 (숫자는 읽는 소리로: 1·3·6·7·8·0 은 받침 있음) */
export function josa(word: string, withJong: string, without: string): string {
  const ch = word[word.length - 1] ?? '';
  let jong: boolean;
  if (/\d/.test(ch)) jong = '013678'.includes(ch);
  else {
    const c = ch.charCodeAt(0) - 0xac00;
    jong = c >= 0 && c < 11172 && c % 28 !== 0;
  }
  return `${word}${jong ? withJong : without}`;
}

/** 으로/로 (ㄹ 받침·받침 없음은 로) */
export function ro(word: string): string {
  const c = (word[word.length - 1] ?? '').charCodeAt(0) - 0xac00;
  const jong = c >= 0 && c < 11172 ? c % 28 : 0;
  return `${word}${jong && jong !== 8 ? '으로' : '로'}`;
}

const itemLabel = (no: string) => (no.includes('의') ? `제${no.replace('의', '호의')}` : `제${no}호`);
const isDeleted = (t: string) => /^(?:[①-⑳㉑-㉟㊱-㊿]|\d+(?:의\d+)?\.|[가-힣]\.)?\s*삭제/.test(t);

/** 조 안에서 인용한 항·호·목 찾기. art 는 "제17조" 꼴 이름 */
export function findLevel(a: ArticleInfo, lv: Level, art: string): LevelHit {
  if (!lv.paragraph && !lv.item) return { text: articleFull(a) };
  const paras = a.paras ?? [];
  let scope: ParaInfo[] = paras;
  let where = art;
  let paraText: string | undefined;
  if (lv.paragraph) {
    const numbered = paras.filter((p) => p.no > 0);
    const p = numbered.length ? numbered.find((x) => x.no === lv.paragraph) : lv.paragraph === 1 ? (paras[0] ?? { no: 0, text: a.lead ?? '' }) : undefined;
    if (!p) {
      const n = numbered.length ? Math.max(...numbered.map((x) => x.no)) : 0;
      return { missing: 'paragraph', reason: n ? `${art}에 제${lv.paragraph}항이 없습니다. ${josa(art, '은', '는')} 제${n}항까지 있습니다.` : `${art}에 제${lv.paragraph}항이 없습니다. 항으로 나뉘지 않은 조문입니다.` };
    }
    if (isDeleted(p.text)) return { missing: 'paragraph', deleted: true, text: p.text, reason: `${art}제${lv.paragraph}항은 삭제된 항입니다(${p.text.replace(/^\S*\s*/, '')}).` };
    scope = [p];
    where = `${art}제${lv.paragraph}항`;
    paraText = [p.no ? p.text : a.lead ?? p.text, ...(p.items ?? []).map((i) => i.text)].filter(Boolean).join('\n');
    if (!lv.item) return { text: cut(paraText, 1200) };
  }
  const items = scope.flatMap((p) => p.items ?? []);
  const it = items.find((i) => i.no === lv.item);
  if (!it) {
    const last = items[items.length - 1]?.no;
    return { missing: 'item', reason: last ? `${where}에 ${josa(itemLabel(lv.item!), '이', '가')} 없습니다. ${itemLabel(last)}까지 있습니다.` : `${where}에 ${josa(itemLabel(lv.item!), '이', '가')} 없습니다. 호로 나뉘지 않았습니다.` };
  }
  const itemWhere = `${where}${itemLabel(it.no)}`;
  if (isDeleted(it.text)) return { missing: 'item', deleted: true, text: it.text, reason: `${josa(itemWhere, '은', '는')} 삭제된 호입니다.` };
  if (!lv.subitem) return { text: cut([it.text, ...(it.subs ?? []).map((s) => s.text)].join('\n'), 1200) };
  const sub = it.subs?.find((s) => s.no === lv.subitem);
  if (!sub) return { missing: 'subitem', reason: it.subs?.length ? `${itemWhere}에 ${lv.subitem}목이 없습니다.` : `${itemWhere}에 ${lv.subitem}목이 없습니다. 목으로 나뉘지 않았습니다.` };
  if (isDeleted(sub.text)) return { missing: 'subitem', deleted: true, text: sub.text, reason: `${itemWhere}${lv.subitem}목은 삭제된 목입니다.` };
  return { text: sub.text };
}
