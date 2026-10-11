/** 경로 검증 — UNC(공유 폴더) 차단은 슬래시를 섞은 우회도 막는다 (폐쇄망·NTLM 자격 증명 유출 방지) */

import { describe, it, expect } from 'vitest';
import { validatePath } from '../src/infra/pathGuard.js';

describe('validatePath', () => {
  it('UNC 와 슬래시를 섞어 윈도에서 UNC 로 풀리는 경로를 막는다', () => {
    for (const p of ['\\\\host\\share\\a.hwpx', '//host/share/a.hwpx', '/\\host\\share\\a.hwpx', '\\/host/share/a.hwpx', '\\\\?\\UNC\\host\\share\\a.hwpx']) {
      expect(() => validatePath(p), p).toThrow(/UNC/);
    }
  });

  it('보통 절대 경로는 그대로 통과', () => {
    expect(validatePath('/Users/kim/Documents/a.hwpx')).toBe('/Users/kim/Documents/a.hwpx');
  });
});
