/**
 * rhwp SVG 미리보기 (render_preview, FillWizard) — @rhwp/core WASM 을 Node 에서 구동.
 *
 * 프론트도 같은 WASM 을 직접 임베드하지만(즉시 갱신), 웹뷰 WASM 초기화가
 * 실패하는 환경(CSP/구버전 WebView2)을 위한 폴백 경로로 이 RPC 를 유지한다.
 * 렌더는 수십 ms 단위라 HEAVY 세마포어에서 제외 — 변환 대기열에 막히면 안 된다.
 */

import { readFile } from 'node:fs/promises';
import { openRhwp, tooBigForRhwp } from '../render/rhwp.js';
import { showFieldGuides } from '../render/guides.js';

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

  const big = await tooBigForRhwp(new Uint8Array(bytes));
  if (big) throw new Error(`문서가 너무 커서(약 ${big.toLocaleString('ko-KR')}쪽) 미리 볼 수 없습니다. 작업대의 쪽 보기로 여세요.`);
  // 빈 누름틀 안내문이 뒤 글자와 겹치지 않게 (미리보기 사본만)
  const doc = await openRhwp(await showFieldGuides(new Uint8Array(bytes)));
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
