/** PDF 유틸 — 병합 + 분리 */

import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { dirname, basename, extname, join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { sendProgress } from '../../infra/progress.js';
import { logger } from '../../infra/logger.js';
import type { MergeFilesParams, MergeFilesResult } from './types.js';

/** 여러 PDF를 하나로 병합 */
export async function concatPdf(
  params: MergeFilesParams,
  signal: AbortSignal,
): Promise<MergeFilesResult> {
  const { files, output_path } = params;
  const failedFiles: string[] = [];
  const merged = await PDFDocument.create();

  logger.info(`[concat-pdf] ${files.length}개 PDF 병합 시작`);

  for (let i = 0; i < files.length; i++) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

    sendProgress({
      current: i + 1,
      total: files.length,
      message: `PDF 병합 ${i + 1}/${files.length}: ${basename(files[i])}`,
    });

    try {
      const buffer = await readFile(files[i]);
      const doc = await PDFDocument.load(buffer);
      const pages = await merged.copyPages(doc, doc.getPageIndices());
      for (const page of pages) merged.addPage(page);
    } catch (err) {
      failedFiles.push(files[i]);
      logger.warn(`[concat-pdf] 실패: ${files[i]} — ${err instanceof Error ? err.message : err}`);
    }
  }

  if (merged.getPageCount() === 0) throw new Error('병합할 유효한 PDF 파일이 없습니다');

  await mkdir(dirname(output_path), { recursive: true });
  const outputBytes = await merged.save();
  await writeFile(output_path, outputBytes);

  logger.info(`[concat-pdf] done → ${output_path} (${outputBytes.length} bytes, ${merged.getPageCount()} pages, ${failedFiles.length}개 실패)`);

  return {
    success: true,
    output_path,
    file_count: files.length,
    total_length: outputBytes.length,
    failed_files: failedFiles,
  };
}

/** PDF를 페이지별로 분리 */
export interface SplitPdfParams {
  file: string;
  output_dir: string;
  /** 분리 방식: 'each' = 1페이지씩, 'range' = 범위 지정 */
  mode?: 'each' | 'range';
  /** range 모드: "1-3,5,7-10" 형식 */
  ranges?: string;
}

export interface SplitPdfResult {
  success: boolean;
  output_files: string[];
  total_pages: number;
}

function parseRanges(rangeStr: string, maxPage: number): number[][] {
  const groups: number[][] = [];
  for (const part of rangeStr.split(',')) {
    const trimmed = part.trim();
    if (trimmed.includes('-')) {
      const [start, end] = trimmed.split('-').map(s => parseInt(s.trim(), 10));
      const pages: number[] = [];
      for (let p = Math.max(1, start); p <= Math.min(maxPage, end); p++) pages.push(p - 1);
      if (pages.length > 0) groups.push(pages);
    } else {
      const p = parseInt(trimmed, 10);
      if (p >= 1 && p <= maxPage) groups.push([p - 1]);
    }
  }
  return groups;
}

/** PDF 페이지 수 조회 */
export async function getPdfPageCount(filePath: string): Promise<{ page_count: number }> {
  const buffer = await readFile(filePath);
  const doc = await PDFDocument.load(buffer);
  return { page_count: doc.getPageCount() };
}

/** PDF 페이지 추출 — include/exclude 모드 */
export interface ExtractPdfPagesParams {
  file: string;
  output_path: string;
  /** 페이지 지정: "1,3,5-7" 형식 */
  pages: string;
  /** include: 지정 페이지만 추출, exclude: 지정 페이지 제외 */
  mode?: 'include' | 'exclude';
}

export interface ExtractPdfPagesResult {
  success: boolean;
  output_path: string;
  extracted_pages: number;
  total_pages: number;
}

export async function extractPdfPages(
  params: ExtractPdfPagesParams,
  signal: AbortSignal,
): Promise<ExtractPdfPagesResult> {
  const { file, output_path, pages, mode = 'include' } = params;
  const buffer = await readFile(file);
  const srcDoc = await PDFDocument.load(buffer);
  const totalPages = srcDoc.getPageCount();

  // 지정된 페이지 인덱스 파싱 (0-based)
  const specified = new Set<number>();
  for (const group of parseRanges(pages, totalPages)) {
    for (const idx of group) specified.add(idx);
  }

  // include: 지정 페이지만, exclude: 지정 페이지 제외
  const targetIndices = mode === 'include'
    ? [...specified].sort((a, b) => a - b)
    : Array.from({ length: totalPages }, (_, i) => i).filter(i => !specified.has(i));

  if (targetIndices.length === 0) {
    throw new Error(mode === 'include'
      ? '추출할 페이지가 없습니다'
      : '제외 후 남은 페이지가 없습니다');
  }

  signal.throwIfAborted();

  const doc = await PDFDocument.create();
  const copiedPages = await doc.copyPages(srcDoc, targetIndices);
  for (const page of copiedPages) doc.addPage(page);

  await mkdir(dirname(output_path), { recursive: true });

  // 파일 존재 시 넘버링 추가하여 덮어쓰기 방지
  let finalPath = output_path;
  const dir = dirname(output_path);
  const ext = extname(output_path);
  const stem = basename(output_path, ext);
  let n = 1;
  while (await access(finalPath).then(() => true, () => false)) {
    n++;
    finalPath = join(dir, `${stem}(${n})${ext}`);
  }

  const outputBytes = await doc.save();
  await writeFile(finalPath, outputBytes);

  logger.info(`[extract-pdf] ${file} → ${finalPath} (${targetIndices.length}/${totalPages}p, ${mode})`);

  return {
    success: true,
    output_path: finalPath,
    extracted_pages: targetIndices.length,
    total_pages: totalPages,
  };
}

export async function splitPdf(
  params: SplitPdfParams,
  signal: AbortSignal,
): Promise<SplitPdfResult> {
  const { file, output_dir, mode = 'each', ranges } = params;
  const buffer = await readFile(file);
  const srcDoc = await PDFDocument.load(buffer);
  const totalPages = srcDoc.getPageCount();
  const outputFiles: string[] = [];
  const baseName = basename(file, '.pdf');

  await mkdir(output_dir, { recursive: true });

  logger.info(`[split-pdf] ${file} (${totalPages}p) → ${mode} 모드`);

  if (mode === 'range' && ranges) {
    const groups = parseRanges(ranges, totalPages);
    for (let gi = 0; gi < groups.length; gi++) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      const doc = await PDFDocument.create();
      const pages = await doc.copyPages(srcDoc, groups[gi]);
      for (const page of pages) doc.addPage(page);
      const outPath = `${output_dir}/${baseName}_${gi + 1}.pdf`;
      await writeFile(outPath, await doc.save());
      outputFiles.push(outPath);
    }
  } else {
    for (let i = 0; i < totalPages; i++) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

      sendProgress({
        current: i + 1,
        total: totalPages,
        message: `PDF 분리 ${i + 1}/${totalPages}p`,
      });

      const doc = await PDFDocument.create();
      const [page] = await doc.copyPages(srcDoc, [i]);
      doc.addPage(page);
      const outPath = `${output_dir}/${baseName}_p${String(i + 1).padStart(3, '0')}.pdf`;
      await writeFile(outPath, await doc.save());
      outputFiles.push(outPath);
    }
  }

  logger.info(`[split-pdf] done → ${outputFiles.length}개 파일`);

  return {
    success: true,
    output_files: outputFiles,
    total_pages: totalPages,
  };
}
