/** 작업 사본 폴더 — 새로 쓰기에서 만든 초안·출력용 사본을 사용자 문서 폴더가 아닌 앱 데이터 폴더에 둔다.
 *
 * 사용자가 "한글 파일로 저장"을 고르기 전까지 초안은 여기에만 있다(문서 폴더에 `제목 (2).hwpx` 가 몰래 쌓이지 않게).
 * 14일 지난 파일은 이 프로세스에서 처음 쓸 때 한 번 지운다.
 */

import { mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { dataDir } from '../../infra/config.js';
import { safeFileName, uniquePath } from './index.js';

const KEEP_MS = 14 * 24 * 60 * 60 * 1000;
let swept = false;

export function workingDir(): string {
  const dir = join(dataDir(), '작업 사본');
  mkdirSync(dir, { recursive: true });
  if (!swept) {
    swept = true;
    const now = Date.now();
    for (const name of readdirSync(dir)) {
      try {
        const p = join(dir, name);
        const st = statSync(p);
        if (st.isFile() && now - st.mtimeMs > KEEP_MS) rmSync(p, { force: true });
      } catch {
        /* 다른 곳에서 쓰는 파일은 건너뛴다 */
      }
    }
  }
  return dir;
}

/** 작업 사본 폴더 안 새 파일 경로 — 이름은 파일 이름으로 쓸 수 있게 다듬고, 같은 이름이 있으면 (2) */
export function workingPath(name: string): { path: string; dir: string } {
  const ext = extname(name).toLowerCase().replace(/[^.a-z0-9]/g, '') || '.hwpx';
  const stem = safeFileName(extname(name) ? name.slice(0, -extname(name).length) : name, '새 문서');
  const dir = workingDir();
  return { path: uniquePath(join(dir, `${stem}${ext}`)), dir };
}
