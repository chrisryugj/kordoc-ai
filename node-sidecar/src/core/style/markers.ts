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

/** 문단 글 앞의 항목 기호. 없으면 null */
export function readMarker(text: string): Marker | null {
  const t = text.replace(/^[\s　 ]+/, '');
  for (const r of RULES) {
    const m = r.re.exec(t);
    if (!m) continue;
    const rest = t.slice(m[0].length);
    // "1." 뒤에 글이 없거나 날짜·금액("2026. 6.")처럼 숫자가 이어지면 항목이 아니다
    if (r.family === 'legal' && (!rest.trim() || /^\d/.test(rest))) continue;
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
