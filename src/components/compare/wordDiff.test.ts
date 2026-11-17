import { describe, expect, it } from "vitest";
import { wordDiff } from "./wordDiff";

const changed = (segs: Array<[string, boolean]>) => segs.filter(([, ch]) => ch).map(([t]) => t);
const text = (segs: Array<[string, boolean]>) => segs.map(([t]) => t).join("");

describe("wordDiff", () => {
  it("짧은 글은 바뀐 어절만 짚는다", () => {
    const d = wordDiff("사업비 1,000만원 지원", "사업비 9,000만원 지원")!;
    expect(changed(d.old)).toEqual(["1,000만원"]);
    expect(changed(d.next)).toEqual(["9,000만원"]);
  });

  it("큰 표(60행 8열)에서 세 칸만 바뀌면 그 세 칸만 짚고 글은 그대로 되살아난다", () => {
    const row = (r: number, f = (c: number) => `칸${r}-${c}`) => Array.from({ length: 8 }, (_, c) => f(c)).join(" | ");
    const a = Array.from({ length: 60 }, (_, r) => row(r)).join("\n");
    const b = Array.from({ length: 60 }, (_, r) => row(r, (c) => ((r === 3 && c === 2) || (r === 30 && c === 5) || (r === 59 && c === 7) ? `새${r}-${c}` : `칸${r}-${c}`))).join("\n");
    const d = wordDiff(a, b)!;
    expect(d).not.toBeNull();
    expect(changed(d.old)).toEqual(["칸3-2", "칸30-5", "칸59-7"]);
    expect(changed(d.next)).toEqual(["새3-2", "새30-5", "새59-7"]);
    expect(text(d.old)).toBe(a);
    expect(text(d.next)).toBe(b);
  });

  it("줄을 끼우거나 빼도 다른 줄은 같음으로 맞춘다", () => {
    const base = Array.from({ length: 300 }, (_, r) => `${r}행 내용 가 나 다 라 마`);
    const b = [...base.slice(0, 100), "새로 넣은 줄 하나", ...base.slice(100)];
    const d = wordDiff(base.join("\n"), b.join("\n"))!;
    expect(changed(d.old)).toEqual([]);
    expect(changed(d.next).join(" ")).toBe("새로 넣은 줄 하나");
    expect(text(d.next)).toBe(b.join("\n"));
  });
});
