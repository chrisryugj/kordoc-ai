/** 긴 글 줄이기 (map-reduce) — 예산보다 긴 글을 조각별 요점으로 줄이고, 요점도 넘치면 한 번 더 줄인다
 *
 * 요약·한 장 보고·회의록처럼 "전체를 다 봐야 하는" 일에 쓴다. 특정 내용만 찾으면 되는 일은 selectPassages(검색)가 싸다.
 */

import { ask, contextCharBudget } from '../../infra/llm/index.js';
import { sendProgress } from '../../infra/progress.js';
import { splitByBudget } from './docs.js';
import { FIDELITY_RULES } from './prompts.js';

const NOTE_TOKENS = 700;
/** 첫 바퀴에 읽는 조각 상한. 내장 모델(문맥 8천 토큰)로 300쪽 편람을 다 읽으면 40번 넘게 묻고 CPU 에서 몇 시간 걸린다 */
const MAX_PIECES = 8;

/** 조각이 너무 많으면 처음과 끝을 넣어 고르게 고른다 */
function spread<T>(items: T[], n: number): T[] {
  if (items.length <= n) return items;
  return Array.from({ length: n }, (_, i) => items[Math.round((i * (items.length - 1)) / (n - 1))]);
}

const SYSTEM = [
  '당신은 긴 한국어 문서를 빠짐없이 요점으로 줄이는 정리 담당입니다.',
  FIDELITY_RULES,
  '- 불릿(-)으로만 쓰고, 머리말·맺음말은 쓰지 마세요.',
].join('\n');

/** text 가 budgetChars 를 넘으면 요점으로 줄여 돌려준다. focus = 무엇을 중심으로 남길지 (예: "결정 사항과 할 일").
 *  partial = 너무 길어 일부 조각만 읽었을 때 (읽은 수·전체 수) */
export async function condense(
  text: string,
  budgetChars: number,
  signal: AbortSignal,
  focus = '핵심 내용, 숫자·날짜·고유명사, 결정·요청 사항',
): Promise<{ text: string; redacted: number; partial?: { read: number; total: number } }> {
  let redacted = 0;
  let cur = text;
  let partial: { read: number; total: number } | undefined;
  const pieceBudget = Math.max(1500, (await contextCharBudget({ reserveTokens: NOTE_TOKENS, signal })) - SYSTEM.length - 300);
  for (let round = 0; round < 3 && cur.length > budgetChars; round++) {
    let pieces = splitByBudget(cur, pieceBudget);
    if (round === 0 && pieces.length > MAX_PIECES) {
      partial = { read: MAX_PIECES, total: pieces.length };
      pieces = spread(pieces, MAX_PIECES);
    }
    const notes: string[] = [];
    for (let i = 0; i < pieces.length; i++) {
      signal.throwIfAborted();
      sendProgress({ current: i, total: pieces.length, message: `긴 글 나눠 읽는 중 (${i + 1}/${pieces.length})` });
      const r = await ask({
        system: SYSTEM,
        messages: [{ role: 'user', content: `다음은 긴 문서의 ${i + 1}/${pieces.length} 부분입니다. ${focus}을(를) 중심으로 요점만 불릿으로 정리하세요.\n\n---\n\n${pieces[i]}` }],
        maxTokens: NOTE_TOKENS,
        signal,
        stream: false,
      });
      redacted += r.redacted;
      notes.push(r.text.trim());
    }
    cur = notes.join('\n\n');
  }
  if (cur.length > budgetChars) cur = cur.slice(0, budgetChars);
  return { text: cur, redacted, ...(partial ? { partial } : {}) };
}
