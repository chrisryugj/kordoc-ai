/** 고쳐 쓰기 — 편집기에서 고른 글을 모드대로 바꿔 돌려준다 (결과는 그 자리에 그대로 바꿔 넣을 글만)
 *
 * 긴 글은 문단 경계로 나눠 차례로 고친다. 맞춤법·공공언어는 kordoc 표기법 검사 결과를 구체적인 고칠 거리로 넣고,
 * 개조식은 kordoc 문체 검사로 서술형 종결이 남았는지 보고 한 번 더 고친다.
 */

import { lintGongmunText, lintMuncheText } from 'kordoc';
import { ask, contextCharBudget } from '../../infra/llm/index.js';
import { sendProgress, sendToken } from '../../infra/progress.js';
import { chunkText } from './docs.js';
import { cleanOutput, FIDELITY_RULES, tokensFor } from './prompts.js';

export type RewriteMode = 'polish' | 'concise' | 'formal' | 'plain' | 'expand' | 'english' | 'gaejosik' | 'narrative' | 'public' | 'press' | 'custom';

/** 쉬운 말로 바꿀 때 소형 모델이 "부드럽게"를 해요체로 알아듣는 일을 막는다 */
const KEEP_ENDING = '문장 끝맺음은 원문 문체를 따르세요(개조식 "~임·~함"은 개조식으로, "~합니다"는 "~합니다"로). 해요체("~요")나 반말로 바꾸지 마세요.';

const MODE_GUIDE: Record<Exclude<RewriteMode, 'custom'>, string> = {
  polish: '맞춤법·띄어쓰기·어색한 표현·중복을 고쳐 매끄럽게 다듬으세요. 뜻·구성·분량·문체는 그대로 두세요.',
  concise: '뜻과 핵심 정보(숫자·날짜·이름)는 그대로 두고 군더더기를 빼서 분량을 70% 안팎으로 줄이세요.',
  formal: '행정 공문서 문체로 바꾸세요: 구어·감정 표현을 빼고 "…하고자 합니다", "…하여 주시기 바랍니다" 같은 경어체로.',
  plain: `처음 읽는 사람도 바로 이해하게 쉬운 말로 바꾸세요: 어려운 한자어·전문 용어는 풀어 쓰고, 긴 문장은 나누세요. ${KEEP_ENDING}`,
  expand: '원문의 뜻을 살려 1.5배 안팎으로 자세히 풀어 쓰세요. 새 사실(숫자·날짜·이름·사례)은 지어내지 말고, 원문 내용을 풀어 쓰거나 이유·의미를 일반적인 말로 보충하세요.',
  english: '자연스러운 업무용 영어로 옮기세요. 숫자·날짜·금액은 그대로, 기관·사람 이름은 로마자로 쓰세요. 영어 글만 쓰세요.',
  gaejosik: '개조식으로 바꾸세요: 문장을 명사나 명사형("~함", "~음", "~ 예정", "~ 필요")으로 끝내고("~다", "~합니다" 금지), 항목이 여럿이면 "□ " → 두 칸 들여 "ㅇ " → 네 칸 들여 "- " 부호로 위계를 나누세요. 한 줄은 짧게. "~다"를 "~임"으로 기계적으로 바꾸지 마세요(틀린 예: 열립니다→열임, 받습니다→받임). 바른 예: 개최합니다→개최, 열립니다→개최 예정, 받습니다→접수, 필요합니다→필요, 추진하고 있습니다→추진 중, 계획입니다→계획임.',
  narrative: '개조식·목록을 이어지는 서술문으로 바꾸세요: 부호를 없애고 "…습니다" 경어체 문장과 문단으로 자연스럽게 잇습니다.',
  public: `쉬운 공공언어로 바꾸세요: 행정 한자어·일본식 표현·외래어를 쉬운 우리말로 바꾸고(예: 금일→오늘, 익일→다음 날, 상기→위, 시달→알림, 의거하여→따라, 제고→높임, 만전을 기하다→최선을 다하다, 가이드라인→지침), 권위적인 표현은 부드럽게 바꾸세요. ${KEEP_ENDING}`,
  press: '보도자료 문체로 바꾸세요: 기관을 주어로 "…했다", "…한다고 밝혔다" 같은 보도 문체, 가장 중요한 사실을 첫 문장에.',
};

/** 결과 글자 수 ÷ 원문 글자 수 (답변 몫 잡기) */
const OUT_FACTOR: Partial<Record<RewriteMode, number>> = { expand: 1.8, english: 1.6, narrative: 1.4 };
/** 한 번에 받을 답 상한 (공급자 출력 한도 16K 안쪽) */
const MAX_OUT_TOKENS = 8000;

const SYSTEM = [
  '당신은 한국어 업무 문서를 고쳐 쓰는 편집자입니다. 사용자가 고른 글을 지시대로 바꿉니다.',
  FIDELITY_RULES,
  '- 결과는 원문 자리에 그대로 바꿔 넣을 글만 쓰세요. 따옴표·머리말("다음은…")·설명·맺음말을 붙이지 마세요.',
  '- 원문의 줄바꿈·목록·표 구조는 지시가 바꾸라고 하지 않는 한 유지하세요.',
].join('\n');

/** 맞춤법·공공언어 검사에서 나온 구체적인 고칠 거리 */
function lintHints(text: string, mode: RewriteMode): string[] {
  const rules = new Set(['SPELLING_ERROR', 'LOANWORD_ERROR', 'DUEUM_ERROR', 'DISCRIMINATORY_TERM']);
  if (mode === 'plain' || mode === 'public') { rules.add('PLAIN_LANGUAGE'); rules.add('FOREIGN_FIRST'); }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const f of lintGongmunText(text)) {
    if (!rules.has(f.rule) || seen.has(f.match)) continue;
    seen.add(f.match);
    out.push(`- "${f.match}": ${f.suggest ?? f.message}`);
  }
  return out.slice(0, 20);
}

function instructionFor(mode: RewriteMode, instruction: string | undefined, text: string): string {
  const guide = mode === 'custom' ? instruction!.trim() : MODE_GUIDE[mode];
  const hints = ['polish', 'formal', 'plain', 'public', 'gaejosik', 'concise'].includes(mode) ? lintHints(text, mode) : [];
  const extra = mode !== 'custom' && instruction?.trim() ? `\n추가 요청: ${instruction.trim()}` : '';
  return `[지시]\n${guide}${extra}${hints.length ? `\n\n[이 글에서 꼭 고칠 표현]\n${hints.join('\n')}` : ''}`;
}

export async function rewriteText(
  params: { text: string; mode: RewriteMode; instruction?: string },
  signal: AbortSignal,
): Promise<{ text: string; redacted: number }> {
  const text = params.text ?? '';
  if (!text.trim()) throw new Error('고칠 글이 비어 있습니다. 편집기에서 글을 고른 뒤 다시 시도하세요.');
  const mode = params.mode;
  if (mode !== 'custom' && !(mode in MODE_GUIDE)) throw new Error(`알 수 없는 고쳐 쓰기 방식입니다: ${mode}`);
  if (mode === 'custom' && !params.instruction?.trim()) throw new Error('어떻게 고칠지 지시를 입력하세요.');

  const factor = OUT_FACTOR[mode] ?? 1.2;
  // 입력 + 답(입력 × factor)이 한 번에 들어가는 크기로 나눈다
  const whole = await contextCharBudget({ reserveTokens: 0, signal });
  const pieceChars = Math.max(800, Math.min(Math.floor((whole - SYSTEM.length - 1200) / (1 + factor)), Math.floor((MAX_OUT_TOKENS * 1.2) / factor)));
  const chunks = chunkText(text.trim(), pieceChars);
  const pieces = chunks.map((c) => c.text);

  let redacted = 0;
  const outs: string[] = [];
  for (let i = 0; i < pieces.length; i++) {
    signal.throwIfAborted();
    if (pieces.length > 1) sendProgress({ current: i, total: pieces.length, message: `고쳐 쓰는 중 (${i + 1}/${pieces.length})` });
    if (i > 0) sendToken(chunks[i - 1].sep);
    const r = await ask({
      system: SYSTEM,
      messages: [{ role: 'user', content: `${instructionFor(mode, params.instruction, pieces[i])}\n\n[원문]\n${pieces[i]}` }],
      maxTokens: Math.min(MAX_OUT_TOKENS, tokensFor(pieces[i].length * factor) + 200),
      signal,
    });
    redacted += r.redacted;
    outs.push(cleanOutput(r.text, pieces[i]).replace(/[ \t]+$/gm, ''));
  }
  // 원문에서 조각 사이에 있던 구분자(빈 줄·줄바꿈·빈칸) 그대로 잇는다
  let result = outs.map((o, i) => o + (i < outs.length - 1 ? chunks[i].sep : '')).join('').trim();
  if (!result) throw new Error('AI가 결과를 내지 못했습니다. 다시 시도하세요.');

  // 개조식: 서술형 종결이 남았으면 한 번 더 (한 조각일 때만)
  if (mode === 'gaejosik' && pieces.length === 1) {
    const errs = lintMuncheText(result).filter((f) => f.severity === 'error');
    if (errs.length) {
      const list = errs.slice(0, 12).map((f) => `- ${f.line}줄 "${f.match.slice(0, 40)}": ${f.message}`).join('\n');
      const fix = await ask({
        system: SYSTEM,
        messages: [{ role: 'user', content: `다음 개조식 글에서 지적된 줄의 끝맺음만 명사형(~함, ~임, ~ 예정)으로 고쳐 전체를 다시 쓰세요.\n\n[지적]\n${list}\n\n[글]\n${result}` }],
        maxTokens: Math.min(MAX_OUT_TOKENS, tokensFor(result.length * 1.2) + 200),
        signal,
        stream: false,
      });
      redacted += fix.redacted;
      const fixed = cleanOutput(fix.text, text).replace(/[ \t]+$/gm, '');
      if (fixed && lintMuncheText(fixed).filter((f) => f.severity === 'error').length < errs.length) result = fixed;
    }
  }
  // 고른 글 앞뒤의 빈칸·줄바꿈은 그대로 (편집기에 바꿔 넣을 때 문단이 붙지 않게)
  const lead = text.match(/^\s*/)?.[0] ?? '';
  const trail = text.match(/\s*$/)?.[0] ?? '';
  return { text: `${lead}${result}${trail}`, redacted };
}
