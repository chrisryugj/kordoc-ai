/** 번들에서 빼고 dist/node_modules 로 따로 까는 패키지 — esbuild·stage-natives 공용
 *
 * kordoc 은 통째로 싣는다: 공개 API 에 없는 서식 보존 마스킹·폴더 감시는 kordoc CLI 로,
 * MCP 원클릭 등록은 kordoc/dist/mcp.js 를 동봉 Node 로 띄운다 (폐쇄망에 npx 불필요).
 * kordoc 의 optional 의존(onnxruntime-node·sharp·pdfium·pdfjs)도 함께 깔린다.
 */
// @hyzyla/pdfium: render_pages·보안 PDF 합치기가 직접 쓴다 — pdfium.wasm 을 import.meta.url 옆에서 찾으므로 번들 금지
export const STAGED_EXTERNALS = ['kordoc', 'node-llama-cpp', '@rhwp/core', 'puppeteer-core', 'sharp', '@hyzyla/pdfium'];

/** 스테이징 뒤 지우는 패키지 — 수식 OCR(transformers) 는 onnxruntime-web 140MB 를 끌고 와서 제외.
 *  kordoc 은 이 모듈을 동적 import 로 부르고 없으면 MISSING_DEPENDENCY 로 안내한다.
 *  sharp-wasm32 는 운영체제별 네이티브 판이 못 뜰 때의 대체본(8.9MB)으로 쓰이지 않고, libvips(LGPL)를 한 파일에 품고 있어 뺀다 */
export const DROPPED_PACKAGES = ['@huggingface/transformers', 'onnxruntime-web', '@img/sharp-wasm32'];

export const NATIVE_EXTERNALS = [...STAGED_EXTERNALS, '@huggingface/transformers'];
