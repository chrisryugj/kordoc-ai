/** 가리기 규칙 — kordoc 규칙 + kordoc 주소 규칙이 놓치는 주소 꼴
 *
 * kordoc 주소 규칙은 "가온시 시청로 12 (중앙동)" 은 잡지만 "가온시 한빛로 123, 101동 1004호"·"가온시 중앙동 123-4" 같은
 * 도로명·지번 + 동·호 꼴을 놓친다. 시·군·구 이름 뒤에 오는 도로명(…로·…길 + 건물번호)·지번(…동·읍·면·리·가 + 번지)과
 * 뒤따르는 동·호·괄호 참고항목을 더 찾는다. kordoc 처럼 시·도·시·군·구 이름은 남기고 그 뒤를 같은 길이로 가린다.
 * redactText·redactMarkdown 과 같은 모양으로 돌려줘 부르는 곳은 이름만 바꿔 쓴다.
 */

import { redactMarkdown as kordocMarkdown, redactText as kordocText, type RedactHit, type RedactRule } from 'kordoc';

interface Opts { rules?: readonly RedactRule[]; maskChar?: string }

// 평범한 행정 문장을 주소로 잡지 않게 좁힌다. 넓게 잡으면 "2026년도 추가 3명"·"광진구 평가 2회"·"필요시 추가로 10일" 같은 글의
// 낱말과 숫자가 가려져, 외부 AI 로 보내는 글과 가린 사본의 뜻이 달라진다 (그런데도 결과는 정상처럼 보인다):
//  - 맨 앞 행정구역 이름은 앞이 글자·숫자가 아니고 두 글자 이상 (…년도·…명도 같은 꼴을 뺀다). 둘째부터는 한 글자도(중구·동구)
//  - 번지 뒤에 세는 말(명·건·회·일·만…)이 오면 주소가 아니다
//  - 도로명 꼴은 "…으로 N"(조사)과 흔한 부사(추가로·별도로…)를 뺀다
//  - 지번 꼴은 번지가 분명할 때만: "-숫자"·"번지"가 붙었거나 뒤에 동·호가 따라올 때
const FIRST = '(?<![가-힣0-9])[가-힣]{2,5}(?:특별자치시|특별자치도|특별시|광역시|도|시|군|구)';
const NEXT = '[가-힣]{1,5}(?:시|군|구)';
const COUNTED = '(?!\\d)(?!\\s*(?:명|건|개|회|일|년|월|주|시간|분|초|%|퍼센트|위|차|단계|억|만|천|백|원|배|점|세|살|장|쪽|매|권|부|대|곳|종|가지|차례|번째|평|톤))';
const NOT_ADVERB = '(?!(?:추가|별도|실제|대체|임의|강제|수시|자체|일부|전부|일괄|개별|각자|단계|순서|차례|기준|평균|최대|최소|합계|총계|서면|우편|구두|전화|직접|별지|그대|스스|절대|상대|대대적으|새|따|주|바)로\\s*\\d)';
const ROAD = `${NOT_ADVERB}[가-힣0-9]{2,15}(?<!으)(?:로|길)(?:\\s*\\d{1,4}번?길)?\\s*\\d{1,5}(?:-\\d{1,5})?${COUNTED}`;
const UNIT_HO = '(?:\\s*,?\\s*(?:[가-힣A-Za-z0-9]{1,15}\\s+)?\\d{1,4}동|\\s*\\d{1,5}호)';
const LOT = `[가-힣0-9]{1,10}(?:동|읍|면|리|가)\\s*\\d{1,5}(?:-\\d{1,5}(?:번지)?(?!\\d)|번지|(?!\\d)(?=${UNIT_HO}))`;
const DETAIL = '(?:\\s*,?\\s*(?:[가-힣A-Za-z0-9]{1,15}\\s+)?\\d{1,4}동)?(?:\\s*\\d{1,5}호)?(?:\\s*\\([가-힣0-9,·\\s]{1,20}\\))?';
const ADDRESS = new RegExp(`(${FIRST}\\s+(?:${NEXT}\\s+){0,2})((?:${ROAD}|${LOT})${DETAIL})`, 'g');

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

/** 글자 읽기(OCR)는 기호 앞뒤를 띄워 읽곤 한다 ("hong @ gaon.example"·"900101 - 1234567"). 그대로 두면 전자우편·번호 규칙이
 *  걸리지 않아 스캔본·양식 칸의 개인정보가 "0곳"으로 나간다 → @ 앞뒤, 숫자 사이 줄표 앞뒤의 띄어쓰기를 뺀 글. at[i] 는 읽은 글에서의 자리 */
export function tighten(text: string): { text: string; at: number[] } {
  let out = '';
  const at: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === ' ' || text[i] === '\t') {
      let j = i;
      while (text[j] === ' ' || text[j] === '\t') j++;
      const prev = out.at(-1) ?? '';
      const next = text[j] ?? '';
      const joins = prev === '@' || next === '@'
        || (next === '-' && /\d/.test(prev))
        || (prev === '-' && /\d/.test(next) && /\d/.test(out.at(-2) ?? ''));
      if (joins) { i = j - 1; continue; }
    }
    out += text[i];
    at.push(i);
  }
  return { text: out, at };
}

/** 글자 읽기로 얻은 글에서 걸린 곳 수 — 읽은 그대로와 기호 앞뒤 띄어쓰기를 뺀 글 가운데 많은 쪽 */
export function countRead(markdown: string, rules: readonly RedactRule[], keep: (s: string) => boolean): number {
  const count = (s: string) => redactMarkdown(s, { rules }).hits.filter((h) => !keep(s.slice(h.index, h.index + h.length))).length;
  const tight = tighten(markdown).text;
  return tight.length === markdown.length ? count(markdown) : Math.max(count(markdown), count(tight));
}

/** kordoc 주소 규칙이 못 잡는 주소만 (같은 글에서 kordoc 이 잡은 곳과 겹치면 뺀다) */
export function missedAddressHits(text: string, maskChar = '●'): RedactHit[] {
  const base = kordocMarkdown(text, { rules: ['address'], maskChar }).hits;
  return extraAddressHits(text, maskChar).filter((h) => !base.some((b) => overlaps(b, h)));
}
