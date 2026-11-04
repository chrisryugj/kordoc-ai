/** 시험용 임시 폴더 — 만든 시험 파일이 끝나면(afterAll) 지운다. %TEMP% 에 kordoc-* 폴더가 쌓이지 않게 */

import { afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const made: string[] = [];

/** tmpdir 아래 prefix 로 시작하는 새 폴더 (이 파일을 불러온 시험 파일이 끝나면 지움) */
export function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  made.push(dir);
  return dir;
}

// 불러온 시험 파일의 맨 바깥 묶음에 걸린다 (시험 파일마다 따로 불러온다)
afterAll(async () => {
  // 효과 집계는 2초 뒤에 저장한다: 지운 뒤 그 저장이 앱 데이터 폴더를 다시 만들지 않게 먼저 저장해 둔다
  if (made.length) (await import('../src/infra/usage.js')).flushUsage();
  for (const dir of made.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch { /* Windows 에서 아직 쥐고 있는 파일이 있으면 남긴다 */ }
  }
});
