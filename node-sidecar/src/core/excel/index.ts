/** 표 추출 — 문서에서 테이블 블록만 추출하여 마크다운 파일로 저장 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, basename, extname, join } from 'node:path';
import { parse, blocksToMarkdown, type IRBlock, type IRTable } from 'kordoc';
import { getConfig } from '../../infra/config.js';
import { sendProgress } from '../../infra/progress.js';
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
  output_path: string;
  error?: string;
}

export async function extractTables(params: ExtractTablesParams, signal?: AbortSignal): Promise<ExtractTablesResult> {
  const { input_path, pages } = params;

  logger.info(`[extract_tables] 시작: ${input_path}`);
  sendProgress({ current: 0, total: 3, message: '문서 읽는 중...' });
  signal?.throwIfAborted();

  const buffer = await readFile(input_path);
  signal?.throwIfAborted();

  sendProgress({ current: 1, total: 3, message: '문서 파싱 중...' });
  const result = await parse(new Uint8Array(buffer).buffer, { pages });

  if (!result.success) {
    logger.error(`[extract_tables] 파싱 실패: ${result.error}`);
    return {
      success: false,
      table_count: 0,
      tables: [],
      output_path: '',
      error: result.error,
    };
  }

  sendProgress({ current: 2, total: 3, message: '테이블 추출 중...' });

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

  // 출력 경로 결정 + 마크다운 파일 저장
  const cfg = getConfig('convert');
  const outDir = cfg.output_dir || dirname(input_path);
  const stem = basename(input_path, extname(input_path));
  const outputPath = join(outDir, `${stem}_tables.md`);

  const markdownContent = tables.length > 0
    ? tables.map((t, i) => `## 표 ${i + 1}${t.page != null ? ` (${t.page}페이지)` : ''}\n\n${t.markdown}`).join('\n\n---\n\n')
    : '# 추출 결과\n\n문서에서 표를 찾지 못했습니다.';

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, markdownContent, 'utf-8');

  sendProgress({ current: 3, total: 3, message: `${tables.length}개 표 추출 완료 → ${basename(outputPath)}` });
  logger.info(`[extract_tables] ${tables.length}개 테이블 → ${outputPath}`);

  return {
    success: true,
    table_count: tables.length,
    tables,
    output_path: outputPath,
  };
}
