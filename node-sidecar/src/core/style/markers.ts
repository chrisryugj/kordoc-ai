/** 항목 기호 읽기 — 문단 앞 기호(□ ○ - · / 1. 가. 1) 가) …)를 갈래로 나누고, 나온 차례로 단계(깊이)를 정한다
 *
 * 단계는 기호 모양이 아니라 문서 안 차례로 정한다(쌓기): 처음 보는 기호는 한 단계 아래, 이미 본 기호로 돌아오면 그 단계.
 * 그래서 ○ 로 시작하는 보고서도, 1. 아래 ○ 를 쓰는 기안문도 같은 방법으로 단계가 잡힌다.
 */

export type MarkerFamily = 'report' | 'legal' | 'ref' | 'chapter' | 'bullet';

export interface Marker {
  /** 갈래 열쇠 (같은 열쇠 = 같은 단계 후보). 예: '□' '○' 'ㅇ' '-' 'ㆍ' '1.' '가.' '1)' */
  key: string;
  family: MarkerFamily;
  /** 기호와 뒤 공백을 뺀 글 */
  rest: string;
  /** 원문 기호 그대로 */
  glyph: string;
}

const SPACE = '[\\s\\u3000\\u00a0]';
const RULES: Array<{ re: RegExp; key: (m: RegExpExecArray) => string; family: MarkerFamily }> = [
  { re: new RegExp(`^([□■❏❑◻▢▣◼])${SPACE}*`), key: () => '□', family: 'report' },
  // 동그라미 갈래(○ ㅇ ◦ ❍)는 한 단계로 본다. 어느 모양을 썼는지는 glyph 로 (bullet2)
  { re: new RegExp(`^([○◯●◦❍])${SPACE}*`), key: () => '○', family: 'report' },
  { re: new RegExp(`^(ㅇ)${SPACE}+`), key: () => '○', family: 'report' },
  { re: new RegExp(`^([-－―ㅡ–—])${SPACE}+`), key: () => '-', family: 'report' },
  { re: new RegExp(`^([·ㆍ∙•‧⋅])${SPACE}*`), key: () => 'ㆍ', family: 'report' },
  { re: new RegExp(`^([▸▶►▷])${SPACE}*`), key: () => '▸', family: 'report' },
  { re: new RegExp(`^(※)${SPACE}*`), key: () => '※', family: 'ref' },
  // "* 참고" 는 별 뒤에 띄어쓰기가 있어야 (마크다운 굵게 "**글**" 와 가르기)
  { re: new RegExp(`^(\\*{1,2})${SPACE}+`), key: () => '※', family: 'ref' },
  { re: new RegExp(`^([❶-❿➊-➓])${SPACE}*`), key: () => '❶', family: 'report' },
  { re: new RegExp(`^([ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]+\\.?)${SPACE}*`), key: () => 'Ⅰ', family: 'chapter' },
  { re: new RegExp(`^(\\d{1,2}\\.)(?=${SPACE}|$)${SPACE}*`), key: () => '1.', family: 'legal' },
  { re: new RegExp(`^([가-하]\\.)(?=${SPACE})${SPACE}*`), key: () => '가.', family: 'legal' },
  { re: new RegExp(`^(\\d{1,2}\\))${SPACE}*`), key: () => '1)', family: 'legal' },
  { re: new RegExp(`^([가-하]\\))${SPACE}*`), key: () => '가)', family: 'legal' },
  { re: new RegExp(`^(\\(\\d{1,2}\\))${SPACE}*`), key: () => '(1)', family: 'legal' },
  { re: new RegExp(`^(\\([가-하]\\))${SPACE}*`), key: () => '(가)', family: 'legal' },
  { re: new RegExp(`^([①-⑳])${SPACE}*`), key: () => '①', family: 'legal' },
  { re: new RegExp(`^([㉮-㉻])${SPACE}*`), key: () => '㉮', family: 'legal' },
];

/** "11. 20(금) 14:00" · "10. 23일까지" · "10. 23 ~ 10. 25" 처럼 일 뒤에 점 없이 쓴 날짜인가 (앞의 "11." 은 월이지 항목 번호가 아니다).
 *  "2. 3일간 교육" · "1. 3~5명 선발" · "2. 2026년 추진 계획" 은 항목이다 */
function dateTail(glyph: string, rest: string): boolean {
  const month = Number(glyph.replace('.', ''));
  const m = /^\s*(\d{1,2})\s*(\(\s*[월화수목금토일]\s*\)|일\s*(?:까지|부터|자(?![가-힣])|에(?![가-힣])|\(|,|[~∼～]|\d{1,2}\s*[:시])|[~∼～]\s*\d{1,2}\s*\.)/.exec(rest);
  return !!m && month >= 1 && month <= 12 && Number(m[1]) >= 1 && Number(m[1]) <= 31;
}

/** 문단 글 앞의 항목 기호. 없으면 null.
 *  inList: 이 문단의 번호가 앞 항목 번호를 잇는다(1. 2. 3. 의 차례). "2. 15일까지 제출" 은 글만으로는 2월 15일인지 2번 항목인지 알 수 없어,
 *  차례를 이으면 항목으로, 아니면 날짜로 본다 (부르는 쪽이 문서 흐름을 알 때만 준다) */
export function readMarker(text: string, opts: { inList?: boolean } = {}): Marker | null {
  const t = text.replace(/^[\s　 ]+/, '');
  for (const r of RULES) {
    const m = r.re.exec(t);
    if (!m) continue;
    const rest = t.slice(m[0].length);
    // "1." 뒤에 글이 없거나 날짜("6. 26.(금)" · "10. 23.까지")처럼 숫자와 점이 이어지면 항목이 아니다.
    // 숫자로 시작한다고 다 빼면 "2. 2026년 추진 계획" · "가. 1분기: 준비" · "1) 3개 부서" 가 항목이 아니게 되어 앞 항목에 한 줄로 붙는다
    if (r.family === 'legal' && (!rest.trim() || (/^\d{1,2}\.$/.test(m[1].trim()) && (/^\s*\d{1,4}\s*\.(?!\d)/.test(rest) || (!opts.inList && dateTail(m[1], rest)))))) continue;
    // 지역번호("02) 450-7114")는 항목 번호가 아니다. 연도 범위("1) 2025-2026 겨울철 대책")는 전화번호가 아니다
    if (/^\d{1,2}\)$/.test(m[1]) && /^\d{3,4}\s*-\s*\d{4}(?!\d)/.test(rest) && !/^(?:19|20)\d{2}\s*-\s*(?:19|20)\d{2}(?!\d)/.test(rest)) continue;
    if (r.family !== 'ref' && !rest.trim()) continue;
    // "□ 예  ■ 아니오" 같은 고르는 칸은 항목이 아니다
    if (m[1].match(/[□■❏❑◻▢▣◼☐☑]/) && /[□■☐☑▣◼]/.test(rest)) return null;
    return { key: r.key(m), family: r.family, rest, glyph: m[1] };
  }
  return null;
}

/** 기호 차례 쌓기 — 기호 열쇠마다 단계(0부터)를 돌려준다. ref·chapter 는 단계 밖 (null) */
export class DepthStack {
  private stack: string[] = [];

  depthOf(key: string): number {
    const at = this.stack.indexOf(key);
    if (at >= 0) {
      this.stack.length = at + 1;
      return at;
    }
    this.stack.push(key);
    return this.stack.length - 1;
  }

  /** 장(Ⅰ.)·제목이 나오면 처음부터 다시 */
  reset(): void {
    this.stack = [];
  }
}

/** 법정 8단계 기호 (단계 순서) */
export const LEGAL_ORDER = ['1.', '가.', '1)', '가)', '(1)', '(가)', '①', '㉮'];
/** 보고서 기호 (2단계는 bullet2 로 고른다) */
export const REPORT_ORDER = ['□', '○', '-', 'ㆍ'];
export const BULLET2 = ['ㅇ', '○', '◦', '❍'] as const;
