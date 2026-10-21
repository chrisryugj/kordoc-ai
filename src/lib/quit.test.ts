/** 완전 종료 전 묻기 — 등록된 곳이 모두 괜찮다고 해야 끈다 */

import { describe, it, expect } from "vitest";
import { canQuit, onQuitGuard } from "./quit";

describe("canQuit", () => {
  it("아무도 없으면 끈다", async () => {
    expect(await canQuit()).toBe(true);
  });

  it("하나라도 아니라고 하거나 던지면 끄지 않는다, 떼면 다시 끈다", async () => {
    const off = onQuitGuard(async () => false);
    expect(await canQuit()).toBe(false);
    off();
    const off2 = onQuitGuard(async () => { throw new Error("저장 실패"); });
    expect(await canQuit()).toBe(false);
    off2();
    onQuitGuard(async () => true);
    expect(await canQuit()).toBe(true);
  });
});
