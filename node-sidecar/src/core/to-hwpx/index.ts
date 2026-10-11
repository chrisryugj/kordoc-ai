/** 한글로 바꾸기 (to_hwpx·to_hwpx_batch) — PDF·워드·엑셀·스캔본 → 고칠 수 있는 HWPX, 옛 HWP → 서식 그대로 HWPX
 *
 * HWP 가 아니면 레이아웃을 베끼지 않고 글·표·그림을 다시 조판한다 (kordoc parse → markdownToHwpx).
 * preset 을 주면 그 공문서 서식(항목부호·여백·글꼴)으로 짠다. 'auto' 면 문서 모양을 보고 고르고, 애매하면 서식 없이.
 * HWP 는 rhwp 로 옮겨서 preset 을 쓰지 않는다.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { markdownToHwpx } from 'kordoc';
import { rhwpConvert, tooBigForRhwp } from '../render/rhwp.js';
import type { BatchItemResult } from '../../types/rpc-contract.js';
import { sendProgress } from '../../infra/progress.js';
import { cleanMessage, errorText } from '../errors.js';
import { parseDoc, parseWarnings, type OcrMode } from '../converter/index.js';
import { formatOf } from '../files/format.js';
import { AUTO_FIT, guessPreset, PRESETS, presetOf } from '../gongmun/index.js';
import { outputDir, outputFile, stemOf } from '../output/index.js';

export async function toHwpx(
  p: { path: string; preset?: string; ocr?: OcrMode; output_path?: string; output_dir?: string },
  signal?: AbortSignal,
  quiet = false,
): Promise<{ output_path: string; warnings: string[]; style: string }> {
  const fmt = formatOf(p.path);
  if (fmt === 'hwpx') throw new Error('이미 HWPX 문서입니다.');
  const warnings: string[] = [];
  const outName = `${stemOf(p.path)}.hwpx`;
  // 아주 큰 HWP(1천 쪽 넘게)는 rhwp 가 수 분 동안 엔진을 멈추게 해서 서식 그대로 옮기지 않는다
  const hwp = fmt === 'hwp' ? new Uint8Array(await readFile(p.path)) : null;
  const big = hwp ? await tooBigForRhwp(hwp) : null;
  if (big) warnings.push(`문서가 커서(약 ${big.toLocaleString('ko-KR')}쪽) 서식 그대로 옮기지 않고 글·표를 다시 짰습니다.`);
  if (hwp && !big) {
    // 옛 HWP 는 다시 짜지 않고 rhwp 로 서식 그대로 HWPX 로 옮긴다. 못 열면 아래에서 글·표를 다시 짠다
    try {
      const bytes = await rhwpConvert(hwp, 'hwpx', signal);
      const outPath = outputFile({ output_path: p.output_path, output_dir: p.output_dir, source: p.path, name: outName });
      await writeFile(outPath, bytes);
      return { output_path: outPath, warnings, style: '서식 그대로' };
    } catch (err) {
      if (signal?.aborted) throw err;
      warnings.push(`서식 그대로 옮기지 못해 글·표를 다시 짰습니다 (${errorText(err)}).`);
    }
  }
  const r = await parseDoc(p.path, { ocr: p.ocr, images: true, progressLabel: quiet ? undefined : `${basename(p.path)} 읽는 중`, signal });
  if (!r.markdown.trim()) throw new Error('문서에서 글자를 찾지 못했습니다. 스캔본이면 OCR을 켜고 다시 시도하세요.');
  // 'auto': 문서 모양(수신·시행 줄, □○ 항목, 회의록·보도자료 등)을 보고 갈래를 고른다
  const preset = p.preset === 'auto' ? guessPreset(r.markdown) : p.preset ? presetOf(p.preset) : undefined;
  const images = Object.fromEntries((r.images ?? []).map((i) => [i.filename, i.data]));
  const genWarnings: string[] = [];
  const buf = await markdownToHwpx(r.markdown, {
    // 원본 글에 끝 표시가 이미 있으므로 엔진이 "끝." 을 또 붙이지 않게
    ...(preset ? { gongmun: { preset, endMark: false, autoFit: { ...AUTO_FIT } } } : {}),
    ...(Object.keys(images).length ? { images } : {}),
    warnings: genWarnings,
  });
  warnings.push(...parseWarnings(r), ...genWarnings.map(cleanMessage));
  const outPath = outputFile({ output_path: p.output_path, output_dir: p.output_dir, source: p.path, name: outName });
  await writeFile(outPath, Buffer.from(buf));
  const style = preset ? `${PRESETS.find((x) => x.id === preset)?.label ?? preset} 서식` : '꾸밈 없이';
  return { output_path: outPath, warnings: [...new Set(warnings)].slice(0, 20), style };
}

export async function toHwpxBatch(p: { paths: string[]; preset?: string; output_dir?: string }, signal: AbortSignal): Promise<{ results: BatchItemResult[]; output_dir: string }> {
  const results: BatchItemResult[] = [];
  for (const [i, path] of p.paths.entries()) {
    signal.throwIfAborted();
    sendProgress({ current: i + 1, total: p.paths.length, message: `${basename(path)} 한글로 바꾸는 중 (${i + 1}/${p.paths.length})` });
    try {
      const r = await toHwpx({ path, preset: p.preset, output_dir: p.output_dir }, signal, true);
      results.push({ path, ok: true, output_path: r.output_path, note: r.style });
    } catch (err) {
      if (signal.aborted) throw err;
      results.push({ path, ok: false, error: errorText(err) });
    }
  }
  return { results, output_dir: outputDir({ output_dir: p.output_dir, source: p.paths[0] }) };
}
