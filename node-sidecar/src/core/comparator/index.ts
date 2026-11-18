/** 문서 비교 — compare(신구대조 행 + HTML·MD·XLSX 내보내기) · compare_hwpx(신·구조문대비표 한글 문서)
 *
 * kordoc compare 는 교차 포맷(HWP ↔ HWPX ↔ PDF …) 블록 비교. 화면용 행은 바뀐 곳 위주로 줄이고
 * (안 바뀐 블록은 바뀐 곳 앞뒤 1개씩만), 바뀐 행은 어절 단위로 다른 곳을 짚는다.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { blocksToMarkdown, diffBlocks, markdownToHwpx, parse, type BlockDiff, type DiffResult, type IRBlock } from 'kordoc';
import type { CompareResult } from '../../types/rpc-contract.js';
import { sendProgress } from '../../infra/progress.js';
import { registerJob, runJob } from '../../infra/worker.js';
import { buildXlsx } from '../excel/xlsx.js';
import { tableGrid } from '../excel/index.js';
import { outputFile, stemOf } from '../output/index.js';
import { parseFailure } from '../errors.js';

type Row = CompareResult['rows'][number];
interface Seg { text: string; changed: boolean }

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

/** 가운데 두 쪽 블록 수를 곱한 값이 이만큼을 넘으면 기준점으로 잘라 비교한다.
 *  kordoc 은 1e7(약 3,163개씩)을 넘으면 차례대로만 짝짓고, 그 아래에서도 1,000×1,000 짝을 견주는 데 20초 걸렸다(실측) */
const ANCHOR_FROM = 1e5;
const blockKey = (b: IRBlock) => `${b.type}\u0000${blockText(b)}`;

/** 양쪽 가운데에 한 번씩만 나오는 같은 블록 짝 중 차례가 어긋나지 않는 가장 긴 줄 (나눠 비교할 기준점) */
function anchors(ka: string[], kb: string[], i0: number, i1: number, j0: number, j1: number): Array<[number, number]> {
  const once = (keys: string[], from: number, to: number) => {
    const at = new Map<string, number>();
    for (let k = from; k < to; k++) at.set(keys[k], at.has(keys[k]) ? -1 : k);
    return at;
  };
  const inA = once(ka, i0, i1);
  const inB = once(kb, j0, j1);
  const pairs: Array<[number, number]> = [];
  for (const [key, i] of inA) {
    const j = inB.get(key);
    if (i >= 0 && j !== undefined && j >= 0) pairs.push([i, j]);
  }
  pairs.sort((x, y) => x[0] - y[0]);
  // B 차례가 늘어나는 가장 긴 부분열
  const tails: number[] = [];
  const prev = new Int32Array(pairs.length).fill(-1);
  pairs.forEach(([, j], k) => {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (pairs[tails[mid]][1] < j) lo = mid + 1; else hi = mid; }
    if (lo > 0) prev[k] = tails[lo - 1];
    tails[lo] = k;
  });
  const out: Array<[number, number]> = [];
  for (let k = tails.at(-1) ?? -1; k >= 0; k = prev[k]) out.push(pairs[k]);
  return out.reverse();
}

/** kordoc diffBlocks 앞에 같은 블록을 떼어 낸다. 블록이 많으면 kordoc 이 차례대로만 짝지어 문단 하나만 끼워도 뒤가 모두 "변경"이 됐다.
 *  앞뒤로 같은 블록은 "같음"으로 두고 가운데만 비교하고, 가운데도 크면 양쪽에 한 번씩만 나오는 같은 블록을 기준점으로 잘라 조각마다 비교한다
 *  (조각 하나가 여전히 아주 크면 그 조각은 kordoc 대로 차례대로 짝지어진다) */
export function diffBlockLists(A: IRBlock[], B: IRBlock[]): DiffResult {
  const ka = A.map(blockKey);
  const kb = B.map(blockKey);
  let p = 0;
  while (p < A.length && p < B.length && ka[p] === kb[p]) p++;
  let s = 0;
  while (s < A.length - p && s < B.length - p && ka[A.length - 1 - s] === kb[B.length - 1 - s]) s++;
  const out: DiffResult = { stats: { added: 0, removed: 0, modified: 0, unchanged: 0 }, diffs: [] };
  const same = (i: number, j: number) => { out.diffs.push({ type: 'unchanged', before: A[i], after: B[j], similarity: 1 }); out.stats.unchanged++; };
  const part = (i0: number, i1: number, j0: number, j1: number) => {
    if (i0 === i1 && j0 === j1) return;
    const d = diffBlocks(A.slice(i0, i1), B.slice(j0, j1));
    for (const x of d.diffs) out.diffs.push(x);
    out.stats.added += d.stats.added;
    out.stats.removed += d.stats.removed;
    out.stats.modified += d.stats.modified;
    out.stats.unchanged += d.stats.unchanged;
  };
  for (let k = 0; k < p; k++) same(k, k);
  const i1 = A.length - s;
  const j1 = B.length - s;
  if ((i1 - p) * (j1 - p) <= ANCHOR_FROM) part(p, i1, p, j1);
  else {
    let i = p;
    let j = p;
    for (const [ai, bj] of anchors(ka, kb, p, i1, p, j1)) { part(i, ai, j, bj); same(ai, bj); i = ai + 1; j = bj + 1; }
    part(i, i1, j, j1);
  }
  for (let k = s; k > 0; k--) same(A.length - k, B.length - k);
  return out;
}

/** 작업자 스레드에서 두 문서를 읽고 비교한다 (1,000문단 비교에 엔진이 18초쯤 멈추고 취소도 못 받았다). 받는 값은 구조화 복제되는 Uint8Array */
registerJob('compare', async ({ a, b }: { a: Uint8Array; b: Uint8Array }): Promise<DiffResult> => {
  const buf = (u: Uint8Array) => Buffer.from(u.buffer, u.byteOffset, u.byteLength);
  const [ra, rb] = await Promise.all([parse(buf(a)), parse(buf(b))]);
  // kordoc compare 와 같은 문구 (compareError 가 어느 쪽인지 읽는다)
  if (!ra.success) throw new Error(`문서A 파싱 실패: ${ra.error}`);
  if (!rb.success) throw new Error(`문서B 파싱 실패: ${rb.error}`);
  return diffBlockLists(ra.blocks, rb.blocks);
});

/** 여러 줄 글(표는 행마다 한 줄)은 줄부터 맞추고, 짝지은 줄 안에서 어절을 견준다. 사이에 남은 줄은 차례대로 짝짓고 남는 줄은 통째로 바뀜 */
function lineDiff(a: string, b: string): { old: Seg[]; new: Seg[] } {
  const A = a.split('\n');
  const B = b.split('\n');
  const w = B.length + 1;
  // 줄이 아주 많으면 맞추지 않고 차례대로 짝짓는다
  const dp = A.length * B.length > 4_000_000 ? null : new Uint32Array((A.length + 1) * w);
  if (dp) {
    for (let i = A.length - 1; i >= 0; i--) {
      for (let j = B.length - 1; j >= 0; j--) dp[i * w + j] = A[i] === B[j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
    }
  }
  const oldL: Seg[][] = [];
  const newL: Seg[][] = [];
  const gap = (i0: number, i1: number, j0: number, j1: number) => {
    for (let k = 0; i0 + k < i1 || j0 + k < j1; k++) {
      if (i0 + k < i1 && j0 + k < j1) {
        const d = wordDiff(A[i0 + k], B[j0 + k]);
        oldL.push(d.old);
        newL.push(d.new);
      } else if (i0 + k < i1) oldL.push([{ text: A[i0 + k], changed: true }]);
      else newL.push([{ text: B[j0 + k], changed: true }]);
    }
  };
  let i = 0;
  let j = 0;
  if (dp) {
    let gi = 0;
    let gj = 0;
    while (i < A.length && j < B.length) {
      if (A[i] === B[j]) {
        gap(gi, i, gj, j);
        oldL.push([{ text: A[i], changed: false }]);
        newL.push([{ text: B[j], changed: false }]);
        gi = ++i;
        gj = ++j;
      } else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) i++;
      else j++;
    }
    gap(gi, A.length, gj, B.length);
  } else gap(0, A.length, 0, B.length);
  const flat = (lines: Seg[][]) => {
    const out: Seg[] = [];
    lines.forEach((segs, k) => {
      for (const s of k ? [{ text: '\n', changed: false }, ...segs] : segs) {
        const last = out.at(-1);
        if (!s.text) continue;
        if (last && last.changed === s.changed) last.text += s.text;
        else out.push({ ...s });
      }
    });
    return out;
  };
  return { old: flat(oldL), new: flat(newL) };
}

/** 어절 단위 차이 — 같은 어절은 그대로, 다른 어절만 changed.
 *  여러 줄 글은 줄마다 견준다: 통째로 견주면 큰 표(어절 2,000개 넘게)는 아래 한도에 걸려 몇 칸만 바뀌어도 표 전체가 바뀐 것으로 나왔고,
 *  줄 끝과 다음 줄 첫머리가 함께 바뀌면 굵게가 줄바꿈을 넘어 대비표에 별표가 글자로 찍혔다 */
export function wordDiff(a: string, b: string): { old: Seg[]; new: Seg[] } {
  if (a.includes('\n') || b.includes('\n')) return lineDiff(a, b);
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

/** 바뀐 조각을 감싸되 앞뒤 공백은 밖으로 (마크다운 굵게가 공백으로 시작·끝나면 안 됨). 줄바꿈을 넘는 조각은 줄마다 감싼다 —
 *  표 칸 글은 <br> 로 갈려 문단이 되므로 "**새1<br>새2**" 의 별표가 짝을 잃고 글자로 찍혔다(이웃 두 줄의 끝·첫 어절이 함께 바뀐 경우) */
export function markSegs(segs: Seg[], esc: (s: string) => string, open: string, close: string): string {
  const wrap = (part: string) => {
    if (!part.trim()) return esc(part);
    const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(part)!;
    return `${m[1]}${open}${esc(m[2])}${close}${m[3]}`;
  };
  return segs.map((s) => {
    if (!s.changed || !s.text.trim()) return esc(s.text);
    return s.text.split(/(\r?\n)/).map((part) => (/^\r?\n$/.test(part) ? esc(part) : wrap(part))).join('');
  }).join('');
}

/** 여러 줄 글(표·여러 문단)을 줄마다 굵게. 통째로 감싸면 줄바꿈(<br>)을 넘는 굵게가 풀려 별표가 글자로 찍힌다 */
const boldLines = (text: string) => text.split(/\r?\n/).map((l) => markSegs([{ text: l, changed: true }], (s) => s.replace(/[\\`*_|<>$[\]#~]/g, (ch) => `\\${ch}`), '**', '**')).join('<br>');

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

/** kordoc compare 의 "문서A 파싱 실패: …" → 어느 쪽 문서를 못 읽었는지와 할 일 (A 가 옛 문서, B 가 새 문서) */
export function compareError(err: unknown): unknown {
  const m = /^문서([AB]) 파싱 실패:\s*([\s\S]*)$/.exec(err instanceof Error ? err.message : String(err));
  if (!m) return err;
  const which = m[1] === 'A' ? '옛 문서' : '새 문서';
  const why = m[2].trim() ? parseFailure({ error: m[2] }).message : '파일이 손상됐거나 비교할 수 없는 형식입니다.';
  return new Error(`${which}를 읽지 못했습니다. ${why}`);
}

export async function diffFiles(oldPath: string, newPath: string, signal?: AbortSignal) {
  sendProgress({ current: 0, total: 2, message: '두 문서 읽는 중' });
  const [a, b] = await Promise.all([readFile(oldPath), readFile(newPath)]);
  signal?.throwIfAborted();
  // 작업자에서 비교한다: 엔진은 그동안 다른 요청을 받고, 취소하면 작업자를 끝내 바로 멈춘다 (시작 파일을 모르는 시험에서는 같은 스레드)
  const diff = await runJob<DiffResult>('compare', { a, b }, { signal }).result.catch((err) => { throw compareError(err); });
  signal?.throwIfAborted();
  // 엔진은 99% 넘게 닮은 문단·표를 "같음"으로 낸다. 긴 조문에서 금액 한 글자("1,000만원" → "9,000만원")나
  // "할 수 있으며" → "할 수 없으며" 만 바뀐 것이 "바뀐 곳 없음"으로 나가면 안 된다 → 글이 한 글자라도 다르면 "변경"
  for (const d of diff.diffs) {
    if (d.type !== 'unchanged' || blockText(d.before) === blockText(d.after)) continue;
    d.type = 'modified';
    diff.stats.unchanged--;
    diff.stats.modified++;
  }
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
  if (!rows.some((r) => r.type !== 'unchanged')) throw new Error('두 문서 내용이 같습니다. 바뀐 곳이 없어 대조표를 만들지 않았습니다. 고친 문서를 새 문서 자리에 넣었는지 확인하세요.');
  const lines = rows.map((r) => {
    if (r.type === 'unchanged') return `| ${escCell(r.old)} | (현행과 같음) |`;
    if (r.type === 'added') return `| ${escCell('<신 설>')} | ${boldLines(r.new)} |`;
    if (r.type === 'removed') return `| ${boldLines(r.old)} | ${escCell('<삭 제>')} |`;
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
