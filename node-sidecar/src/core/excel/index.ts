/** 표 추출 — 문서에서 테이블 블록만 추출 */

import { readFile } from 'node:fs/promises';
import { parse, blocksToMarkdown, type IRBlock, type IRTable } from 'kordoc';
import { logger } from '../../infra/logger.js';

export interface ExtractTablesParams {
  /** 입력 파일 경로 */
  input_path: string;
  /** 페이지 범위 */
  pages?: string;
  /** 마크다운 포맷으로 반환 (기본: true) */
  as_markdown?: boolean;
}

interface TableEntry {
  index: number;
  page?: number;
  rows: number;
  cols: number;
  markdown: string;
  table: IRTable;
}

export interface ExtractTablesResult {
  success: boolean;
  table_count: number;
  tables: TableEntry[];
  error?: string;
}

export async function extractTables(params: ExtractTablesParams): Promise<ExtractTablesResult> {
  const { input_path, pages } = params;

  logger.info(`[extract_tables] ${input_path}`);

  const buffer = await readFile(input_path);
  const result = await parse(new Uint8Array(buffer).buffer, { pages });

  if (!result.success) {
    return {
      success: false,
      table_count: 0,
      tables: [],
      error: result.error,
    };
  }

  const tableBlocks = result.blocks.filter((b): b is IRBlock & { table: IRTable } =>
    b.type === 'table' && b.table != null,
  );

  const tables: TableEntry[] = tableBlocks.map((block, i) => ({
    index: i,
    page: block.pageNumber,
    rows: block.table.rows,
    cols: block.table.cols,
    markdown: blocksToMarkdown([block]),
    table: block.table,
  }));

  logger.info(`[extract_tables] ${tables.length}개 테이블 추출`);

  return {
    success: true,
    table_count: tables.length,
    tables,
  };
}
