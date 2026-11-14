/** 내 프롬프트 저장 — 저장소에 실제로 들어갔을 때만 저장했다고 한다 */

import { beforeEach, describe, expect, it } from "vitest";
import { addMyPrompt, loadMyPrompts } from "./my-prompts";

const mem = new Map<string, string>();
/** 참이면 저장소가 가득 찬 것처럼 쓰기가 던진다 */
let full = false;
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (full) throw new Error("QuotaExceededError");
      mem.set(k, String(v));
    },
    removeItem: (k: string) => void mem.delete(k),
  },
});

describe("addMyPrompt", () => {
  beforeEach(() => { mem.clear(); full = false; });

  it("새 문장은 저장하고, 같은 문장은 다시 넣지 않는다", () => {
    expect(addMyPrompt(" 이 문서를 세 줄로 요약해 줘 ")).toBe("saved");
    expect(addMyPrompt("이 문서를 세 줄로 요약해 줘")).toBe("same");
    expect(loadMyPrompts().map((p) => p.text)).toEqual(["이 문서를 세 줄로 요약해 줘"]);
  });

  it("저장소가 가득 차 못 넣었으면 저장했다고 하지 않는다", () => {
    full = true;
    expect(addMyPrompt("결재 전 점검해 줘")).toBe("full");
    expect(loadMyPrompts()).toEqual([]);
  });
});
