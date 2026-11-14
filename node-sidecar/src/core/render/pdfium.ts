/** PDFium(WASM) — PDF 쪽 래스터. kordoc 이 OCR 에 쓰는 @hyzyla/pdfium 을 같이 쓴다 (설치본은 external 스테이징) */

import type { PDFiumDocument, PDFiumLibrary, PDFiumPage } from '@hyzyla/pdfium';

let lib: Promise<PDFiumLibrary> | null = null;

function pdfium(): Promise<PDFiumLibrary> {
  if (!lib) {
    lib = import('@hyzyla/pdfium').then((m) => m.PDFiumLibrary.init());
    lib.catch(() => { lib = null; });
  }
  return lib;
}

export async function openPdf(bytes: Uint8Array, password?: string): Promise<PDFiumDocument> {
  const l = await pdfium();
  try {
    return await l.loadDocument(bytes, password ?? '');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/password/i.test(msg)) {
      throw new Error(password ? 'PDF 암호가 맞지 않습니다. 다시 확인하세요.' : '암호가 걸린 PDF입니다. 암호를 넣고 다시 시도하세요.');
    }
    if (/format|corrupt/i.test(msg)) throw new Error('PDF가 손상되어 열 수 없습니다. 원본을 다시 받아 시도하세요.');
    throw err;
  }
}

/** 그리지 않고 크기·글만 읽은 쪽을 닫는다 — @hyzyla/pdfium 은 그린 뒤에만 쪽을 닫고 문서를 닫을 때도 쪽은 닫지 않아, 쪽마다 불러 크기만 보면
 *  엔진 전체가 쓰는 PDFium WASM 힙에 쌓였다(300쪽 도면 용량 줄이기 몇 번 뒤 "Failed to allocate memory for bitmap"). 그린 쪽에는 부르지 말 것(두 번 닫힘) */
export function closePdfPage(page: PDFiumPage): void {
  const { module: m, pageIdx } = page as unknown as { module: { _FPDF_ClosePage(p: number): void }; pageIdx: number };
  m._FPDF_ClosePage(pageIdx);
}

/** 쪽 그림 한 장의 상한: 화소 수(6천만, RGBA 240MB)와 긴 변(JPEG 는 65,535px 까지라 넘으면 sharp 가 영어 오류).
 *  쪽이 아주 긴 1KB PDF(600×200,000pt)를 폭 1000px 로 미리 보면 RSS 4.1GB, 300dpi 그림 파일로는 6.4GB 였고
 *  PDFium WASM 힙은 한 번 커지면 줄지 않는다. 넘으면 거절하지 않고 배율을 낮춘다 */
export const MAX_PAGE_PIXELS = 60_000_000;
export const MAX_PAGE_SIDE = 16_384;

/** pt 크기의 쪽을 scale 로 그릴 때 상한에 맞춘 배율 (@hyzyla/pdfium 의 크기 계산: 내림한 pt × 배율, 다시 내림) */
export function fitScale(widthPt: number, heightPt: number, scale: number): number {
  const w = Math.max(1, Math.floor(widthPt));
  const h = Math.max(1, Math.floor(heightPt));
  return Math.min(scale, Math.sqrt(MAX_PAGE_PIXELS / (w * h)), MAX_PAGE_SIDE / Math.max(w, h));
}

/** 한 쪽에 든 그림 화소 수 합의 상한. PDFium 은 그리는 크기와 상관없이 그림을 다 풀어서(작업자가 아니라 엔진 스레드),
 *  압축 2.6MB 그림 한 장(3만×3만) PDF 의 쪽 하나를 그리는 동안 25초 멈췄다(백만 화소에 약 28ms). A0 를 300dpi 로 스캔한 쪽(1억 4천만)까지는 그린다 */
export const MAX_PAGE_IMAGE_PIXELS = 150_000_000;

interface PageObjects {
  _FPDFPage_CountObjects(page: number): number;
  _FPDFPage_GetObject(page: number, i: number): number;
  _FPDFPageObj_GetType(obj: number): number;
  _FPDFImageObj_GetImagePixelSize(obj: number, w: number, h: number): number;
  _FPDFFormObj_CountObjects(obj: number): number;
  _FPDFFormObj_GetObject(obj: number, i: number): number;
  HEAPU8: Uint8Array;
  wasmExports: { malloc(n: number): number; free(p: number): void };
}

/** 쪽 개체(양식 개체 안까지)의 그림 화소 수 합 — 그리기 전에 그림을 풀지 않고 적힌 크기만 본다. stop 을 넘으면 거기서 그만 센다 */
export function pageImagePixels(page: PDFiumPage, stop = MAX_PAGE_IMAGE_PIXELS): number {
  const { module: m, pageIdx } = page as unknown as { module: PageObjects; pageIdx: number };
  const wh = m.wasmExports.malloc(8);
  let sum = 0;
  const walk = (count: number, get: (i: number) => number, depth: number) => {
    for (let i = 0; i < count && sum <= stop; i++) {
      const obj = get(i);
      const type = m._FPDFPageObj_GetType(obj);
      if (type === 3 && m._FPDFImageObj_GetImagePixelSize(obj, wh, wh + 4)) {
        const v = new Uint32Array(m.HEAPU8.buffer, wh, 2);
        sum += v[0] * v[1];
      } else if (type === 5 && depth < 16) {
        walk(m._FPDFFormObj_CountObjects(obj), (k) => m._FPDFFormObj_GetObject(obj, k), depth + 1);
      }
    }
  };
  try {
    walk(m._FPDFPage_CountObjects(pageIdx), (i) => m._FPDFPage_GetObject(pageIdx, i), 0);
  } finally {
    m.wasmExports.free(wh);
  }
  return sum;
}

const pixelsText = (n: number) => (n >= 1e8 ? `${(n / 1e8).toFixed(1)}억` : `${Math.round(n / 1e4).toLocaleString('ko-KR')}만`);

/** 그림이 너무 큰 쪽이면 (그리지 않고 쪽을 닫은 뒤) 알아들을 오류. code 'PDF_PAGE_TOO_HEAVY' — 쪽 그림 미리보기는 그 쪽을 비워 둔다 */
export function checkPageImages(page: PDFiumPage, pageNo: number): void {
  const px = pageImagePixels(page);
  if (px <= MAX_PAGE_IMAGE_PIXELS) return;
  closePdfPage(page);
  throw Object.assign(
    new Error(`${pageNo}쪽에 아주 큰 그림(약 ${pixelsText(px)} 화소)이 들어 있어 그리지 않았습니다. 손상됐거나 일부러 크게 만든 파일일 수 있습니다. 그 쪽을 빼고 다시 하거나 원본을 다시 받으세요.`),
    { code: 'PDF_PAGE_TOO_HEAVY' },
  );
}

export const isHeavyPage = (err: unknown) => (err as { code?: unknown })?.code === 'PDF_PAGE_TOO_HEAVY';

/** 한 쪽을 그림으로 — 폭 maxWidth px 에 맞춤(최대 4배, maxScale 을 주면 그만큼). width·height 는 pt 원본 크기.
 *  화소 상한(MAX_PAGE_PIXELS·MAX_PAGE_SIDE)을 넘으면 배율을 낮추고, 그림이 너무 큰 쪽은 그리지 않고 오류(checkPageImages).
 *  loaded: 크기를 보려고 앞서 불러 둔 쪽. @hyzyla/pdfium 은 그린 뒤 쪽을 닫으므로 한 쪽 객체는 한 번만 그린다 (두 번째는 WASM 오류) */
export async function rasterPdfPage(
  doc: PDFiumDocument,
  pageNo: number,
  maxWidth: number,
  as: 'png' | 'jpeg' = 'png',
  quality = 85,
  loaded?: PDFiumPage,
  maxScale = 4,
): Promise<{ data: Buffer; width: number; height: number; pxWidth: number; pxHeight: number }> {
  const sharp = (await import('sharp')).default;
  const page = loaded ?? doc.getPage(pageNo - 1);
  const { originalWidth, originalHeight } = page.getOriginalSize();
  checkPageImages(page, pageNo);
  // @hyzyla/pdfium 은 원본 폭을 내림한 뒤 배율을 곱하고 다시 내림한다 → 내림한 폭 기준 + 아주 조금 키워 정확히 maxWidth
  const scale = fitScale(originalWidth, originalHeight, Math.min((maxWidth / Math.max(1, Math.floor(originalWidth))) * (1 + 1e-9), Math.max(4, maxScale)));
  // 입력 칸(양식 필드)에 적어 넣은 값도 그린다. 안 그리면 쪽을 그림으로 만드는 길(용량 줄이기·보안 PDF 합치기·쪽 그림 내보내기)에서
  // 칸의 값이 통째로 빠진 결과가 정상처럼 나온다
  const r = await page.render({ scale, renderFormFields: true, render: async ({ data }) => data });
  // @hyzyla/pdfium 의 bitmap 은 이미 RGBA 다 (BGRA 로 보고 바꾸면 빨강이 파랑이 됨: 실측)
  const img = sharp(Buffer.from(r.data), { raw: { width: r.width, height: r.height, channels: 4 } });
  const data = as === 'png' ? await img.png({ compressionLevel: 6 }).toBuffer() : await img.flatten({ background: '#ffffff' }).jpeg({ quality }).toBuffer();
  return { data, width: originalWidth, height: originalHeight, pxWidth: r.width, pxHeight: r.height };
}
