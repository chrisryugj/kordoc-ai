/** 여러 파일 작업 — 일괄 메서드를 중간에 멈춰도 이미 끝난 파일은 완료로 남는다 */

import { describe, expect, it, vi } from "vitest";
import type { FileEntry } from "../../lib/contract";

type Opts = { signal?: AbortSignal; onProgress?: (p: { current: number; total: number; message: string; item?: unknown }) => void };
let sent: Opts | null = null;
vi.mock("../../lib/rpc", () => ({
  errorText: (e: unknown) => (e instanceof Error ? e.message : String(e)),
  isAbort: (e: unknown) => e instanceof Error && e.name === "AbortError",
  rpc: (_m: string, _p: unknown, opts: Opts) =>
    new Promise((_resolve, reject) => {
      sent = opts;
      opts.signal?.addEventListener("abort", () => reject(Object.assign(new Error("취소했습니다"), { name: "AbortError" })));
    }),
}));

const { runTask } = await import("./runners");
type Row = import("./runners").RowState;

const file = (path: string): FileEntry => ({ path, name: path.split("/").pop()!, format: "hwpx", size: 1 } as FileEntry);

describe("runTask", () => {
  it("변환을 중간에 멈추면 끝난 파일은 만든 파일과 함께 완료로, 나머지는 대기로 남는다", async () => {
    const rows: Record<string, Row> = {};
    const ac = new AbortController();
    const progress = vi.fn();
    const run = runTask("convert", {
      signal: ac.signal, onProgress: progress, files: [file("/in/a.hwpx"), file("/in/b.hwpx"), file("/in/c.hwpx")],
      opts: { convertFormat: "md" } as never, setRow: (p, s) => { rows[p] = s; },
    });
    await vi.waitFor(() => expect(sent).not.toBeNull());
    sent!.onProgress!({ current: 1, total: 3, message: "a.hwpx 변환 중 (1/3)", item: { path: "/in/a.hwpx", ok: true, output_path: "/out/a.md" } });
    sent!.onProgress!({ current: 2, total: 3, message: "b.hwpx 변환 중 (2/3)", item: { path: "/in/b.hwpx", ok: false, error: "읽지 못했습니다" } });
    sent!.onProgress!({ current: 3, total: 3, message: "c.hwpx 변환 중 (3/3)" });
    ac.abort();
    await expect(run).rejects.toThrow("취소했습니다");
    expect(rows["/in/a.hwpx"]).toEqual({ status: "ok", output: "/out/a.md", note: undefined });
    expect(rows["/in/b.hwpx"]).toEqual({ status: "fail", error: "읽지 못했습니다" });
    expect(rows["/in/c.hwpx"]).toEqual({ status: "wait" });
    // 진행률은 그대로 넘긴다
    expect(progress).toHaveBeenCalledTimes(3);
  });
});
