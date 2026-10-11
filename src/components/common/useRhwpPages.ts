/**
 * rhwp 쪽 그림을 쪽 더미(PageStack)에 대 주는 훅 — 문서를 일꾼에서 열고, 화면에 보이는 쪽만 그려 Blob 주소로 들고 있는다.
 *
 * - 새 문서를 열어도 이미 그린 쪽은 새 쪽이 올 때까지 그대로 둔다 (실시간 미리보기가 깜박이지 않게)
 * - 들고 있는 SVG 가 BUDGET 을 넘으면 지금 보는 곳에서 먼 쪽부터 버린다 (다시 보이면 또 그린다)
 * - 쪽 그리기가 실패하면 error 가 차고, 호출부가 엔진 렌더로 넘어간다
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { PagePreview } from "../../lib/contract";
import { RhwpPreview, type RhwpMeta } from "../../lib/rhwp-preview";

const BUDGET = 64 * 1024 * 1024;

interface Held { url: string; size: number; gen: number; width: number; height: number }

export function useRhwpPages() {
  const engine = useRef<RhwpPreview | null>(null);
  const held = useRef(new Map<number, Held>());
  const gen = useRef(0);
  const meta = useRef<(RhwpMeta & { gen: number }) | null>(null);
  const wanted = useRef<number[]>([]);
  const pumping = useRef(false);
  const [doc, setDoc] = useState<RhwpMeta | null>(null);
  const [pages, setPages] = useState<Record<number, PagePreview>>({});
  const [error, setError] = useState("");

  const publish = () => {
    const out: Record<number, PagePreview> = {};
    held.current.forEach((h, n) => { out[n] = { page: n, width: h.width, height: h.height, data_url: h.url }; });
    setPages(out);
  };

  const drop = (n: number) => {
    const h = held.current.get(n);
    if (h) URL.revokeObjectURL(h.url);
    held.current.delete(n);
  };

  const put = (n: number, blob: Blob, m: RhwpMeta & { gen: number }) => {
    drop(n);
    held.current.set(n, { url: URL.createObjectURL(blob), size: blob.size, gen: m.gen, width: m.sizes[(n - 1) * 2], height: m.sizes[(n - 1) * 2 + 1] });
    let total = 0;
    held.current.forEach((h) => { total += h.size; });
    if (total > BUDGET) {
      const keep = new Set(wanted.current);
      const center = wanted.current[0] ?? n;
      const far = [...held.current.keys()].filter((p) => !keep.has(p)).sort((a, b) => Math.abs(b - center) - Math.abs(a - center));
      for (const p of far) {
        if (total <= BUDGET) break;
        total -= held.current.get(p)!.size;
        drop(p);
      }
    }
    publish();
  };

  // 보고 싶은 쪽을 앞에서부터 하나씩 (목록이 바뀌면 다음 쪽부터 새 목록을 따른다)
  const pump = useCallback(async () => {
    if (pumping.current) return;
    pumping.current = true;
    try {
      for (;;) {
        const m = meta.current;
        if (!m || !engine.current) break;
        const n = wanted.current.find((p) => p <= m.pageCount && held.current.get(p)?.gen !== m.gen);
        if (n == null) break;
        let blob: Blob;
        try {
          blob = await engine.current.render(n - 1);
        } catch (e) {
          if (meta.current === m) setError(e instanceof Error ? e.message : String(e));
          break;
        }
        if (meta.current === m) put(n, blob, m);
      }
    } finally {
      pumping.current = false;
    }
  }, []);

  /** 문서 열기 — 더 나중에 연 문서가 있으면 이 결과는 버린다(false) */
  const open = useCallback(async (bytes: Uint8Array, opts?: { password?: string; timeoutMs?: number }): Promise<boolean> => {
    const my = ++gen.current;
    engine.current ??= new RhwpPreview();
    const m = await engine.current.open(bytes, opts);
    if (my !== gen.current) return false;
    meta.current = { ...m, gen: my };
    for (const n of [...held.current.keys()]) if (n > m.pageCount) drop(n);
    publish();
    setError("");
    setDoc(m);
    void pump();
    return true;
  }, [pump]);

  /** 쪽 더미가 알려 주는 보이는 쪽 (가까운 순) */
  const need = useCallback((nums: number[]) => {
    wanted.current = nums;
    void pump();
  }, [pump]);

  /** 일꾼(WASM)을 끝내고 그린 쪽을 버린다 — 숨겨 둔 문서용. 쪽 수·크기는 남겨 자리는 그대로, 다시 보려면 open */
  const close = useCallback(() => {
    gen.current++;
    meta.current = null;
    engine.current?.dispose();
    engine.current = null;
    held.current.forEach((h) => URL.revokeObjectURL(h.url));
    held.current.clear();
    setPages({});
    setError("");
  }, []);

  useEffect(() => () => {
    gen.current++;
    meta.current = null;
    engine.current?.dispose();
    engine.current = null;
    held.current.forEach((h) => URL.revokeObjectURL(h.url));
    held.current.clear();
  }, []);

  return { pageCount: doc?.pageCount ?? 0, sizes: doc?.sizes ?? null, pages, need, open, close, error };
}
