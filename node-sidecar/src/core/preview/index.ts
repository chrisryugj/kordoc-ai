/**
 * rhwp SVG 미리보기 (KorDoc Studio Phase B) — @rhwp/core WASM을 Node에서 구동.
 *
 * 프론트엔드도 동일 WASM을 직접 임베드하지만(즉시 갱신), 웹뷰 WASM 초기화가
 * 실패하는 환경(CSP/구버전 WebView2)을 위한 폴백 경로로 이 RPC를 유지한다.
 * 렌더는 수십 ms 단위라 HEAVY 세마포어에서 제외 — 변환 대기열에 막히면 안 된다.
 */

import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { logger } from '../../infra/logger.js';

interface RhwpModule {
  default: (input?: unknown) => Promise<unknown>;
  HwpDocument: new (data: Uint8Array) => {
    pageCount(): number;
    renderPageSvg(pageNum: number): string;
    free?(): void;
  };
  version?: () => string;
}

let rhwpPromise: Promise<RhwpModule> | null = null;

async function loadRhwp(): Promise<RhwpModule> {
  if (rhwpPromise) return rhwpPromise;
  rhwpPromise = (async () => {
    // createRequire.resolve는 dev(tsx)/tsc dist/esbuild 번들 모두에서
    // 실행 파일 위치 기준 node_modules 체인을 탄다.
    // 번들 배포 시 dist/node_modules/@rhwp/core 가 함께 복사된다 (esbuild.config.mjs).
    // 비-리터럴 경로 dynamic import는 esbuild가 require로 변환하지 않고 보존한다
    // (CJS에서도 import()는 네이티브 — ESM 패키지 로드의 표준 경로).
    const req = createRequire(import.meta.url);
    const entryPath = req.resolve('@rhwp/core');
    const mod = (await import(pathToFileURL(entryPath).href)) as RhwpModule;
    const wasmBytes = await readFile(join(dirname(entryPath), 'rhwp_bg.wasm'));
    await mod.default(wasmBytes);
    logger.info(`[render_preview] rhwp WASM 로드 완료${mod.version ? ` (v${mod.version()})` : ''}`);
    return mod;
  })();
  rhwpPromise.catch(() => { rhwpPromise = null; }); // 실패 시 다음 호출에서 재시도
  return rhwpPromise;
}

export interface RenderPreviewParams {
  /** 둘 중 하나 필수 — doc_b64 우선 (채움 직후 미저장 상태 렌더) */
  input_path?: string;
  doc_b64?: string;
  /** 렌더할 0-based 페이지 목록 (생략 시 앞에서 max_pages장) */
  pages?: number[];
  /** pages 생략 시 렌더 상한 (기본 5) */
  max_pages?: number;
}

export interface RenderPreviewResult {
  success: boolean;
  page_count: number;
  /** { page, svg } — 요청 순서대로 */
  pages: Array<{ page: number; svg: string }>;
  error?: string;
}

export async function renderPreview(params: RenderPreviewParams, signal?: AbortSignal): Promise<RenderPreviewResult> {
  const { input_path, doc_b64, pages, max_pages = 5 } = params;
  const bytes = doc_b64 ? Buffer.from(doc_b64, 'base64') : await readFile(input_path!);
  signal?.throwIfAborted();

  const rhwp = await loadRhwp();
  const doc = new rhwp.HwpDocument(new Uint8Array(bytes));
  try {
    const pageCount = doc.pageCount();
    const targets = (pages && pages.length > 0)
      ? pages.filter((p) => Number.isInteger(p) && p >= 0 && p < pageCount)
      : Array.from({ length: Math.min(pageCount, max_pages) }, (_, i) => i);

    const rendered: Array<{ page: number; svg: string }> = [];
    for (const p of targets) {
      signal?.throwIfAborted();
      rendered.push({ page: p, svg: doc.renderPageSvg(p) });
    }
    return { success: true, page_count: pageCount, pages: rendered };
  } finally {
    doc.free?.();
  }
}
