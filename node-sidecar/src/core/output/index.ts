/** 출력 경로 규칙 (계약 상단) — 저장하는 모든 호출이 이 헬퍼 하나를 쓴다.
 *
 * output_path → output_dir → 설정 출력 폴더 → 원본 옆 (원본이 없으면 문서 폴더).
 * 같은 이름이 있으면 `이름 (2).확장자` 로 피한다 — output_path 를 줬어도 기존 파일·원본은 덮어쓰지 않는다.
 * (예외: 폴더 감시는 같은 원본의 변환 결과를 갱신하므로 덮어쓴다 — core/watch)
 */

import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { getSettings } from '../../infra/config.js';
import { validatePath } from '../../infra/pathGuard.js';

/** 확장자 뺀 파일 이름. 맥 우클릭·끌어 놓기 경로는 자소가 갈라진(NFD) 이름이라, 결과 파일이 윈도에서 깨지지 않게 완성형(NFC)으로 */
export function stemOf(path: string): string {
  const name = basename(path);
  const ext = extname(name);
  return (ext ? name.slice(0, -ext.length) : name).normalize('NFC');
}

/** 사용자 문서 폴더 (없으면 홈) */
export function documentsDir(): string {
  const docs = join(homedir(), 'Documents');
  return existsSync(docs) ? docs : homedir();
}

// 윈도 예약 이름은 확장자가 붙어도(con.2024·nul.보고) 못 쓴다
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/** 문서 내용·표 값에서 온 글을 파일 이름으로 — 금지 문자 제거, 길이 제한, 윈도 예약어 회피 */
export function safeFileName(name: string, fallback = '문서'): string {
  let s = name
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\s]+|[.\s]+$/g, '');
  if (s.length > 80) s = s.slice(0, 80).trim();
  if (!s) s = fallback;
  if (RESERVED.test(s)) s = `_${s}`;
  return s;
}

/** 같은 이름이 있으면 `이름 (2).확장자`, `이름 (3).확장자` … (폴더도 같은 방식) */
export function uniquePath(p: string): string {
  if (!existsSync(p)) return p;
  const dir = dirname(p);
  const ext = extname(p);
  const stem = basename(p, ext);
  for (let n = 2; ; n++) {
    const cand = join(dir, `${stem} (${n})${ext}`);
    if (!existsSync(cand)) return cand;
  }
}

/** 결과 여러 개를 담을 폴더 — 이미 있고 비어 있지 않으면 `이름 (2)` … 새 폴더 (전에 만든 결과를 덮어쓰지 않게). 만들어서 돌려준다 */
export function resultDir(dir: string): string {
  const used = (d: string) => {
    try { return readdirSync(d).length > 0; } catch { return existsSync(d); }
  };
  let out = dir;
  for (let n = 2; used(out); n++) out = join(dirname(dir), `${basename(dir)} (${n})`);
  mkdirSync(out, { recursive: true });
  return out;
}

/** 나누기 결과 폴더 자리 — parent 를 주면 그 안의 name 폴더(parent 이름이 이미 name 이면 그 폴더), 없으면 저장 폴더의 name */
export function splitDirOf(parent: string | undefined, source: string, name: string): string {
  if (!parent) return join(outputDir({ source }), name);
  const p = validatePath(parent);
  return basename(p).normalize('NFC') === name.normalize('NFC') ? p : join(p, name);
}

/** 결과를 이 폴더 안에만 두는 울타리 (MCP 서버가 허용 폴더를 정해 뜬 경우). 없으면 null */
let fence: string | null = null;

/** 바깥 AI 에이전트에 허용한 폴더가 있으면 결과도 그 안에 둔다. 설정의 저장 폴더(기본: 홈의 "KorDoc AI 결과")가 허용 폴더 밖이면
 *  에이전트는 방금 만든 파일을 다시 열지 못하고(허용 폴더 밖), 그렇다고 그 폴더까지 열어 주면 앱이 다른 일로 만든 결과까지 보인다 */
export function confineOutputs(root: string | null): void {
  fence = root ? resolve(root) : null;
}

const within = (dir: string, root: string) => {
  const rel = relative(root, resolve(dir));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};

/** 울타리가 있으면 그 안의 폴더로 — 밖을 가리키는 저장 폴더는 울타리 안의 같은 이름 폴더로 바꾼다 */
function fenced(dir: string): string {
  if (!fence || within(dir, fence)) return dir;
  return join(fence, basename(dir) || 'KorDoc AI 결과');
}

/** 저장 폴더 — output_dir → 설정 출력 폴더 → 원본 옆 → 문서 폴더. 없으면 만든다 */
export function outputDir(opts: { output_dir?: string; source?: string }): string {
  const configured = getSettings().convert.output_dir?.trim();
  const dir = fenced(opts.output_dir
    ? validatePath(opts.output_dir)
    : configured
      ? validatePath(configured)
      : opts.source
        ? dirname(opts.source)
        : documentsDir());
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** 파일 이름 한도(macOS·Windows 255바이트 안팎)에 맞춘다 — 긴 한글 이름(84자 = 252바이트)에 "_용량줄임" 같은 뒷말을 붙이면 넘어
 *  ENAMETOOLONG 으로 실패했다. 뒷말·확장자가 남게 앞부분 뒤를 줄이고 "…" 를 넣는다. " (2)" 를 붙일 자리를 남긴다 */
const NAME_MAX_BYTES = 240;
export function fitFileName(name: string): string {
  if (Buffer.byteLength(name) <= NAME_MAX_BYTES) return name;
  const ext = extname(name);
  const chars = [...name.slice(0, name.length - ext.length)];
  const tail = chars.slice(-16).join('');
  let head = chars.slice(0, -16);
  while (head.length && Buffer.byteLength(`${head.join('')}…${tail}${ext}`) > NAME_MAX_BYTES) head = head.slice(0, -1);
  return `${head.join('')}…${tail}${ext}`;
}

/** 저장 파일 경로 — name 은 `이름.확장자` (safeFileName 을 거친 것) */
export function outputFile(opts: { output_path?: string; output_dir?: string; source?: string; name: string; overwrite?: boolean }): string {
  if (opts.output_path) {
    const p = validatePath(opts.output_path);
    mkdirSync(dirname(p), { recursive: true });
    // overwrite: 사용자가 저장 창에서 고르고 바꾸기까지 확인한 경로. 그 밖에는 있는 파일을 지키려고 (2) 를 붙인다
    return opts.overwrite ? p : uniquePath(p);
  }
  return uniquePath(join(outputDir(opts), fitFileName(opts.name)));
}
