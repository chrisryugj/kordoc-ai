/** rhwp(@rhwp/core WASM) — 한글 문서 쪽 SVG. 편집기와 같은 버전(0.8.6), 설치본은 external 스테이징
 *
 * render_preview(FillWizard 미리보기)와 PDF 내보내기가 같이 쓴다.
 * PDF 를 kordoc renderDocument 대신 rhwp 로 그리는 이유: kordoc 렌더는 칸 안 줄바꿈(hp:lineBreak)을 아직 무시해서
 * 줄 배치 정보가 없는 문서(누름틀 채움·생성본)의 여러 줄 본문이 한 덩어리로 붙는다.
 */

import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { logger } from '../../infra/logger.js';
import { registerJob, runJob } from '../../infra/worker.js';

interface RhwpDoc {
  pageCount(): number;
  renderPageSvg(pageNum: number): string;
  getPageInfo(pageNum: number): string;
  free?(): void;
}

export interface RhwpModule {
  default: (input?: unknown) => Promise<unknown>;
  HwpDocument: { new (data: Uint8Array): RhwpDoc; openWithPassword(data: Uint8Array, password: string): RhwpDoc };
  version?: () => string;
}

let rhwpPromise: Promise<RhwpModule> | null = null;

/** 비-리터럴 경로 dynamic import 는 esbuild 가 번들에 넣지 않고 그대로 둔다 (dist/node_modules 의 @rhwp/core) */
export function loadRhwp(): Promise<RhwpModule> {
  if (rhwpPromise) return rhwpPromise;
  rhwpPromise = (async () => {
    const entry = createRequire(import.meta.url).resolve('@rhwp/core');
    const mod = (await import(pathToFileURL(entry).href)) as RhwpModule;
    await mod.default({ module_or_path: await readFile(join(dirname(entry), 'rhwp_bg.wasm')) });
    logger.info(`[rhwp] WASM 로드${mod.version ? ` (v${mod.version()})` : ''}`);
    return mod;
  })();
  rhwpPromise.catch(() => { rhwpPromise = null; });
  return rhwpPromise;
}

export async function openRhwp(bytes: Uint8Array, password?: string): Promise<RhwpDoc> {
  const rhwp = await loadRhwp();
  try {
    return password ? rhwp.HwpDocument.openWithPassword(bytes, password) : new rhwp.HwpDocument(bytes);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/비밀번호|password|암호/i.test(msg)) throw new Error(password ? '암호가 맞지 않습니다. 다시 확인하세요.' : '암호가 걸린 문서입니다. 암호를 넣고 다시 시도하세요.');
    throw err;
  }
}

/** rhwp(0.8.6)로 열어도 되는 쪽 수 상한 — 쪽 수에 따라 여는 시간이 가파르게 늘고(1만 쪽급은 수 분) 그동안 엔진 전체가 멈춘다.
 *  화면 미리보기(src/lib/rhwp-preview.ts RHWP_MAX_PAGES)와 같은 기준 */
export const RHWP_MAX_PAGES = 1000;

/** 한글에서 저장하지 않은 HWPX(생성본)는 줄 배치 정보가 없어 kordoc 쪽 수가 1로 나온다. 그럴 때만 글 양으로 어림잡는다
 *  (rhwp 실측 614·619·751자/쪽). 1쪽짜리 빽빽한 문서를 잘못 늘리지 않게 6천 자 넘고 3배 넘게 어긋날 때만 */
export function estimatePages(pageCount: number, markdown: string): number | null {
  const est = Math.ceil(markdown.length / 600);
  return est >= 10 && est > pageCount * 3 ? est : null;
}

/** kordoc 으로 쪽 수만 먼저 잰다(1만 쪽 문서도 1초 안). rhwp 로 열기엔 너무 크면 그 쪽 수, 아니면 null */
export async function tooBigForRhwp(bytes: Uint8Array, password?: string): Promise<number | null> {
  const { parse } = await import('kordoc');
  const r = await parse(Buffer.from(bytes), { images: false, ocr: false, ...(password ? { password } : {}) }).catch(() => null);
  if (!r?.success) return null;
  const n = r.metadata?.pageCount ?? r.pageCount ?? 0;
  const zip = bytes[0] === 0x50 && bytes[1] === 0x4b; // HWPX
  const pages = (zip && estimatePages(n, r.markdown ?? '')) || n;
  return pages > RHWP_MAX_PAGES ? pages : null;
}

type Page = { svg: string; width: number; height: number };

/** 이보다 큰 문서는 작업자 스레드에서 연다 (infra/worker: 여는 동안 엔진이 멈추고, 끝나도 WASM 메모리를 돌려주지 않는다) */
const WORKER_BYTES = 2 * 1024 * 1024;

registerJob('rhwp-pages', async ({ bytes, password }: { bytes: Uint8Array; password?: string }, port) => {
  for await (const p of pagesHere(bytes, password)) {
    port.send(p);
    await port.next();
  }
});

registerJob('rhwp-convert', async ({ bytes, to }: { bytes: Uint8Array; to: 'hwpx' | 'hwp' }) => convertHere(bytes, to));

/** 쪽을 하나씩 꺼낸다 — 전 쪽 SVG 를 한꺼번에 들고 있지 않게 (사진 많은 문서는 수백 MB). 큰 문서는 작업자에서, 취소하면 바로 멈춘다 */
export async function* rhwpPages(bytes: Uint8Array, password?: string, signal?: AbortSignal): AsyncGenerator<Page> {
  if (bytes.length < WORKER_BYTES) {
    yield* pagesHere(bytes, password);
    return;
  }
  const queue: Page[] = [];
  let wake: (() => void) | undefined;
  let finished = false;
  let failure: unknown;
  const ping = () => { const w = wake; wake = undefined; w?.(); };
  const job = runJob<void>('rhwp-pages', { bytes, password }, { signal, onMessage: (p: Page) => { queue.push(p); ping(); } });
  job.result.then(() => { finished = true; ping(); }, (err: unknown) => { failure = err; finished = true; ping(); });
  try {
    for (;;) {
      if (queue.length) {
        yield queue.shift()!;
        job.next();
      } else if (failure) throw failure;
      else if (finished) return;
      else await new Promise<void>((r) => { wake = r; });
    }
  } finally {
    job.stop();
  }
}

/** HWP·HWPX → HWPX·HWP (서식 그대로). 큰 문서는 작업자에서 */
export async function rhwpConvert(bytes: Uint8Array, to: 'hwpx' | 'hwp', signal?: AbortSignal): Promise<Uint8Array> {
  return bytes.length < WORKER_BYTES ? convertHere(bytes, to) : runJob<Uint8Array>('rhwp-convert', { bytes, to }, { signal }).result;
}

async function convertHere(bytes: Uint8Array, to: 'hwpx' | 'hwp'): Promise<Uint8Array> {
  const doc = (await openRhwp(bytes)) as unknown as { exportHwpx(): Uint8Array; exportHwp(): Uint8Array; free?(): void };
  try {
    return to === 'hwp' ? doc.exportHwp() : doc.exportHwpx();
  } finally {
    doc.free?.();
  }
}

async function* pagesHere(bytes: Uint8Array, password?: string): AsyncGenerator<Page> {
  const doc = await openRhwp(bytes, password);
  try {
    for (let i = 0; i < doc.pageCount(); i++) {
      const info = JSON.parse(doc.getPageInfo(i)) as { width: number; height: number };
      yield { svg: doc.renderPageSvg(i), width: info.width, height: info.height };
    }
  } finally {
    doc.free?.();
  }
}

/** 전 쪽 SVG + 쪽 크기(px, 96dpi) */
export async function rhwpPageSvgs(bytes: Uint8Array, password?: string): Promise<Array<{ svg: string; width: number; height: number }>> {
  const doc = await openRhwp(bytes, password);
  try {
    const pages: Array<{ svg: string; width: number; height: number }> = [];
    for (let i = 0; i < doc.pageCount(); i++) {
      const info = JSON.parse(doc.getPageInfo(i)) as { width: number; height: number };
      pages.push({ svg: doc.renderPageSvg(i), width: info.width, height: info.height });
    }
    return pages;
  } finally {
    doc.free?.();
  }
}
