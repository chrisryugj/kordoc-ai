/** kordoc:// 주소 읽기 — 우클릭 메뉴·파일 연결이 넘기는 동작 */

import { describe, it, expect } from "vitest";
import { parseDeepLink } from "./useDeepLink";

describe("parseDeepLink", () => {
  it("파일 동작", () => {
    expect(parseDeepLink("kordoc://redact?path=C%3A%5C%EB%AC%B8%EC%84%9C.hwpx")).toEqual({ type: "file", action: "redact", path: "C:\\문서.hwpx" });
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
