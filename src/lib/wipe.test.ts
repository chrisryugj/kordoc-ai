import { describe, expect, it } from "vitest";
import { traceKeys } from "./wipe";

describe("traceKeys", () => {
  it("대화·최근 문서만 고르고 화면 설정·내 지시문은 남긴다", () => {
    const keys = ["kordoc-chats", "kordoc-chat:abc", "kordoc-recent", "kordoc-theme", "kordoc-my-prompts", "kordoc-first-run-done", "kordoc-chat", "kordoc-zoom"];
    expect(traceKeys(keys)).toEqual(["kordoc-chats", "kordoc-chat:abc", "kordoc-recent"]);
  });
});
