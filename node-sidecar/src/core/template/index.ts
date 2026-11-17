/** 서식 칸 채우기 — template_fields·template_fill(내장 기안문 2종 또는 사용자 HWPX) · mail_merge(명부 한 줄 = 문서 한 장)
 *
 * 칸은 누름틀(CLICK_HERE) 이름이 먼저, 누름틀이 없는 서식은 라벨-값 표 칸(extractFormSchema).
 * fillHwpx 가 누름틀 이름으로 먼저 채우고 남은 키는 라벨로 찾는다 (원본 서식 바이트 보존).
 */

import { existsSync } from 'node:fs';
import { readFile, rm, rmdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  extractClickHereFields, extractFormSchema, fillHwpx, fillWithUniqueGuard, formatFillValue, readBuiltinTemplate, readBuiltinTemplateSample, resolveBuiltinTemplate,
} from 'kordoc';
import { sendProgress } from '../../infra/progress.js';
import { errorText } from '../errors.js';
import { parseDoc, readTextFile } from '../converter/index.js';
import { parseCsv } from '../excel/csv.js';
import { tableGrid, tableMerges } from '../excel/index.js';
import { formatOf } from '../files/format.js';
import { outputDir, outputFile, safeFileName, stemOf, uniquePath } from '../output/index.js';
import { isHeaderField } from '../fill/index.js';
import { orgAutofill } from './org.js';
import { readSheetView } from './xlsx-view.js';
import type { MailMergePlan } from '../../types/rpc-contract.js';

export interface LoadedTemplate {
  buf: ArrayBuffer;
  /** 결과 파일 이름의 뿌리 */
  name: string;
  source?: string;
  sample: Record<string, string>;
}

const toAB = (b: Buffer): ArrayBuffer => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

export async function loadTemplate(template?: string, path?: string): Promise<LoadedTemplate> {
  if (template) {
    const t = resolveBuiltinTemplate(template);
    if (!t) throw new Error(`내장 서식을 찾을 수 없습니다: ${template}. gian(일반기안문)·gian-simple(간이기안문) 중에서 고르세요.`);
    return { buf: readBuiltinTemplate(t), name: t.aliases[0] ?? t.id, sample: readBuiltinTemplateSample(t) };
  }
  if (!path) throw new Error('서식 파일을 고르세요.');
  const fmt = formatOf(path);
  if (fmt === 'hwp') throw new Error('HWP 서식은 칸 채우기를 못 합니다. 한글에서 HWPX로 저장하거나 편집기에서 여세요.');
  if (fmt !== 'hwpx') throw new Error('칸 채우기는 HWPX 서식만 됩니다.');
  return { buf: toAB(await readFile(path)), name: stemOf(path), source: path, sample: {} };
}

const MULTILINE = /본문|내용|요약|설명|사유|의견/;

export async function templateFields(p: { template?: string; path?: string }): Promise<{ fields: Array<{ name: string; label?: string; multiline?: boolean }> }> {
  const t = await loadTemplate(p.template, p.path);
  const click = await extractClickHereFields(t.buf);
  if (click.length) {
    const seen = new Set<string>();
    return {
      fields: click.filter((f) => !seen.has(f.name) && seen.add(f.name)).map((f) => ({
        name: f.name,
        ...(f.placeholder?.trim() ? { label: f.placeholder.trim() } : {}),
        ...((t.sample[f.name] ?? '').includes('\n') || MULTILINE.test(f.name) ? { multiline: true } : {}),
      })),
    };
  }
  const r = await parseDoc(p.path!, { images: false, ocr: 'off', keepLayout: true });
  // "항목 | 내용" 같은 표 머리 행은 칸이 아니다
  const labels = [...new Set(extractFormSchema(r.blocks).fields.filter((f) => !isHeaderField(f.label, f.value)).map((f) => f.label.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean))];
  return { fields: labels.map((name) => ({ name, ...(MULTILINE.test(name) ? { multiline: true } : {}) })) };
}

const nonEmpty = (values: Record<string, string>) => Object.fromEntries(Object.entries(values ?? {}).filter(([, v]) => typeof v === 'string' && v.trim() !== ''));

export async function templateFill(p: { template?: string; path?: string; values: Record<string, string>; output_path?: string }): Promise<{ output_path: string; filled: string[]; unmatched: string[] }> {
  const values = nonEmpty(p.values);
  if (!Object.keys(values).length) throw new Error('채울 값이 없습니다. 칸에 내용을 적으세요.');
  const t = await loadTemplate(p.template, p.path);
  const r = await fillHwpx(t.buf, values);
  const name = t.source ? `${t.name}_채움.hwpx` : `${safeFileName(values['제목'] ?? '', t.name)}.hwpx`;
  const outPath = outputFile({ output_path: p.output_path, source: t.source, name });
  await writeFile(outPath, Buffer.from(r.buffer));
  return { output_path: outPath, filled: [...new Set(r.filled.map((f) => f.label))], unmatched: r.unmatched };
}

/** 명부 → [머리 행, 데이터 행들(엑셀 줄 번호), 건너뛴 숨긴 행 수] — 머리는 칸이 둘 이상 찬 첫 줄 */
async function readRoster(dataPath: string): Promise<{ header: string[]; rows: Array<{ row: number; cells: string[] }>; hidden: number }> {
  const fmt = formatOf(dataPath);
  let grid: string[][];
  let merges: NonNullable<ReturnType<typeof tableMerges>> = [];
  // 표 줄 → 명부 줄 번호 (엑셀은 글 없는 줄이 표에서 빠지므로 시트 줄 번호로)
  let rowNo = (i: number) => i + 1;
  let isHidden = (_i: number) => false;
  if (fmt === 'csv' || fmt === 'txt') grid = parseCsv(await readTextFile(dataPath));
  else if (fmt === 'xlsx' || fmt === 'xls') {
    const r = await parseDoc(dataPath, { images: false, ocr: 'off' });
    const block = r.blocks.find((b) => b.type === 'table' && b.table);
    const table = block?.table;
    if (!table) throw new Error('명부 첫 시트에서 표를 찾지 못했습니다.');
    grid = tableGrid(table);
    const { sourceRows, sourceCols } = table;
    if (sourceRows) rowNo = (i) => sourceRows[i] + 1;
    // 숫자 칸은 엑셀에 보이는 글로 (010-1234-5678·50%·1,234,000·004321). kordoc 표는 원래 값(1012345678·0.5)만 준다
    if (fmt === 'xlsx' && sourceRows && sourceCols) {
      const view = await readSheetView(await readFile(dataPath), (block.pageNumber ?? 1) - 1);
      grid.forEach((row, i) => row.forEach((_, j) => {
        const shown = view.display.get(`${sourceRows[i]},${sourceCols[j]}`);
        if (shown !== undefined) row[j] = shown;
      }));
      isHidden = (i) => view.hiddenRows.has(sourceRows[i]);
    }
    merges = tableMerges(table) ?? [];
    // 세로로 합친 칸(부서를 여러 사람에 걸쳐 합친 명부)은 합친 줄마다 같은 값으로. 안 채우면 둘째 사람부터 그 칸이 빈 문서가 된다
    for (const m of merges) {
      for (let r = m.r + 1; r < m.r + m.rs && r < grid.length; r++) if (!(grid[r][m.c] ?? '').trim()) grid[r][m.c] = grid[m.r][m.c];
    }
  } else throw new Error('명부는 엑셀(xlsx·xls)이나 CSV 파일로 넣으세요.');
  const filled = (r: string[]) => r.filter((c) => c.trim()).length;
  let hi = grid.findIndex((r) => filled(r) >= 2);
  if (hi < 0) hi = grid.findIndex((r) => filled(r) >= 1);
  if (hi < 0) throw new Error('명부가 비어 있습니다.');
  const clean = (s: string | undefined) => (s ?? '').replace(/\s*\n\s*/g, ' ').trim();
  // 머리 줄에 합친 칸이 있으면 머리가 두 줄 (성명 | 연락처(전화·이메일)). 둘째 줄을 사람 한 명으로 읽지 않게 머리로 합친다
  const headMerges = merges.filter((m) => m.r === hi && (m.rs > 1 || m.cs > 1));
  let depth = 1;
  let names = grid[hi].map((c) => clean(c));
  if (headMerges.length) {
    if (headMerges.some((m) => m.rs > 2) || merges.some((m) => m.r === hi + 1 && m.cs > 1)) {
      throw new Error('명부 머리 줄이 세 줄 이상으로 합쳐져 있어 어느 열이 무엇인지 정하지 못했습니다. 엑셀에서 머리 칸 합치기를 풀고 첫 줄에 칸 이름을 한 줄로 적은 뒤 명부를 다시 고르세요.');
    }
    depth = 2;
    const cover = (c: number, m: { c: number; cs: number }) => c >= m.c && c < m.c + m.cs;
    const pairs = grid[hi].map((_, c) => {
      const m = headMerges.find((x) => cover(c, x));
      const top = clean(m ? grid[hi][m.c] : grid[hi][c]);
      // 위아래로 합친 머리 칸은 아랫줄이 없다
      const under = headMerges.some((x) => x.rs > 1 && cover(c, x)) ? '' : clean(grid[hi + 1]?.[c]);
      return [top, under] as const;
    });
    // 아랫줄 이름(전화·이메일)을 열 이름으로, 같은 아랫줄 이름이 여럿이면 윗줄을 앞에 (1학기 점수·2학기 점수)
    names = pairs.map(([top, under]) => (!under ? top : top && top !== under && pairs.filter(([, u]) => u === under).length > 1 ? `${top} ${under}` : under));
  }
  // 같은 이름의 열이 둘이면 뒤 것에 번호를 붙인다 (이름으로 값을 모으므로, 그대로 두면 뒤 열이 앞 열 값을 지운다)
  const seen = new Map<string, number>();
  const header = names.map((c, i) => {
    const name = c || `열${i + 1}`;
    const n = (seen.get(name) ?? 0) + 1;
    seen.set(name, n);
    return n > 1 ? `${name} (${n})` : name;
  });
  const data = grid.map((cells, i) => ({ i, cells })).slice(hi + depth).filter((r) => filled(r.cells) > 0);
  // 엑셀에서 숨긴 행은 문서로 만들지 않는다 (지운 사람·거른 사람)
  const rows = data.filter((r) => !isHidden(r.i)).map((r) => ({ row: rowNo(r.i), cells: r.cells }));
  return { header, rows, hidden: data.length - rows.length };
}

const squash = (s: string) => s.replace(/\s+/g, '');

/** 날짜·전화 열은 같은 모양으로 (날짜 2026-10-01 → 2026. 10. 1., 전화 01012345678 → 010-1234-5678). 모양이 다르면 그대로 */
function formatCell(column: string, v: string): string {
  const c = squash(column);
  const t = v.trim();
  if (/(일자|날짜|일)$/.test(c) && /^(\d{4}[-./년\s]+\d{1,2}[-./월\s]+\d{1,2}[.일\s]*|\d{8})$/.test(t)) return formatFillValue(t, 'date:yyyy. m. d.');
  if (/(전화|연락처|휴대폰|핸드폰|팩스)/.test(c) && /^[\d\s()-]{9,15}$/.test(t)) return formatFillValue(t, 'phone');
  return v;
}

type MergeParams = { template_path?: string; template?: string; data_path: string; name_column?: string; output_dir?: string; org?: boolean };

/** 명부 열 ↔ 양식 칸 짝 — 열마다 실제로 채워 보고 어느 칸에 들어가는지 잰다 */
async function planMerge(p: MergeParams, t: LoadedTemplate, header: string[], rows: Array<{ row: number; cells: string[] }>, hidden = 0): Promise<MailMergePlan> {
  const names = (await templateFields({ template: p.template, path: p.template_path })).fields.map((f) => f.name);
  const sample = (c: number) => rows.map((r) => (r.cells[c] ?? '').trim()).find(Boolean);
  const columns: MailMergePlan['columns'] = [];
  for (const [c, name] of header.entries()) {
    const v = sample(c) ?? name;
    const res = await fillHwpx(t.buf, { [name]: v });
    columns.push({ name, fields: [...new Set(res.filled.map((f) => f.label.replace(/\s*\n\s*/g, ' ').trim()))], ...(sample(c) ? { sample: sample(c) } : {}) });
  }
  const all = Object.fromEntries(columns.filter((c) => c.fields.length).map((c) => [c.name, c.sample ?? c.name]));
  const rejected = Object.keys(all).length ? (await fillWithUniqueGuard(all, (v, blocked) => fillHwpx(t.buf, v, blocked))).rejected : [];
  const fieldOf = (f: string) => columns.find((c) => !rejected.includes(c.name) && c.fields.some((x) => squash(x) === squash(f)))?.name;
  const free = names.filter((f) => !fieldOf(f));
  // 내 양식은 받는 사람마다 다른 문서라 명부에 없는 칸(직위·연락처·일자)에 내 정보가 들어가면 틀린 문서가 된다 → 켤 때만.
  // 내장 서식(기안문 등)의 기관 칸은 결문·발신명의(보내는 쪽 = 나)라 받는 사람과 상관없이 내 정보가 맞다 → 기본 켬
  const org = (p.org ?? !p.template_path) ? orgAutofill(free).values : {};
  return {
    rows: rows.length,
    columns,
    fields: names.map((name) => ({ name, ...(fieldOf(name) ? { column: fieldOf(name) } : org[name] ? { org: org[name] } : {}) })),
    rejected,
    ...(hidden ? { hidden_rows: hidden } : {}),
  };
}

/** 명부와 양식을 보고 어느 열이 어느 칸에 들어가는지 미리 (mail_merge_plan) */
export async function mailMergePlan(p: MergeParams): Promise<MailMergePlan> {
  const t = await loadTemplate(p.template, p.template_path);
  const { header, rows, hidden } = await readRoster(p.data_path);
  return planMerge(p, t, header, rows, hidden);
}

export async function mailMerge(
  p: MergeParams,
  signal: AbortSignal,
): Promise<{ outputs: string[]; failed: Array<{ row: number; error: string }>; output_dir: string; rejected: string[] }> {
  const t = await loadTemplate(p.template, p.template_path);
  const { header, rows } = await readRoster(p.data_path);
  if (!rows.length) throw new Error('명부에 채울 줄이 없습니다. 첫 줄은 칸 이름, 둘째 줄부터 값을 넣으세요.');
  const nameCol = p.name_column ? header.indexOf(p.name_column.trim()) : -1;
  if (p.name_column && nameCol < 0) throw new Error(`명부에 '${p.name_column.trim()}' 열이 없습니다. 파일 이름에 쓸 열은 명부 첫 줄에 있는 이름(${header.slice(0, 6).join(', ')})으로 적으세요.`);

  const plan = await planMerge(p, t, header, rows);
  const used = plan.columns.filter((c) => c.fields.length && !plan.rejected.includes(c.name)).map((c) => c.name);
  if (!used.length) {
    const want = plan.fields.filter((f) => !f.org).slice(0, 5).map((f) => f.name);
    throw new Error(`명부 열 이름이 양식 칸과 하나도 맞지 않습니다. 명부 첫 줄을 양식 칸 이름${want.length ? `(${want.join(', ')})` : ''}으로 고친 뒤 다시 하세요.`);
  }
  const org = Object.fromEntries(plan.fields.filter((f) => f.org).map((f) => [f.name, f.org!]));

  // 폴더는 첫 장을 만들 때 만든다 (하나도 못 만들면 빈 폴더를 남기지 않는다)
  const dir = p.output_dir ?? uniquePath(join(outputDir({ source: p.data_path }), safeFileName(`${t.name}_${stemOf(p.data_path)}`)));
  const outputs: string[] = [];
  const failed: Array<{ row: number; error: string }> = [];
  const rejected = new Set<string>();
  const dirExisted = existsSync(dir);
  for (const [i, r] of rows.entries()) {
    if (signal.aborted) {
      await dropCancelled(outputs, dirExisted ? '' : dir);
      signal.throwIfAborted();
    }
    sendProgress({ current: i + 1, total: rows.length, message: `${i + 1}/${rows.length}번째 문서 만드는 중` });
    try {
      const cells = Object.fromEntries(header.map((h, c) => [h, formatCell(h, r.cells[c] ?? '')]).filter(([h]) => used.includes(h))) as Record<string, string>;
      if (!Object.keys(nonEmpty(cells)).length) throw new Error(`양식에 넣을 값이 비어 있습니다. 명부의 ${used.slice(0, 4).map((u) => `'${u}'`).join(', ')} 열에 값을 넣으세요.`);
      // 명부에서 비어 있는 칸은 빈칸으로 채운다(공백 한 칸). 값이 적힌 문서를 양식으로 쓰면, 건너뛴 칸에 양식에 있던 앞 사람 값이
      // 그대로 남아 다른 사람의 연락처·비고가 든 문서가 나간다
      const fromRoster = Object.fromEntries(Object.entries(cells).map(([h, v]) => [h, v.trim() === '' ? ' ' : v]));
      const res = await fillWithUniqueGuard({ ...org, ...fromRoster }, (v, blocked) => fillHwpx(t.buf, v, blocked));
      res.rejected.forEach((x) => rejected.add(x));
      if (!res.filled.length) {
        throw new Error('이 줄의 값이 양식 칸에 하나도 들어가지 않았습니다. 명부 첫 줄의 열 이름을 양식 칸 이름에 맞추세요.');
      }
      const base = nameCol >= 0 ? safeFileName(r.cells[nameCol] ?? '', '') : '';
      const outPath = outputFile({ output_dir: dir, name: `${base || `${t.name}_${i + 1}`}.hwpx` });
      await writeFile(outPath, Buffer.from(res.buffer));
      outputs.push(outPath);
    } catch (err) {
      if (signal.aborted) {
        await dropCancelled(outputs, dirExisted ? '' : dir);
        throw err;
      }
      failed.push({ row: r.row, error: errorText(err) });
    }
  }
  return { outputs, failed, output_dir: outputs.length ? dir : '', rejected: [...rejected] };
}

/** 취소한 명부 합치기의 뒷정리: 이번 실행이 만든 문서만 지우고, 이번 실행이 만든 폴더는 비었을 때만 지운다 (원래 있던 파일·폴더는 그대로) */
async function dropCancelled(outputs: string[], createdDir: string): Promise<void> {
  for (const f of outputs) await rm(f, { force: true });
  if (createdDir) await rmdir(createdDir).catch(() => undefined); // 비어 있지 않거나(사용자가 그새 넣은 파일) 만들지 않았으면 그대로
}
