/** 경로 검증 — UNC 경로 차단, 시스템 디렉토리 차단, 파일 크기 제한 */

import { resolve, isAbsolute } from 'node:path';
import { stat } from 'node:fs/promises';

/** 로컬 처리 최대 파일 크기 (500MB) */
export const MAX_FILE_SIZE_BYTES = 500 * 1024 * 1024;

/** UNC 경로 차단 (NTLM 릴레이 등 방지) */
function isUncPath(p: string): boolean {
  return p.startsWith('\\\\') || p.startsWith('//');
}

/** 시스템 디렉토리 차단 — 드라이브 문자 독립적 + 크로스 플랫폼 */
const WIN_BLOCKED_SUFFIXES = [
  '\\windows',
  '\\program files',
  '\\program files (x86)',
  '\\programdata',
  '\\system volume information',
];

const UNIX_BLOCKED_PREFIXES = [
  '/etc',
  '/usr',
  '/bin',
  '/sbin',
  '/boot',
  '/sys',
  '/proc',
  '/System',
  '/Library',
];

function isBlockedSystemPath(resolved: string): boolean {
  const isWin = process.platform === 'win32';

  if (isWin) {
    const lower = resolved.toLowerCase();
    // 드라이브 문자 제거 후 비교 (C:\Windows, D:\Windows 모두 차단)
    const withoutDrive = lower.length >= 2 && lower[1] === ':' ? lower.slice(2) : lower;
    return WIN_BLOCKED_SUFFIXES.some((suffix) => withoutDrive.startsWith(suffix));
  }

  // macOS / Linux
  return UNIX_BLOCKED_PREFIXES.some((prefix) => resolved.startsWith(prefix));
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

/**
 * 파일 크기가 제한 이내인지 검증.
 * 초과 시 Error를 throw.
 */
export async function validateFileSize(filePath: string, limit = MAX_FILE_SIZE_BYTES): Promise<void> {
  const info = await stat(filePath);
  if (info.size > limit) {
    const sizeMB = Math.round(info.size / 1024 / 1024);
    const limitMB = Math.round(limit / 1024 / 1024);
    throw new Error(`파일 크기가 ${sizeMB}MB로 제한(${limitMB}MB)을 초과합니다`);
  }
}
