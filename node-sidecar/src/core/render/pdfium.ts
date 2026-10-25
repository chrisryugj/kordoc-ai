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

/** 한 쪽을 그림으로 — 폭 maxWidth px 에 맞춤(최대 4배, maxScale 을 주면 그만큼). width·height 는 pt 원본 크기.
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
  // @hyzyla/pdfium 은 원본 폭을 내림한 뒤 배율을 곱하고 다시 내림한다 → 내림한 폭 기준 + 아주 조금 키워 정확히 maxWidth
  const scale = Math.min((maxWidth / Math.max(1, Math.floor(originalWidth))) * (1 + 1e-9), Math.max(4, maxScale));
  const r = await page.render({ scale, render: async ({ data }) => data });
  // @hyzyla/pdfium 의 bitmap 은 이미 RGBA 다 (BGRA 로 보고 바꾸면 빨강이 파랑이 됨: 실측)
  const img = sharp(Buffer.from(r.data), { raw: { width: r.width, height: r.height, channels: 4 } });
  const data = as === 'png' ? await img.png({ compressionLevel: 6 }).toBuffer() : await img.flatten({ background: '#ffffff' }).jpeg({ quality }).toBuffer();
  return { data, width: originalWidth, height: originalHeight, pxWidth: r.width, pxHeight: r.height };
}
