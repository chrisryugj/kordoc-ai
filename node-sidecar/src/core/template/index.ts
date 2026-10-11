/** 서식 칸 채우기 — template_fields·template_fill(내장 기안문 2종 또는 사용자 HWPX) · mail_merge(명부 한 줄 = 문서 한 장)
 *
 * 칸은 누름틀(CLICK_HERE) 이름이 먼저, 누름틀이 없는 서식은 라벨-값 표 칸(extractFormSchema).
 * fillHwpx 가 누름틀 이름으로 먼저 채우고 남은 키는 라벨로 찾는다 (원본 서식 바이트 보존).
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  extractClickHereFields, extractFormSchema, fillHwpx, readBuiltinTemplate, readBuiltinTemplateSample, resolveBuiltinTemplate,
} from 'kordoc';
import { sendProgress } from '../../infra/progress.js';
import { errorText } from '../errors.js';
import { parseDoc, readTextFile } from '../converter/index.js';
import { parseCsv } from '../excel/csv.js';
import { tableGrid } from '../excel/index.js';
import { formatOf } from '../files/format.js';
import { outputDir, outputFile, safeFileName, stemOf, uniquePath } from '../output/index.js';

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
  const labels = [...new Set(extractFormSchema(r.blocks).fields.map((f) => f.label.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean))];
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

/** 명부 → [머리 행, 데이터 행들(엑셀 줄 번호)] — 머리는 칸이 둘 이상 찬 첫 줄 */
async function readRoster(dataPath: string): Promise<{ header: string[]; rows: Array<{ row: number; cells: string[] }> }> {
  const fmt = formatOf(dataPath);
  let grid: string[][];
  if (fmt === 'csv' || fmt === 'txt') grid = parseCsv(await readTextFile(dataPath));
  else if (fmt === 'xlsx' || fmt === 'xls') {
    const r = await parseDoc(dataPath, { images: false, ocr: 'off' });
    const table = r.blocks.find((b) => b.type === 'table' && b.table)?.table;
    if (!table) throw new Error('명부 첫 시트에서 표를 찾지 못했습니다.');
    grid = tableGrid(table);
  } else throw new Error('명부는 엑셀(xlsx·xls)이나 CSV 파일로 넣으세요.');
  const filled = (r: string[]) => r.filter((c) => c.trim()).length;
  let hi = grid.findIndex((r) => filled(r) >= 2);
  if (hi < 0) hi = grid.findIndex((r) => filled(r) >= 1);
  if (hi < 0) throw new Error('명부가 비어 있습니다.');
  const header = grid[hi].map((c, i) => c.replace(/\s*\n\s*/g, ' ').trim() || `열${i + 1}`);
  const rows = grid.slice(hi + 1).map((cells, i) => ({ row: hi + 2 + i, cells })).filter((r) => filled(r.cells) > 0);
  return { header, rows };
}

export async function mailMerge(
  p: { template_path?: string; template?: string; data_path: string; name_column?: string; output_dir?: string },
  signal: AbortSignal,
): Promise<{ outputs: string[]; failed: Array<{ row: number; error: string }>; output_dir: string }> {
  const t = await loadTemplate(p.template, p.template_path);
  const { header, rows } = await readRoster(p.data_path);
  if (!rows.length) throw new Error('명부에 채울 줄이 없습니다. 첫 줄은 칸 이름, 둘째 줄부터 값을 넣으세요.');
  const nameCol = p.name_column ? header.indexOf(p.name_column.trim()) : -1;
  if (p.name_column && nameCol < 0) throw new Error(`명부에 "${p.name_column}" 열이 없습니다. 파일 이름에 쓸 열은 첫 줄 칸 이름으로 적으세요.`);

  const dir = p.output_dir ?? uniquePath(join(outputDir({ source: p.data_path }), safeFileName(`${t.name}_${stemOf(p.data_path)}`)));
  const outputs: string[] = [];
  const failed: Array<{ row: number; error: string }> = [];
  for (const [i, r] of rows.entries()) {
    signal.throwIfAborted();
    sendProgress({ current: i + 1, total: rows.length, message: `${i + 1}/${rows.length}번째 문서 만드는 중` });
    try {
      const values = nonEmpty(Object.fromEntries(header.map((h, c) => [h, r.cells[c] ?? ''])));
      const res = await fillHwpx(t.buf, values);
      if (!res.filled.length) throw new Error('명부의 칸 이름이 서식 칸과 하나도 맞지 않습니다. 첫 줄 칸 이름을 서식 칸 이름에 맞추세요.');
      const base = nameCol >= 0 ? safeFileName(r.cells[nameCol] ?? '', '') : '';
      const outPath = outputFile({ output_dir: dir, name: `${base || `${t.name}_${r.row}`}.hwpx` });
      await writeFile(outPath, Buffer.from(res.buffer));
      outputs.push(outPath);
    } catch (err) {
      if (signal.aborted) throw err;
      failed.push({ row: r.row, error: errorText(err) });
    }
  }
  return { outputs, failed, output_dir: outputDir({ output_dir: dir }) };
}
