/** 넘친 줄 AI 줄여 쓰기 (ai_fit_lines) — 마지막 줄에 몇 글자만 넘어간 문단을 뜻은 그대로 짧게 고쳐 한 줄로
 *
 * 줄 맞춤 자체는 kordoc autoFit(장평·자간)이 한다. 그걸로도 안 되는 문단만 여기서 문장을 줄인다.
 * 넘쳤는지는 앱 미리보기·PDF 와 같은 rhwp 조판으로 잰다(작성실이 보내는 생성 옵션 그대로 만든 HWPX).
 * 숫자가 하나라도 바뀌거나 덜 줄인 답은 버리고, 다시 만들어 실제로 한 줄이 된 문장만 남긴다.
 */

import type { GenerateParams } from '../../types/rpc-contract.js';
import { ask, parseJsonLoose, type JsonSchema } from '../../infra/llm/index.js';
import { sendProgress } from '../../infra/progress.js';
import { openRhwp } from '../render/rhwp.js';
import { generateHwpx } from '../gongmun/index.js';

/** 마지막 줄이 이 글자 수 이하면 넘친 줄 */
const MAX_TAIL = 5;

interface LineDoc {
  getSectionCount(): number;
  getParagraphCount(section: number): number;
  getLogicalLength(section: number, para: number): number;
  getTextRange(section: number, para: number, offset: number, count: number): string;
  getLineInfo(section: number, para: number, offset: number): string;
  free?(): void;
}

/** 넘친 문단의 글(항목 부호·탭 뺀 것)과 넘어간 글자 수 */
export async function findSpills(bytes: Uint8Array): Promise<Array<{ text: string; tail: number }>> {
  const doc = (await openRhwp(bytes)) as unknown as LineDoc;
  const out: Array<{ text: string; tail: number }> = [];
  try {
    for (let s = 0; s < doc.getSectionCount(); s++) {
      for (let p = 0; p < doc.getParagraphCount(s); p++) {
        const len = doc.getLogicalLength(s, p);
        if (!len) continue;
        const li = JSON.parse(doc.getLineInfo(s, p, len)) as { lineCount: number; charStart: number };
        if (li.lineCount < 2) continue;
        const text = doc.getTextRange(s, p, 0, len);
        const tail = text.slice(li.charStart).trim().length;
        if (tail && tail <= MAX_TAIL) out.push({ text: text.replace(/^[^\t]{0,6}\t/, '').trim(), tail });
      }
    }
  } finally { doc.free?.(); }
  return out;
}

const plain = (s: string) => s.replace(/\*\*|__|~~|\s+/g, '');
const numbers = (s: string) => (s.match(/\d[\d,.]*/g) ?? []).map((n) => n.replace(/[.,]$/, '')).sort().join('|');

/** 마크다운 한 줄 = [앞(들여쓰기·부호), 글] */
function splitLine(line: string): [string, string] {
  const m = /^(\s*(?:[□■○ㅇ◦·※\-*+]|\d{1,3}[.)]|[가-힣][.)]|\(\d{1,3}\)|\([가-힣]\))?\s*)(.*)$/.exec(line)!;
  return [m[1], m[2]];
}

async function buildBytes(p: GenerateParams, markdown: string, signal: AbortSignal): Promise<Uint8Array> {
  const r = await generateHwpx({ ...p, markdown, output_path: undefined, preview_only: true, preview_hwpx: true }, signal);
  return Buffer.from(r.preview_hwpx_b64 ?? '', 'base64');
}

const SYSTEM = [
  '당신은 공문서 문장을 한 줄에 들어가게 다듬는 담당입니다.',
  '- 뜻을 바꾸지 마세요. 숫자·날짜·금액·기관명·사람 이름·법령명은 한 글자도 바꾸지 마세요.',
  '- 새 내용을 넣지 마세요. 조사, 겹친 말, "~하는 것임" 같은 늘어진 끝맺음을 덜어 내세요.',
  '- 개조식 끝맺음(~함, ~임, 명사형)은 그대로 두세요.',
  '- 문장마다 적힌 글자 수 이상 줄이되, 그보다 3자 넘게 더 줄이지는 마세요.',
].join('\n');

export async function fitLinesWithAi(p: GenerateParams, signal: AbortSignal): Promise<{ markdown: string; changes: Array<{ before: string; after: string }>; remaining: number }> {
  let markdown = p.markdown ?? '';
  if (!markdown.trim()) throw new Error('본문이 비어 있습니다. 내용을 적으세요.');
  sendProgress({ current: 0, total: 3, message: '넘친 줄 찾는 중' });
  let spills = await findSpills(await buildBytes(p, markdown, signal));
  const changes: Array<{ before: string; after: string }> = [];
  // 두 번까지: 처음엔 넘친 만큼, 그래도 넘치면 2자 더
  for (let round = 0; round < 2 && spills.length; round++) {
    const lines = markdown.split('\n');
    const targets = spills.flatMap((s) => {
      const i = lines.findIndex((l) => plain(splitLine(l)[1]) === plain(s.text));
      return i < 0 ? [] : [{ i, text: splitLine(lines[i])[1], cut: s.tail + round * 2 }];
    });
    if (!targets.length) break;
    signal.throwIfAborted();
    sendProgress({ current: 1 + round, total: 3, message: `넘친 줄 ${targets.length}곳 줄여 쓰는 중` });
    const schema: JsonSchema = {
      type: 'object',
      properties: { items: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, text: { type: 'string' } }, required: ['id', 'text'], additionalProperties: false } } },
      required: ['items'],
      additionalProperties: false,
    };
    const list = targets.map((t, k) => `${k + 1}. (${t.cut}자 이상 줄이기) ${t.text}`).join('\n');
    const r = await ask({
      system: SYSTEM,
      messages: [{ role: 'user', content: `[줄일 문장]\n${list}\n\n번호를 id 로, 줄인 문장을 text 로 하는 JSON 으로 답하세요.` }],
      schema,
      maxTokens: 120 + targets.length * 120,
      signal,
      stream: false,
    });
    const items = parseJsonLoose<{ items?: Array<{ id?: unknown; text?: unknown }> }>(r.text).items ?? [];
    const next = [...lines];
    const tried: Array<{ i: number; before: string; after: string }> = [];
    for (const it of items) {
      const t = targets[Number(String(it.id).replace(/\D/g, '')) - 1];
      const after = typeof it.text === 'string' ? it.text.trim() : '';
      if (!t || !after) continue;
      const shorter = t.text.replace(/\s+/g, '').length - after.replace(/\s+/g, '').length;
      // 숫자가 바뀌었거나 덜 줄였거나 지나치게 줄인(뜻이 빠졌을 수 있는) 답은 버린다
      if (numbers(after) !== numbers(t.text) || shorter < t.cut || shorter > t.cut + 6) continue;
      next[t.i] = splitLine(lines[t.i])[0] + after;
      tried.push({ i: t.i, before: t.text, after });
    }
    if (!tried.length) break;
    const left = await findSpills(await buildBytes(p, next.join('\n'), signal));
    const stillSpill = new Set(left.map((s) => plain(s.text)));
    // 줄였는데도 넘치는 문장은 원래대로 (고칠 이유가 없는 변경을 남기지 않는다)
    for (const t of tried) {
      if (stillSpill.has(plain(t.after))) next[t.i] = lines[t.i];
      else changes.push({ before: t.before, after: t.after });
    }
    markdown = next.join('\n');
    spills = await findSpills(await buildBytes(p, markdown, signal));
  }
  return { markdown, changes, remaining: spills.length };
}
