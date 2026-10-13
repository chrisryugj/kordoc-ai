/** 인용 문장과 조문 내용 맞춰 보기 — AI 없이 낱말 겹침, AI 가 있으면 맞음·확인 필요·안 맞음과 한 문장 이유
 *
 * 조문 글은 늘 법제처 원문(drf)이다. AI 는 판단과 이유만 내고, 이유에 든 조문 낱말은 원문에 실제로 있는 것만 남긴다.
 */

import type { LawMatch } from '../../types/rpc-contract.js';
import { ask, parseJsonLoose, type JsonSchema } from '../../infra/llm/index.js';
import { logger } from '../../infra/logger.js';

/** 인용 문장 상한 (글자) */
const SENTENCE_MAX = 240;

/** 문장 끝: 한글 뒤 마침표(다. 함. 임.) + 공백·줄끝. "2026. 3. 2." 같은 날짜 점은 숫자 뒤라 끝이 아니다 */
const SENT_END = /[가-힣)]\.(?=\s|$)|[!?](?=\s|$)/g;

/** 인용 [start,end) 이 든 문장. 내용 낱말이 모자라면(근거: 「…」 제N조 같은 줄) 다음 문장까지 */
export function citingSentence(text: string, start: number, end: number, cites: string[] = []): string {
  const lineStart = text.lastIndexOf('\n', start - 1) + 1;
  let lineEnd = text.indexOf('\n', end);
  if (lineEnd < 0) lineEnd = text.length;
  const line = text.slice(lineStart, lineEnd);
  const at = start - lineStart;
  const to = end - lineStart;
  let s0 = 0;
  let s1 = line.length;
  for (const m of line.matchAll(SENT_END)) {
    const e = m.index + m[0].length;
    if (e <= at) s0 = e;
    else if (m.index >= to) { s1 = e; break; }
  }
  let out = tidy(line.slice(s0, s1));
  if (contentWords(out, cites).length < 3) {
    // 다음 문장: 같은 줄의 나머지, 없으면 다음 빈 줄 아닌 줄
    let rest = tidy(line.slice(s1));
    if (!rest) {
      const next = text.slice(lineEnd + 1).split('\n').map(tidy).find(Boolean);
      rest = next ?? '';
    }
    if (rest) {
      const m = /^.*?[가-힣)]\.(?=\s|$)/.exec(rest);
      out = `${out} ${m ? m[0] : rest}`.trim();
    }
  }
  if (out.length > SENTENCE_MAX) {
    const c = out.indexOf(text.slice(start, end).replace(/\s+/g, ' ').trim());
    const from = Math.max(0, Math.min(c - 60, out.length - SENTENCE_MAX));
    out = `${from > 0 ? '…' : ''}${out.slice(from, from + SENTENCE_MAX).trim()}…`;
  }
  return out;
}

/** 표 칸 구분·항목 기호·꾸밈표를 걷고 공백 한 칸 */
function tidy(s: string): string {
  return s.replace(/\|/g, ' ').replace(/[*#>`]+/g, ' ').replace(/^\s*(?:\d{1,2}\.|[가-하]\.|\(\d{1,2}\)|[-•○□■◦▪]|[①-⑳])\s+/, '').replace(/\s+/g, ' ').trim();
}

// ── 낱말 ──

/** 끝의 조사·어미 (긴 것부터). 떼고 남은 글이 두 글자 이상일 때만 뗀다 */
const TAIL = /(?:하였습니다|했습니다|합니다|입니다|됩니다|습니다|으로써|으로서|에서는|에게는|으로는|하여야|되어야|하도록|하므로|하였다|한다는|이라도|에서|에게|으로|부터|까지|에는|에도|이나|이며|이고|이다|하여|하고|하며|하는|하게|하기|한다|하면|해야|된다|되는|되어|되며|된|할|한|함|와|과|을|를|은|는|이|가|의|에|로|도|만|임|며)$/;
/** 어디에나 나와 내용을 가리지 못하는 말 */
const STOP = new Set([
  '따라', '따른', '의한', '의하여', '위하여', '위한', '관한', '관하여', '대한', '대하여', '경우', '다음', '해당', '관련', '사항', '규정', '법률', '법령', '조문',
  '바랍니다', '주시기', '있습니다', '합니다', '없습니다', '있다', '없다', '아래', '위와', '같이', '같은', '각호', '어느', '하나', '이하', '이상', '이내', '또는',
  '그리고', '다만', '이에', '아울러', '해당하는', '해당되는', '이를', '그밖에', '등의', '등을', '등은', '귀하', '기관', '협조', '요청', '알려', '드립니다', '이법', '이영',
  '시행령', '시행규칙', '근거', '관계', '참고', '붙임', '안내', '동법', '같은법', '받은', '받아', '받는', '받을', '있는', '없는', '하는', '되는', '경우에도',
]);

function stem(w: string): string {
  let x = w;
  for (let i = 0; i < 2; i++) {
    const m = TAIL.exec(x);
    if (!m || x.length - m[0].length < 2) break;
    x = x.slice(0, -m[0].length);
  }
  return x;
}

/** 내용 낱말 — 한글·영문·숫자 덩이를 조사·어미를 떼고, 두 글자 이상, 흔한 말·조문 번호 빼고. cites(인용 글) 안 낱말은 뺀다 */
export function contentWords(s: string, cites: string[] = []): string[] {
  let t = s;
  for (const c of cites) if (c) t = t.split(c).join(' ');
  t = t.replace(/[「『“][^」』”]{0,80}[」』”]/g, ' ').replace(/제\s?\d+\s?(?:조|항|호)(?:\s?의\s?\d+)?/g, ' ');
  const out: string[] = [];
  for (const raw of t.split(/[^가-힣A-Za-z0-9]+/)) {
    if (!raw || /^\d+$/.test(raw)) continue;
    const w = stem(raw);
    if (w.length < 2 || STOP.has(w) || STOP.has(raw)) continue;
    if (!out.includes(w)) out.push(w);
  }
  return out;
}

const squash = (s: string) => s.replace(/\s+/g, '');

/** 낱말 겹침. 문장 낱말이 셋 미만이면 비교하지 않는다(undefined) */
export function wordMatch(sentence: string, article: string, cites: string[]): LawMatch | undefined {
  const words = contentWords(sentence, cites);
  if (words.length < 3) return undefined;
  const body = squash(article);
  const overlap = words.filter((w) => body.includes(w) || (w.length >= 3 && body.includes(w.slice(0, -1))));
  const score = Math.round((overlap.length / words.length) * 100) / 100;
  const low = overlap.length < 2 && score < 0.15;
  return {
    verdict: low ? 'check' : 'match',
    by: 'words',
    score,
    overlap: overlap.slice(0, 8),
    reason: low
      ? overlap.length
        ? `인용 문장과 조문에 같은 낱말이 거의 없습니다(${overlap.join('·')}만 겹침). 이 조문이 맞는 근거인지 확인하세요.`
        : '인용 문장과 조문에 같은 낱말이 없습니다. 이 조문이 맞는 근거인지 확인하세요.'
      : `인용 문장과 조문에 같은 낱말이 있습니다(${overlap.slice(0, 5).join('·')}).`,
  };
}

// ── AI 판단 ──

const SYSTEM = [
  '당신은 공문서가 인용한 법령 조문이 그 문장의 근거로 맞는지 확인하는 검토자입니다.',
  '- 조문 글은 법제처 원문입니다. 조문에 없는 내용을 지어내거나 조문을 고쳐 쓰지 마세요.',
  '- verdict: match(문장이 말하는 일이 조문 내용과 맞음), check(관련은 있으나 근거로 부족하거나 애매함), mismatch(조문과 다른 일을 근거로 듦).',
  '- reason: 쉬운 한국어 합니다체 한 문장. 조문에 실제로 있는 낱말을 작은따옴표로 한두 개 인용하세요. 줄표(—, –)는 쓰지 마세요.',
  '- words: reason 에 인용한 조문 낱말 그대로.',
].join('\n');

const SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['match', 'check', 'mismatch'] },
    reason: { type: 'string' },
    words: { type: 'array', maxItems: 4, items: { type: 'string' } },
  },
  required: ['verdict', 'reason', 'words'],
  additionalProperties: false,
};

/** AI 에게 한 건 묻기 — 실패하면 undefined (낱말 겹침을 그대로 쓴다) */
export async function aiMatch(q: { sentence: string; cite: string; title?: string; article: string; signal?: AbortSignal }): Promise<LawMatch | undefined> {
  const article = q.article.length > 900 ? `${q.article.slice(0, 900)}…` : q.article;
  try {
    const r = await ask({
      system: SYSTEM,
      messages: [{
        role: 'user',
        content: `문서 문장: ${q.sentence}\n인용: ${q.cite}\n조문(법제처 원문)${q.title ? ` 제목 ${q.title}` : ''}:\n${article}\n\nverdict·reason·words 를 JSON 으로 답하세요.`,
      }],
      schema: SCHEMA,
      maxTokens: 300,
      signal: q.signal ?? new AbortController().signal,
      stream: false,
    });
    const j = parseJsonLoose<{ verdict?: unknown; reason?: unknown; words?: unknown }>(r.text);
    const verdict = j.verdict === 'match' || j.verdict === 'check' || j.verdict === 'mismatch' ? j.verdict : undefined;
    const reason = typeof j.reason === 'string' ? j.reason.replace(/\s*[—–]\s*/g, ': ').replace(/\s+/g, ' ').trim().slice(0, 200) : '';
    if (!verdict || !reason) return undefined;
    const body = squash(q.article);
    const words = (Array.isArray(j.words) ? j.words : []).filter((w): w is string => typeof w === 'string' && w.trim().length > 0 && body.includes(squash(w))).slice(0, 4);
    return { verdict, by: 'ai', reason, overlap: words };
  } catch (err) {
    q.signal?.throwIfAborted();
    logger.warn(`[law] AI 판단 실패: ${err instanceof Error ? err.message : err}`);
    return undefined;
  }
}
