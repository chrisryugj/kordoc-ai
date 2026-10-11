/** 문서와 대화 — 조각에 번호를 붙여 넣고 [n] 인용을 강제, 답의 [n] 을 근거(Citation)로 돌려준다
 *
 * 문서가 예산 안이면 통째로(번호만 붙여), 넘치면 BM25 로 질문과 가까운 조각만.
 * 소형 모델이 번호를 빼먹으면 답과 가장 많이 겹치는 조각을 근거로 단다(본문은 그대로).
 * 인용 검증(verify.ts): 문장마다 숫자·날짜·금액·비율이 그 문장이 단 조각 원문에 있는지 대조해 verified·mismatch·unsupported 로.
 */

import type { ChatMessage, Citation } from '../../types/rpc-contract.js';
import { ask, contextCharBudget } from '../../infra/llm/index.js';
import { sendProgress } from '../../infra/progress.js';
import { bm25Scores, tokenize } from './bm25.js';
import { loadDocs, passageLabel, selectPassages, type Passage } from './docs.js';
import { escapeLineDates, FIDELITY_RULES } from './prompts.js';
import { verifyCitations } from './verify.js';

const ANSWER_TOKENS = 1200;

const SYSTEM = [
  '당신은 사용자가 준 문서만 근거로 답하는 한국어 업무 도우미입니다.',
  '- 아래 [번호] 문서 조각에 있는 내용으로만 답하세요. 조각에 없으면 "문서에서 찾지 못했습니다"라고 답하세요.',
  '- 문장마다 근거 조각 번호를 [1], [2]처럼 문장 끝에 붙이세요. 번호는 조각에 붙은 번호만 쓰세요.',
  '- 숫자·날짜·금액·비율은 근거 조각에 적힌 값 그대로만 쓰세요. 더하거나 나누어 새 숫자를 만들지 말고, 조각에 없는 숫자는 쓰지 마세요. 답의 숫자는 조각 원문과 자동으로 대조됩니다.',
  FIDELITY_RULES,
  '- 질문에 바로 답하고, 필요하면 짧은 목록으로 정리하세요.',
].join('\n');

export interface ChatParams {
  paths: string[];
  question: string;
  history?: ChatMessage[];
}

/** 이전 대화는 최근 것부터 예산의 1/5 까지만 */
function trimHistory(history: ChatMessage[], maxChars: number): ChatMessage[] {
  const out: ChatMessage[] = [];
  let used = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    if (!m?.content?.trim() || (m.role !== 'user' && m.role !== 'assistant')) continue;
    if (used + m.content.length > maxChars) break;
    out.unshift({ role: m.role, content: m.content });
    used += m.content.length;
  }
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}

/** 조각에서 답 문장과 가장 많이 겹치는 줄을 발췌 (200자 안) */
function excerptFor(p: Passage, context: string): string {
  const want = new Set(tokenize(context));
  // 문장 끝에서 자르되 날짜(2026. 5. 20.)의 온점은 숫자 뒤라 자르지 않는다
  const all = p.text.split(/\n|(?<=[^\d\s][.!?。])\s+/).map((l) => l.trim()).filter(Boolean);
  // 제목 줄(## …)만 발췌되면 쓸모가 없으니 본문 줄에서 고른다
  const body = all.filter((l) => !/^#{1,6}\s/.test(l));
  const lines = body.length ? body : all;
  let best = lines[0] ?? '';
  let bestScore = -1;
  for (const l of lines) {
    const toks = tokenize(l);
    const score = toks.filter((t) => want.has(t)).length / Math.sqrt(toks.length || 1);
    if (score > bestScore) { best = l; bestScore = score; }
  }
  return best.length > 200 ? `${best.slice(0, 200)}…` : best;
}

type RawCitation = Omit<Citation, 'verified' | 'mismatch'>;

/** 답에서 [n]·[n, m] 을 찾아 근거로. 없는 번호도 답에 남기고 path 가 빈 근거로 돌려준다(검증에서 verified false) */
export function extractCitations(answer: string, shown: Passage[]): { answer: string; citations: RawCitation[] } {
  const cited = new Map<number, string[]>();
  const clean = answer.replace(/\[(\d{1,3}(?:\s*[,，]\s*\d{1,3})*)\]/g, (_whole, list: string, offset: number) => {
    const nums = [...new Set(list.split(/[,，]/).map((x) => Number(x.trim())))].filter((n) => n >= 1);
    const ctx = answer.slice(Math.max(0, offset - 160), offset);
    for (const n of nums) cited.set(n, [...(cited.get(n) ?? []), ctx]);
    return nums.length ? `[${nums.join(', ')}]` : '';
  });
  const citations = [...cited.keys()].sort((a, b) => a - b).map((n) => {
    const p = shown[n - 1];
    if (!p) return { n, path: '', excerpt: '' };
    return { n, path: p.path, ...(p.page ? { page: p.page } : {}), ...(p.heading ? { heading: p.heading } : {}), excerpt: excerptFor(p, cited.get(n)!.join(' ')) };
  });
  return { answer: clean.replace(/[ \t]+\n/g, '\n').trim(), citations };
}

export async function chatWithDocs(params: ChatParams, signal: AbortSignal): Promise<{ answer: string; citations: Citation[]; redacted: number; unsupported?: string[] }> {
  const question = params.question?.trim();
  if (!question) throw new Error('질문을 입력하세요.');
  if (!params.paths?.length) throw new Error('대화할 문서를 하나 이상 고르세요.');

  const docs = await loadDocs(params.paths, signal);
  const budget = await contextCharBudget({ reserveTokens: ANSWER_TOKENS, signal });
  const history = trimHistory(params.history ?? [], Math.floor(budget / 5));
  const historyChars = history.reduce((s, m) => s + m.content.length, 0);
  const room = Math.max(1000, budget - SYSTEM.length - historyChars - question.length - 300);

  const all = docs.flatMap((d) => d.passages);
  const lastUser = history.filter((m) => m.role === 'user').at(-1)?.content ?? '';
  const { selected, whole } = selectPassages(all, `${question}\n${lastUser}`, room);
  if (!selected.length) throw new Error('문서에서 읽을 글이 없습니다.');

  const context = selected.map((p, i) => `${passageLabel(p, i + 1)}\n${p.text}`).join('\n\n');
  const scope = whole ? '문서 전체' : `문서에서 질문과 가까운 부분 ${selected.length}곳`;
  sendProgress({ current: 1, total: 2, message: 'AI가 답을 쓰는 중...' });
  const r = await ask({
    system: SYSTEM,
    messages: [
      ...history,
      { role: 'user', content: `[문서 조각: ${scope}]\n\n${context}\n\n[질문]\n${question}\n\n조각 번호를 [n] 형식으로 문장 끝에 붙여 답하세요.` },
    ],
    maxTokens: ANSWER_TOKENS,
    signal,
  });

  const extracted = extractCitations(r.text.trim(), selected);
  const answer = extracted.answer;
  let citations = extracted.citations;
  const fallback = !citations.length && Boolean(answer) && !/찾지 못했/.test(answer);
  if (fallback) {
    // 번호를 안 단 답 — 답과 가장 많이 겹치는 조각 최대 2개를 근거로
    const scores = bm25Scores(selected.map((p) => p.text), answer);
    citations = scores
      .map((s, i) => ({ s, i }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 2)
      .map(({ i }) => {
        const p = selected[i];
        return { n: i + 1, path: p.path, ...(p.page ? { page: p.page } : {}), ...(p.heading ? { heading: p.heading } : {}), excerpt: excerptFor(p, answer) };
      })
      .sort((a, b) => a.n - b.n);
  }
  const checked = verifyCitations(answer, selected, citations, fallback);
  sendProgress({ current: 2, total: 2, message: '답변 완료' });
  // 검증은 원문 표기로 하고, 돌려줄 때만 줄 첫머리 날짜를 이스케이프(마크다운 렌더에서 순서 목록이 되지 않게)
  return { answer: escapeLineDates(answer), citations: checked.citations, redacted: r.redacted, ...(checked.unsupported.length ? { unsupported: checked.unsupported } : {}) };
}
