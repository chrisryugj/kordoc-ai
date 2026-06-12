/**
 * @rhwp/core WASM 프론트엔드 로더 — 한/글급 SVG 미리보기 서피스.
 *
 * WASM은 Vite asset으로 로컬 번들된다 (CSP connect-src가 ipc/'self'만 허용 —
 * 외부 fetch 불가). WebAssembly 컴파일에는 CSP script-src 'wasm-unsafe-eval'
 * 필요 (tauri.conf.json에 추가됨). 초기화 실패 시 호출부가 사이드카
 * render_preview RPC로 폴백한다.
 */

import init, { HwpDocument } from "@rhwp/core";
import wasmUrl from "@rhwp/core/rhwp_bg.wasm?url";

let initPromise: Promise<boolean> | null = null;

/** WASM 1회 초기화 — 성공 여부 반환 (실패해도 throw 없음, RPC 폴백 판단용) */
export function initRhwp(): Promise<boolean> {
  if (!initPromise) {
    initPromise = init({ module_or_path: wasmUrl })
      .then(() => true)
      .catch((e) => {
        console.warn("[rhwp] WASM 초기화 실패 — 사이드카 렌더 폴백:", e);
        return false;
      });
  }
  return initPromise;
}

export interface RhwpDoc {
  pageCount: number;
  renderPageSvg: (page: number) => string;
  free: () => void;
}

/** HWPX/HWP 바이트로 문서 열기 — initRhwp()가 true를 반환한 뒤에만 호출 */
export function openRhwpDocument(bytes: Uint8Array): RhwpDoc {
  const doc = new HwpDocument(bytes);
  return {
    pageCount: doc.pageCount(),
    renderPageSvg: (page: number) => doc.renderPageSvg(page),
    free: () => doc.free(),
  };
}

export function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
