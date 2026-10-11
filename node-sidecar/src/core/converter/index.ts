/** 문서 읽기·변환 — 문서 기능 공용 parseDoc + convert·convert_batch
 *
 * parseDoc: 파일 → kordoc ParseSuccess (실패는 사람이 읽을 오류로 throw). md·txt·csv 는 글 그대로.
 * convert: 형식 md·html·json·chunks·txt, save=false 면 저장 없이 content 만.
 * 그림은 CLI 와 같은 자리(`images/<문서 이름>/`)에 저장하고 본문 참조를 그 경로로 고친다.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { blocksToChunks, parse, renderHtml, type IRBlock, type ParseOptions, type ParseResult, type ParseSuccess } from 'kordoc';
import iconv from 'iconv-lite';
import type { BatchItemResult, ConvertParams, ConvertResult } from '../../types/rpc-contract.js';
import { getSettings } from '../../infra/config.js';
import { sendProgress } from '../../infra/progress.js';
import { registerJob, runJob } from '../../infra/worker.js';
import { cleanMessage, errorText, parseFailure } from '../errors.js';
import { parseCsv } from '../excel/csv.js';
import { formatOf, TEXT_FORMATS } from '../files/format.js';
import { outputDir, outputFile, stemOf } from '../output/index.js';

export type OcrMode = 'auto' | 'force' | 'off';

export interface ParseDocOptions {
  password?: string;
  pages?: string;
  /** 생략하면 설정(convert.ocr) */
  ocr?: OcrMode;
  images?: boolean;
  plain?: boolean;
  htmlTables?: boolean;
  /** 원본 표 구조 그대로 (패치·양식 경로) */
  keepLayout?: boolean;
  /** 주면 쪽 진행률을 알림으로 보낸다 */
  progressLabel?: string;
  signal?: AbortSignal;
}

/** auto 는 kordoc 기본(캐시에 모델이 있으면 필요한 쪽만, 내려받지 않음) */
function ocrOption(mode: OcrMode): ParseOptions['ocr'] {
  return mode === 'force' ? 'force' : mode === 'off' ? false : undefined;
}

/** UTF-8 이 아니면 CP949(엑셀이 저장한 CSV 등)로.
 * Node 의 euc-kr 디코더는 CP949 확장 한글(똠·햏 등 EUC-KR 2350자 밖)을 깨뜨려서 iconv-lite 로 읽는다. */
export function decodeText(buf: Uint8Array): string {
  // 엑셀 "유니코드 텍스트"·메모장 UTF-16 저장본 (BOM 으로 안다)
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf.subarray(2));
  if (buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder('utf-16be').decode(buf.subarray(2));
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    text = iconv.decode(buf, 'cp949');
  }
  return text.replace(/^﻿/, '');
}

export async function readTextFile(path: string): Promise<string> {
  return decodeText(await readFile(path));
}

/** CSV 는 글은 그대로 두고 표 블록도 만든다 (명부 고르기·표 뽑기가 blocks 의 표를 찾는다) */
function csvBlocks(text: string): IRBlock[] {
  const grid = parseCsv(text).filter((r) => r.some((c) => c.trim()));
  if (!grid.length) return [];
  const cols = Math.max(...grid.map((r) => r.length));
  const cells = grid.map((r) => Array.from({ length: cols }, (_, i) => ({ text: r[i] ?? '', colSpan: 1, rowSpan: 1 })));
  return [{ type: 'table', table: { rows: grid.length, cols, cells, hasHeader: grid.length > 1 } }];
}

registerJob('parse', ({ buf, opts }: { buf: Uint8Array; opts: ParseOptions }, port) =>
  parse(Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength), { ...opts, onProgress: (current, total) => port.send({ current, total }) }));

type Progress = (current: number, total: number) => void;

/** 작업자 스레드에서 kordoc 으로 읽기 (취소하면 작업자를 끝낸다) */
export function parseInWorker(buf: Uint8Array, opts: Omit<ParseOptions, 'onProgress'>, onProgress?: Progress, signal?: AbortSignal): Promise<ParseResult> {
  return runJob<ParseResult>('parse', { buf, opts }, { signal, onMessage: (m: { current: number; total: number }) => onProgress?.(m.current, m.total) }).result;
}

/** kordoc 으로 읽기. 큰 PDF(3MB~)·아주 큰 파일(30MB~)은 작업자 스레드에서 (infra/worker: 800쪽 PDF 를 읽는 20초 동안 엔진이 멈추고 취소도 못 받았다) */
export function parseBytes(buf: Buffer, opts: Omit<ParseOptions, 'onProgress'>, onProgress?: Progress, signal?: AbortSignal): Promise<ParseResult> {
  const pdf = buf.subarray(0, 5).toString('latin1') === '%PDF-';
  if (buf.length >= (pdf ? 3 : 30) * 1024 * 1024) return parseInWorker(buf, opts, onProgress, signal);
  return parse(buf, { ...opts, onProgress: (current, total) => { signal?.throwIfAborted(); onProgress?.(current, total); } });
}

export async function parseDoc(path: string, opts: ParseDocOptions = {}): Promise<ParseSuccess> {
  const { signal } = opts;
  signal?.throwIfAborted();
  if (TEXT_FORMATS.has(formatOf(path))) {
    const markdown = await readTextFile(path);
    return { success: true, fileType: 'unknown', markdown, blocks: formatOf(path) === 'csv' ? csvBlocks(markdown) : [] };
  }
  const buf = await readFile(path);
  signal?.throwIfAborted();
  const label = opts.progressLabel;
  const r = await parseBytes(buf, {
    filePath: path,
    pages: opts.pages,
    password: opts.password,
    ocr: ocrOption(opts.ocr ?? getSettings().convert.ocr),
    images: opts.images,
    plain: opts.plain,
    htmlTables: opts.htmlTables,
    layoutTables: opts.keepLayout ? 'keep' : undefined,
  }, (current, total) => {
    if (label) sendProgress({ current, total, message: `${label} ${current}/${total}쪽` });
  }, signal);
  signal?.throwIfAborted();
  if (!r.success) throw parseFailure(r, !!opts.password);
  return r;
}

/** kordoc 경고 → 화면 문장 (OCR 필요 경고는 CLI 안내 대신 할 일로) */
export function parseWarnings(r: ParseSuccess): string[] {
  const out = (r.warnings ?? []).map((w) => (w.code === 'NEEDS_OCR' || /CLI|ocr: true/.test(w.message)
    ? '글자 층이 없는 쪽(스캔)이 있습니다. 글자를 읽으려면 OCR을 켜고 다시 시도하세요.'
    : cleanMessage(w.message)));
  return [...new Set(out)];
}

const EXT: Record<NonNullable<ConvertParams['format']>, string> = { md: '.md', html: '.html', json: '.json', chunks: '.chunks.json', txt: '.txt' };

/** quiet: 일괄 변환 안에서 쪽 진행률을 보내지 않음 (파일 단위 진행률만) */
export async function convert(p: ConvertParams & { path: string; save?: boolean }, signal?: AbortSignal, quiet = false): Promise<ConvertResult> {
  const format = p.format ?? 'md';
  const save = p.save !== false;
  const keepImages = save && p.images !== false && (format === 'md' || format === 'html' || format === 'json');
  const r = await parseDoc(p.path, {
    password: p.password,
    pages: p.pages,
    ocr: p.ocr,
    images: keepImages,
    plain: format === 'txt',
    htmlTables: p.html_tables,
    keepLayout: p.keep_layout,
    progressLabel: save && !quiet ? `${basename(p.path)} 읽는 중` : undefined,
    signal,
  });

  const outPath = save ? outputFile({ output_dir: p.output_dir, source: p.path, name: stemOf(p.path) + EXT[format] }) : undefined;
  const images = outPath ? (r.images ?? []) : [];
  const docStem = outPath ? stemOf(outPath).replace(/\.chunks$/, '') : stemOf(p.path);
  const link = `images/${docStem.replace(/[ ()]/g, (ch) => encodeURIComponent(ch))}/`;
  const linked = (t: string) => (images.length
    ? t.replace(/!\[image\]\(image_/g, `![image](${link}image_`).replace(/(<img\b[^>]*\bsrc=")image_/g, `$1${link}image_`)
    : t);
  const markdown = linked(r.markdown);

  let content: string;
  if (format === 'html') content = renderHtml(markdown);
  else if (format === 'chunks') content = JSON.stringify(blocksToChunks(r.blocks), null, 2);
  else if (format === 'json') {
    content = JSON.stringify({
      fileType: r.fileType,
      pageCount: r.pageCount,
      metadata: r.metadata,
      outline: r.outline,
      warnings: r.warnings,
      blocks: r.blocks,
      pages: r.pages,
      images: images.map((i) => ({ filename: i.filename, mimeType: i.mimeType, path: link + i.filename })),
    }, (_k, v) => (v instanceof Uint8Array ? undefined : v), 2);
  } else content = markdown;

  if (outPath) {
    await writeFile(outPath, content, 'utf-8');
    if (images.length) {
      const dir = join(dirname(outPath), 'images', docStem);
      await mkdir(dir, { recursive: true });
      for (const img of images) await writeFile(join(dir, img.filename), img.data);
    }
  }
  return {
    ...(outPath ? { output_path: outPath } : {}),
    content,
    page_count: r.pageCount ?? r.metadata?.pageCount,
    warnings: parseWarnings(r),
  };
}

export async function convertBatch(p: ConvertParams & { paths: string[] }, signal: AbortSignal): Promise<{ results: BatchItemResult[]; output_dir: string }> {
  const results: BatchItemResult[] = [];
  const total = p.paths.length;
  for (const [i, path] of p.paths.entries()) {
    signal.throwIfAborted();
    sendProgress({ current: i + 1, total, message: `${basename(path)} 변환 중 (${i + 1}/${total})` });
    try {
      const r = await convert({ ...p, path, save: true }, signal, true);
      results.push({ path, ok: true, output_path: r.output_path });
    } catch (err) {
      if (signal.aborted) throw err;
      results.push({ path, ok: false, error: errorText(err) });
    }
  }
  return { results, output_dir: outputDir({ output_dir: p.output_dir, source: p.paths[0] }) };
}
