/** 문서 수합 (collect_gather·collect_roster) — 부서 제출물 폴더 + 부서 명단 → 엑셀 한 장 + 미제출 부서·독촉 글
 *
 * 1. 엑셀·CSV 제출물: 열 이름 줄(칸이 둘 이상 찬 첫 줄) 아래를 행으로 잇는다. 합계·소계 줄은 뺀다(수합 합계와 겹친다).
 * 2. 한글·워드·PDF: 누름틀·라벨 표 칸(extract/readFormDoc). 문서 절반 이상에 있는 칸을 기준 칸으로 삼고,
 *    기준 칸의 60% 이상을 가진 문서를 같은 서식으로 친다.
 * 3. 서식이 다른 문서는 use_ai 이고 AI 가 연결돼 있으면 기준 칸으로 AI 가 뽑고, 아니면 "따로 봐야 할 문서"로 남긴다.
 * 열 이름은 띄어쓰기·괄호 설명을 지우고 맞춘다(희망 인원(명) = 희망인원). 부서·담당자·연락처는 흔한 다른 이름도 같은 열로 친다.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import type { BatchItemResult, CollectGatherParams, CollectGatherResult } from '../../types/rpc-contract.js';
import { sendProgress } from '../../infra/progress.js';
import { aiStatus } from '../ai/status.js';
import { extractTable } from '../ai/extract.js';
import { parseDoc, readTextFile } from '../converter/index.js';
import { errorText } from '../errors.js';
import { parseCsv } from '../excel/csv.js';
import { tableGrid } from '../excel/index.js';
import { buildXlsx } from '../excel/xlsx.js';
import { readFormDoc } from '../extract/index.js';
import { formatOf } from '../files/format.js';
import { outputFile, safeFileName, stemOf } from '../output/index.js';
import { buildBook, buildStatus, reminderText, type Column, type GatherRow } from './book.js';
import { matchDept, norm, rosterFromFile, rosterFromText } from './dept.js';

const EXCEL = new Set(['xlsx', 'xls', 'csv']);
const DEPT_KEY = '부서명';
const SYNONYM: Array<[RegExp, string]> = [
  [/^(부서|부서명|소속|소속부서|과명|팀명|제출부서|부서및팀)$/, DEPT_KEY],
  [/^(담당|담당자|담당자명|작성자)$/, '담당자'],
  [/^(연락처|전화|전화번호|내선|내선번호)$/, '연락처'],
];
/** 표 머리 줄을 칸으로 잘못 읽은 것 (항목 | 내용) */
const HEADER_VALUE = /^(내용|내역|값|기재란|작성란|기재내용)$/;
const TOTAL_CELL = /^(합계|총계|소계|계|총합계)$/;

/** 열 맞추기 열쇠 */
export function colKey(label: string): string {
  const k = norm(label.replace(/\(.*?\)|（.*?）/g, ''));
  return SYNONYM.find(([re]) => re.test(k))?.[1] ?? k;
}

interface DocSub { kind: 'doc'; path: string; fields: Array<{ label: string; value: string }>; text: string; title: string }
interface ExcelSub { kind: 'excel'; path: string; header: string[]; rows: string[][] }

/** 마크다운 첫 제목 (없으면 표가 아닌 첫 줄) */
function docTitle(md: string): string {
  const lines = md.split('\n').map((l) => l.trim()).filter(Boolean);
  const h = lines.find((l) => /^#{1,3}\s/.test(l));
  const t = (h ?? lines.find((l) => !l.startsWith('|') && !l.startsWith('!')) ?? '').replace(/^#+\s*/, '').replace(/[*_\\]/g, '').trim();
  return t.length <= 60 ? t : '';
}

async function readExcel(path: string, signal: AbortSignal): Promise<{ header: string[]; rows: string[][] }> {
  let grid: string[][];
  if (formatOf(path) === 'csv') grid = parseCsv(await readTextFile(path));
  else {
    const r = await parseDoc(path, { images: false, ocr: 'off', signal });
    const t = r.blocks.find((b) => b.type === 'table' && b.table && b.table.rows >= 2)?.table;
    if (!t) throw new Error('엑셀 첫 시트에서 표를 찾지 못했습니다. 첫 줄에 열 이름이 있는지 확인하세요.');
    grid = tableGrid(t);
  }
  const filled = (r: string[]) => r.filter((c) => c.trim()).length;
  const hi = grid.findIndex((r) => filled(r) >= 2);
  if (hi < 0) throw new Error('엑셀에 열 이름 줄이 없습니다. 첫 줄에 열 이름을 적어 주세요.');
  const header = grid[hi].map((c, i) => c.replace(/\s*\n\s*/g, ' ').trim() || `열${i + 1}`);
  const rows = grid.slice(hi + 1).filter((r) => filled(r) > 0 && !r.some((c) => TOTAL_CELL.test(norm(c))));
  return { header, rows };
}

export async function collectRoster(p: { text?: string; path?: string }, signal?: AbortSignal): Promise<{ names: string[] }> {
  const names = p.path ? await rosterFromFile(p.path, signal) : rosterFromText(p.text ?? '');
  if (!names.length) throw new Error(p.path ? '명단 파일에서 부서 이름을 찾지 못했습니다. 첫 열이나 "부서" 열에 부서 이름을 한 줄에 하나씩 적어 주세요.' : '부서 이름을 한 줄에 하나씩 적어 주세요.');
  return { names };
}

const mostCommon = (xs: string[]) => {
  const n = new Map<string, number>();
  for (const x of xs) if (x) n.set(x, (n.get(x) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
};

/** 앞서 만든 수합 엑셀 (제출물 폴더 옆에 저장돼 폴더째 다시 넣으면 섞여 들어온다) */
const OWN_OUTPUT = /_수합(?: \(\d+\))?\.xlsx$/;

export async function collectGather(p: CollectGatherParams, signal: AbortSignal): Promise<CollectGatherResult> {
  p = { ...p, paths: p.paths.filter((x) => !OWN_OUTPUT.test(basename(x).normalize('NFC'))) };
  if (!p.paths.length) throw new Error('수합할 제출 파일을 넣으세요.');
  const roster = rosterFromText((p.roster ?? []).join('\n'));
  const total = p.paths.length + 1;

  // ── 읽기 ──
  const subs: Array<DocSub | ExcelSub> = [];
  const failed: BatchItemResult[] = [];
  for (const [i, path] of p.paths.entries()) {
    signal.throwIfAborted();
    sendProgress({ current: i, total, message: `${basename(path)} 읽는 중 (${i + 1}/${p.paths.length})` });
    try {
      if (EXCEL.has(formatOf(path))) subs.push({ kind: 'excel', path, ...(await readExcel(path, signal)) });
      else {
        const d = await readFormDoc(path, signal);
        subs.push({ kind: 'doc', path, fields: d.fields.filter((f) => !HEADER_VALUE.test(norm(f.value))), text: d.markdown, title: docTitle(d.markdown) });
      }
    } catch (err) {
      if (signal.aborted) throw err;
      failed.push({ path, ok: false, error: errorText(err) });
    }
  }
  const docs = subs.filter((s): s is DocSub => s.kind === 'doc');
  const excels = subs.filter((s): s is ExcelSub => s.kind === 'excel');

  // ── 기준 칸 (같은 서식) ──
  const count = new Map<string, number>();
  const labelOf = new Map<string, string>();
  const order: string[] = [];
  for (const d of docs) {
    const seen = new Set<string>();
    for (const f of d.fields) {
      const k = colKey(f.label);
      if (!k || seen.has(k)) continue;
      seen.add(k);
      count.set(k, (count.get(k) ?? 0) + 1);
      if (!labelOf.has(k)) { labelOf.set(k, f.label); order.push(k); }
    }
  }
  let base: string[];
  if (p.fields?.length) {
    base = [...new Set(p.fields.map(colKey).filter(Boolean))];
    p.fields.forEach((f) => labelOf.set(colKey(f), f));
  } else {
    const top = Math.max(0, ...count.values());
    const need = docs.length === 1 ? 1 : Math.max(2, Math.ceil(top / 2));
    base = order.filter((k) => (count.get(k) ?? 0) >= need);
    if (base.length < 2) base = [];
  }
  const minHit = Math.min(base.length, Math.max(2, Math.ceil(base.length * 0.6)));
  const hits = (d: DocSub) => new Set(d.fields.map((f) => colKey(f.label)).filter((k) => base.includes(k))).size;
  const same = base.length ? docs.filter((d) => hits(d) >= minHit) : [];
  const diff = docs.filter((d) => !same.includes(d));

  // ── 열 ──
  const columns: Column[] = base.map((k) => ({ key: k, label: labelOf.get(k) ?? k, required: true }));
  const colOf = new Map(columns.map((c) => [c.key, c]));
  const excelCount = new Map<string, number>();
  for (const x of excels) {
    for (const k of new Set(x.header.map(colKey))) {
      if (!colOf.has(k)) {
        const c: Column = { key: k, label: x.header.find((h) => colKey(h) === k)!, required: false };
        columns.push(c);
        colOf.set(k, c);
      }
      excelCount.set(k, (excelCount.get(k) ?? 0) + 1);
    }
  }
  if (!base.length) for (const c of columns) c.required = (excelCount.get(c.key) ?? 0) >= Math.ceil(excels.length / 2);

  // ── 행 ──
  const rows: GatherRow[] = [];
  const filed: Array<{ file: string; dept: string; in_roster: boolean }> = [];
  const separate: CollectGatherResult['separate'] = [];
  const docDept = (d: DocSub) => matchDept(roster, { path: d.path, values: d.fields.filter((f) => colKey(f.label) === DEPT_KEY).map((f) => f.value), text: d.text });
  const pushDoc = (d: DocSub, cells: Map<string, string>, note?: string, skip = false) => {
    const m = docDept(d);
    rows.push({ file: basename(d.path), dept: m.dept, cells, ...(note ? { note } : {}), ...(skip ? { skip } : {}) });
    filed.push({ file: basename(d.path), ...m });
    return m;
  };
  for (const d of same) {
    const cells = new Map<string, string>();
    for (const f of d.fields) {
      const k = colKey(f.label);
      if (colOf.has(k) && !cells.get(k)) cells.set(k, f.value);
    }
    pushDoc(d, cells);
  }
  for (const x of excels) {
    const file = basename(x.path);
    const fileM = matchDept(roster, { path: x.path, values: [], text: [x.header, ...x.rows].map((r) => r.join(' ')).join('\n') });
    const deptCol = x.header.findIndex((h) => colKey(h) === DEPT_KEY);
    const depts = new Map<string, boolean>();
    for (const r of x.rows) {
      const cells = new Map<string, string>();
      x.header.forEach((h, i) => { if ((r[i] ?? '').trim() && !cells.get(colKey(h))) cells.set(colKey(h), r[i].trim()); });
      const own = deptCol >= 0 && r[deptCol]?.trim() ? matchDept(roster, { path: '', values: [r[deptCol]], text: '' }) : null;
      const m = own?.in_roster ? own : fileM.dept ? fileM : own ?? fileM;
      rows.push({ file, dept: m.dept, cells });
      depts.set(m.dept, m.in_roster);
    }
    if (!depts.size) depts.set(fileM.dept, fileM.in_roster);
    for (const [dept, in_roster] of depts) filed.push({ file, dept, in_roster });
  }

  let aiCount = 0;
  const required = columns.filter((c) => c.required);
  if (diff.length && p.use_ai && required.length && aiStatus().configured) {
    sendProgress({ current: p.paths.length, total, message: `서식이 다른 문서 ${diff.length}개를 AI로 뽑는 중` });
    const dir = await mkdtemp(join(tmpdir(), 'kordoc-gather-'));
    try {
      const r = await extractTable({ paths: diff.map((d) => d.path), columns: required.map((c) => c.label), output_path: join(dir, 'ai.csv') }, signal);
      const bad = new Map(r.failed.map((f) => [f.path, f.error ?? '']));
      let j = 0;
      for (const d of diff) {
        if (bad.has(d.path)) {
          const m = pushDoc(d, new Map(), 'AI로 뽑지 못해 따로 확인', true);
          separate.push({ path: d.path, dept: m.dept, reason: `AI로 뽑지 못했습니다: ${bad.get(d.path)}` });
          continue;
        }
        const got = r.rows[j++] ?? {};
        pushDoc(d, new Map(required.map((c) => [c.key, (got[c.label] ?? '').trim()])), 'AI로 뽑음 (원문과 대조 필요)');
        aiCount++;
      }
    } catch (err) {
      if (signal.aborted) throw err;
      for (const d of diff) {
        const m = pushDoc(d, new Map(), '서식이 달라 따로 확인', true);
        separate.push({ path: d.path, dept: m.dept, reason: `AI로 뽑지 못했습니다: ${errorText(err)}` });
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  } else {
    for (const d of diff) {
      const m = pushDoc(d, new Map(), '서식이 달라 따로 확인', true);
      separate.push({ path: d.path, dept: m.dept, reason: d.fields.length ? '서식이 달라 칸을 맞추지 못했습니다' : '표나 누름틀 칸이 없는 문서입니다' });
    }
  }
  for (const f of failed) {
    const m = matchDept(roster, { path: f.path, values: [], text: '' });
    rows.push({ file: basename(f.path), dept: m.dept, cells: new Map(), note: '읽지 못함', skip: true });
    filed.push({ file: basename(f.path), ...m });
  }
  // 명단 순서 → 파일 이름 순 (부서를 모르면 뒤로)
  const rank = (d: string) => { const i = roster.indexOf(d); return i >= 0 ? i : d ? roster.length : roster.length + 1; };
  rows.sort((a, b) => rank(a.dept) - rank(b.dept) || a.dept.localeCompare(b.dept, 'ko') || a.file.localeCompare(b.file, 'ko'));

  // ── 저장 ──
  sendProgress({ current: p.paths.length, total, message: '엑셀로 저장하는 중' });
  const status = buildStatus(roster, filed, rows, columns);
  const book = buildBook(columns, rows, status, roster.length > 0);
  const title = mostCommon(same.map((d) => d.title)) || mostCommon(docs.map((d) => d.title));
  const name = `${safeFileName(title || stemOf(p.paths[0]), '문서')}_수합.xlsx`;
  const outPath = outputFile({ output_path: p.output_path, output_dir: p.output_dir, source: p.paths[0], name, overwrite: p.overwrite });
  await writeFile(outPath, await buildXlsx(book.sheets));
  sendProgress({ current: total, total, message: `${rows.length}줄을 모았습니다` });

  const missing = status.filter((s) => s.in_roster && !s.submitted).map((s) => s.dept);
  return {
    output_path: outPath,
    rows: rows.length,
    columns: columns.map((c) => ({ label: c.label, required: c.required, ...(book.totals.has(c.key) ? { total: book.totals.get(c.key) } : {}) })),
    by_kind: { form: same.length, excel: excels.length, ai: aiCount },
    separate,
    failed,
    blanks: book.blanks,
    status,
    missing,
    reminder: reminderText(missing, title, p.deadline),
    title,
  };
}
