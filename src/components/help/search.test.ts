/** 도움말 찾기 — 대소문자를 가리지 않는다 */

import { describe, it, expect } from "vitest";
import { findLine } from "./search";

const body = "# 4. PDF 작업\n\n여러 **PDF**를 한 권으로 합치고, 쪽을 돌리거나 지웁니다.";

describe("findLine", () => {
  it("소문자로 찾아도 대문자 낱말을 찾는다", () => {
    expect(findLine(body, "pdf")).toContain("PDF 작업");
    expect(findLine(body, "Pdf")).not.toBeNull();
  });

  it("없는 말은 null, 빈 말도 null", () => {
    expect(findLine(body, "엑셀")).toBeNull();
    expect(findLine(body, "  ")).toBeNull();
  });

  it("한글 찾기는 그대로", () => {
    expect(findLine(body, "한 권")).toContain("한 권으로 합치고");
  });
});
