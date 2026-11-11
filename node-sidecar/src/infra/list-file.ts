/** 앱 데이터 폴더의 목록 파일(JSON) 읽기 — 서식 목록·서식함이 같이 쓴다
 *
 * 못 읽은 것을 "빈 목록"으로 돌려주면, 그 뒤 저장 한 번에 저장해 둔 것이 전부 지워진다 (다른 프로세스가 파일을 쥔 잠깐 사이에도).
 *  - 파일이 없다 → null (처음 쓰는 것)
 *  - 잠깐 못 읽었다 → 보기만 할 때는 null, 고칠 때(forWrite)는 던진다
 *  - 내용이 깨졌다 → 고칠 때는 옆으로 옮겨 남기고 null
 */

import { readFile, rename } from 'node:fs/promises';
import { logger } from './logger.js';

export async function readListFile(path: string, what: string, forWrite: boolean): Promise<unknown> {
  let text: string;
  try {
    text = await readFile(path, 'utf-8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return null;
    logger.warn(`[list] ${what} 목록을 읽지 못했습니다(파일은 그대로 둠): ${code ?? err}`);
    if (!forWrite) return null;
    throw new Error(`${what} 목록을 지금 읽을 수 없어 바꾸지 않았습니다. 잠시 뒤 다시 하세요.`);
  }
  try {
    return JSON.parse(text);
  } catch {
    if (forWrite) {
      const kept = `${path}.broken-${new Date().toISOString().replace(/[:.]/g, '-')}`;
      await rename(path, kept).catch(() => undefined);
      logger.error(`[list] ${what} 목록 파일이 깨져 새로 만듭니다 (깨진 파일은 옆에 남김)`);
    }
    return null;
  }
}
