/** K팀장 검토 (ai_review) — AI 가 논리·숫자·날짜·용어·오탈자·내부 참조를 보고, kordoc 표기법 검사 결과를 함께 돌려준다
 *
 * 긴 문서는 쪽 표시를 붙인 조각으로 나눠 차례로 검토한다(최대 MAX_PIECES 조각). JSON 은 스키마로 강제한다.
 */

import { lintGongmunText } from 'kordoc';
import type { LintFinding, ReviewIssue } from '../../types/rpc-contract.js';
import { ask, contextCharBudget, parseJsonLoose, type JsonSchema } from '../../infra/llm/index.js';
import { sendProgress } from '../../infra/progress.js';
import { logger } from '../../infra/logger.js';
import { loadDoc, type Passage } from '../ai/docs.js';
import { FIDELITY_RULES } from '../ai/prompts.js';

const CATEGORY_LABELS = {
  logic: '논리 구조',
  number: '숫자·금액',
  date: '날짜·기간',
  terminology: '용어 일관성',
  typo: '오탈자·맞춤법',
  reference: '내부 참조',
} as const;
type Category = keyof typeof CATEGORY_LABELS;

const SEVERITY = { error: 'error', warning: 'warning', suggestion: 'info' } as const;
const REVIEW_TOKENS = 1500;
const MAX_PIECES = 12;

const SYSTEM = [
  '당신은 한국어 공문서 교열·논리 검토 전문가 "K팀장"입니다. 문서를 꼼꼼히 읽고 문제를 찾습니다.',
  FIDELITY_RULES,
  '- 문서에 \'26년이라고 적혀 있으면 그대로 \'26년입니다. 현재 연도와 다르다고 오기로 판단하지 마세요.',
  '- 날짜·숫자의 "오류"는 문서 안에서 앞뒤가 어긋날 때만 지적하세요(예: 본문은 3월, 표는 4월). 외부 지식으로 틀렸다고 판단하지 마세요.',
  '- 확실한 문제만 지적하세요. 문제가 없으면 issues 를 빈 배열로 두고, "문제없음"을 설명하는 지적·같은 말을 되풀이하는 지적·취향 차이는 쓰지 마세요.',
  '- description 은 한두 문장으로 짧게 쓰세요.',
].join('\n');

const GUIDE = `검사 항목:
1. logic(논리 구조): 서술 흐름 단절, 근거 없는 주장, 결론과 본문 불일치, 항목 순서 문제
2. number(숫자·금액): 단위 불일치, 표 합계 오류, 금액 계산 오류, 백분율 불일치
3. date(날짜·기간): 문서 안의 날짜 형식 혼용, 기간 계산 오류, 앞뒤 날짜 불일치
4. terminology(용어 일관성): 같은 개념을 다른 말로 혼용, 띄어쓰기 불일치
5. typo(오탈자·맞춤법): 오타, 맞춤법·띄어쓰기 오류
6. reference(내부 참조): "제3조에 따라" 같은 조항 참조 오류, 붙임·각주 번호 불일치

심각도: error = 내용이 틀려 신뢰성에 영향(금액 오류·날짜 모순·논리 모순), warning = 표기 불일치·혼용, suggestion = 개선 권고.
location 에는 〔n쪽〕 표시와 위치(예: "3쪽 표 2 합계 행")를, original 에는 문제가 된 원문을 그대로 적으세요.`;

const SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    issues: {
      type: 'array',
      maxItems: 8,
      items: {
        type: 'object',
        properties: {
          category: { type: 'string', enum: Object.keys(CATEGORY_LABELS) },
          severity: { type: 'string', enum: ['error', 'warning', 'suggestion'] },
          location: { type: 'string' },
          description: { type: 'string' },
          original: { type: 'string' },
          suggestion: { type: 'string' },
        },
        required: ['category', 'severity', 'location', 'description', 'original', 'suggestion'],
        additionalProperties: false,
      },
    },
  },
  required: ['summary', 'issues'],
  additionalProperties: false,
};

interface RawIssue { category?: unknown; severity?: unknown; location?: unknown; description?: unknown; original?: unknown; suggestion?: unknown }

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

function normalize(raw: unknown): ReviewIssue[] {
  if (!Array.isArray(raw)) return [];
  const out: ReviewIssue[] = [];
  for (const it of raw as RawIssue[]) {
    const cat = str(it?.category) as Category;
    const sev = str(it?.severity) as keyof typeof SEVERITY;
    const message = str(it?.description);
    if (!message || !(cat in CATEGORY_LABELS) || !(sev in SEVERITY)) continue;
    const original = str(it.original);
    const location = str(it.location);
    out.push({
      severity: SEVERITY[sev],
      category: CATEGORY_LABELS[cat],
      ...(location || original ? { location: [location, original && `"${original.slice(0, 80)}"`].filter(Boolean).join(' ') } : {}),
      message,
      ...(str(it.suggestion) ? { suggestion: str(it.suggestion) } : {}),
    });
  }
  return out;
}

/** 쪽이 바뀔 때마다 〔n쪽〕 표시를 넣으며 예산 크기 조각으로 묶는다 */
function reviewPieces(passages: Passage[], room: number): string[] {
  const pieces: string[] = [];
  let cur = '';
  let page: number | undefined;
  for (const p of passages) {
    const mark = p.page && p.page !== page ? `〔${p.page}쪽〕\n` : '';
    page = p.page ?? page;
    const add = `${mark}${p.text}`;
    if (cur && cur.length + add.length + 2 > room) {
      pieces.push(cur);
      cur = page && !mark ? `〔${page}쪽〕\n` : '';
    }
    cur = cur ? `${cur}\n\n${add}` : add;
  }
  if (cur) pieces.push(cur);
  return pieces;
}

export function lintFindings(text: string, parsed: boolean): LintFinding[] {
  return lintGongmunText(text, parsed ? { parsed: true } : { document: true }).map((f) => ({
    rule: f.rule,
    severity: f.severity,
    message: f.message,
    line: f.line,
    excerpt: f.match,
    ...(f.suggest ? { suggestion: f.suggest } : {}),
  }));
}

export async function reviewDocument(params: { path: string }, signal: AbortSignal): Promise<{ summary: string; issues: ReviewIssue[]; lint: LintFinding[]; redacted: number }> {
  sendProgress({ current: 0, total: 3, message: '문서 읽는 중...' });
  const doc = await loadDoc(params.path, signal);
  const lint = lintFindings(doc.markdown, doc.parsed);

  const budget = await contextCharBudget({ reserveTokens: REVIEW_TOKENS, signal });
  const room = Math.max(1500, budget - SYSTEM.length - GUIDE.length - 300);
  const all = reviewPieces(doc.passages, room);
  const pieces = all.slice(0, MAX_PIECES);

  const issues: ReviewIssue[] = [];
  const summaries: string[] = [];
  let redacted = 0;
  for (let i = 0; i < pieces.length; i++) {
    signal.throwIfAborted();
    sendProgress({ current: i, total: pieces.length, message: pieces.length > 1 ? `K팀장이 검토 중 (${i + 1}/${pieces.length})` : 'K팀장이 검토 중...' });
    const part = pieces.length > 1 ? `(긴 문서의 ${i + 1}/${pieces.length} 부분)\n` : '';
    const r = await ask({
      system: SYSTEM,
      messages: [{ role: 'user', content: `${GUIDE}\n\n문서: ${doc.name} ${part}\n---\n${pieces[i]}\n---\n\nsummary(문서 상태 한 줄)와 issues 를 JSON 으로 답하세요.` }],
      schema: SCHEMA,
      maxTokens: REVIEW_TOKENS,
      signal,
      stream: false,
    });
    redacted += r.redacted;
    try {
      const parsed = parseJsonLoose<{ summary?: unknown; issues?: unknown }>(r.text);
      issues.push(...normalize(parsed.issues));
      if (str(parsed.summary)) summaries.push(str(parsed.summary));
    } catch {
      logger.warn(`[ai_review] ${i + 1}번째 부분 JSON 해석 실패`);
    }
  }

  // 같은 지적(분류+내용) 한 번만, 심각한 것부터
  const seen = new Set<string>();
  const order = { error: 0, warning: 1, info: 2 };
  const merged = issues
    .filter((x) => { const k = `${x.category}|${x.message}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => order[a.severity] - order[b.severity]);

  const count = (s: ReviewIssue['severity']) => merged.filter((x) => x.severity === s).length;
  const head = pieces.length === 1 && summaries[0]
    ? summaries[0]
    : `검토 사항 ${merged.length}건 (오류 ${count('error')} · 주의 ${count('warning')} · 제안 ${count('info')})`;
  const tail = all.length > pieces.length ? ` 문서가 길어 앞 ${pieces.length}/${all.length} 부분만 검토했습니다.` : '';
  sendProgress({ current: 3, total: 3, message: `검토 완료: ${merged.length}건` });
  return { summary: `${head}${tail}`, issues: merged, lint, redacted };
}
