/** 내장 모델 받기 — 같은 모델은 하나의 받기를 같이 기다리고, 멈추면 엔진에 취소를 보내고 비운다 */

import { describe, expect, it, vi } from "vitest";

const calls: Array<{ id: string; signal?: AbortSignal; onProgress?: (p: { current: number; total: number; message: string }) => void; resolve: (v: { path: string }) => void }> = [];
vi.mock("./rpc", () => ({
  rpc: (_m: string, params: { id: string }, opts: { signal?: AbortSignal; onProgress?: (p: { current: number; total: number; message: string }) => void }) =>
    new Promise((resolve, reject) => {
      calls.push({ id: params.id, signal: opts.signal, onProgress: opts.onProgress, resolve });
      opts.signal?.addEventListener("abort", () => reject(Object.assign(new Error("취소했습니다"), { name: "AbortError" })));
    }),
}));

const { downloadModel, stopModelDownload } = await import("./model-download");

describe("downloadModel", () => {
  it("같은 모델을 또 받으면 엔진에 다시 보내지 않고 같은 받기를 기다린다", async () => {
    const a = downloadModel("m1");
    const b = downloadModel("m1");
    expect(calls).toHaveLength(1);
    await expect(downloadModel("m2")).rejects.toThrow("다른 모델을 받는 중");
    calls[0].resolve({ path: "/models/m1.gguf" });
    expect(await a).toEqual({ path: "/models/m1.gguf" });
    expect(await b).toEqual({ path: "/models/m1.gguf" });
    // 끝나면 비어 다른 모델을 받을 수 있다
    const c = downloadModel("m2");
    expect(calls).toHaveLength(2);
    calls[1].resolve({ path: "/models/m2.gguf" });
    await c;
  });

  it("멈추면 취소 신호를 보내고 비운다", async () => {
    calls.length = 0;
    const a = downloadModel("m3");
    stopModelDownload();
    expect(calls[0].signal?.aborted).toBe(true);
    await expect(a).rejects.toThrow("취소");
    const b = downloadModel("m3");
    expect(calls).toHaveLength(2);
    calls[1].resolve({ path: "/models/m3.gguf" });
    await b;
  });
});
