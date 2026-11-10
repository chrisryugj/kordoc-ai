/** 팀장 눈으로 검토 — AI 가 요일 계산을 틀려 맞는 날짜를 틀렸다고 한 지적은 뺀다 */

import { describe, it, expect } from 'vitest';
import { isFalseWeekdayClaim } from '../src/core/inspect/index.js';

describe('isFalseWeekdayClaim', () => {
  it('인용한 날짜의 요일이 실제로 맞으면 거짓 지적 (2026. 11. 24. 은 화요일)', () => {
    expect(isFalseWeekdayClaim({
      location: '1쪽 가. 교육명 아래 "2026. 11. 24.(화)"',
      message: '지정된 날짜(2026. 11. 24.)가 요일(화)과 일치하지 않습니다.',
      suggestion: '2026년 11월 24일은 화요일이 아니므로, 요일 혹은 날짜를 수정해야 합니다.',
    })).toBe(true);
    expect(isFalseWeekdayClaim({ location: '2쪽 "2026년 10월 23일(금요일)"', message: '날짜와 요일이 맞지 않습니다.' })).toBe(true);
  });

  it('요일이 정말 틀린 날짜를 짚은 지적은 남긴다', () => {
    expect(isFalseWeekdayClaim({ location: '1쪽 "2026. 11. 24.(수)"', message: '날짜와 요일이 일치하지 않습니다.' })).toBe(false);
  });

  it('없는 날짜, 연도 없는 날짜, 두 날짜를 견준 지적, 요일 이야기가 아닌 지적은 남긴다', () => {
    expect(isFalseWeekdayClaim({ location: '1쪽 "2026. 2. 30.(월)"', message: '날짜와 요일이 맞지 않습니다.' })).toBe(false);
    expect(isFalseWeekdayClaim({ location: '1쪽 "11. 24.(화)"', message: '날짜와 요일이 맞지 않습니다.' })).toBe(false);
    expect(isFalseWeekdayClaim({ location: '1쪽 "2026. 11. 24.(화)"', message: '본문은 2026. 11. 24.(화)인데 붙임은 2026. 11. 25.(수)라 요일과 날짜가 다릅니다.' })).toBe(false);
    expect(isFalseWeekdayClaim({ location: '1쪽 "2026. 11. 24.(화)"', message: '교육 시간이 본문과 표에서 서로 다릅니다.' })).toBe(false);
  });
});
