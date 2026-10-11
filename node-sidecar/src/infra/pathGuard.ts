/** 경로 검증 — UNC 경로 차단, 시스템 디렉토리 차단 */

import { resolve, isAbsolute, win32 } from 'node:path';

const UNC_MESSAGE = '공유 폴더의 네트워크 경로(UNC)는 쓸 수 없습니다. 드라이브 문자(Z:)로 연결한 폴더나 이 PC의 폴더를 고르세요.';

/** UNC 경로 차단 (NTLM 릴레이 등 방지) */
function isUncPath(p: string): boolean {
  return p.startsWith('\\\\') || p.startsWith('//');
}

/** Windows 시스템 디렉토리 차단 */
const BLOCKED_PREFIXES = [
  'C:\\Windows',
  'C:\\Program Files',
  'C:\\Program Files (x86)',
  'C:\\ProgramData',
].map((p) => p.toLowerCase());

function isBlockedSystemPath(resolved: string): boolean {
  const lower = resolved.toLowerCase();
  return BLOCKED_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

/**
 * 경로를 검증하고 정규화된 절대 경로를 반환.
 * 실패 시 Error를 throw.
 */
export function validatePath(rawPath: string): string {
  if (!rawPath || typeof rawPath !== 'string') {
    throw new Error('경로가 비어 있습니다');
  }

  // 슬래시를 섞은 "/\\host\\share" 도 윈도 resolve 에선 UNC 로 풀린다 → 윈도 방식 정규화와 resolve 결과로도 본다
  if (isUncPath(rawPath) || isUncPath(win32.normalize(rawPath))) {
    throw new Error(UNC_MESSAGE);
  }

  const resolved = resolve(rawPath);
  if (isUncPath(resolved)) {
    throw new Error(UNC_MESSAGE);
  }

  if (!isAbsolute(resolved)) {
    throw new Error('절대 경로만 허용됩니다');
  }

  if (isBlockedSystemPath(resolved)) {
    throw new Error('시스템 폴더에는 접근할 수 없습니다');
  }

  return resolved;
}
