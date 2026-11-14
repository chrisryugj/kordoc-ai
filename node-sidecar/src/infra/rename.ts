/** 바꿔 넣기(rename) — 임시 파일에 다 쓴 뒤 제자리로 옮기는 저장(설정·편집기 저장·목록 파일·복구 사본)이 다 거친다 */

import { rename } from 'node:fs/promises';

/** 다른 프로그램이 파일을 잠깐 쥐었을 때 Windows 가 내는 오류 (백신·색인 프로그램·한글) */
export const LOCKED = /^(EPERM|EBUSY|EACCES)$/;

/** Windows 에서는 백신·색인 프로그램이 막 쓴 파일을 잠깐 쥐어 바꿔 넣기가 EPERM·EBUSY·EACCES 로 실패한다(E2E 실측) → 잠깐 쉬었다 다시 */
export async function renameRetry(from: string, to: string, tries = 6, mv: (a: string, b: string) => Promise<void> = rename): Promise<void> {
  for (let i = 0; ; i++) {
    try { await mv(from, to); return; } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? '';
      if (i >= tries - 1 || !LOCKED.test(code)) throw err;
      await new Promise((r) => setTimeout(r, 60 * (i + 1)));
    }
  }
}
