/** 영수증 읽기 — 글자 읽기(OCR) 모델이 없는 PC: 글자층 없는 스캔 PDF 는 빈 값으로 "읽음" 처리하지 않고 할 일을 알린다 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument } from 'pdf-lib';

vi.mock('../src/infra/progress.js', async (orig) => ({ ...(await orig<typeof import('../src/infra/progress.js')>()), sendProgress: vi.fn(), sendNotification: vi.fn() }));
vi.mock('../src/core/system/index.js', async (orig) => ({ ...(await orig<typeof import('../src/core/system/index.js')>()), ocrModelsReady: () => false }));

const { receiptRead } = await import('../src/core/receipt/read.js');
const FX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'receipts');

async function scannedPdf(dir: string, pages: number): Promise<string> {
  const doc = await PDFDocument.create();
  const png = await doc.embedPng(readFileSync(join(FX, 'simple.png')));
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage([png.width, png.height]);
    page.drawImage(png, { x: 0, y: 0, width: png.width, height: png.height });
  }
  const p = join(dir, `스캔 영수증 (${pages}쪽).pdf`);
  writeFileSync(p, await doc.save());
  return p;
}

describe('OCR 모델이 없을 때', () => {
  it('스캔 PDF(한 쪽·여러 쪽)는 실패로, 모델을 넣으라고 알린다', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kordoc-receipt-noocr-'));
    try {
      for (const n of [1, 2]) {
        const r = await receiptRead({ paths: [await scannedPdf(dir, n)] }, new AbortController().signal);
        expect(r.receipts.length).toBeGreaterThan(0);
        for (const x of r.receipts) {
          expect(x.ok).toBe(false);
          expect(x.error).toMatch(/글자 읽기\(OCR\) 모델/);
          expect(x.lines).toEqual([]);
        }
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
