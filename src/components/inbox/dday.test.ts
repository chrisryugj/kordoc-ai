/** 접수함 기한 칸 — 달력의 "삭제"로 비운 기한도 저장한다 */

import { describe, it, expect } from "vitest";
import { dueToSave } from "./dday";

describe("dueToSave", () => {
  it("달력의 삭제로 비우면 기한 지우기로 저장한다", () => {
    expect(dueToSave("", false, "2026-11-20")).toBe("");
  });

  it("칸을 덜 채운 중의 빈 값은 저장하지 않는다 (치던 날짜가 지워지지 않게)", () => {
    expect(dueToSave("", true, "2026-11-20")).toBeNull();
  });

  it("기한이 없던 칸을 비우면 저장할 것이 없다", () => {
    expect(dueToSave("", false, null)).toBeNull();
    expect(dueToSave("", false, "")).toBeNull();
  });

  it("고른 날짜는 저장하고, 연도를 치는 중의 날짜와 같은 날짜는 저장하지 않는다", () => {
    expect(dueToSave("2026-12-01", false, "2026-11-20")).toBe("2026-12-01");
    expect(dueToSave("0202-12-01", false, "2026-11-20")).toBeNull();
    expect(dueToSave("2026-11-20", false, "2026-11-20")).toBeNull();
  });
});
