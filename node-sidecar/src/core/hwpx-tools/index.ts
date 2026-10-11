/** 한글 문서 손질 — 도장 찍기(seal) · 고친 글 반영(patch_document) · HWPX 구조 검사(validate_hwpx) */

import { readFile, writeFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { patchHwp, patchHwpx, placeSealHwpx, validateHwpx } from 'kordoc';
import { formatOf } from '../files/format.js';
import { outputFile, stemOf } from '../output/index.js';

const toAB = (b: Buffer): ArrayBuffer => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
const SEAL_EXT = new Set(['png', 'jpg', 'jpeg', 'bmp', 'gif']);

export async function seal(p: { path: string; image_path: string; anchor: string; output_path?: string }): Promise<{ output_path: string; placed: number }> {
  if (formatOf(p.path) !== 'hwpx') throw new Error('도장은 HWPX 문서에만 찍을 수 있습니다. 한글에서 HWPX로 저장해 넣으세요.');
  const ext = extname(p.image_path).slice(1).toLowerCase();
  if (!SEAL_EXT.has(ext)) throw new Error('도장 그림은 PNG·JPG 파일로 넣으세요. 배경이 투명한 PNG가 좋습니다.');
  const anchor = p.anchor?.trim() || '(인)';
  const [doc, image] = await Promise.all([readFile(p.path), readFile(p.image_path)]);
  const r = await placeSealHwpx(toAB(doc), [{ anchor, image: new Uint8Array(image), ext: ext as 'png' | 'jpg' | 'jpeg' | 'bmp' | 'gif' }]);
  const outPath = outputFile({ output_path: p.output_path, source: p.path, name: `${stemOf(p.path)}_날인.hwpx` });
  await writeFile(outPath, Buffer.from(r.buffer));
  return { output_path: outPath, placed: r.placed.length };
}

export async function patchDocument(p: { path: string; markdown: string; output_path?: string }): Promise<{ output_path: string; applied: number; skipped: Array<{ reason: string; excerpt?: string }> }> {
  const fmt = formatOf(p.path);
  if (fmt !== 'hwpx' && fmt !== 'hwp') throw new Error('서식 그대로 반영은 HWPX·HWP 문서만 됩니다.');
  if (typeof p.markdown !== 'string' || !p.markdown.trim()) throw new Error('반영할 글이 비어 있습니다.');
  const original = new Uint8Array(await readFile(p.path));
  const r = fmt === 'hwpx' ? await patchHwpx(original, p.markdown) : await patchHwp(original, p.markdown);
  if (!r.success || !r.data) throw new Error(r.error || '고친 글을 반영하지 못했습니다.');
  const outPath = outputFile({ output_path: p.output_path, source: p.path, name: `${stemOf(p.path)}_수정.${fmt}` });
  await writeFile(outPath, r.data);
  return {
    output_path: outPath,
    applied: r.applied,
    skipped: r.skipped.map((s) => ({ reason: s.reason, ...(s.before ?? s.after ? { excerpt: s.before ?? s.after } : {}) })),
  };
}

export async function validateHwpxFile(path: string): Promise<{ ok: boolean; issues: Array<{ severity: string; message: string; part?: string }> }> {
  if (formatOf(path) !== 'hwpx') throw new Error('구조 검사는 HWPX 문서만 됩니다.');
  const r = await validateHwpx(await readFile(path));
  return { ok: r.ok, issues: r.issues.map((i) => ({ severity: 'error', message: i.message, ...(i.path ? { part: i.path } : {}) })) };
}
