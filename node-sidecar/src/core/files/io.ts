/** 바이트 저장·읽기 (write_file·read_file_b64) — 편집기 내보내기 등. 확장자 허용 목록 + 크기 상한 */

import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname } from 'node:path';
import { showFieldGuides } from '../render/guides.js';

const MAX_BYTES = 200 * 1024 * 1024;
const WRITE_EXT = new Set(['.hwp', '.hwpx', '.hml', '.pdf', '.md', '.txt', '.html', '.csv', '.xlsx', '.png']);
const READ_EXT = new Set([...WRITE_EXT, '.hwpml', '.docx', '.xls', '.pptx', '.jpg', '.jpeg', '.webp', '.json']);

function checkExt(path: string, allowed: Set<string>, verb: string): void {
  const ext = extname(path).toLowerCase();
  if (!allowed.has(ext)) throw new Error(`${ext || '확장자 없는'} 파일은 ${verb} 수 없습니다. 허용: ${[...allowed].join(' ')}`);
}

export async function writeFileB64(p: { path: string; data_b64: string; overwrite?: boolean }): Promise<{ path: string }> {
  checkExt(p.path, WRITE_EXT, '저장할');
  if (typeof p.data_b64 !== 'string') throw new Error('저장할 내용이 없습니다.');
  if (p.data_b64.length > (MAX_BYTES / 3) * 4 + 4) throw new Error('파일이 너무 큽니다 (200MB까지).');
  if (existsSync(p.path) && !p.overwrite) throw new Error('같은 이름의 파일이 이미 있습니다. 덮어쓰려면 덮어쓰기를 고르세요.');
  const data = Buffer.from(p.data_b64, 'base64');
  await mkdir(dirname(p.path), { recursive: true });
  const tmp = `${p.path}.kordoc-tmp`;
  await writeFile(tmp, data);
  await rename(tmp, p.path);
  return { path: p.path };
}

export async function readFileB64(path: string, preview = false): Promise<{ data_b64: string; name: string; size: number }> {
  checkExt(path, READ_EXT, '읽을');
  const st = await stat(path);
  if (!st.isFile()) throw new Error('파일이 아닙니다. 파일을 고르세요.');
  if (st.size > MAX_BYTES) throw new Error('파일이 너무 큽니다 (200MB까지).');
  const data = await readFile(path);
  const out = preview && extname(path).toLowerCase() === '.hwpx' ? Buffer.from(await showFieldGuides(data)) : data;
  return { data_b64: out.toString('base64'), name: basename(path), size: st.size };
}

/** 편집기에서 내보낸 HWPX 의 미리보기 사본 */
export async function previewBytes(p: { data_b64: string }): Promise<{ data_b64: string }> {
  if (typeof p.data_b64 !== 'string' || !p.data_b64) throw new Error('미리 볼 문서가 없습니다.');
  if (p.data_b64.length > (MAX_BYTES / 3) * 4 + 4) throw new Error('파일이 너무 큽니다 (200MB까지).');
  return { data_b64: Buffer.from(await showFieldGuides(Buffer.from(p.data_b64, 'base64'))).toString('base64') };
}
