/** 받은 공문처럼 생겼나 — 회신 단추·문서별 할 수 있는 일을 고르는 데 쓴다 */

import { describe, it, expect } from "vitest";
import { looksReceived } from "./docText";

describe("looksReceived", () => {
  it("수신 줄과 시행 줄(문서번호)이 있으면 받은 공문", () => {
    expect(looksReceived("가온도\n수신  가온시장(행정지원과장)\n제목  체육대회 참가 협조 요청\n시행  체육진흥과-2203(2026. 10. 2.)")).toBe(true);
  });
  it("제목 줄과 끝. 아래 발신명의도 받은 공문", () => {
    expect(looksReceived("제목 회의 개최 알림\n1. 회의를 엽니다.  끝.\n\n가온도지사\n")).toBe(true);
  });
  it("보고서·계획서는 아니다", () => {
    expect(looksReceived("2026 가온시 디지털 행정 혁신 추진계획\n□ 추진 배경\n○ 행정 서비스 개선")).toBe(false);
  });
});
