/** 서식 칸 값 제안 — 지시(무슨 문서인지)·참고 문서·칸 안내문을 읽고 칸마다 그대로 들어갈 글을 JSON 으로
 *
 * 기관명·부서·담당자·날짜 같은 정해진 값은 org_autofill 이 채우니 AI 는 제목·본문·내용 칸에 힘을 쓴다.
 * 글은 지어도 되지만 숫자는 지어내면 안 된다: 출처(참고 문서·지시·메모·기관 정보·오늘 날짜)에 없는 숫자가 들어간 짧은 칸은 비우고,
 * 긴 칸은 그 숫자만 "○○" 로 바꾼다.
 */

import { ask, contextCharBudget, maskTable, parseJsonLoose, restoreWith, type JsonSchema } from '../../infra/llm/index.js';
import { sendProgress } from '../../infra/progress.js';
import { loadDocs, selectPassages, unescapeMd } from './docs.js';
import { GREETING_RULE } from './draft-guides.js';
import { DOC_NO, dropGreeting, FIDELITY_RULES, fixRelatedLine, orgContext, receivedDocRef, todayText } from './prompts.js';

export interface FillParams {
  fields: string[];
  references: string[];
  note?: string;
  instruction?: string;
  guides?: Record<string, string>;
}

const SYSTEM = [
  '당신은 한국 공문서·업무 서식의 빈칸을 채우는 도우미입니다.',
  FIDELITY_RULES,
  '- 칸마다 그 칸에 그대로 들어갈 글만 씁니다. 설명·따옴표·"(예시)" 같은 말을 붙이지 않습니다.',
  '- 제목·본문·내용·목적·개요 같은 칸은 지시와 참고 문서를 바탕으로 공문서 문체로 씁니다. 여러 줄이 필요하면 줄을 나눕니다.',
  '- 공문 본문은 "1." "2." 항목으로 씁니다. [받은 공문 번호]가 있으면 첫 항목을 "1. 관련: [받은 공문 번호]"로 쓰고 다음 항목부터 용건을 씁니다. 참고 문서 본문의 "관련" 항목은 그 문서가 근거로 든 이전 문서라서 옮기지 않습니다.',
  GREETING_RULE,
  '- 기관명·부서·담당자·전화·날짜 같은 칸은 [내 기관 정보]·[오늘 날짜]·참고 문서에 있는 값만 그대로 쓰고, 없으면 빈 문자열("")로 둡니다.',
  '- 알 수 없는 칸은 빈 문자열("")로 둡니다. 숫자·날짜·금액·이름을 지어내지 않습니다.',
].join('\n');

/** 값 속 숫자가 출처에 있는지 — 없는 숫자는 지어낸 것으로 본다 */
function groundNumbers(value: string, known: Set<number>): string {
  // 항목 번호("1." "2)")·회차·부수("제1회" "1부")는 지시문이 시킨 글의 뼈대이지 지어낸 값이 아니다. 이것까지 대조하면
  // 참고 문서 없이 지시만 준 본문이 "○○. …"가 되고 짧은 제목·붙임 칸이 통째로 비워진다. 날짜·금액·전화 같은 값 숫자만 본다
  const spans = [...value.matchAll(FRAME_NUMBER)].map((m) => [m.index, m.index + m[0].length]);
  const frame = (at: number) => spans.some(([a, b]) => at >= a && at < b);
  const unknown = [...value.matchAll(/\d+/g)].filter((m) => !frame(m.index) && !known.has(Number(m[0])));
  if (!unknown.length) return value;
  if (value.length <= 30) return '';
  return value.replace(/\d+/g, (r, at: number) => (frame(at) || known.has(Number(r)) ? r : '○○'));
}

// 줄 머리 번호 뒤에 날짜가 이어지면("3. 14.(토)") 그 번호는 월이다 → 값 숫자로 본다. 회차는 "제1회"만 뼈대로 본다("제15회"는 값)
const FRAME_NUMBER = /^[ \t]*(?:\d{1,2}[.)]|\(\d{1,2}\))(?=\s)(?!\s*\d{1,2}\s*(?:\.|\(|일))|(?:붙임|별첨|별지)\s*\d{1,2}(?=[.\s]|$)|제\s?1\s?(?:회|차|기)|\d{1,2}\s?(?:부|매)(?=[\s.,)]|$)/gm;

export async function suggestFill(params: FillParams, signal: AbortSignal): Promise<{ values: Record<string, string>; redacted: number }> {
  const fields = [...new Set((params.fields ?? []).map((f) => String(f).trim()).filter(Boolean))];
  if (!fields.length) throw new Error('채울 칸 이름이 없습니다.');
  const instruction = params.instruction?.trim() ?? '';
  const note = params.note?.trim() ?? '';
  if (!params.references?.length && !instruction && !note) throw new Error('참고 문서를 넣거나 무슨 문서를 쓰는지 적으세요.');

  const guides = params.guides ?? {};
  const fieldList = fields.map((f) => (guides[f]?.trim() ? `- ${f}: ${guides[f].trim()}` : `- ${f}`)).join('\n');
  const org = orgContext();
  const today = todayText();
  const maxTokens = Math.min(3000, 300 + fields.length * 120);

  const docs = params.references?.length ? await loadDocs(params.references, signal) : [];
  const budget = await contextCharBudget({ reserveTokens: maxTokens, signal });
  const room = Math.max(800, budget - SYSTEM.length - fieldList.length - instruction.length - note.length - org.length - 500);
  const { selected } = selectPassages(docs.flatMap((d) => d.passages), [instruction, note, fieldList].join('\n'), room);
  const refs = selected.map((p) => `(${p.name}${p.page ? ` ${p.page}쪽` : ''})\n${p.text}`).join('\n\n');
  const received = docs.map((d) => receivedDocRef(d.text)).find(Boolean);

  const content = [
    instruction ? `[쓰려는 문서]\n${instruction}` : '',
    `[칸 목록] (칸 이름: 안내)\n${fieldList}`,
    `[오늘 날짜]\n${today}`,
    org ? `[내 기관 정보]\n${org}` : '',
    received ? `[받은 공문 번호]\n${received.ref}` : '',
    received?.recipient ? `[받은 공문을 보낸 곳]\n${received.recipient}` : '',
    refs ? `[참고 문서]\n${refs}` : '',
    note ? `[메모]\n${note}` : '',
    '칸 이름을 키로 하는 JSON 객체 하나로 답하세요. 모든 칸을 넣고, 모르는 칸은 ""로 두세요.',
  ].filter(Boolean).join('\n\n');

  const schema: JsonSchema = {
    type: 'object',
    properties: Object.fromEntries(fields.map((f) => [f, { type: 'string' }])),
    required: fields,
    additionalProperties: false,
  };
  sendProgress({ current: 1, total: 2, message: '칸에 넣을 값을 찾는 중' });
  const r = await ask({ system: SYSTEM, messages: [{ role: 'user', content }], schema, maxTokens, signal, stream: false });

  let raw: Record<string, unknown> = {};
  try {
    raw = parseJsonLoose<Record<string, unknown>>(r.text);
  } catch {
    throw new Error('AI 응답을 칸 값으로 읽지 못했습니다. 다시 시도하거나 더 큰 모델을 고르세요.');
  }
  const sources = [instruction, note, org, today, refs, received?.ref ?? '', ...Object.values(guides)].join('\n');
  const known = new Set((sources.match(/\d+/g) ?? []).map(Number));
  const asked = `${instruction}\n${note}`;
  const fixRelated = received && !DOC_NO.test(asked);
  const keepGreeting = /인사|기원/.test(asked);
  const values: Record<string, string> = {};
  const table = r.redacted ? maskTable(content) : [];
  for (const f of fields) {
    const v = raw[f];
    const s = typeof v === 'string' ? v : v == null ? '' : Array.isArray(v) ? v.join('\n') : String(v);
    // 보내기 전에 가린 값(기관 전화·전자우편)은 답에서 원래 값으로 되돌린 뒤 본다
    const got = restoreWith(table, s);
    let value = groundNumbers(unescapeMd(got.replace(/\r\n/g, '\n')).trim(), known);
    if (!keepGreeting) value = dropGreeting(value);
    values[f] = fixRelated ? fixRelatedLine(value, received) : value;
  }
  sendProgress({ current: 2, total: 2, message: '완료' });
  return { values, redacted: r.redacted };
}
