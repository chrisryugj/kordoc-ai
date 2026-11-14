/** 문서 읽기·변환 — 문서 기능 공용 parseDoc + convert·convert_batch
 *
 * parseDoc: 파일 → kordoc ParseSuccess (실패는 사람이 읽을 오류로 throw). md·txt·csv 는 글 그대로.
 * convert: 형식 md·html·json·chunks·txt(마크다운 표시를 걷은 글, 표는 탭), save=false 면 저장 없이 content 만.
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
import { zipXmlBytes } from '../files/zip-read.js';
import { outputDir, outputFile, stemOf } from '../output/index.js';
import { markdownToPlain } from './plain.js';

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
  /** 브라우저가 못 그리는 그림(BMP·TIFF 등)만 PNG 로 바꾼다 — 브라우저로 그리는 PDF·HTML·마크다운용. 글(markdown)과 images 만 맞춘다(blocks 는 그대로) */
  drawableImages?: boolean;
  /** PDF 그림 블록을 쪽 끝이 아니라 읽는 차례 제자리에 ("flow") */
  imagePlacement?: ParseOptions['imagePlacement'];
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

/** kordoc 으로 읽기. 큰 PDF(3MB~)·아주 큰 파일(30MB~)은 작업자 스레드에서 (infra/worker: 800쪽 PDF 를 읽는 20초 동안 엔진이 멈추고 취소도 못 받았다).
 *  ZIP 꼴(HWPX·DOCX·XLSX·PPTX)은 압축을 푼 XML 크기로 잰다: 200KB HWPX 의 XML 이 43MB 라 엔진 스레드에서 읽는 동안 RSS 1.26GB 였다 */
export function parseBytes(buf: Buffer, opts: Omit<ParseOptions, 'onProgress'>, onProgress?: Progress, signal?: AbortSignal): Promise<ParseResult> {
  const pdf = buf.subarray(0, 5).toString('latin1') === '%PDF-';
  if (buf.length >= (pdf ? 3 : 30) * 1024 * 1024 || zipXmlBytes(buf) >= 30 * 1024 * 1024) return parseInWorker(buf, opts, onProgress, signal);
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
  const base: Omit<ParseOptions, 'onProgress'> = {
    filePath: path,
    pages: opts.pages,
    password: opts.password,
    ocr: ocrOption(opts.ocr ?? getSettings().convert.ocr),
    images: opts.images,
    plain: opts.plain,
    htmlTables: opts.htmlTables,
    layoutTables: opts.keepLayout ? 'keep' : undefined,
    imagePlacement: opts.imagePlacement,
  };
  const r = await parseBytes(buf, base, (current, total) => {
    if (label) sendProgress({ current, total, message: `${label} ${current}/${total}쪽` });
  }, signal);
  signal?.throwIfAborted();
  if (!r.success) throw parseFailure(r, !!opts.password);
  return opts.drawableImages && opts.images ? withDrawableImages(r, buf, base, signal) : r;
}

/** 브라우저가 그리는 그림 형식 */
const DRAWABLE = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml']);

/** 브라우저가 못 그리는 그림(BMP·TIFF 등)만 PNG 로 바꿔 끼운다.
 *  엔진의 imageFormat 은 모든 그림을 바꿔 JPEG 사진까지 무손실 PNG 로 부풀린다(사진 문서가 몇 배로 커진다).
 *  못 그리는 그림이 있을 때만 같은 옵션으로 한 번 더 읽어(그림 차례가 같다) 그 그림의 이름·바이트만 가져온다. 못 바꾼 그림(WMF 등)은 그대로 */
async function withDrawableImages(r: ParseSuccess, buf: Buffer, base: Omit<ParseOptions, 'onProgress'>, signal?: AbortSignal): Promise<ParseSuccess> {
  const images = r.images ?? [];
  if (images.every((i) => DRAWABLE.has(i.mimeType))) return r;
  const again = await parseBytes(buf, { ...base, imageFormat: 'png' }, undefined, signal).catch((err) => { if (signal?.aborted) throw err; return null; });
  const png = again?.success ? again.images ?? [] : [];
  if (png.length !== images.length) return r;
  let markdown = r.markdown;
  images.forEach((img, i) => {
    const p = png[i];
    if (DRAWABLE.has(img.mimeType) || !DRAWABLE.has(p.mimeType)) return;
    if (p.filename !== img.filename) markdown = markdown.split(`(${img.filename})`).join(`(${p.filename})`).split(`"${img.filename}"`).join(`"${p.filename}"`);
    Object.assign(img, { filename: p.filename, data: p.data, mimeType: p.mimeType });
  });
  return { ...r, markdown };
}

/** kordoc 경고 → 화면 문장 (OCR 필요 경고는 CLI 안내 대신 할 일로) */
export function parseWarnings(r: ParseSuccess): string[] {
  const out = (r.warnings ?? []).map((w) => (w.code === 'NEEDS_OCR' || /CLI|ocr: true/.test(w.message)
    ? '글자 층이 없는 쪽(스캔)이 있습니다. 글자 읽기(OCR)를 켜고 다시 시도하세요.'
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
    // 마크다운·HTML 은 브라우저·미리보기 창이 그림을 그린다: 못 그리는 형식만 PNG 로, PDF 그림은 읽는 차례 제자리에
    drawableImages: format === 'md' || format === 'html',
    imagePlacement: 'flow',
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
  } else if (format === 'txt' && !TEXT_FORMATS.has(formatOf(p.path))) content = markdownToPlain(markdown);
  else content = markdown;

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
    const step = { current: i + 1, total, message: `${basename(path)} 변환 중 (${i + 1}/${total})` };
    sendProgress(step);
    try {
      const r = await convert({ ...p, path, save: true }, signal, true);
      results.push({ path, ok: true, output_path: r.output_path });
    } catch (err) {
      if (signal.aborted) throw err;
      results.push({ path, ok: false, error: errorText(err) });
    }
    // 끝난 파일마다 결과를 알린다: 중간에 멈추면 응답이 없어, 이것이 없으면 이미 만든 파일이 화면에 "대기"로 남는다
    sendProgress({ ...step, item: results[results.length - 1] });
  }
  return { results, output_dir: outputDir({ output_dir: p.output_dir, source: p.paths[0] }) };
}
