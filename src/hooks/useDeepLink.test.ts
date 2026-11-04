/** kordoc:// 주소 읽기 — 우클릭 메뉴·파일 연결이 넘기는 동작 */

import { describe, it, expect } from "vitest";
import { parseDeepLink } from "./useDeepLink";

describe("parseDeepLink", () => {
  it("파일 동작", () => {
    expect(parseDeepLink("kordoc://redact?path=C%3A%5C%EB%AC%B8%EC%84%9C.hwpx")).toEqual({ type: "file", action: "redact", path: "C:\\문서.hwpx" });
  });
  it("빠른 동작: 쪽 번호·엑셀 합치기·공문 접수", () => {
    expect(parseDeepLink("kordoc://pagenum?path=%2Fa.pdf")).toEqual({ type: "file", action: "pagenum", path: "/a.pdf" });
    expect(parseDeepLink("kordoc://xlsxmerge?path=%2Fa.xlsx")).toEqual({ type: "file", action: "xlsxmerge", path: "/a.xlsx" });
    expect(parseDeepLink("kordoc://inbox?path=%2Fa.hwpx")).toEqual({ type: "file", action: "inbox", path: "/a.hwpx" });
  });
  it("하나로 합치기·나누기, 옛 판의 형식별 주소도", () => {
    expect(parseDeepLink("kordoc://join?path=%2Fa.hwp")).toEqual({ type: "file", action: "join", path: "/a.hwp" });
    expect(parseDeepLink("kordoc://split?path=%2Fa.pdf")).toEqual({ type: "file", action: "split", path: "/a.pdf" });
    for (const old of ["pdfmerge", "hwpmerge", "pdfsplit", "hwpsplit"]) expect(parseDeepLink(`kordoc://${old}?path=x`)).toMatchObject({ action: old });
  });
  it("묶음", () => {
    expect(parseDeepLink("kordoc://batch?manifest=%2Ftmp%2Fm.json")).toEqual({ type: "batch", manifestPath: "/tmp/m.json" });
  });
  it("모르는 동작·다른 주소·경로 없음은 무시", () => {
    expect(parseDeepLink("kordoc://delete?path=x")).toBeNull();
    expect(parseDeepLink("https://example.com/open?path=x")).toBeNull();
    expect(parseDeepLink("kordoc://open")).toBeNull();
    expect(parseDeepLink("아무 글")).toBeNull();
  });
});
