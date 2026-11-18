/** 효과 화면 기준 시간 — 다시 읽어도 저장 안 한 칸은 사람이 친 값을 지킨다 */

import { describe, it, expect } from "vitest";
import { keepEdits } from "./baselines";

const items = (convert: number, merge: number) => [{ key: "convert", baseline_min: convert }, { key: "merge", baseline_min: merge }];

describe("keepEdits", () => {
  it("처음 읽으면 집계의 기준 시간으로 채운다", () => {
    expect(keepEdits(undefined, items(10, 30), {})).toEqual({ convert: "10", merge: "30" });
  });

  it("기간을 바꿔 다시 읽어도 저장 안 한 칸은 그대로 둔다", () => {
    expect(keepEdits(items(10, 30), items(10, 30), { convert: "15", merge: "30" })).toEqual({ convert: "15", merge: "30" });
  });

  it("저장한 뒤 다시 읽으면 새 기준 시간으로 (고친 칸과 같은 값)", () => {
    expect(keepEdits(items(10, 30), items(15, 30), { convert: "15", merge: "30" })).toEqual({ convert: "15", merge: "30" });
  });

  it("고치지 않은 칸은 새로 읽은 값을 따른다", () => {
    expect(keepEdits(items(10, 30), items(12, 40), { convert: "10", merge: "30" })).toEqual({ convert: "12", merge: "40" });
  });
});
