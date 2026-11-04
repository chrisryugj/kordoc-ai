import { beforeEach, describe, expect, it } from "vitest";
import { chatIdOf, deleteChat, loadChat, loadChats, saveChat } from "./chat-store";

const mem = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, String(v)),
    removeItem: (k: string) => void mem.delete(k),
  },
});

const turn = (startedAt: number) => ({ request: "일", steps: [], text: "", files: [], saved: 0, state: "running" as const, startedAt });

describe("chat-store", () => {
  beforeEach(() => mem.clear());

  it("본문 키에서 대화 id", () => {
    expect(chatIdOf("kordoc-chat:abc")).toBe("abc");
    expect(chatIdOf("kordoc-chats")).toBeNull();
    expect(chatIdOf(null)).toBeNull();
  });

  it("앱이 꺼질 때 돌던 요청은 멈춤, 이 창이 뜬 뒤 다른 창에서 시작한 요청은 그대로", () => {
    saveChat({ id: "a", title: "가", createdAt: 1, updatedAt: 1 }, { paths: [], turns: [turn(100), turn(200)], events: [] });
    expect(loadChat("a")!.turns.map((t) => t.state)).toEqual(["stopped", "stopped"]);
    expect(loadChat("a", 150)!.turns.map((t) => t.state)).toEqual(["stopped", "running"]);
  });

  it("지우면 목록과 본문이 함께 빠진다", () => {
    saveChat({ id: "a", title: "가", createdAt: 1, updatedAt: 1 }, { paths: [], turns: [], events: [] });
    deleteChat("a");
    expect(loadChats()).toEqual([]);
    expect(loadChat("a")).toBeNull();
  });
});

describe("대화 크기 상한 (fitBody)", () => {
  const turn = (i: number, text = "답") => ({ request: `요청 ${i}`, steps: [], text, files: [], saved: 0, state: "done" as const, startedAt: i });
  it("요청은 최근 MAX_TURNS 개만, 아주 긴 답은 앞부분만", async () => {
    const { fitBody, MAX_TURNS } = await import("./chat-store");
    const body = { paths: [], events: [], turns: Array.from({ length: MAX_TURNS + 15 }, (_, i) => turn(i, i === MAX_TURNS + 14 ? "가".repeat(30_000) : "답")) };
    const out = fitBody(body);
    expect(out.turns.length).toBe(MAX_TURNS);
    expect(out.turns[0].request).toBe("요청 15");
    expect(out.turns.at(-1)!.text.length).toBeLessThan(21_000);
  });
  it("전체가 너무 크면 오래된 요청부터 덜어 내되 마지막 요청은 남긴다", async () => {
    const { fitBody } = await import("./chat-store");
    const body = { paths: [], events: [], turns: Array.from({ length: 50 }, (_, i) => turn(i, "나".repeat(19_000))) };
    const out = fitBody(body);
    expect(JSON.stringify(out).length).toBeLessThanOrEqual(600_000);
    expect(out.turns.at(-1)!.request).toBe("요청 49");
  });
});
