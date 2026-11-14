import { beforeEach, describe, expect, it } from "vitest";
import { chatIdOf, deleteChat, loadChat, loadChats, saveChat } from "./chat-store";

const mem = new Map<string, string>();
/** 저장소 크기 상한 (글자 수): 넘으면 실제 저장소처럼 쓰기가 던진다 */
let cap = Infinity;
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => {
      let size = String(v).length;
      for (const [key, val] of mem) if (key !== k) size += val.length;
      if (size > cap) throw new Error("QuotaExceededError");
      mem.set(k, String(v));
    },
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

  it("저장소가 가득 차 오래된 대화를 지웠으면 몇 개를 지웠는지 돌려준다", () => {
    const big = (startedAt: number) => ({ ...turn(startedAt), text: "가".repeat(3_000) });
    expect(saveChat({ id: "a", title: "가", createdAt: 1, updatedAt: 1 }, { paths: [], turns: [big(1)], events: [] })).toBe(0);
    expect(saveChat({ id: "b", title: "나", createdAt: 2, updatedAt: 2 }, { paths: [], turns: [big(2)], events: [] })).toBe(0);
    cap = 8_000;
    try {
      expect(saveChat({ id: "c", title: "다", createdAt: 3, updatedAt: 3 }, { paths: [], turns: [big(3)], events: [] })).toBe(1);
    } finally { cap = Infinity; }
    // 가장 오래된 대화만 밀려난다
    expect(loadChats().map((c) => c.id)).toEqual(["c", "b"]);
    expect(loadChat("a")).toBeNull();
    expect(loadChat("c")).not.toBeNull();
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
  it("큰 문서를 읽은 도구 결과는 저장본에서만 줄이고, 화면에 보이는 요청은 그대로 둔다", async () => {
    const { fitBody } = await import("./chat-store");
    const big = "문".repeat(500_000);
    const events = [
      { role: "user" as const, text: "이 문서 요약해 줘", context: "붙인 문서 목록" },
      { role: "assistant" as const, text: "", calls: [{ id: "1", name: "read_document", input: {} }] },
      { role: "tool" as const, results: [{ id: "1", name: "read_document", output: big }] },
      { role: "assistant" as const, text: "요약입니다", calls: [] },
    ];
    const body = { paths: [], events, turns: Array.from({ length: 30 }, (_, i) => turn(i, "다".repeat(5_000))) };
    const out = fitBody(body);
    expect(out.turns).toHaveLength(30);
    expect(JSON.stringify(out).length).toBeLessThan(600_000);
    const kept = out.events.find((e) => e.role === "tool");
    expect(kept && "results" in kept && kept.results[0].output.length).toBeLessThan(4_100);
    // 도는 중인 대화(메모리)는 건드리지 않는다
    expect(events[2].results![0].output.length).toBe(500_000);
    expect(events[0].context).toBe("붙인 문서 목록");
  });
});
