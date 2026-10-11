/** 표 뽑기 (tables_extract) — kordoc extractTables 분류(데이터표·레이아웃·불확실) → XLSX·CSV·MD
 *
 * 레이아웃 표(조직도·비상연락망처럼 표를 그림판으로 쓴 것)는 only_data 로 거를 수 있다.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { blocksToMarkdown, extractTables, type IRTable } from 'kordoc';
import type { TablesResult } from '../../types/rpc-contract.js';
import { sendProgress } from '../../infra/progress.js';
import { outputFile, stemOf } from '../output/index.js';
import { parsePageSpec } from '../render/index.js';
import { toCsv } from './csv.js';
import { buildXlsx, type Sheet } from './xlsx.js';

type Kind = TablesResult['tables'][number]['kind'];
const KIND: Record<string, Kind> = { 'semantic-table': 'data', 'non-tabular-layout': 'layout', uncertain: 'uncertain' };
const KIND_LABEL: Record<Kind, string> = { data: '자료표', layout: '배치용 표', uncertain: '판단 보류' };

/** 표 → 칸 글 격자 (병합으로 덮인 칸은 빈 글) */
export function tableGrid(t: IRTable): string[][] {
  return Array.from({ length: t.rows }, (_, r) => Array.from({ length: t.cols }, (_, c) => t.cells[r]?.[c]?.text ?? ''));
}

export function tableMerges(t: IRTable): Sheet['merges'] {
  const out: NonNullable<Sheet['merges']> = [];
  t.cells.forEach((row, r) => row.forEach((cell, c) => {
    if (cell && (cell.rowSpan > 1 || cell.colSpan > 1)) out.push({ r, c, rs: Math.max(1, cell.rowSpan), cs: Math.max(1, cell.colSpan) });
  }));
  return out;
}

export async function tablesExtract(
  p: { path: string; format: 'xlsx' | 'csv' | 'md'; pages?: string; only_data?: boolean; output_path?: string; allow_empty?: boolean },
  signal?: AbortSignal,
): Promise<TablesResult> {
  sendProgress({ current: 0, total: 2, message: '표 찾는 중' });
  const found = await extractTables(await readFile(p.path), { policy: 'none' });
  signal?.throwIfAborted();
  const pages = new Set(parsePageSpec(p.pages));
  const picked = found
    .map((t, i) => ({ ...t, index: i, kind: KIND[t.classification.kind] ?? 'uncertain' }))
    .filter((t) => (!pages.size || pages.has(t.page)) && (!p.only_data || t.kind === 'data'));
  if (!picked.length) {
    if (p.allow_empty) return { tables: [] };
    throw new Error(p.only_data && found.length ? '자료표가 없습니다. "자료가 든 표만"을 끄고 다시 시도하세요.' : '문서에서 표를 찾지 못했습니다.');
  }

  sendProgress({ current: 1, total: 2, message: `표 ${picked.length}개 저장 중` });
  const title = (t: (typeof picked)[number], n: number) => `표 ${n + 1}${t.page ? ` (${t.page}쪽, ${KIND_LABEL[t.kind]})` : ` (${KIND_LABEL[t.kind]})`}`;
  let data: Buffer | string;
  if (p.format === 'xlsx') {
    data = await buildXlsx(picked.map((t, n) => ({
      name: `표${n + 1}${t.page ? `_${t.page}쪽` : ''}`,
      rows: tableGrid(t.table),
      merges: tableMerges(t.table),
      header: t.table.hasHeader && t.kind === 'data',
    })));
  } else if (p.format === 'csv') {
    const rows: string[][] = [];
    picked.forEach((t, n) => {
      if (picked.length > 1) {
        if (n) rows.push([]);
        rows.push([`[${title(t, n)}]`]);
      }
      rows.push(...tableGrid(t.table));
    });
    data = toCsv(rows);
  } else {
    data = picked.map((t, n) => `## ${title(t, n)}\n\n${blocksToMarkdown([{ type: 'table', table: t.table }]).trim()}\n`).join('\n');
  }
  const outPath = outputFile({ output_path: p.output_path, source: p.path, name: `${stemOf(p.path)}_표.${p.format}` });
  await writeFile(outPath, data);
  sendProgress({ current: 2, total: 2, message: `표 ${picked.length}개 저장함` });

  return {
    tables: picked.map((t) => ({
      index: t.index,
      page: t.page || undefined,
      kind: t.kind,
      rows: t.table.rows,
      cols: t.table.cols,
      preview: tableGrid(t.table).slice(0, 5).map((r) => r.slice(0, 12).map((c) => (c.length > 40 ? `${c.slice(0, 40)}…` : c))),
    })),
    output_path: outPath,
  };
}
