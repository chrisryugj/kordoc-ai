/**
 * rhwp 쪽 미리보기 — 편집기·PDF 와 같은 조판(rhwp)으로 HWP·HWPX 쪽을 그린다. 일꾼(rhwp-worker) 하나를 부리는 얇은 손잡이.
 *
 * - 여는 데 RHWP_OPEN_TIMEOUT_MS 를 넘기면 일꾼을 끝내고(그래야 CPU 를 놓는다) 실패로 돌려준다 → 호출부는 엔진 렌더(render_pages, PNG)로.
 * - 쪽이 아주 많은 문서는 처음부터 엔진 렌더로: rhwp 는 쪽 수에 따라 여는 시간이 가파르게 는다
 *   (실측 174쪽 0.35초 · 696쪽 1.2초 · 2,783쪽 12.8초 · 16,384쪽 282초, kordoc 렌더는 12,821쪽 문서 앞 4쪽 4.8초).
 * - 글꼴은 따로 싣지 않는다: 쪽 SVG 의 글꼴 목록(예 '함초롬바탕','Batang',…,serif)을 이 PC 에 깔린 글꼴로 푼다. PDF(docToPdf) 와 같은 방식.
 */

import type { DocFormat, PagePreview } from "./contract";
import { rpc } from "./rpc";
import { b64ToBytes, bytesToB64 } from "./rhwp";

export const RHWP_OPEN_TIMEOUT_MS = 8000;
export const RHWP_MAX_PAGES = 1000;

/** rhwp 로 그려 볼 만한 문서인가 (엔진이 센 쪽 수 기준) */
export function rhwpWorth(format: DocFormat, pageCount?: number): boolean {
  return (format === "hwp" || format === "hwpx") && (pageCount ?? 0) <= RHWP_MAX_PAGES;
}

export interface RhwpMeta {
  pageCount: number;
  /** 쪽 크기 pt — [폭0, 높이0, 폭1, 높이1, …] */
  sizes: Float32Array;
}

type Wait = { resolve: (v: unknown) => void; reject: (e: Error) => void };

export class RhwpPreview {
  private worker: Worker | null = null;
  private seq = 0;
  private waits = new Map<number, Wait>();

  private call<T>(msg: Record<string, unknown>, transfer: Transferable[] = []): Promise<T> {
    if (!this.worker) {
      const w = new Worker(new URL("./rhwp-worker.ts", import.meta.url), { type: "module" });
      w.onmessage = (e: MessageEvent<{ id: number; ok: boolean; value?: unknown; error?: string }>) => {
        const wait = this.waits.get(e.data.id);
        if (!wait) return;
        this.waits.delete(e.data.id);
        if (e.data.ok) wait.resolve(e.data.value);
        else wait.reject(new Error(e.data.error));
      };
      w.onerror = (e) => this.fail(new Error(e.message || "rhwp 일꾼을 띄우지 못했습니다"));
      this.worker = w;
    }
    const id = ++this.seq;
    return new Promise<T>((resolve, reject) => {
      this.waits.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.worker!.postMessage({ ...msg, id }, transfer);
    });
  }

  /** 문서 열기 (앞에 연 문서는 닫힌다). bytes 는 일꾼으로 넘겨 이쪽에선 못 쓴다 */
  async open(bytes: Uint8Array, opts: { password?: string; timeoutMs?: number } = {}): Promise<RhwpMeta> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { this.dispose(); reject(new Error("rhwp 가 제때 문서를 열지 못했습니다")); }, opts.timeoutMs ?? RHWP_OPEN_TIMEOUT_MS);
    });
    try {
      return await Promise.race([this.call<RhwpMeta>({ op: "open", bytes, password: opts.password }, [bytes.buffer]), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  /** 쪽 SVG (0부터) */
  render(page: number): Promise<Blob> {
    return this.call<Blob>({ op: "render", page });
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.fail(new Error("rhwp 미리보기를 닫았습니다"));
  }

  private fail(err: Error) {
    this.waits.forEach((w) => w.reject(err));
    this.waits.clear();
  }
}

/** 미리보기용 파일 바이트 (암호 문서도 그대로 — rhwp 가 암호로 연다). HWPX 는 빈 누름틀 안내문을 글로 넣은 사본(안내문 겹침 우회) */
export async function readBytes(path: string): Promise<Uint8Array> {
  return b64ToBytes((await rpc("read_file_b64", { path, preview: true })).data_b64);
}

/** 편집기에서 내보낸 HWPX 를 미리보기 사본으로 (readBytes 와 같은 처리) */
export async function previewOf(bytes: Uint8Array): Promise<Uint8Array> {
  return b64ToBytes((await rpc("preview_bytes", { data_b64: bytesToB64(bytes) })).data_b64);
}

/** 첫 쪽 그림 — 한글 문서는 rhwp(Blob 주소, 다 쓰면 URL.revokeObjectURL), 안 되면 엔진 렌더(PNG) */
export async function firstPage(path: string, format: DocFormat): Promise<PagePreview | null> {
  if (rhwpWorth(format)) {
    const p = new RhwpPreview();
    try {
      const meta = await p.open(await readBytes(path));
      const blob = await p.render(0);
      return { page: 1, width: meta.sizes[0], height: meta.sizes[1], data_url: URL.createObjectURL(blob) };
    } catch {
      // 엔진 렌더로
    } finally {
      p.dispose();
    }
  }
  const r = await rpc("render_pages", { path, pages: "1", max_width: 600 });
  return r.pages[0] ?? null;
}
