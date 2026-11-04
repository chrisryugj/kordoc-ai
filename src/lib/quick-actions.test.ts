/** 우클릭 빠른 동작: 하나로 합치기·나누기가 실패했을 때 갈 화면 */

import { describe, it, expect } from "vitest";
import { quickFallback } from "./quick-actions";

describe("quickFallback", () => {
  it("한글 문서끼리면 서무 도구, 섞이거나 PDF·폴더면 PDF 작업", () => {
    expect(quickFallback("join", ["C:\\a.hwp", "C:\\b.HWPX"])).toEqual({ screen: "batch", task: "merge" });
    expect(quickFallback("split", ["C:\\a.hwpx"])).toEqual({ screen: "batch", task: "hwpsplit" });
    expect(quickFallback("join", ["C:\\a.hwp", "C:\\b.pdf"])).toEqual({ screen: "pdf" });
    expect(quickFallback("split", ["C:\\a.pdf"])).toEqual({ screen: "pdf" });
    expect(quickFallback("join", ["C:\\받은 문서"])).toEqual({ screen: "pdf" });
    expect(quickFallback("join", ["C:\\보고서hwp", "C:\\b.hwp"])).toEqual({ screen: "pdf" });
  });
  it("그 밖의 동작은 정해 둔 곳", () => {
    expect(quickFallback("inbox", ["C:\\a.pdf"])).toEqual({ screen: "inbox" });
    expect(quickFallback("hwpmerge", ["C:\\a.pdf"])).toEqual({ screen: "batch", task: "merge" });
  });
});
