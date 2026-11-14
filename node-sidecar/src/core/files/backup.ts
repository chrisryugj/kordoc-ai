/** 덮어쓰기 전 백업 — 편집기 저장(editor_write)·문서 수합 "같은 파일 바꾸기"(collect_gather overwrite)
 *
 * 디스크 파일이 앱이 마지막으로 쓴 판이면 그냥 덮는다(그 앞 판은 그때 이미 남겼다). 아니면(처음 덮는 파일, 그 뒤 한글·엑셀에서 고친 판)
 * 옆에 남긴다: `이름.bak` 이 없으면 그것으로(처음 원본, 다시 만들지 않는다), 있으면 날짜 붙은 `이름.YYYYMMDD-HHMMSS.bak`.
 * 앱이 쓴 판인지는 쓸 때마다 적어 두는 크기·수정 시각 표(앱 데이터 editor-written.json, 이름은 편집기 때 그대로)로 가른다:
 * 편집기가 열 때 받은 표(token)로 가렸더니 엔진이 다시 켜진 뒤의 저장은 백업 없이 원본을 덮었다.
 */

import { existsSync } from 'node:fs';
import { copyFile, constants, mkdir, readFile, rm, stat } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { dataDir } from '../../infra/config.js';
import { serial } from '../../infra/list-file.js';
import { logger } from '../../infra/logger.js';
import { fitFileName } from '../output/index.js';
import { atomicWriteFile } from './io.js';

const writtenFile = () => join(dataDir(), 'editor-written.json');
type WrittenMark = { size: number; mtimeMs: number };
/** 표 고치기는 하나씩 (두 저장이 겹치면 한쪽 기록이 사라져 다음 저장이 백업을 또 만든다) */
const marks = serial();

async function readWritten(): Promise<Record<string, WrittenMark>> {
  try { return JSON.parse(await readFile(writtenFile(), 'utf-8')) as Record<string, WrittenMark>; } catch { return {}; }
}
async function sameAsLastWritten(path: string): Promise<boolean> {
  const mark = (await readWritten())[resolve(path)];
  if (!mark) return false;
  const st = await stat(path);
  return st.size === mark.size && Math.abs(st.mtimeMs - mark.mtimeMs) < 2;
}
function rememberWritten(path: string): Promise<void> {
  return marks(async () => {
    const st = await stat(path);
    const all = await readWritten();
    delete all[resolve(path)];
    all[resolve(path)] = { size: st.size, mtimeMs: st.mtimeMs };
    // 최근 500개만
    const keep = Object.fromEntries(Object.entries(all).slice(-500));
    await mkdir(dataDir(), { recursive: true });
    await atomicWriteFile(writtenFile(), JSON.stringify(keep));
  });
}
/** 이 PC 시각으로 "20261114-171230" */
function stamp(): string {
  const d = new Date();
  const two = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}`;
}

export const BACKUP_FAILED = '덮어쓰기 전에 지금 파일을 백업(.bak)하지 못해 저장하지 않았습니다. 지금 파일은 그대로 있습니다. 다른 이름으로 저장하세요.';

/** 없던 자리에만 사본을 만든다 — 만들었으면 true, 이미 있으면 false. 못 만들면 반쯤 쓴 사본을 지우고 던진다.
 *  먼저 있는지 본다: Windows 는 원본이 잠겨 있으면 사본 자리에 파일이 있어도 EEXIST 가 아니라 EBUSY 를 내서,
 *  오류 종류만 보고 지우면 앞서 남겨 둔 백업(처음 원본)을 지운다 */
async function copyNew(from: string, to: string): Promise<boolean> {
  if (existsSync(to)) return false;
  try {
    await copyFile(from, to, constants.COPYFILE_EXCL);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') return false;
    // 없던 자리에 반쯤 쓴 사본일 수 있다: 지우지 않으면 다음부터 그것을 처음 원본으로 안다
    await rm(to, { force: true }).catch(() => undefined);
    throw err;
  }
}

/** 백업 하나 만들기 — 만든 경로, 이 초의 날짜 백업이 이미 있으면 undefined. 둘 다 못 만들면 던진다(원본을 지키려고 저장하지 않는다) */
async function makeBackup(path: string): Promise<string | undefined> {
  const bak = `${path}.bak`;
  try {
    // 이미 있으면 처음 원본이라 두고 날짜 백업으로
    if (await copyNew(path, bak)) return bak;
  } catch (err) {
    // 이름이 길어 .bak 을 못 붙여도 날짜 백업은 한도에 맞춰 줄인 이름으로 된다
    logger.warn(`[backup] ${bak} 를 만들지 못해 날짜 백업으로: ${err}`);
  }
  // 이름 한도(255바이트)에 맞춘다 — 긴 이름에 날짜 꼬리(20바이트)를 붙이면 넘어 저장 자체가 실패했다
  const dated = join(dirname(path), fitFileName(`${basename(path)}.${stamp()}.bak`));
  try {
    return (await copyNew(path, dated)) ? dated : undefined;
  } catch (err) {
    logger.warn(`[backup] ${dated} 도 만들지 못함: ${err}`);
    throw new Error(BACKUP_FAILED);
  }
}

/** write 로 path 를 덮는다. 디스크 판이 앱이 쓴 판이 아니면 먼저 백업하고, 쓰기가 실패하면 이번에 만든 백업은 지운다
 *  (지금 파일이 그대로 남으니 필요 없다 — 지우지 않았더니 못 쓴 채 다시 누를 때마다 날짜 백업이 하나씩 쌓였다). 만든 백업 경로를 돌려준다 */
export async function writeWithBackup(path: string, write: () => Promise<unknown>, backup = true): Promise<string | undefined> {
  const made = backup && existsSync(path) && !(await sameAsLastWritten(path)) ? await makeBackup(path) : undefined;
  try {
    await write();
  } catch (err) {
    if (made) await rm(made, { force: true }).catch(() => undefined);
    throw err;
  }
  await rememberWritten(path).catch(() => undefined);
  return made;
}
