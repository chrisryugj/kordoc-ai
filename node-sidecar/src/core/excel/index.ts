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
  /** 출력 디렉토리 (미지정 시 설정값 → 원본 폴더) */
  output_dir?: string;
  /** 마크다운 포맷으로 반환 (기본: true) */
  as_markdown?: boolean;
}

interface TableEntry {
  index: number;
  page?: number;
  rows: number;
  cols: number;
  caption: string;
  footnotes: string[];
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

/** 의미 있는 표인지 판정 — 1셀 짧은 텍스트, 빈 표 등 필터링 */
function isSignificantTable(table: IRTable): boolean {
  // 셀이 없으면 무의미
  if (table.rows === 0 || table.cols === 0) return false;

  // 1행 1열 → 보통 서식용 래퍼 (예: "별표 1")
  if (table.rows === 1 && table.cols === 1) {
    const text = table.cells[0]?.[0]?.text?.trim() ?? '';
    // 30자 미만 1셀은 의미 없음
    if (text.length < 30) return false;
  }

  // 전체 텍스트가 너무 짧으면 무의미
  const allText = table.cells.flatMap(row => row.map(c => c.text.trim())).filter(Boolean);
  if (allText.join('').length < 5) return false;

  return true;
}

/** 이전 표의 하단 주석 패턴 (캡션이 아님) */
const FOOTNOTE_RE = /^(주\s*[\d)]|※|注|\*\s*\d|#\s*\d)/;

/** 블록에서 짧은 텍스트 추출 */
function extractShortText(block: IRBlock): string | null {
  if ((block.type === 'heading' || block.type === 'paragraph') && block.text) {
    const t = block.text.trim();
    return t.length > 0 && t.length <= 80 ? t : null;
  }
  if (block.type === 'table' && block.table) {
    const { rows, cols, cells } = block.table;
    if (rows <= 2 && cols === 1) {
      const texts = cells.map(row => row[0]?.text?.trim()).filter(Boolean);
      const joined = texts.join(' ');
      return joined.length > 0 && joined.length <= 100 ? joined : null;
    }
  }
  return null;
}

/** 표 직전 블록에서 캡션 추출 — 주석/각주를 만나면 중단 */
function findCaption(blocks: IRBlock[], tableIdx: number): string {
  const parts: string[] = [];

  for (let i = tableIdx - 1; i >= Math.max(0, tableIdx - 6); i--) {
    const prev = blocks[i];
    if (prev.type === 'separator') break;

    // 데이터 표(2행×2열 이상) → 이전 표의 영역, 중단
    if (prev.type === 'table' && prev.table && prev.table.rows >= 2 && prev.table.cols >= 2) break;

    const text = extractShortText(prev);
    if (!text) continue;

    // 주석 패턴 → 이전 표의 각주, 여기서 끊기
    if (FOOTNOTE_RE.test(text)) break;

    parts.unshift(text);
  }

  return parts.join(' — ');
}

/** 데이터 표 뒤에 오는 각주 텍스트 수집 (주1, 주), ※ 등) */
function findFootnotes(blocks: IRBlock[], tableIdx: number): string[] {
  const notes: string[] = [];

  for (let i = tableIdx + 1; i < Math.min(blocks.length, tableIdx + 8); i++) {
    const next = blocks[i];

    // 다음 데이터 표를 만나면 중단
    if (next.type === 'table' && next.table && isSignificantTable(next.table)) break;

    const text = extractShortText(next);
    if (!text) continue;

    // 각주 패턴이면 수집
    if (FOOTNOTE_RE.test(text)) {
      notes.push(text);
      continue;
    }

    // 각주 아닌 짧은 텍스트 — 다음 표 캡션일 수 있으므로 중단
    if (notes.length === 0) break; // 각주가 아직 안 나왔으면 바로 끊기
    // 각주 다음에 나온 비각주 → 끝
    break;
  }

  return notes;
}

export async function extractTables(params: ExtractTablesParams, signal?: AbortSignal): Promise<ExtractTablesResult> {
  const { input_path, pages, output_dir } = params;

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

  // 전체 블록에서 테이블만 필터 + 의미 없는 표 제외
  const tables: TableEntry[] = [];
  let tableNum = 0;

  for (let i = 0; i < result.blocks.length; i++) {
    const block = result.blocks[i];
    if (block.type !== 'table' || !block.table) continue;
    if (!isSignificantTable(block.table)) {
      logger.info(`[extract_tables] 표 ${i} 건너뜀 (${block.table.rows}x${block.table.cols}, 의미 없는 표)`);
      continue;
    }

    const caption = findCaption(result.blocks, i);
    const footnotes = findFootnotes(result.blocks, i);
    tables.push({
      index: tableNum++,
      page: block.pageNumber,
      rows: block.table.rows,
      cols: block.table.cols,
      caption,
      footnotes,
      markdown: blocksToMarkdown([block]),
      table: block.table,
    });
  }

  // 출력 경로 결정 + 마크다운 파일 저장
  const cfg = getConfig('convert');
  const outDir = output_dir || cfg.output_dir || dirname(input_path);
  const stem = basename(input_path, extname(input_path));
  const outputPath = join(outDir, `${stem}_tables.md`);

  const markdownContent = tables.length > 0
    ? tables.map((t) => {
        const title = t.caption || `표 ${t.index + 1}`;
        const meta = [
          t.page != null ? `${t.page}페이지` : '',
          `${t.rows}행 × ${t.cols}열`,
        ].filter(Boolean).join(' · ');
        const footnotesBlock = t.footnotes.length > 0
          ? '\n\n' + t.footnotes.map(n => `> *${n}*`).join('\n>\n')
          : '';
        return `#### ${title}\n\n> ${meta}\n\n${t.markdown}${footnotesBlock}`;
      }).join('\n\n---\n\n')
    : '# 추출 결과\n\n문서에서 의미 있는 표를 찾지 못했습니다.';

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, markdownContent, 'utf-8');

  sendProgress({ current: 3, total: 3, message: `${tables.length}개 표 추출 완료 → ${basename(outputPath)}` });
  logger.info(`[extract_tables] ${tables.length}개 유효 테이블 → ${outputPath}`);

  return {
    success: true,
    table_count: tables.length,
    tables,
    output_path: outputPath,
  };
}
