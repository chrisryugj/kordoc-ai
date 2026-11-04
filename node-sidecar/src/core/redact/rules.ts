/** 가리기 규칙 — kordoc 규칙 + kordoc 주소 규칙이 놓치는 주소 꼴
 *
 * kordoc 주소 규칙은 "가온시 시청로 12 (중앙동)" 은 잡지만 "가온시 한빛로 123, 101동 1004호"·"가온시 중앙동 123-4" 같은
 * 도로명·지번 + 동·호 꼴을 놓친다. 시·군·구 이름 뒤에 오는 도로명(…로·…길 + 건물번호)·지번(…동·읍·면·리·가 + 번지)과
 * 뒤따르는 동·호·괄호 참고항목을 더 찾는다. kordoc 처럼 시·도·시·군·구 이름은 남기고 그 뒤를 같은 길이로 가린다.
 * redactText·redactMarkdown 과 같은 모양으로 돌려줘 부르는 곳은 이름만 바꿔 쓴다.
 */

import { redactMarkdown as kordocMarkdown, redactText as kordocText, type RedactHit, type RedactRule } from 'kordoc';

interface Opts { rules?: readonly RedactRule[]; maskChar?: string }

const SIGUNGU = '[가-힣]{1,10}(?:특별자치시|특별자치도|특별시|광역시|도|시|군|구)';
const ROAD = '[가-힣0-9]{1,15}(?:로|길)(?:\\s*\\d{1,4}번?길)?\\s*\\d{1,5}(?:-\\d{1,5})?';
const LOT = '[가-힣0-9]{1,10}(?:동|읍|면|리|가)\\s*\\d{1,5}(?:-\\d{1,5})?(?:번지)?';
const DETAIL = '(?:\\s*,?\\s*(?:[가-힣A-Za-z0-9]{1,15}\\s+)?\\d{1,4}동)?(?:\\s*\\d{1,5}호)?(?:\\s*\\([가-힣0-9,·\\s]{1,20}\\))?';
const ADDRESS = new RegExp(`((?:${SIGUNGU}\\s+){1,3})((?:${ROAD}|${LOT})${DETAIL})`, 'g');

/** 띄어쓰기·쉼표·괄호는 두고 나머지를 가림 글자로 (kordoc 주소 가림과 같은 모양) */
const maskOf = (s: string, maskChar: string) => s.replace(/[^\s,()]/g, maskChar);

/** kordoc 이 놓친 주소 (도로명·지번 + 동·호). 시·군·구 이름 뒤부터 */
export function extraAddressHits(text: string, maskChar = '●'): RedactHit[] {
  const out: RedactHit[] = [];
  for (const m of text.matchAll(ADDRESS)) {
    const index = m.index! + m[1].length;
    out.push({ rule: 'address', index, length: m[2].length, masked: maskOf(m[2], maskChar) });
  }
  return out;
}

const overlaps = (a: RedactHit, b: RedactHit) => a.index < b.index + b.length && b.index < a.index + a.length;

function withAddress(text: string, base: { text: string; hits: RedactHit[] }, opts: Opts) {
  if (!(opts.rules ?? []).includes('address')) return base;
  const more = extraAddressHits(text, opts.maskChar || '●').filter((h) => !base.hits.some((b) => overlaps(b, h)));
  if (!more.length) return base;
  let masked = base.text;
  for (const h of more) masked = masked.slice(0, h.index) + h.masked + masked.slice(h.index + h.length);
  return { ...base, text: masked, hits: [...base.hits, ...more].sort((a, b) => a.index - b.index) };
}

export function redactText(text: string, opts: Opts = {}): ReturnType<typeof kordocText> {
  return withAddress(text, kordocText(text, opts), opts) as ReturnType<typeof kordocText>;
}

export function redactMarkdown(markdown: string, opts: Opts = {}): ReturnType<typeof kordocMarkdown> {
  return withAddress(markdown, kordocMarkdown(markdown, opts), opts) as ReturnType<typeof kordocMarkdown>;
}

/** kordoc 주소 규칙이 못 잡는 주소만 (같은 글에서 kordoc 이 잡은 곳과 겹치면 뺀다) */
export function missedAddressHits(text: string, maskChar = '●'): RedactHit[] {
  const base = kordocMarkdown(text, { rules: ['address'], maskChar }).hits;
  return extraAddressHits(text, maskChar).filter((h) => !base.some((b) => overlaps(b, h)));
}
