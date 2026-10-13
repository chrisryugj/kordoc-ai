/** 쪽 미리보기·PDF — render_pages·render_preview(rhwp 0.8.6)·export_pdf·bundle_pdf·pdf_stamp·PDF 나누기·합치기 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { fillHwpx, readBuiltinTemplate, resolveBuiltinTemplate } from 'kordoc';
import { call, corpus, hasCorpus, makePng, sample, setupEnv } from './doc-helpers.js';
import { findBrowser } from '../src/core/export/chromium.js';
import { rhwpPageSvgs } from '../src/core/render/rhwp.js';
import { openPdf } from '../src/core/render/pdfium.js';

vi.mock('../src/infra/progress.js', async (orig) => ({ ...(await orig<typeof import('../src/infra/progress.js')>()), sendProgress: vi.fn(), sendNotification: vi.fn() }));

const LETTER_HWPX = sample('1-받은공문_도민체육대회 참가 협조 요청.hwpx');
const LETTER_PDF = sample('1-받은공문_도민체육대회 참가 협조 요청.pdf');
const FORM = sample('취합/교육수요조사서_총무과.hwpx');
const hasBrowser = !!findBrowser();
const pngSize = (dataUrl: string) => {
  const b = Buffer.from(dataUrl.split(',')[1], 'base64');
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), bytes: b.length };
};
let env: ReturnType<typeof setupEnv>;

beforeAll(() => {
  env = setupEnv();
});

describe('render_pages', () => {
  it('HWPX — kordoc 렌더 PNG, 폭 맞춤', async () => {
    const r = await call('render_pages', { path: LETTER_HWPX, max_width: 800 });
    expect(r.page_count).toBe(1);
    expect(r.pages[0]).toMatchObject({ page: 1 });
    expect(r.pages[0].width).toBeGreaterThan(590);
    const s = pngSize(r.pages[0].data_url);
    expect(s.w).toBe(800);
    expect(s.h).toBeGreaterThan(1000);
    expect(s.bytes).toBeGreaterThan(10_000);
  });

  it.skipIf(!hasCorpus('hwp5/changing-paragraph-text.hwp', 'korea-kr'))('HWP5 실문서 + 쪽 고르기', async () => {
    const r = await call('render_pages', { path: corpus('hwp5/changing-paragraph-text.hwp') });
    expect(r.pages).toHaveLength(1);
    expect(pngSize(r.pages[0].data_url).w).toBe(1000);
  });

  it('PDF — PDFium 래스터, 쪽 범위 밖은 안내', async () => {
    const r = await call('render_pages', { path: LETTER_PDF, pages: '1', max_width: 600 });
    expect(r.page_count).toBe(1);
    expect(pngSize(r.pages[0].data_url).w).toBe(600);
    expect(r.pages[0].height).toBeGreaterThan(800);
    await expect(call('render_pages', { path: LETTER_PDF, pages: '5' })).rejects.toThrow(/1쪽/);
  });

  it('이미지 — 크면 축소', async () => {
    const img = join(env.work, '큰그림.png');
    writeFileSync(img, await makePng(3000, 1000));
    const r = await call('render_pages', { path: img, max_width: 1200 });
    expect(r.pages[0]).toMatchObject({ width: 3000, height: 1000 });
    expect(pngSize(r.pages[0].data_url).w).toBe(1200);
  });

  it('쪽 모양이 없는 형식은 NO_LAYOUT:', async () => {
    const md = join(env.work, '글.md');
    writeFileSync(md, '# 글');
    await expect(call('render_pages', { path: md })).rejects.toThrow(/^NO_LAYOUT:/);
  });
});

describe('render_preview (rhwp 0.8.6)', () => {
  it('누름틀 여러 줄 본문 — rhwp 는 줄을 나눠 그린다 (kordoc 렌더 결함 우회 근거)', async () => {
    const t = resolveBuiltinTemplate('gian')!;
    const filled = await fillHwpx(readBuiltinTemplate(t), { 본문: '첫째 줄 내용\n둘째 줄 내용' });
    const [page] = await rhwpPageSvgs(new Uint8Array(filled.buffer));
    const ys = (needle: string) => [...page.svg.matchAll(/<text[^>]*\by="([\d.]+)"[^>]*>([^<]*)<\/text>/g)].filter((m) => m[2] === needle).map((m) => Number(m[1]));
    expect(ys('첫')[0]).toBeLessThan(ys('둘')[0]);
    expect(page.width).toBeGreaterThan(790);
  });

  it('빈 누름틀 안내문 — 미리보기 사본은 안내문을 글로 넣어 뒤 글자와 안 겹친다, 원본 읽기는 그대로', async () => {
    const path = join(env.work, '빈기안문.hwpx');
    writeFileSync(path, Buffer.from(readBuiltinTemplate(resolveBuiltinTemplate('gian')!)));
    // "기안자" 줄의 글자를 x 순으로 이어 읽는다 (겹치면 순서가 뒤섞인다)
    const line = async (b64: string) => {
      const [page] = await rhwpPageSvgs(new Uint8Array(Buffer.from(b64, 'base64')));
      const items = [...page.svg.matchAll(/<text\b([^>]*)>([^<]*)<\/text>/g)].map((m) => ({ x: Number(/\bx="([\d.]+)"/.exec(m[1])?.[1]), y: Math.round(Number(/\by="([\d.]+)"/.exec(m[1])?.[1])), t: m[2] }));
      const rows = [...new Set(items.map((i) => i.y))].map((y) => items.filter((i) => i.y === y).sort((a, b) => a.x - b.x).map((i) => i.t).join('').replace(/\s+/g, ''));
      return rows.find((r) => r.startsWith('기안')) ?? '';
    };
    const raw = await call('read_file_b64', { path });
    expect(Buffer.from(raw.data_b64, 'base64').equals(readFileSync(path))).toBe(true);
    const preview = await call('read_file_b64', { path, preview: true });
    expect(await line(preview.data_b64)).toContain('기안자직위(직급)서명검토자직위(직급)서명결재권자직위(직급)서명');
    expect(await line(raw.data_b64)).not.toContain('기안자직위(직급)서명검토자');
    // 편집기에서 내보낸 바이트도 같은 처리
    const fromEditor = await call('preview_bytes', { data_b64: raw.data_b64 });
    expect(fromEditor.data_b64).toBe(preview.data_b64);
  });
});

describe.skipIf(!hasBrowser)('export_pdf·bundle_pdf (Chromium 필요)', () => {
  it('HWPX → PDF (rhwp 쪽 SVG → Chromium)', async () => {
    const r = await call('export_pdf', { path: LETTER_HWPX });
    const pdf = await PDFDocument.load(readFileSync(r.output_path));
    expect(pdf.getPageCount()).toBe(1);
    expect(Math.round(pdf.getPage(0).getWidth())).toBe(595);
  }, 60_000);

  it('같은 이름이 있으면 (2), 저장 창에서 고른 경로(overwrite)면 그 파일을 바꾼다', async () => {
    const target = join(env.work, '내보낸.pdf');
    writeFileSync(target, 'old');
    const kept = await call('export_pdf', { path: LETTER_HWPX, output_path: target });
    expect(kept.output_path).toBe(join(env.work, '내보낸 (2).pdf'));
    expect(readFileSync(target, 'utf-8')).toBe('old');
    const replaced = await call('export_pdf', { path: LETTER_HWPX, output_path: target, overwrite: true });
    expect(replaced.output_path).toBe(target);
    expect((await PDFDocument.load(readFileSync(target))).getPageCount()).toBe(1);
  }, 60_000);

  it('합본 — HWPX + PDF + 이미지, 워터마크·쪽번호, 실패는 결과 안에', async () => {
    const img = join(env.work, '사진.png');
    writeFileSync(img, await makePng(800, 1100));
    const bad = join(env.work, '깨짐.pdf');
    writeFileSync(bad, 'broken');
    const r = await call('bundle_pdf', { paths: [LETTER_HWPX, LETTER_PDF, img, bad], watermark: '대외비', page_numbers: true });
    expect(r.page_count).toBe(3);
    expect(r.failed).toHaveLength(1);
    expect(r.failed[0].path).toBe(bad);
    expect((await PDFDocument.load(readFileSync(r.output_path))).getPageCount()).toBe(3);
  }, 60_000);
});

describe('PDF 쪽 그림 색', () => {
  it('빨강은 빨강으로 (PDFium bitmap 은 RGBA, BGRA 로 보고 바꾸면 파랑이 됨)', async () => {
    const { rgb } = await import('pdf-lib');
    const sharp = (await import('sharp')).default;
    const { rasterPdfPage } = await import('../src/core/render/pdfium.js');
    const d = await PDFDocument.create();
    d.addPage([100, 100]).drawRectangle({ x: 0, y: 0, width: 100, height: 100, color: rgb(1, 0, 0) });
    const doc = await openPdf(await d.save());
    try {
      const { data } = await sharp((await rasterPdfPage(doc, 1, 100, 'png')).data).raw().toBuffer({ resolveWithObject: true });
      expect([data[0], data[1], data[2]]).toEqual([255, 0, 0]);
    } finally {
      doc.destroy();
    }
  });
});

describe('pdf_stamp·PDF 나누기·합치기 (Chromium 불필요)', () => {
  it('워터마크(영문)·쪽번호', async () => {
    const r = await call('pdf_stamp', { path: LETTER_PDF, watermark: 'COPY', page_numbers: true });
    expect(r.output_path).toMatch(/_워터마크\.pdf$/);
    const doc = await openPdf(new Uint8Array(readFileSync(r.output_path)));
    const text = doc.getPage(0).getText();
    doc.destroy();
    expect(text).toContain('COPY');
    expect(text).toContain('- 1 -');
  });

  it.skipIf(process.platform !== 'darwin' && process.platform !== 'win32')('한글 워터마크 (OS 한글 글꼴 부분 임베드)', async () => {
    const r = await call('pdf_stamp', { path: LETTER_PDF, watermark: '사본' });
    expect(existsSync(r.output_path)).toBe(true);
  });

  it('둘 다 없으면 안내', async () => {
    await expect(call('pdf_stamp', { path: LETTER_PDF })).rejects.toThrow(/워터마크 글자나 쪽번호/);
  });

  it('쪽 수·쪽 뽑기·합치기·나누기', async () => {
    expect((await call('pdf_page_count', { input_path: LETTER_PDF })).page_count).toBe(1);
    const merged = await call('merge_files', { files: [LETTER_PDF, LETTER_PDF], mode: 'native' });
    expect((await PDFDocument.load(readFileSync(merged.output_path))).getPageCount()).toBe(2);
    const picked = await call('pdf_extract_pages', { input_path: merged.output_path, pages: '2' });
    expect(picked.extracted_pages).toBe(1);
    const split = await call('split_pdf', { input_path: merged.output_path });
    expect(split.output_files).toHaveLength(2);
  });

  it('마크다운 합치기', async () => {
    const r = await call('merge_files', { files: [LETTER_HWPX, FORM] });
    expect(r.output_path).toMatch(/_병합\.md$/);
    expect(readFileSync(r.output_path, 'utf-8')).toContain('총무과');
  });
});
