/// <reference lib="webworker" />
/**
 * rhwp(@rhwp/core WASM) 미리보기 일꾼 — 문서 열기(쪽 나눔)와 쪽 SVG 그리기를 화면 스레드 밖에서 한다.
 * 쪽이 많으면 여는 데만 수 초가 걸린다(실측 2,783쪽 12.8초, 16,384쪽 282초) → 화면이 멈추지 않게 따로.
 * 쪽 SVG 는 Blob(image/svg+xml)으로 넘긴다: 화면은 <img> 로 보여 주므로 글꼴은 PDF 처럼 이 PC 에 깔린 글꼴.
 * 일꾼 하나에 문서 하나 (새로 열면 앞 문서는 닫는다).
 */

import init, { HwpDocument } from "@rhwp/core";
import wasmUrl from "@rhwp/core/rhwp_bg.wasm?url";

type Req =
  | { id: number; op: "open"; bytes: Uint8Array; password?: string }
  | { id: number; op: "render"; page: number };

let ready: Promise<unknown> | null = null;
let doc: HwpDocument | null = null;

const post = (msg: unknown, transfer: Transferable[] = []) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg, transfer);

self.onmessage = async (e: MessageEvent<Req>) => {
  const m = e.data;
  try {
    ready ??= init({ module_or_path: wasmUrl });
    await ready;
    if (m.op === "open") {
      doc?.free();
      doc = null;
      // 암호 문서는 0.8 판부터 (없으면 호출부가 엔진 렌더로 넘어간다)
      const withPassword = (HwpDocument as unknown as { openWithPassword?: (b: Uint8Array, p: string) => HwpDocument }).openWithPassword;
      if (m.password && !withPassword) throw new Error("이 rhwp 판은 암호 문서를 열지 못합니다");
      doc = m.password ? withPassword!(m.bytes, m.password) : new HwpDocument(m.bytes);
      const n = doc.pageCount();
      // 쪽 크기(96dpi px → pt) — 그리기 전에 자리를 잡는 데 쓴다
      const sizes = new Float32Array(n * 2);
      for (let i = 0; i < n; i++) {
        const info = JSON.parse(doc.getPageInfo(i)) as { width: number; height: number };
        sizes[i * 2] = info.width * 0.75;
        sizes[i * 2 + 1] = info.height * 0.75;
      }
      post({ id: m.id, ok: true, value: { pageCount: n, sizes } }, [sizes.buffer]);
    } else {
      if (!doc) throw new Error("열린 문서가 없습니다");
      post({ id: m.id, ok: true, value: new Blob([doc.renderPageSvg(m.page)], { type: "image/svg+xml" }) });
    }
  } catch (err) {
    post({ id: m.id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
