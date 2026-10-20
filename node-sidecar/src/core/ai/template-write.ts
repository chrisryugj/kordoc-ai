/** 서식대로 새로 쓰기 — 견본·양식 문서의 서식은 그대로 두고 내용만 AI 가 지시·참고 문서대로 새로 쓴다 (kordoc 서식 베끼기)
 *
 * 견본을 틀 표째 마크다운 골격으로 읽고(parse keep), AI 가 부호·들여쓰기·표·그림 줄은 두고 내용만 바꿔 쓰면,
 * kordoc 패치가 원본 HWPX 에 넣는다. 늘린 문단은 같은 부호 견본 문단의 서식을 받는다(patchHwpx structure).
 * HWP 견본은 rhwp 로 HWPX 로 바꿔 쓴다(문단 늘리고 줄이기는 HWPX 패치만 된다).
 * 결과는 공문서 게이트로 검수: 줄 단위로 고칠 수 있는 error(표기법·윤문)는 한 번 고쳐 쓰고, 나머지는 사용자에게 보인다.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { gongmunGate, parse, patchHwpx, type GongmunGateFinding } from 'kordoc';
import { ask, contextCharBudget } from '../../infra/llm/index.js';
import { sendProgress } from '../../infra/progress.js';
import { openRhwp } from '../render/rhwp.js';
import { withoutTrackedChanges, hasTrackedChanges } from '../hwp-save/tracked-changes.js';
import { outputFile, stemOf } from '../output/index.js';
import { loadDocs } from './docs.js';
import { fixLines, referenceText } from './draft.js';
import { cleanOutput, FIDELITY_RULES, orgContext, todayText, tokensFor } from './prompts.js';

export interface TemplateWriteParams {
  path: string;
  instruction: string;
  references?: string[];
  output_path?: string;
}

export interface TemplateWriteResult {
  output_path: string;
  /** 패치로 바뀐 곳 수 */
  applied: number;
  /** 서식에 넣지 못한 것 (사용자 문장) */
  skipped: string[];
  /** 공문서 게이트 지적 — 고쳐 쓴 뒤에도 남은 것 */
  findings: Array<Pick<GongmunGateFinding, 'axis' | 'rule' | 'line' | 'match' | 'message' | 'severity'> & { suggest?: string }>;
  redacted: number;
  /** HWP 견본이라 HWPX 로 만들었다 */
  converted: boolean;
}

const SYSTEM = [
  '당신은 한국 공문서 작성 전문가입니다. 기관이 쓰는 견본 문서의 서식을 그대로 살려, 지시받은 새 문서의 내용을 씁니다.',
  FIDELITY_RULES,
  `[견본 골격 규칙]
- [견본 골격]은 견본 문서를 마크다운으로 옮긴 것입니다. 이것과 같은 꼴의 마크다운 전체를 출력합니다.
- 줄 첫머리 부호(□ ㅇ ○ - · ※ 1. 가. 등)와 들여쓰기, 제목(#) 단계, 표의 칸 수와 칸 순서, 그림 줄(![…](…)), HTML 표 태그는 그대로 둡니다.
- 같은 부호의 항목은 내용에 맞게 늘리거나 줄여도 됩니다. 새 항목도 견본에 있는 부호만 씁니다.
- 표지·결재란·머리 표의 칸 이름(기관명·작성일·담당 등)은 두고 값만 이번 문서에 맞게 씁니다. [내 기관 정보]·[오늘 날짜]에 있으면 그것을 씁니다.
- 견본의 내용(사실·숫자·날짜·이름·사업명)은 옮기지 않습니다. 이번 문서의 내용은 [작성 지시]와 [참고 문서]에 있는 것만 씁니다. 모르는 값은 "○○"로 둡니다.
- 견본에 있는 안내 문구(예: "~를 쓰세요", "(작성 요령)")는 지우고 그 자리에 내용을 씁니다.
- 견본의 "관련" 항목("○○과-123(날짜)호와 관련입니다")은 [작성 지시]·[참고 문서]에 관련 문서가 없으면 그 항목을 지우고 뒤 항목 번호를 당깁니다.
- 결재란·서명·협조자·시행 번호·접수 번호·결재 날짜처럼 전자결재가 채우는 자리의 이름·날짜·번호는 비웁니다("○○"도 쓰지 않습니다). "시행", "접수", "협조자" 같은 칸 이름은 둡니다.
- 기관 표어·구호 줄은 [내 기관 정보]에 없으면 비웁니다. 다른 기관 이름으로 채우지 않습니다.`,
  `[구성 규칙]
- 보고서·계획서 꼴이면 왜(추진배경·근거·현황 및 문제점) → 무엇을(추진개요·개선방안·세부 추진계획) → 어떻게(추진일정·소요예산·기대효과·행정사항) 흐름이 서도록 장 내용을 채웁니다. 장 이름을 "서론·본론·결론"으로 쓰지 않습니다.
- 배경은 사실(지시·법령·민원·건수)로 열고, 문제점마다 방안을 한 짝씩 두고, 기대효과는 목표치로 씁니다(모르면 ○○).
- "결론적으로", "시사하는 바가 크다", "획기적", "만족도 향상" 같은 상투어를 쓰지 않습니다.`,
  '- 출력은 마크다운 문서 본문만 씁니다. 설명·머리말·맺음말·코드블록은 쓰지 않습니다.',
].join('\n\n');

const OLE = [0xd0, 0xcf, 0x11, 0xe0];
const isOle = (b: Uint8Array) => OLE.every((x, i) => b[i] === x);

/** 견본 바이트를 HWPX 로 (HWP 는 rhwp 로 바꾼다. 변경 추적 HWP 는 지금 내용으로) */
async function templateHwpx(path: string): Promise<{ bytes: Uint8Array; converted: boolean }> {
  let bytes: Uint8Array = await readFile(path);
  if (!isOle(bytes)) return { bytes, converted: false };
  if (hasTrackedChanges(bytes)) bytes = withoutTrackedChanges(bytes) ?? bytes;
  const doc = (await openRhwp(bytes)) as unknown as { exportHwpx(): Uint8Array; free?(): void };
  try {
    return { bytes: doc.exportHwpx(), converted: true };
  } finally {
    doc.free?.();
  }
}

/** 줄 하나만 고치면 되는 지적인가 (장 구성처럼 문서 전체를 봐야 하는 지적은 사람에게 보인다) */
const lineFixable = (f: GongmunGateFinding) => f.severity === 'error' && (f.axis === '표기법' || f.axis === '윤문' || f.axis === '문체');

export async function writeFromTemplate(p: TemplateWriteParams, signal: AbortSignal): Promise<TemplateWriteResult> {
  const instruction = (p.instruction ?? '').trim();
  if (!instruction && !p.references?.length) throw new Error('무슨 문서를 쓸지 지시를 입력하거나 참고 문서를 붙이세요.');

  sendProgress({ current: 1, total: 4, message: '견본 서식을 읽는 중...' });
  const { bytes, converted } = await templateHwpx(p.path);
  const parsed = await parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, { layoutTables: 'keep' });
  const skeleton = parsed.success ? parsed.markdown : '';
  if (!skeleton.trim()) throw new Error('견본에서 글을 읽지 못했습니다. 글이 든 한글 서식인지 확인하세요.');

  const maxTokens = Math.min(16_000, Math.max(2048, tokensFor(skeleton.length) * 2));
  const org = orgContext();
  const budget = await contextCharBudget({ reserveTokens: maxTokens, signal });
  const room = Math.max(800, budget - SYSTEM.length - skeleton.length - instruction.length - org.length - 400);
  const docs = p.references?.length ? await loadDocs(p.references, signal) : [];
  const refs = await referenceText(docs, undefined, instruction, room, signal);
  let redacted = refs.redacted;

  sendProgress({ current: 2, total: 4, message: '견본 서식대로 내용을 쓰는 중...' });
  const parts = [
    `[작성 지시]\n${instruction || '참고 문서를 바탕으로 이 서식의 새 문서를 쓰세요.'}`,
    `[오늘 날짜]\n${todayText()}`,
    org ? `[내 기관 정보]\n${org}` : '',
    refs.text ? `[참고 문서]\n${refs.text}` : '',
    `[견본 골격]\n${skeleton}`,
    '위 [견본 골격]과 같은 꼴로, 내용만 [작성 지시]의 새 문서로 바꾼 마크다운 전체를 출력하세요.',
  ].filter(Boolean);
  const first = await ask({ system: SYSTEM, messages: [{ role: 'user', content: parts.join('\n\n') }], maxTokens, signal });
  redacted += first.redacted;
  let markdown = cleanOutput(first.text).trim();
  if (!markdown) throw new Error('AI가 문서를 쓰지 못했습니다. 지시를 조금 더 구체적으로 적어 다시 시도하세요.');

  sendProgress({ current: 3, total: 4, message: '공문서 게이트로 검수하는 중...' });
  let gate = gongmunGate(markdown, { parsed: true });
  const fixable = gate.blocking.filter(lineFixable);
  if (fixable.length) {
    const fix = await fixLines(markdown, fixable.map((f) => ({ line: f.line, text: `"${f.match}": ${f.message}${f.suggest ? ` (${f.suggest})` : ''}` })), SYSTEM, signal);
    redacted += fix.redacted;
    const next = gongmunGate(fix.markdown, { parsed: true });
    if (next.blocking.length < gate.blocking.length) { markdown = fix.markdown; gate = next; }
  }

  sendProgress({ current: 4, total: 4, message: '견본 서식에 넣는 중...' });
  const patched = await patchHwpx(bytes, markdown, { structure: true });
  if (!patched.success || !patched.data) throw new Error(`견본 서식에 내용을 넣지 못했습니다: ${patched.error ?? '알 수 없는 오류'}. 견본을 다시 등록하거나 편집기에서 직접 쓰세요.`);
  const out = outputFile({ output_path: p.output_path, source: p.path, name: `${stemOf(p.path)}_새로쓰기.hwpx` });
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, patched.data);
  return {
    output_path: out,
    applied: patched.applied,
    skipped: patched.skipped.map((s) => `${s.reason}${s.after ?? s.before ? `: ${s.after ?? s.before}` : ''}`),
    findings: gate.blocking.map((f) => ({ axis: f.axis, rule: f.rule, line: f.line, match: f.match, message: f.message, severity: f.severity, ...(f.suggest ? { suggest: f.suggest } : {}) })),
    redacted,
    converted,
  };
}
