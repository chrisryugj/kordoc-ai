/** 파일 형식 판정 — 확장자 기준, .hwp 는 HWP 3.x 여부만 머리 바이트로 가른다 */

import { closeSync, openSync, readSync } from 'node:fs';
import { extname } from 'node:path';
import type { DocFormat } from '../../types/rpc-contract.js';

const EXT_FORMAT: Record<string, DocFormat> = {
  '.hwp': 'hwp',
  '.hwpx': 'hwpx',
  '.hml': 'hwpml',
  '.hwpml': 'hwpml',
  '.pdf': 'pdf',
  '.xls': 'xls',
  '.xlsx': 'xlsx',
  '.docx': 'docx',
  '.pptx': 'pptx',
  '.png': 'image',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.webp': 'image',
  '.md': 'md',
  '.markdown': 'md',
  '.txt': 'txt',
  '.csv': 'csv',
};

/** kordoc 으로 읽는 형식 */
export const PARSEABLE = new Set<DocFormat>(['hwp', 'hwp3', 'hwpx', 'hwpml', 'pdf', 'xls', 'xlsx', 'docx', 'pptx', 'image']);
/** 글자 파일 (그대로 읽음) */
export const TEXT_FORMATS = new Set<DocFormat>(['md', 'txt', 'csv']);
/** 쪽 미리보기 가능 */
export const LAYOUT_FORMATS = new Set<DocFormat>(['hwp', 'hwpx', 'pdf', 'image']);

/** HWP 3.x 서명 "HWP Document File" */
function isHwp3(path: string): boolean {
  let fd: number | undefined;
  try {
    fd = openSync(path, 'r');
    const buf = Buffer.alloc(17);
    readSync(fd, buf, 0, 17, 0);
    return buf.toString('latin1') === 'HWP Document File';
  } catch {
    return false;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

export function formatOf(path: string): DocFormat {
  const f = EXT_FORMAT[extname(path).toLowerCase()] ?? 'unknown';
  return f === 'hwp' && isHwp3(path) ? 'hwp3' : f;
}

/** 오피스 임시 파일(~$), 숨김 파일 */
export function isJunkName(name: string): boolean {
  return name.startsWith('~$') || name.startsWith('.') || name.toLowerCase() === 'thumbs.db';
}
