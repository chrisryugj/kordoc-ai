/** 꺼내기·취합 — extract_images(그림만 폴더로) · collect_fields·collect_run(같은 서식 문서들 → 엑셀 한 장)
 *
 * 취합은 누름틀(HWPX)과 라벨-값 표 칸(extractFormFields)을 칸 이름으로 쓴다. 칸 이름 비교는 띄어쓰기를 가리지 않는다.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { extractClickHereFields, extractFormFields } from 'kordoc';
import type { BatchItemResult } from '../../types/rpc-contract.js';
import { sendProgress } from '../../infra/progress.js';
import { errorText } from '../errors.js';
import { parseDoc } from '../converter/index.js';
import { buildXlsx } from '../excel/xlsx.js';
import { formatOf } from '../files/format.js';
import { outputDir, outputFile, safeFileName, stemOf, uniquePath } from '../output/index.js';

export async function extractImages(p: { path: string; output_dir?: string; allow_empty?: boolean }, signal?: AbortSignal): Promise<{ output_dir: string; count: number }> {
  const r = await parseDoc(p.path, { images: true, ocr: 'off', signal });
  const images = r.images ?? [];
  if (!images.length) {
    if (p.allow_empty) return { output_dir: '', count: 0 };
    throw new Error('이 문서에는 꺼낼 그림이 없습니다.');
  }
  const dir = p.output_dir ?? uniquePath(join(outputDir({ source: p.path }), `${safeFileName(stemOf(p.path))}_그림`));
  await mkdir(dir, { recursive: true });
  for (const img of images) await writeFile(uniquePath(join(dir, safeFileName(img.filename, 'image'))), img.data);
  return { output_dir: dir, count: images.length };
}

const label = (s: string) => s.replace(/\s+/g, ' ').trim();
const key = (s: string) => s.replace(/\s+/g, '');

/** 한 문서의 칸 이름·값 (누름틀 먼저, 그다음 표 칸) */
async function docFields(path: string, signal?: AbortSignal): Promise<Array<{ label: string; value: string }>> {
  return (await readFormDoc(path, signal)).fields;
}

/** 칸 이름·값 + 본문 글 (문서 수합이 부서 이름을 본문에서도 찾는다) */
export async function readFormDoc(path: string, signal?: AbortSignal): Promise<{ fields: Array<{ label: string; value: string }>; markdown: string }> {
  const out: Array<{ label: string; value: string }> = [];
  if (formatOf(path) === 'hwpx') {
    const buf = await readFile(path);
    for (const f of await extractClickHereFields(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer)) {
      out.push({ label: label(f.name), value: f.value.trim() });
    }
  }
  const r = await parseDoc(path, { images: false, ocr: 'off', keepLayout: true, signal });
  for (const f of extractFormFields(r.blocks).fields) out.push({ label: label(f.label), value: f.value.trim() });
  return { fields: out.filter((f) => f.label && f.label.length <= 40), markdown: r.markdown };
}

export async function collectFields(p: { paths: string[] }, signal: AbortSignal): Promise<{ fields: Array<{ label: string; count: number }> }> {
  const seen = new Map<string, { label: string; docs: Set<number> }>();
  for (const [i, path] of p.paths.entries()) {
    signal.throwIfAborted();
    sendProgress({ current: i + 1, total: p.paths.length, message: `${basename(path)} 칸 찾는 중 (${i + 1}/${p.paths.length})` });
    const fields = await docFields(path, signal).catch((err) => {
      if (signal.aborted) throw err;
      return [];
    });
    for (const f of fields) {
      const k = key(f.label);
      const e = seen.get(k) ?? { label: f.label, docs: new Set<number>() };
      e.docs.add(i);
      seen.set(k, e);
    }
  }
  const fields = [...seen.values()].map((e) => ({ label: e.label, count: e.docs.size }));
  return { fields: fields.sort((a, b) => b.count - a.count) };
}

export async function collectRun(
  p: { paths: string[]; fields: string[]; output_path?: string },
  signal: AbortSignal,
): Promise<{ output_path: string; rows: number; failed: BatchItemResult[] }> {
  if (!p.fields.length) throw new Error('엑셀로 모을 칸을 하나 이상 고르세요.');
  const rows: string[][] = [];
  const failed: BatchItemResult[] = [];
  for (const [i, path] of p.paths.entries()) {
    signal.throwIfAborted();
    sendProgress({ current: i + 1, total: p.paths.length, message: `${basename(path)} 모으는 중 (${i + 1}/${p.paths.length})` });
    try {
      const values = new Map<string, string>();
      for (const f of await docFields(path, signal)) {
        const k = key(f.label);
        if (!values.get(k)) values.set(k, f.value);
      }
      rows.push([basename(path), ...p.fields.map((f) => values.get(key(f)) ?? '')]);
    } catch (err) {
      if (signal.aborted) throw err;
      failed.push({ path, ok: false, error: errorText(err) });
    }
  }
  if (!rows.length) throw new Error(`모을 수 있는 문서가 없습니다. ${failed[0]?.error ?? ''}`.trim());
  const data = await buildXlsx([{ name: '취합', header: true, rows: [['파일', ...p.fields], ...rows] }]);
  const outPath = outputFile({ output_path: p.output_path, source: p.paths[0], name: `취합_${p.fields.length}칸_${rows.length}건.xlsx` });
  await writeFile(outPath, data);
  return { output_path: outPath, rows: rows.length, failed };
}
