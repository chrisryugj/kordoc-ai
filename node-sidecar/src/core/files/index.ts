/** 파일 목록 펼치기(scan_paths)·문서 정보(doc_info) */

import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { parse } from 'kordoc';
import type { DocInfo, FileEntry } from '../../types/rpc-contract.js';
import { parseFailure } from '../errors.js';
import { parseWarnings } from '../converter/index.js';
import { openPdf } from '../render/pdfium.js';
import { estimatePages } from '../render/rhwp.js';
import { formatOf, isJunkName, LAYOUT_FORMATS, PARSEABLE } from './format.js';

const MAX_FILES = 2000;
const MAX_DEPTH = 12;

/** 파일·폴더 섞인 목록 → 지원 문서만 (폴더는 하위까지, 숨김·임시 파일 제외, 최대 2,000개) */
export async function scanPaths(paths: string[]): Promise<{ files: FileEntry[]; skipped: number }> {
  const files: FileEntry[] = [];
  const seen = new Set<string>();
  let skipped = 0;

  const addFile = (path: string, size: number) => {
    const format = formatOf(path);
    if (format === 'unknown' || isJunkName(basename(path)) || files.length >= MAX_FILES) {
      skipped++;
      return;
    }
    if (seen.has(path)) return;
    seen.add(path);
    files.push({ path, name: basename(path), size, format });
  };

  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > MAX_DEPTH || files.length >= MAX_FILES) return;
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    entries.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
    for (const e of entries) {
      if (isJunkName(e.name) || e.name === 'node_modules' || e.isSymbolicLink()) continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) await walk(p, depth + 1);
      else if (e.isFile()) addFile(p, (await stat(p).catch(() => null))?.size ?? 0);
    }
  };

  for (const p of paths) {
    const st = await stat(p).catch(() => null);
    if (!st) skipped++;
    else if (st.isDirectory()) await walk(p, 0);
    else if (st.isFile()) addFile(p, st.size);
  }
  return { files, skipped };
}

/** PDF 는 다 읽으면 느려서(300쪽 12초) 고르게 흩은 6쪽만 읽어 OCR 필요 여부를 본다 */
function samplePages(count: number): string {
  const picks = new Set([1, 2, Math.ceil(count / 4), Math.ceil(count / 2), Math.ceil((count * 3) / 4), count]);
  return [...picks].filter((n) => n >= 1 && n <= count).sort((a, b) => a - b).join(',');
}

export async function docInfo(path: string, password?: string): Promise<DocInfo> {
  const st = await stat(path);
  if (!st.isFile()) throw new Error('파일이 아닙니다. 파일을 고르세요.');
  const format = formatOf(path);
  const info: DocInfo = {
    path,
    name: basename(path),
    size: st.size,
    format,
    encrypted: false,
    needs_ocr: format === 'image',
    has_layout: LAYOUT_FORMATS.has(format),
    editable: format === 'hwpx',
    warnings: [],
  };
  if (format === 'image') return { ...info, page_count: 1 };
  if (!PARSEABLE.has(format)) return info;

  const buf = await readFile(path);
  const locked = (msg: string): DocInfo => ({ ...info, encrypted: true, editable: false, warnings: [msg] });
  let pages: string | undefined;
  if (format === 'pdf') {
    try {
      const doc = await openPdf(new Uint8Array(buf), password);
      pages = samplePages(doc.getPageCount());
      doc.destroy();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/암호/.test(msg)) return locked(msg);
    }
  }
  const r = await parse(buf, { filePath: path, password, pages, images: false, ocr: false });
  if (!r.success) {
    if (r.code === 'ENCRYPTED') {
      return locked(password ? '암호가 맞지 않습니다. 다시 확인하세요.' : '암호가 걸린 문서입니다. 암호를 넣으면 열 수 있습니다.');
    }
    if (r.code === 'DRM_PROTECTED') return { ...locked('한컴 문서보안(DRM)이 걸린 문서라 열 수 없습니다.'), has_layout: false };
    throw parseFailure(r, !!password);
  }
  const m = r.metadata;
  const quality = r.pageQuality ?? [];
  const counted = m?.pageCount ?? r.pageCount;
  const est = format === 'hwpx' ? estimatePages(counted ?? 0, r.markdown ?? '') : null;
  return {
    ...info,
    page_count: est ?? counted,
    title: m?.title || undefined,
    author: m?.author || undefined,
    created: m?.createdAt,
    modified: m?.modifiedAt,
    encrypted: !!password,
    editable: info.editable && !password,
    needs_ocr: format === 'pdf' && quality.length > 0 && quality.filter((q) => q.needsOcr).length * 2 >= quality.length,
    warnings: [...(est ? ['쪽 수는 글 양으로 어림잡은 값입니다(한글에서 저장하지 않은 문서).'] : []), ...parseWarnings(r)].slice(0, 10),
  };
}
