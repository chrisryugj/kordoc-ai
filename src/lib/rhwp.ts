/**
 * @rhwp/core WASM 프론트엔드 로더 — 한/글급 SVG 미리보기 + 인메모리 편집 서피스.
 *
 * WASM은 Vite asset으로 로컬 번들된다 (CSP connect-src가 ipc/'self'만 허용 —
 * 외부 fetch 불가). WebAssembly 컴파일에는 CSP script-src 'wasm-unsafe-eval'
 * 필요 (tauri.conf.json에 추가됨). 초기화 실패 시 호출부가 사이드카
 * render_preview RPC로 폴백한다.
 *
 * rhwp는 단순 렌더러가 아니라 풀 편집 엔진이다(커서/타이핑/서식/표/저장).
 * 여기서 편집 API를 타입드로 노출해 워크벤치가 사이드카 왕복 없이 직접 편집한다
 * (KorDoc Studio Phase R2 — rhwp 단일 엔진 전환).
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

// ── 편집 좌표/서식 타입 (rhwp JSON 반환을 타입드로) ──

/** 페이지 픽셀 좌표 → 문서 논리 위치 (hitTest) */
export interface HitResult {
  sectionIndex: number;
  paragraphIndex: number;
  charOffset: number;
}

/** 논리 위치 → 페이지 픽셀 좌표 (커서 그리기) */
export interface CursorRect {
  pageIndex: number;
  x: number;
  y: number;
  height: number;
}

/** rhwp applyCharFormat / getCharPropertiesAt props (부분 지정) */
export interface CharFormat {
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  textColor?: string;
  fontFamily?: string;
}

/** rhwp applyParaFormat / getParaPropertiesAt props (부분 지정) */
export interface ParaFormat {
  alignment?: "left" | "center" | "right" | "justify" | "distribute";
  lineSpacing?: number;
  marginLeft?: number;
  marginRight?: number;
  marginTop?: number;
  marginBottom?: number;
  indent?: number;
}

/** rhwp 명령 반환 JSON `{"ok":true,...}` → 성공 여부 */
function okJson(s: string): boolean {
  try {
    return (JSON.parse(s) as { ok?: boolean })?.ok === true;
  } catch {
    return false;
  }
}

function parseJson<T>(s: string): T | null {
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

export interface RhwpDoc {
  /** 현재 페이지 수 (편집 후 갱신은 refreshPageCount로) */
  pageCount: number;
  renderPageSvg: (page: number) => string;
  /** 편집으로 페이지 수가 바뀐 뒤 최신 값을 다시 읽는다 */
  refreshPageCount: () => number;
  free: () => void;

  // ── 위치/커서 ──
  /** 페이지 픽셀 좌표에서 문서 논리 위치 찾기 (미리보기 클릭) */
  hitTest: (page: number, x: number, y: number) => HitResult | null;
  /** 논리 위치의 화면 픽셀 좌표 (커서/선택 그리기) */
  getCursorRect: (sec: number, para: number, charOffset: number) => CursorRect | null;
  /** 문단의 글자 수 (커서 경계 계산) */
  getParagraphLength: (sec: number, para: number) => number;

  // ── 텍스트 편집 ──
  insertText: (sec: number, para: number, charOffset: number, text: string) => boolean;
  deleteText: (sec: number, para: number, charOffset: number, count: number) => boolean;

  // ── 서식 ──
  applyCharFormat: (sec: number, para: number, startOffset: number, endOffset: number, props: CharFormat) => boolean;
  applyParaFormat: (sec: number, para: number, props: ParaFormat) => boolean;
  getCharPropertiesAt: (sec: number, para: number, charOffset: number) => CharFormat | null;
  getParaPropertiesAt: (sec: number, para: number) => ParaFormat | null;

  // ── undo/redo (스냅샷) + 저장 ──
  saveSnapshot: () => number;
  restoreSnapshot: (id: number) => boolean;
  discardSnapshot: (id: number) => void;
  exportHwpx: () => Uint8Array;
}

/** HWPX/HWP 바이트로 문서 열기 — initRhwp()가 true를 반환한 뒤에만 호출 */
export function openRhwpDocument(bytes: Uint8Array): RhwpDoc {
  const doc = new HwpDocument(bytes);
  return {
    pageCount: doc.pageCount(),
    renderPageSvg: (page) => doc.renderPageSvg(page),
    refreshPageCount: () => doc.pageCount(),
    free: () => doc.free(),

    hitTest: (page, x, y) => parseJson<HitResult>(doc.hitTest(page, x, y)),
    getCursorRect: (sec, para, off) => parseJson<CursorRect>(doc.getCursorRect(sec, para, off)),
    getParagraphLength: (sec, para) => doc.getParagraphLength(sec, para),

    insertText: (sec, para, off, text) => okJson(doc.insertText(sec, para, off, text)),
    deleteText: (sec, para, off, count) => okJson(doc.deleteText(sec, para, off, count)),

    applyCharFormat: (sec, para, s, e, props) =>
      okJson(doc.applyCharFormat(sec, para, s, e, JSON.stringify(props))),
    applyParaFormat: (sec, para, props) =>
      okJson(doc.applyParaFormat(sec, para, JSON.stringify(props))),
    getCharPropertiesAt: (sec, para, off) => parseJson<CharFormat>(doc.getCharPropertiesAt(sec, para, off)),
    getParaPropertiesAt: (sec, para) => parseJson<ParaFormat>(doc.getParaPropertiesAt(sec, para)),

    saveSnapshot: () => doc.saveSnapshot(),
    restoreSnapshot: (id) => okJson(doc.restoreSnapshot(id)),
    discardSnapshot: (id) => doc.discardSnapshot(id),
    exportHwpx: () => doc.exportHwpx(),
  };
}

export function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
