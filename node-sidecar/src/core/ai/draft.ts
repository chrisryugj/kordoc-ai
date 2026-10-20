/** 공문서 초안 — 지시 + 참고 문서 → generate_hwpx 에 바로 넣는 마크다운
 *
 * 받은 뒤 kordoc 표기법 검사(+개조식 프리셋은 문체 검사)에서 error 가 나오면 지적된 줄만 한 번 고쳐 쓴다.
 * 토큰 알림은 첫 초안만 흘린다 — 고쳐 쓴 최종본은 결과 markdown 으로 온다.
 */

import { lintGongmunText, lintMuncheText, normalizeGongmunPreset, usesGaejosikMunche, type GongmunPreset } from 'kordoc';
import { ask, contextCharBudget, parseJsonLoose, type JsonSchema } from '../../infra/llm/index.js';
import { sendProgress } from '../../infra/progress.js';
import { condense } from './condense.js';
import { loadDocs, selectPassages, type LoadedDoc } from './docs.js';
import {
  KIND_GUIDE, KIND_PRESET, LENGTH_GUIDE, LENGTH_TOKENS, MARKDOWN_RULES, PRESET_GUIDE, PRESET_LABEL, type DraftKind,
} from './draft-guides.js';
import {
  cleanOutput, DOC_NO, dropGreeting, escapeLineDates, FIDELITY_RULES, fixRecipientLine, fixRelatedLine, orgContext, receivedDocRef, todayText,
} from './prompts.js';

export interface DraftParams {
  instruction: string;
  preset?: string;
  kind?: DraftKind;
  references?: string[];
  length?: 'short' | 'medium' | 'long';
}

const ROLE = '당신은 한국 행정기관·공공기관·기업의 문서 작성을 돕는 공문서 작성 전문가입니다. 지시와 참고 문서를 바탕으로 바로 결재에 올릴 수 있는 초안을 씁니다.';

/** "# 제목" 으로 시작하게 + kordoc 이 모르는 글머리(•·● 등)는 "- " 로 (들여쓰기 그대로) */
function ensureTitle(md: string, instruction: string): string {
  const t = md.trim().replace(/^(\s*)[•●◦▪∙]\s+/gm, '$1- ');
  if (/^#\s+\S/.test(t)) return t;
  const [first, ...rest] = t.split('\n');
  if (first && first.length <= 60 && !/^\s*([-*>|□ㅇ○※]|\d+[.)]|[가-하][.)])/.test(first)) return `# ${first.replace(/^#+\s*/, '').trim()}\n${rest.join('\n')}`;
  return `# ${instruction.split('\n')[0].slice(0, 40).trim() || '제목'}\n\n${t}`;
}

/** 고쳐 쓸 error 목록 (표기법 + 개조식 문체) */
function lintErrors(md: string, preset: GongmunPreset): Array<{ line: number; text: string }> {
  const out: Array<{ line: number; text: string }> = [];
  for (const f of lintGongmunText(md, { document: true })) {
    if (f.severity === 'error') out.push({ line: f.line, text: `"${f.match}": ${f.message}${f.suggest ? ` (${f.suggest})` : ''}` });
  }
  if (usesGaejosikMunche(preset)) {
    for (const f of lintMuncheText(md)) {
      if (f.severity === 'error') out.push({ line: f.line, text: `"${f.match.slice(0, 40)}": ${f.message}${f.suggest ? ` (${f.suggest})` : ''}` });
    }
  }
  return out.slice(0, 15);
}

const FIX_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    lines: {
      type: 'array',
      maxItems: 15,
      items: {
        type: 'object',
        properties: { line: { type: 'integer' }, text: { type: 'string' } },
        required: ['line', 'text'],
        additionalProperties: false,
      },
    },
  },
  required: ['lines'],
  additionalProperties: false,
};

/** 지적된 줄만 고쳐 받아 그 줄에 바꿔 넣는다. 초안 전체를 다시 쓰게 하면 초안만큼 한 번 더 생성해서 CPU 에서 몇 분이 더 걸린다 */
export async function fixLines(md: string, errors: Array<{ line: number; text: string }>, system: string, signal: AbortSignal): Promise<{ markdown: string; redacted: number }> {
  const lines = md.split('\n');
  const nums = [...new Set(errors.map((e) => e.line))].filter((n) => n >= 1 && n <= lines.length);
  if (!nums.length) return { markdown: md, redacted: 0 };
  const listing = nums.map((n) => `${n}줄: ${lines[n - 1]}\n${errors.filter((e) => e.line === n).map((e) => `  - ${e.text}`).join('\n')}`).join('\n\n');
  const r = await ask({
    system,
    messages: [{ role: 'user', content: `다음은 초안에서 표기법 오류가 지적된 줄입니다. 줄마다 지적된 오류만 고친 한 줄을 line(줄 번호)·text 로 답하세요. 내용·글머리 기호는 바꾸지 마세요.\n\n${listing}` }],
    schema: FIX_SCHEMA,
    maxTokens: 150 + nums.length * 150,
    signal,
    stream: false,
  });
  let parsed: { lines?: Array<{ line?: unknown; text?: unknown }> };
  try { parsed = parseJsonLoose(r.text); } catch { return { markdown: md, redacted: r.redacted }; }
  const out = [...lines];
  for (const it of parsed.lines ?? []) {
    const n = Number(it?.line);
    if (!nums.includes(n) || typeof it.text !== 'string' || !it.text.trim() || it.text.includes('\n')) continue;
    out[n - 1] = it.text.trimEnd();
  }
  return { markdown: out.join('\n'), redacted: r.redacted };
}

/** 참고 문서를 예산 안의 글로 — 전체를 봐야 하는 종류(한 장 보고·회의록·회신의 받은 공문)는 줄이고, 나머지는 지시와 가까운 부분만 */
export async function referenceText(docs: LoadedDoc[], kind: DraftKind | undefined, instruction: string, room: number, signal: AbortSignal): Promise<{ text: string; redacted: number }> {
  if (!docs.length) return { text: '', redacted: 0 };
  const whole = (d: LoadedDoc, label: string) => `=== ${label}: ${d.name} ===\n${d.text.trim()}`;
  if (kind === 'onepage' || kind === 'minutes' || kind === 'memo') {
    const focus = kind === 'minutes' ? '안건·발언 요지·결정 사항·할 일(담당·기한)' : kind === 'memo' ? '사실·숫자·날짜·이름·할 일(담당·기한)·결론' : '결론·현황 숫자·주요 내용·향후 계획';
    return condense(docs.map((d) => whole(d, '참고 문서')).join('\n\n'), room, signal, focus);
  }
  let redacted = 0;
  let head = '';
  let rest = docs;
  if (kind === 'reply') {
    const share = docs.length > 1 ? Math.floor(room * 0.7) : room;
    const c = await condense(whole(docs[0], '받은 공문'), share, signal, '보낸 기관·문서번호·시행일·제목·요청 사항·제출 기한·제출 양식');
    head = c.text;
    redacted += c.redacted;
    rest = docs.slice(1);
  }
  if (!rest.length) return { text: head, redacted };
  const { selected } = selectPassages(rest.flatMap((d) => d.passages), instruction, Math.max(800, room - head.length));
  let body = '';
  let lastName = '';
  for (const p of selected) {
    if (p.name !== lastName) { body += `\n\n=== 참고 문서: ${p.name} ===`; lastName = p.name; }
    body += `\n${p.text}`;
  }
  return { text: `${head}${body}`.trim(), redacted };
}

export async function draftDocument(params: DraftParams, signal: AbortSignal): Promise<{ markdown: string; redacted: number }> {
  const instruction = (params.instruction ?? '').trim();
  const kind = params.kind && params.kind in KIND_GUIDE ? params.kind : undefined;
  if (kind === 'memo' && !instruction && !params.references?.length) throw new Error('정리할 메모를 붙여 넣거나 메모 파일을 붙이세요.');
  if (!instruction && !params.references?.length) throw new Error('무엇을 쓸지 지시를 입력하거나 참고 문서를 고르세요.');
  if (kind === 'reply' && !params.references?.length) throw new Error('회신할 공문(받은 공문)을 참고 문서로 넣으세요.');

  const preset = normalizeGongmunPreset(params.preset || (kind ? KIND_PRESET[kind] : undefined));
  const length = params.length ?? (kind === 'onepage' ? 'short' : 'medium');
  const maxTokens = LENGTH_TOKENS[length] ?? LENGTH_TOKENS.medium;
  const system = [ROLE, FIDELITY_RULES, MARKDOWN_RULES, PRESET_GUIDE[preset], kind ? KIND_GUIDE[kind] : '', LENGTH_GUIDE[length]].filter(Boolean).join('\n\n');

  const docs = params.references?.length ? await loadDocs(params.references, signal) : [];
  const org = orgContext();
  const budget = await contextCharBudget({ reserveTokens: maxTokens, signal });
  const room = Math.max(1000, budget - system.length - instruction.length - org.length - 400);
  const refs = await referenceText(docs, kind, instruction, room, signal);
  let redacted = refs.redacted;
  // 회신의 관련 번호·수신은 받은 공문에서 정해진다 — 요약 전 원문에서 뽑아 따로 주고, 초안이 다르게 쓰면 바로잡는다.
  // 지시에 없는 안부 인사는 소형 모델이 규칙을 어기고 넣어서 걷는다
  const received = kind === 'reply' && docs[0] ? receivedDocRef(docs[0].text) : undefined;
  const finish = (text: string) => {
    let md = ensureTitle(cleanOutput(text), instruction);
    if (!/인사|기원/.test(instruction)) md = dropGreeting(md);
    if (received && !DOC_NO.test(instruction)) md = fixRelatedLine(md, received);
    if (received && !/수신/.test(instruction)) md = fixRecipientLine(md, received);
    return md;
  };

  const parts = [
    kind === 'memo'
      ? `[작성 지시]\n아래 메모를 개조식 보고서로 정리하세요.${instruction ? `\n\n[메모]\n${instruction}` : ''}`
      : `[작성 지시]\n${instruction || '참고 문서를 바탕으로 초안을 쓰세요.'}`,
    `[오늘 날짜]\n${todayText()}`,
    org ? `[내 기관 정보]\n${org}` : '',
    received ? `[받은 공문 번호]\n${received.ref}` : '',
    received?.recipient ? `[회신 받을 곳]\n${received.recipient}` : '',
    refs.text ? `[참고 문서]\n${refs.text}` : '',
    `위 지시${refs.text ? '와 참고 문서' : ''}로 ${PRESET_LABEL[preset]} 초안을 마크다운으로 쓰세요. 문서 본문만 출력하세요.`,
  ].filter(Boolean);

  sendProgress({ current: 1, total: 3, message: `${PRESET_LABEL[preset]} 초안 쓰는 중...` });
  const first = await ask({ system, messages: [{ role: 'user', content: parts.join('\n\n') }], maxTokens, signal });
  redacted += first.redacted;
  let markdown = finish(first.text);
  if (!markdown.replace(/^#.*$/m, '').trim()) throw new Error('AI가 초안을 쓰지 못했습니다. 지시를 조금 더 구체적으로 적어 다시 시도하세요.');

  const errors = lintErrors(markdown, preset);
  if (errors.length) {
    sendProgress({ current: 2, total: 3, message: `표기법 오류 ${errors.length}건 고쳐 쓰는 중...` });
    const fix = await fixLines(markdown, errors, system, signal);
    redacted += fix.redacted;
    const fixed = finish(fix.markdown);
    // 오류가 줄지 않으면 첫 초안 유지
    if (lintErrors(fixed, preset).length < errors.length) markdown = fixed;
  }
  sendProgress({ current: 3, total: 3, message: '초안 완료' });
  return { markdown: escapeLineDates(markdown), redacted };
}
