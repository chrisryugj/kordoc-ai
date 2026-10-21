/** 경로·형식 표기 도우미 — Windows 경로와 슬래시 경로 둘 다 */

import { describe, it, expect } from "vitest";
import { baseName, dirName, extOf, formatOf, joinPath, stem } from "./format";

describe("format", () => {
  it("이름·폴더·확장자", () => {
    expect(baseName("C:\\업무\\보고서.hwpx")).toBe("보고서.hwpx");
    expect(dirName("C:\\업무\\보고서.hwpx")).toBe("C:\\업무");
    expect(stem("/a/b/계획.v2.hwp")).toBe("계획.v2");
    expect(extOf("A.HWPX")).toBe("hwpx");
    expect(extOf("폴더.이름/파일")).toBe("");
  });
  it("폴더 구분자를 따라 붙인다", () => {
    expect(joinPath("C:\\업무", "a.pdf")).toBe("C:\\업무\\a.pdf");
    expect(joinPath("/tmp/", "a.pdf")).toBe("/tmp/a.pdf");
  });
  it("형식", () => {
    expect(formatOf("x.hml")).toBe("hwpml");
    expect(formatOf("x.zip")).toBe("unknown");
  });
});
