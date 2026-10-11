/** 출력 경로 규칙 (계약 상단) — 저장하는 모든 호출이 이 헬퍼 하나를 쓴다.
 *
 * output_path → output_dir → 설정 출력 폴더 → 원본 옆 (원본이 없으면 문서 폴더).
 * 같은 이름이 있으면 `이름 (2).확장자` 로 피한다 — output_path 를 줬어도 기존 파일·원본은 덮어쓰지 않는다.
 * (예외: 폴더 감시는 같은 원본의 변환 결과를 갱신하므로 덮어쓴다 — core/watch)
 */

import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, extname, join } from 'node:path';
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

/** 저장 폴더 — output_dir → 설정 출력 폴더 → 원본 옆 → 문서 폴더. 없으면 만든다 */
export function outputDir(opts: { output_dir?: string; source?: string }): string {
  const configured = getSettings().convert.output_dir?.trim();
  const dir = opts.output_dir
    ? validatePath(opts.output_dir)
    : configured
      ? validatePath(configured)
      : opts.source
        ? dirname(opts.source)
        : documentsDir();
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** 저장 파일 경로 — name 은 `이름.확장자` (safeFileName 을 거친 것) */
export function outputFile(opts: { output_path?: string; output_dir?: string; source?: string; name: string; overwrite?: boolean }): string {
  if (opts.output_path) {
    const p = validatePath(opts.output_path);
    mkdirSync(dirname(p), { recursive: true });
    // overwrite: 사용자가 저장 창에서 고르고 바꾸기까지 확인한 경로. 그 밖에는 있는 파일을 지키려고 (2) 를 붙인다
    return opts.overwrite ? p : uniquePath(p);
  }
  return uniquePath(join(outputDir(opts), opts.name));
}
