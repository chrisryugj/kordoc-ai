/**
 * 쪽 그림 불러오기: 화면에 보이는 쪽을 원본마다 모아 pdf_thumbs 한 번에(40쪽까지), 동시에 두 번까지.
 * 그림 폭은 칸 크기 × 화면 배율을 64px 단위로 올린 값. 칸을 키우면 더 큰 그림을 다시 받고, 그동안은 작은 그림을 둔다.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { rpc } from "../../lib/rpc";
import { toRanges } from "../../lib/format";

const BATCH = 40;
const PARALLEL = 2;

interface Entry { w: number; url: string }

export interface Thumbs {
  /** 이 쪽 그림 (아직 없으면 undefined, 못 그렸으면 "") */
  get: (source: string, page: number) => string | undefined;
  /** 보이는 쪽: 그림이 없거나 작으면 받아 온다 */
  want: (source: string, page: number) => void;
  /** 쪽 그림을 다 받을 때까지 (빈 쪽 찾기) */
  ensure: (list: Array<{ source: string; page: number }>) => Promise<void>;
  /** 그림이 새로 올 때마다 바뀐다 (다시 그리기 신호) */
  version: number;
}

export function useThumbs(cssWidth: number): Thumbs {
  const width = Math.min(640, Math.ceil((cssWidth * (window.devicePixelRatio || 1)) / 64) * 64);
  const cache = useRef(new Map<string, Entry>());
  /** 그리지 못한 쪽: 문서에 없는 쪽은 끝까지(Infinity), 엔진 오류는 잠깐 뒤 다시 (언제까지 안 묻는지) */
  const failed = useRef(new Map<string, number>());
  /** 받는 중인 쪽 (같은 쪽을 또 묻지 않게) */
  const inflight = useRef(new Set<string>());
  const queue = useRef(new Map<string, Set<number>>());
  const waiters = useRef(new Set<() => void>());
  const busy = useRef(0);
  const widthRef = useRef(width);
  widthRef.current = width;
  const [version, setVersion] = useState(0);
  const bump = useRef(0);

  const key = (source: string, page: number) => `${source}\u0000${page}`;
  const gaveUp = (k: string) => (failed.current.get(k) ?? 0) > Date.now();
  const fresh = (source: string, page: number) => {
    const k = key(source, page);
    return gaveUp(k) || (cache.current.get(k)?.w ?? 0) >= widthRef.current;
  };

  const pump = useCallback(() => {
    while (busy.current < PARALLEL && queue.current.size) {
      const [source, set] = queue.current.entries().next().value as [string, Set<number>];
      const pages = [...set].sort((a, b) => a - b).slice(0, BATCH);
      pages.forEach((p) => set.delete(p));
      if (!set.size) queue.current.delete(source);
      const w = widthRef.current;
      busy.current++;
      pages.forEach((p) => inflight.current.add(key(source, p)));
      void rpc("pdf_thumbs", { path: source, pages: toRanges(pages), width: w })
        .then((r) => {
          for (const p of r.pages) {
            cache.current.set(key(source, p.page), { w, url: p.data_url });
            failed.current.delete(key(source, p.page));
          }
          // 문서에 없는 쪽(원본이 바뀜)은 다시 묻지 않는다
          for (const p of pages) if (!r.pages.some((x) => x.page === p)) failed.current.set(key(source, p), Infinity);
        })
        // 엔진이 다시 켜지는 중 같은 오류: 10초 동안 묻지 않고(빈 그림) 그 뒤 보이면 다시
        .catch(() => { for (const p of pages) failed.current.set(key(source, p), Date.now() + 10_000); })
        .finally(() => {
          pages.forEach((p) => inflight.current.delete(key(source, p)));
          busy.current--;
          // 그림이 여러 번에 나눠 와도 한 그림틀에 한 번만 다시 그린다
          cancelAnimationFrame(bump.current);
          bump.current = requestAnimationFrame(() => setVersion((v) => v + 1));
          waiters.current.forEach((w2) => w2());
          pump();
        });
    }
  }, []);

  const want = useCallback((source: string, page: number) => {
    if (fresh(source, page) || inflight.current.has(key(source, page))) return;
    let set = queue.current.get(source);
    if (!set) { set = new Set(); queue.current.set(source, set); }
    if (set.has(page)) return;
    set.add(page);
    queueMicrotask(pump);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pump]);

  const ensure = useCallback((list: Array<{ source: string; page: number }>) => {
    list.forEach((x) => want(x.source, x.page));
    return new Promise<void>((resolve) => {
      const check = () => {
        if (list.every((x) => fresh(x.source, x.page))) {
          waiters.current.delete(check);
          resolve();
          return;
        }
        // 그사이 칸을 키웠으면(폭이 바뀜) 화면 밖 쪽은 아무도 다시 묻지 않는다 → 여기서 다시
        list.forEach((x) => want(x.source, x.page));
      };
      waiters.current.add(check);
      check();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [want]);

  // 칸이 커지면 보이는 쪽부터 다시 받는다 (카드가 want 를 다시 부른다)
  useEffect(() => { setVersion((v) => v + 1); }, [width]);

  const get = useCallback((source: string, page: number) => {
    const k = key(source, page);
    const url = cache.current.get(k)?.url;
    if (url) return url;
    return gaveUp(k) ? "" : undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { get, want, ensure, version };
}
