/** 파일 수합 — 마크다운 병합 또는 서식 유지 수합 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import JSZip from 'jszip';
import { dirname, basename, extname, join } from 'node:path';
import { sendProgress } from '../../infra/progress.js';
import { logger } from '../../infra/logger.js';
import { mergeHwpx } from './hwpx-merge.js';
import { splitHwpx, type SplitMode } from './hwpx-split.js';
import { rhwpConvert, tooBigForRhwp } from '../render/rhwp.js';
import { parseBytes } from '../converter/index.js';
import { concatDocx } from './concat-docx.js';
import { concatXlsx } from './concat-xlsx.js';
import { concatPdf, splitPdf } from './concat-pdf.js';
import type { MergeFilesParams, MergeFilesResult, MergeFailure } from './types.js';
import { errorText, parseFailure } from '../errors.js';
import { dropPartial, resultDir, stemOf } from '../output/index.js';
import { checkZipSize, entryText } from '../files/zip-read.js';

export type { MergeFilesParams, MergeFilesResult } from './types.js';
export { splitPdf, extractPdfPages, getPdfPageCount } from './concat-pdf.js';
export type { SplitPdfParams, SplitPdfResult, ExtractPdfPagesParams, ExtractPdfPagesResult } from './concat-pdf.js';

/** 깨진 HWPX 는 합치기 전에 걸러 어느 파일인지 알린다 (합치는 도중에 터지면 어느 파일 때문인지 모른다) */
async function checkHwpx(bytes: Uint8Array): Promise<void> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    throw new Error('한글 문서로 열 수 없습니다. 파일이 손상됐거나 저장이 끝나지 않은 파일일 수 있습니다. 한글에서 열리는지 확인하세요.');
  }
  if (!zip.file('Contents/header.xml') || !Object.keys(zip.files).some((n) => /content\.hpf$/i.test(n))) {
    throw new Error('HWPX 문서 구조가 아닙니다. 한글에서 열어 HWPX로 다시 저장한 뒤 넣으세요.');
  }
  checkZipSize(zip);
  // 암호 걸린 문서는 안의 XML 이 암호문이다. 그대로 넘기면 합치기·나누기 전체가 XML 오류(영어)로 죽고 어느 파일 때문인지도 모른다
  // 크기 상한을 넘는 항목(압축 폭탄)은 걸러 어느 파일인지 알린다. 그 밖의 읽기 실패는 전처럼 빈 글로
  const read = (name: string) => entryText(zip, name).catch((err: unknown) => {
    if ((err as { code?: unknown })?.code === 'ZIP_TOO_BIG') throw err;
    return '';
  });
  const manifest = await read('META-INF/manifest.xml') ?? '';
  const head = (await read('Contents/header.xml') ?? '').trimStart();
  if (/encryption-data/i.test(manifest) || !head.startsWith('<')) {
    throw new Error('암호가 걸린 문서라 쓸 수 없습니다. 한글에서 암호를 풀어 다시 저장한 뒤 넣으세요.');
  }
}

/** HWPX·HWP 서식 유지 수합 — 한컴오피스 없이 XML 수준으로 이어 붙인다 (HWP 는 rhwp 로 HWPX 로 바꿔서) */
async function mergeHangul(params: MergeFilesParams, signal: AbortSignal): Promise<MergeFilesResult> {
  const inputs: Uint8Array[] = [];
  const failed: MergeFailure[] = [];
  for (const [i, f] of params.files.entries()) {
    signal.throwIfAborted();
    sendProgress({ current: i, total: params.files.length + 1, message: `${basename(f)} 읽는 중` });
    try {
      const bytes = new Uint8Array(await readFile(f));
      if (extname(f).toLowerCase() === '.hwp') {
        const big = await tooBigForRhwp(bytes);
        if (big) throw new Error(`문서가 너무 큽니다(약 ${big}쪽)`);
        inputs.push(await rhwpConvert(bytes, 'hwpx', signal));
      } else {
        await checkHwpx(bytes);
        inputs.push(bytes);
      }
    } catch (err) {
      if (signal.aborted) throw err;
      failed.push({ path: f, error: errorText(err) });
      logger.warn(`[merge] ${f} 읽기 실패: ${err instanceof Error ? err.message : err}`);
    }
  }
  if (inputs.length < 2) {
    const why = failed.map((x) => `${basename(x.path)}: ${x.error}`).join(' / ');
    throw new Error(`합칠 수 있는 한글 문서가 두 개 이상 필요합니다.${why ? ` 읽지 못한 파일 ${why}` : ''}`);
  }
  sendProgress({ current: params.files.length, total: params.files.length + 1, message: '서식 그대로 합치는 중' });
  const merged = await mergeHwpx(inputs, signal);
  let out = merged.bytes;
  if (extname(params.output_path).toLowerCase() === '.hwp') out = await rhwpConvert(out, 'hwp', signal);
  await mkdir(dirname(params.output_path), { recursive: true });
  await writeFile(params.output_path, out);
  return {
    success: true,
    output_path: params.output_path,
    file_count: inputs.length,
    total_length: out.byteLength,
    failed_files: failed.map((x) => x.path),
    failed,
    ...(merged.warnings.length ? { warnings: merged.warnings } : {}),
  };
}

/** 한글 문서 나누기 — 구역·강제 쪽 나눔마다 서식 그대로 HWPX 여러 개로 (HWP 는 HWPX 로 바꿔서). 원본은 그대로 */
export async function splitHangul(p: { path: string; output_dir: string; mode?: SplitMode }, signal: AbortSignal): Promise<{ output_dir: string; output_files: string[]; sections: number; page_breaks: number }> {
  const ext = extname(p.path).toLowerCase();
  if (ext !== '.hwp' && ext !== '.hwpx') throw new Error('한글 문서(HWP·HWPX)만 나눌 수 있습니다.');
  sendProgress({ current: 0, total: 2, message: `${basename(p.path)} 읽는 중` });
  let bytes: Uint8Array = new Uint8Array(await readFile(p.path));
  if (ext === '.hwp') bytes = await rhwpConvert(bytes, 'hwpx', signal);
  else await checkHwpx(bytes);
  signal.throwIfAborted();
  sendProgress({ current: 1, total: 2, message: '서식 그대로 나누는 중' });
  const r = await splitHwpx(bytes, p.mode ?? 'auto', signal);
  signal.throwIfAborted();
  // 전에 나눈 결과가 든 폴더면 덮어쓰지 않고 (2) 폴더에
  const output_dir = resultDir(p.output_dir);
  const stem = stemOf(p.path);
  const width = String(r.parts.length).length;
  const output_files: string[] = [];
  try {
    for (const [i, part] of r.parts.entries()) {
      // 멈춘(시간 초과 포함) 뒤에는 파일을 더 쓰지 않는다
      signal.throwIfAborted();
      const out = join(output_dir, `${stem}_${String(i + 1).padStart(width, '0')}.hwpx`);
      output_files.push(out);
      await writeFile(out, part);
    }
  } catch (err) {
    // 반쯤 쓴 결과는 지운다 — 멈췄을 때도, 쓰다 실패했을 때도(디스크 가득·공유 폴더 끊김)
    await dropPartial(output_files, output_dir);
    throw err;
  }
  return { output_dir, output_files, sections: r.sections, page_breaks: r.pageBreaks };
}

const READ_FAILED = '이 파일을 읽지 못해 넣지 못했습니다. 원래 프로그램에서 열리는지 확인하세요.';

/** 합치지 못한 파일을 이유와 함께 담고, 합친 파일 수를 실제 수로 */
function settle(r: MergeFilesResult, files: string[]): MergeFilesResult & { failed: MergeFailure[] } {
  const failed = r.failed ?? r.failed_files.map((path) => ({ path, error: READ_FAILED }));
  return { ...r, file_count: files.length - failed.length, failed_files: failed.map((x) => x.path), failed };
}

export async function mergeFiles(
  params: MergeFilesParams,
  signal: AbortSignal,
): Promise<MergeFilesResult & { failed: MergeFailure[] }> {
  // native 모드: 포맷별 서식 유지 수합
  if (params.mode === 'native') {
    const ext = extname(params.files[0]).toLowerCase();
    switch (ext) {
      case '.hwp':
      case '.hwpx': return settle(await mergeHangul(params, signal), params.files);
      case '.xlsx': return settle(await concatXlsx(params, signal), params.files);
      case '.docx': return settle(await concatDocx(params, signal), params.files);
      case '.pdf': return settle(await concatPdf(params, signal), params.files);
      default: throw new Error(`서식 유지 합치기를 지원하지 않는 형식입니다: ${ext}`);
    }
  }

  // markdown 모드 (기본): 기존 로직
  const { files, output_path, separator } = params;
  const sections: string[] = [];
  const failed: MergeFailure[] = [];

  logger.info(`[merge] ${files.length}개 파일 병합 시작`);

  for (let i = 0; i < files.length; i++) {
    if (signal.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    sendProgress({
      current: i + 1,
      total: files.length,
      message: `파일 ${i + 1}/${files.length} 변환 중`,
    });

    const filePath = files[i];
    try {
      const buffer = await readFile(filePath);
      const result = await parseBytes(buffer, {}, undefined, signal);

      if (result.success) {
        const fileName = basename(filePath);
        const divider = separator ?? `\n\n---\n\n## ${fileName}\n\n`;
        sections.push(i === 0 ? `## ${fileName}\n\n${result.markdown}` : `${divider}${result.markdown}`);
      } else {
        failed.push({ path: filePath, error: errorText(parseFailure(result)) });
        logger.warn(`[merge] 실패: ${filePath} — ${result.error}`);
      }
    } catch (err) {
      if (signal.aborted) throw err;
      failed.push({ path: filePath, error: errorText(err) });
      logger.warn(`[merge] 에러: ${filePath} — ${err instanceof Error ? err.message : err}`);
    }
  }

  // 하나도 못 읽었으면 빈 파일을 만들지 않는다
  if (!sections.length) {
    const why = failed.map((x) => `${basename(x.path)}: ${x.error}`).join(' / ');
    throw new Error(`합칠 수 있는 문서가 없습니다. 고른 파일을 하나도 읽지 못했습니다. ${why}`.trim());
  }
  const merged = sections.join('');

  await mkdir(dirname(output_path), { recursive: true });
  await writeFile(output_path, merged, 'utf-8');

  logger.info(`[merge] done → ${output_path} (${merged.length}자, ${failed.length}개 실패)`);

  return settle({
    success: true,
    output_path,
    file_count: sections.length,
    total_length: merged.length,
    failed_files: failed.map((x) => x.path),
    failed,
  }, files);
}
