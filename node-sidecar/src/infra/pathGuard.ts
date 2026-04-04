/** 경로 검증 — UNC 경로 차단, 시스템 디렉토리 차단 */

import { resolve, isAbsolute } from 'node:path';

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

  if (isUncPath(rawPath)) {
    throw new Error('네트워크 경로(UNC)는 허용되지 않습니다');
  }

  const resolved = resolve(rawPath);

  if (!isAbsolute(resolved)) {
    throw new Error('절대 경로만 허용됩니다');
  }

  if (isBlockedSystemPath(resolved)) {
    throw new Error('시스템 디렉토리 접근이 차단되었습니다');
  }

  return resolved;
}
