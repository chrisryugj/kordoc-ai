import { describe, expect, it } from "vitest";
import { pagesToDrop } from "./page-budget";

describe("pagesToDrop", () => {
  it("상한 안이면 아무것도 버리지 않는다", () => {
    expect(pagesToDrop(new Map([[1, 10], [2, 10]]), [1], 100)).toEqual([]);
  });

  it("보는 곳에서 먼 쪽부터, 상한 아래가 될 때까지만 버린다", () => {
    const sizes = new Map([[1, 40], [2, 40], [3, 40], [9, 40], [10, 40]]);
    // 보는 곳 3쪽: 10쪽 → 9쪽 → 1쪽 차례로 멀다. 200 → 160 → 120 이면 멈춘다
    expect(pagesToDrop(sizes, [3], 120)).toEqual([10, 9]);
  });

  it("지금 보이는 쪽은 상한을 넘어도 남긴다", () => {
    const sizes = new Map([[1, 100], [2, 100], [3, 100]]);
    expect(pagesToDrop(sizes, [2, 3, 1], 50)).toEqual([]);
    expect(pagesToDrop(sizes, [2], 50)).toEqual([1, 3]);
  });
});
