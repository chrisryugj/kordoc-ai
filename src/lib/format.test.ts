/** 경로·형식 표기 도우미 — Windows 경로와 슬래시 경로 둘 다 */

import { describe, it, expect } from "vitest";
import { baseName, dirName, extOf, formatOf, joinPath, stem, timeAgo } from "./format";

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
  it("얼마 전: 어제는 지난 시간이 아니라 달력 날짜로", () => {
    const at = (d: number, h: number) => new Date(2026, 10, d, h, 0, 0).getTime();
    expect(timeAgo(at(11, 9), at(11, 9) + 30_000)).toBe("방금");
    expect(timeAgo(at(10, 23), at(11, 1))).toBe("2시간 전");
    expect(timeAgo(at(10, 9), at(11, 10))).toBe("어제");
    // 그저께 밤 → 오늘 새벽: 26시간 전이지만 어제가 아니다
    expect(timeAgo(at(9, 23), at(11, 1))).toBe("11월 9일");
  });
});
