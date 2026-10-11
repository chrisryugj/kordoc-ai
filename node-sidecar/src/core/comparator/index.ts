/** 문서 비교 — compare(신구대조 행 + HTML·MD·XLSX 내보내기) · compare_hwpx(신·구조문대비표 한글 문서)
 *
 * kordoc compare 는 교차 포맷(HWP ↔ HWPX ↔ PDF …) 블록 비교. 화면용 행은 바뀐 곳 위주로 줄이고
 * (안 바뀐 블록은 바뀐 곳 앞뒤 1개씩만), 바뀐 행은 어절 단위로 다른 곳을 짚는다.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { blocksToMarkdown, compare, markdownToHwpx, type BlockDiff, type IRBlock } from 'kordoc';
import type { CompareResult } from '../../types/rpc-contract.js';
import { sendProgress } from '../../infra/progress.js';
import { buildXlsx } from '../excel/xlsx.js';
import { tableGrid } from '../excel/index.js';
import { outputFile, stemOf } from '../output/index.js';

type Row = CompareResult['rows'][number];
interface Seg { text: string; changed: boolean }

const toAB = (b: Buffer): ArrayBuffer => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

/** 블록 → 비교용 글 (표는 행마다 한 줄, 칸은 ·) */
function blockText(b?: IRBlock): string {
  if (!b) return '';
  if (b.type === 'paragraph' || b.type === 'heading') return b.text ?? '';
  if (b.type === 'image') return '[그림]';
  if (b.type === 'separator') return '';
  if (b.type === 'table' && b.table) return tableGrid(b.table).map((r) => r.map((c) => c.replace(/\s*\n\s*/g, ' ')).join(' · ')).join('\n');
  return blocksToMarkdown([b]).trim();
}

export function compareRows(diffs: BlockDiff[]): Row[] {
  const all: Row[] = diffs
    .map((d) => ({ type: d.type, old: blockText(d.before), new: blockText(d.after) }))
    .filter((r) => r.old || r.new);
  const changed = (r?: Row) => !!r && r.type !== 'unchanged';
  return all.filter((r, i) => changed(r) || changed(all[i - 1]) || changed(all[i + 1]));
}

/** 어절 단위 차이 — 같은 어절은 그대로, 다른 어절만 changed */
export function wordDiff(a: string, b: string): { old: Seg[]; new: Seg[] } {
  const A = a.match(/\s+|\S+/g) ?? [];
  const B = b.match(/\s+|\S+/g) ?? [];
  if (A.length * B.length > 4_000_000) return { old: [{ text: a, changed: true }], new: [{ text: b, changed: true }] };
  const w = B.length + 1;
  const dp = new Uint32Array((A.length + 1) * w);
  for (let i = A.length - 1; i >= 0; i--) {
    for (let j = B.length - 1; j >= 0; j--) {
      dp[i * w + j] = A[i] === B[j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
    }
  }
  const old: Seg[] = [];
  const neu: Seg[] = [];
  const push = (to: Seg[], text: string, changed: boolean) => {
    const last = to.at(-1);
    if (last && last.changed === changed) last.text += text;
    else to.push({ text, changed });
  };
  let i = 0;
  let j = 0;
  while (i < A.length && j < B.length) {
    if (A[i] === B[j]) { push(old, A[i++], false); push(neu, B[j++], false); }
    else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) push(old, A[i++], true);
    else push(neu, B[j++], true);
  }
  while (i < A.length) push(old, A[i++], true);
  while (j < B.length) push(neu, B[j++], true);
  return { old: joinGaps(old), new: joinGaps(neu) };
}

/** 바뀐 어절 사이의 띄어쓰기는 바뀐 덩어리에 붙인다 ("**주소를** **둔**" → "**주소를 둔**") */
function joinGaps(segs: Seg[]): Seg[] {
  const out: Seg[] = [];
  for (let k = 0; k < segs.length; k++) {
    const s = segs[k];
    const prev = out.at(-1);
    if (!s.changed && /^\s+$/.test(s.text) && prev?.changed && segs[k + 1]?.changed) {
      prev.text += s.text + segs[k + 1].text;
      k++;
    } else if (prev && prev.changed === s.changed) prev.text += s.text;
    else out.push({ ...s });
  }
  return out;
}

/** 바뀐 조각을 감싸되 앞뒤 공백은 밖으로 (마크다운 굵게가 공백으로 시작·끝나면 안 됨) */
function markSegs(segs: Seg[], esc: (s: string) => string, open: string, close: string): string {
  return segs.map((s) => {
    if (!s.changed || !s.text.trim()) return esc(s.text);
    const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(s.text)!;
    return `${m[1]}${open}${esc(m[2])}${close}${m[3]}`;
  }).join('');
}

const TYPE_LABEL: Record<Row['type'], string> = { added: '신설', removed: '삭제', modified: '변경', unchanged: '같음' };
const escHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** GFM 표 칸 안 — 마크다운 기호·수식 표지($)·꺾쇠는 글자로, 줄바꿈은 <br> */
const escCell = (s: string) => s.replace(/[\\`*_|<>$[\]#~]/g, (ch) => `\\${ch}`).replace(/\r?\n/g, '<br>');

function cells(r: Row, esc: (s: string) => string, open: string, close: string): [string, string] {
  if (r.type !== 'modified') return [esc(r.old), esc(r.new)];
  const d = wordDiff(r.old, r.new);
  return [markSegs(d.old, esc, open, close), markSegs(d.new, esc, open, close)];
}

function htmlReport(title: string, sub: string, rows: Row[]): string {
  const body = rows.map((r) => {
    const [o, n] = cells(r, escHtml, '<u>', '</u>');
    return `<tr class="${r.type}"><td class="k">${TYPE_LABEL[r.type]}</td><td>${o}</td><td>${n}</td></tr>`;
  }).join('\n');
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><title>${escHtml(title)}</title><style>
body{font-family:"맑은 고딕","Malgun Gothic","Apple SD Gothic Neo",sans-serif;margin:24px;color:#222}
h1{font-size:20px;text-align:center;margin-bottom:4px}p.sub{text-align:center;color:#666;margin-top:0}
table{border-collapse:collapse;width:100%;table-layout:fixed}
th,td{border:1px solid #999;padding:6px 8px;vertical-align:top;white-space:pre-wrap;word-break:keep-all;font-size:14px;line-height:1.6}
th{background:#eef2f8}td.k,th.k{width:56px;text-align:center;color:#555}
u{font-weight:bold;text-decoration-color:#c00}tr.added td{background:#f3fbf3}tr.removed td{background:#fdf3f3}tr.unchanged td{color:#777}
@media print{body{margin:0}}
</style></head><body>
<h1>${escHtml(title)}</h1><p class="sub">${escHtml(sub)}</p>
<table><tr><th class="k">구분</th><th>현 행</th><th>개 정 안</th></tr>
${body}
</table></body></html>
`;
}

function mdReport(title: string, sub: string, rows: Row[]): string {
  const lines = rows.map((r) => {
    const [o, n] = cells(r, escCell, '**', '**');
    return `| ${TYPE_LABEL[r.type]} | ${o || ' '} | ${n || ' '} |`;
  });
  return `# ${title}\n\n${sub}\n\n| 구분 | 현 행 | 개 정 안 |\n| --- | --- | --- |\n${lines.join('\n')}\n`;
}

async function diffFiles(oldPath: string, newPath: string, signal?: AbortSignal) {
  sendProgress({ current: 0, total: 2, message: '두 문서 읽는 중' });
  const [a, b] = await Promise.all([readFile(oldPath), readFile(newPath)]);
  signal?.throwIfAborted();
  const diff = await compare(toAB(a), toAB(b));
  signal?.throwIfAborted();
  sendProgress({ current: 1, total: 2, message: '비교 결과 정리 중' });
  return diff;
}

const statLine = (s: CompareResult['stats']) => `변경 ${s.modified} · 신설 ${s.added} · 삭제 ${s.removed} · 같음 ${s.unchanged}`;

export async function compareDocs(
  p: { old_path: string; new_path: string; export?: 'html' | 'md' | 'xlsx'; output_path?: string },
  signal?: AbortSignal,
): Promise<CompareResult> {
  const diff = await diffFiles(p.old_path, p.new_path, signal);
  const rows = compareRows(diff.diffs);
  if (!p.export) return { stats: diff.stats, rows };

  const title = '신구대조표';
  const sub = `현행: ${basename(p.old_path)} · 개정안: ${basename(p.new_path)} (${statLine(diff.stats)})`;
  let data: Buffer | string;
  if (p.export === 'html') data = htmlReport(title, sub, rows);
  else if (p.export === 'md') data = mdReport(title, sub, rows);
  else {
    data = await buildXlsx([{
      name: title,
      header: true,
      rows: [['구분', '현 행', '개 정 안'], ...rows.map((r) => [TYPE_LABEL[r.type], r.old, r.new])],
    }]);
  }
  const outPath = outputFile({ output_path: p.output_path, source: p.new_path, name: `${stemOf(p.new_path)}_신구대조표.${p.export}` });
  await writeFile(outPath, data);
  return { stats: diff.stats, rows, output_path: outPath };
}

/** 공식 여백(좌우 20mm) A4 본문 폭 170mm 를 두 칸으로 나눈 HWPUNIT */
const HALF_WIDTH = String(Math.floor((170 * 7200) / 25.4 / 2));

/** 신·구조문대비표 — 법제 관행: 안 바뀐 곳 "(현행과 같음)", 새 조문 "<신 설>", 지운 조문 "<삭 제>", 바뀐 어절 굵게 */
export async function compareHwpx(
  p: { old_path: string; new_path: string; title?: string; output_path?: string },
  signal?: AbortSignal,
): Promise<{ output_path: string; stats: CompareResult['stats'] }> {
  const diff = await diffFiles(p.old_path, p.new_path, signal);
  const rows = compareRows(diff.diffs);
  if (!rows.some((r) => r.type !== 'unchanged')) throw new Error('두 문서에서 바뀐 곳을 찾지 못했습니다.');
  const lines = rows.map((r) => {
    if (r.type === 'unchanged') return `| ${escCell(r.old)} | (현행과 같음) |`;
    if (r.type === 'added') return `| ${escCell('<신 설>')} | ${markSegs([{ text: r.new, changed: true }], escCell, '**', '**')} |`;
    if (r.type === 'removed') return `| ${markSegs([{ text: r.old, changed: true }], escCell, '**', '**')} | ${escCell('<삭 제>')} |`;
    const [o, n] = cells(r, escCell, '**', '**');
    return `| ${o} | ${n} |`;
  });
  const title = p.title?.trim() || '신·구조문대비표';
  const md = `# ${escCell(title)}\n\n| 현 행 | 개 정 안 |\n| --- | --- |\n${lines.join('\n')}\n`;
  const profile = { tables: [{ table_index: 0, rows: rows.length + 1, cols: 2, col_widths_hwpunit: [HALF_WIDTH, HALF_WIDTH], cells: [], used_border_fills: {} }] };
  const buf = await markdownToHwpx(md, { gongmun: { preset: 'official', endMark: false }, profile });
  const outPath = outputFile({ output_path: p.output_path, source: p.new_path, name: `${stemOf(p.new_path)}_신구조문대비표.hwpx` });
  await writeFile(outPath, Buffer.from(buf));
  return { output_path: outPath, stats: diff.stats };
}
