/** CSV 쓰기 — 엑셀이 칸을 수식으로 실행하지 않게 (CSV 수식 주입) */

import { describe, it, expect } from 'vitest';
import { toCsv } from '../src/core/excel/csv.js';
import { writeCsv } from '../src/core/ai/xlsx.js';

describe('toCsv', () => {
  it('= + - @ 로 시작하는 칸은 글자로, 그냥 숫자는 그대로', () => {
    const out = toCsv([['=HYPERLINK("http://x","y")', '+82-10-1234', '@SUM(A1)', '-5', '+3.2', '12%', '- 항목', '대강당, 2층']]);
    expect(out).toBe('﻿"\'=HYPERLINK(""http://x"",""y"")",\'+82-10-1234,\'@SUM(A1),-5,+3.2,12%,\'- 항목,"대강당, 2층"\r\n');
  });

  it('AI 추출표 CSV 도 같은 규칙', () => {
    expect(writeCsv(['칸'], [['=1+1']]).toString('utf-8')).toBe('﻿칸\r\n\'=1+1\r\n');
  });
});
