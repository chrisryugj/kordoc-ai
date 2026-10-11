/** PDFium(WASM) — PDF 쪽 래스터. kordoc 이 OCR 에 쓰는 @hyzyla/pdfium 을 같이 쓴다 (설치본은 external 스테이징) */

import type { PDFiumDocument, PDFiumLibrary } from '@hyzyla/pdfium';

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

/** PDFium 의 BGRA → RGBA (sharp raw 입력) */
export function bgraToRgba(data: Uint8Array): Buffer {
  const out = Buffer.from(data);
  for (let i = 0; i < out.length; i += 4) {
    const b = out[i];
    out[i] = out[i + 2];
    out[i + 2] = b;
  }
  return out;
}

/** 한 쪽을 그림으로 — 폭 maxWidth px 에 맞춤(최대 4배). width·height 는 pt 원본 크기 */
export async function rasterPdfPage(
  doc: PDFiumDocument,
  pageNo: number,
  maxWidth: number,
  as: 'png' | 'jpeg' = 'png',
): Promise<{ data: Buffer; width: number; height: number; pxWidth: number; pxHeight: number }> {
  const sharp = (await import('sharp')).default;
  const page = doc.getPage(pageNo - 1);
  const { originalWidth, originalHeight } = page.getOriginalSize();
  // @hyzyla/pdfium 은 원본 폭을 내림한 뒤 배율을 곱하고 다시 내림한다 → 내림한 폭 기준 + 아주 조금 키워 정확히 maxWidth
  const scale = Math.min((maxWidth / Math.max(1, Math.floor(originalWidth))) * (1 + 1e-9), 4);
  const r = await page.render({ scale, render: async ({ data }) => data });
  const img = sharp(bgraToRgba(r.data), { raw: { width: r.width, height: r.height, channels: 4 } });
  const data = as === 'png' ? await img.png({ compressionLevel: 6 }).toBuffer() : await img.flatten({ background: '#ffffff' }).jpeg({ quality: 85 }).toBuffer();
  return { data, width: originalWidth, height: originalHeight, pxWidth: r.width, pxHeight: r.height };
}
