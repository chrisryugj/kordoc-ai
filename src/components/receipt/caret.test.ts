/** 영수증 금액 칸 — 쉼표를 다시 매겨도 커서가 친 자리에 남는다 */

import { describe, it, expect } from "vitest";
import { caretAfterDigits, digitsBefore } from "./caret";

describe("금액 칸 커서", () => {
  it("가운데에 숫자를 넣어 쉼표가 생겨도 넣은 숫자 바로 뒤에 남는다", () => {
    // "123" 의 1 뒤에 4 → 브라우저 값 "1423" (커서 2) → 다시 매김 "1,423" 에서 4 뒤 (자리 3)
    const n = digitsBefore("1423", 2);
    expect(n).toBe(2);
    expect(caretAfterDigits("1,423", n)).toBe(3);
  });

  it("쉼표가 하나 늘어도 같은 숫자 뒤로", () => {
    // "123,456" 의 3 뒤에 7 → "1237,456" (커서 4) → 다시 매김 "1,237,456"
    const n = digitsBefore("1237,456", 4);
    expect(caretAfterDigits("1,237,456", n)).toBe(5);
  });

  it("숫자 하나를 지워 쉼표가 줄어도 지운 자리에", () => {
    // "1,234,567" 의 2 를 지움 → "1,34,567" (커서 2) → 다시 매김 "134,567"
    const n = digitsBefore("1,34,567", 2);
    expect(caretAfterDigits("134,567", n)).toBe(1);
  });

  it("맨 앞과 숫자가 모자랄 때", () => {
    expect(caretAfterDigits("1,000", 0)).toBe(0);
    expect(caretAfterDigits("5", 2)).toBe(1);
  });
});
