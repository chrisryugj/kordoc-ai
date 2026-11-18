/** 임시 파일 바꿔 넣기 — Windows 에서 백신·문서보안 프로그램이 막 쓴 파일을 잠깐 잡으면 rename 이 EPERM·EBUSY 로 실패한다
 * (실측: 이 저장소 시험이 쓰자마자 덮어쓸 때 EPERM). 잠깐 기다려 몇 번 다시 하고, 그래도 안 되면 그 오류를 그대로 던진다
 * (정말로 한글에서 열려 있는 파일이면 errors.ts 가 "그 프로그램에서 닫고 다시 저장" 으로 알린다)
 */

import { rename } from 'node:fs/promises';

const RETRY = new Set(['EPERM', 'EBUSY', 'EACCES']);
const DELAYS = [50, 100, 200, 400, 800];

export async function renameRetry(from: string, to: string, opts: { delays?: number[]; platform?: string } = {}): Promise<void> {
  const delays = (opts.platform ?? process.platform) === 'win32' ? (opts.delays ?? DELAYS) : [];
  for (let i = 0; ; i++) {
    try {
      return await rename(from, to);
    } catch (err) {
      if (i >= delays.length || !RETRY.has((err as NodeJS.ErrnoException).code ?? '')) throw err;
      await new Promise((r) => setTimeout(r, delays[i]));
    }
  }
}
