/** PDF 작업 화면 엔진 (pdf_open·pdf_thumbs·pdf_compose·pdf_to_images) — 쪽 조립 하나로 합치기·뽑기·순서·돌리기·빈 쪽·나누기 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import sharp from 'sharp';
import { PDFArray, PDFDocument, PDFName, PDFRawStream, StandardFonts, decodePDFRawStream, degrees } from 'pdf-lib';
import { call, corpus, hasCorpus, makePng, setupEnv } from './doc-helpers.js';

vi.mock('../src/infra/progress.js', async (orig) => ({ ...(await orig<typeof import('../src/infra/progress.js')>()), sendProgress: vi.fn(), sendNotification: vi.fn() }));

let env: ReturnType<typeof setupEnv>;
let A: string;
let B: string;
let PNG: string;
beforeAll(async () => {
  env = setupEnv();
  A = await pdf('가.pdf', ['A1', 'A2', 'A3']);
  B = await pdf('나.pdf', ['B1', 'B2'], { rotate: 90, size: [842, 595] });
  PNG = join(env.work, '사진.png');
  writeFileSync(PNG, await makePng(800, 600, 'PHOTO'));
});

/** 쪽마다 글자 하나 (쪽을 구별하려고 문서 제목 칸 대신 쪽 크기·글자로) */
async function pdf(name: string, labels: string[], o: { rotate?: number; size?: [number, number] } = {}): Promise<string> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const label of labels) {
    const page = doc.addPage(o.size ?? [595, 842]);
    page.drawText(label, { x: 60, y: 700, size: 40, font });
    if (o.rotate) page.setRotation(degrees(o.rotate));
  }
  const path = join(env.work, name);
  writeFileSync(path, await doc.save());
  return path;
}

const load = (p: string) => PDFDocument.load(readFileSync(p));
const fonts = (doc: PDFDocument) => doc.context.enumerateIndirectObjects().filter(([, o]) => (o as { get?: (k: PDFName) => unknown }).get?.(PDFName.of('Type'))?.toString() === '/Font').length;

describe('pdf_open', () => {
  it('PDF 는 그대로, 보이는 방향 크기로', async () => {
    const r = await call('pdf_open', { path: B });
    expect(r).toMatchObject({ source: B, converted: false, secured: false, page_count: 2 });
    // /Rotate 90 이라 보이는 방향은 세로
    expect(r.pages[0]).toEqual({ width: 595, height: 842 });
  });

  it('그림은 A4 한 쪽짜리 임시 PDF 로 (같은 파일을 다시 넣으면 다시 쓴다)', async () => {
    const r = await call('pdf_open', { path: PNG });
    expect(r).toMatchObject({ converted: true, secured: false, page_count: 1 });
    expect(r.source).not.toBe(PNG);
    expect(Math.round(r.pages[0].width)).toBe(842);
    expect((await call('pdf_open', { path: PNG })).source).toBe(r.source);
  });

  it('PDF 가 아닌 글자 파일은 손상으로 알리지 않고 바꾼다', async () => {
    const md = join(env.work, '메모.md');
    writeFileSync(md, '# 제목\n\n본문 한 줄');
    const r = await call('pdf_open', { path: md });
    expect(r.converted).toBe(true);
    expect(r.page_count).toBeGreaterThan(0);
  }, 60_000);
});

describe('pdf_thumbs', () => {
  it('고른 쪽만 JPEG 로, 폭은 준 대로', async () => {
    const r = await call('pdf_thumbs', { path: A, pages: '2-3', width: 200 });
    expect(r.page_count).toBe(3);
    expect(r.pages.map((x: { page: number }) => x.page)).toEqual([2, 3]);
    const img = Buffer.from(r.pages[0].data_url.split(',')[1], 'base64');
    expect(r.pages[0].data_url.startsWith('data:image/jpeg;base64,')).toBe(true);
    expect((await sharp(img).metadata()).width).toBe(200);
  });

  it('여러 번 불러도(들고 있는 문서) 같은 결과, 없는 쪽은 뺀다', async () => {
    const a = await call('pdf_thumbs', { path: A, pages: '1', width: 120 });
    const b = await call('pdf_thumbs', { path: A, pages: '1,9', width: 120 });
    expect(b.pages).toHaveLength(1);
    expect(b.pages[0].data_url).toBe(a.pages[0].data_url);
  });
});

describe('pdf_compose', () => {
  it('두 PDF·그림·빈 쪽을 차례대로 한 파일로, 돌린 각은 원래 각에 더한다', async () => {
    const img = (await call('pdf_open', { path: PNG })).source;
    const r = await call('pdf_compose', {
      source: A,
      outputs: [{
        name: '합친 문서',
        pages: [
          { path: B, page: 2 },
          { path: A, page: 3, rotate: 90 },
          { path: A, page: 1 },
          { blank: { width: 595, height: 842 } },
          { path: B, page: 1, rotate: -90 },
          { path: img, page: 1 },
        ],
      }],
    });
    expect(r.outputs).toHaveLength(1);
    expect(r.secured).toEqual([]);
    const out = r.outputs[0];
    expect(basename(out.output_path)).toBe('합친 문서.pdf');
    expect(out.output_path.startsWith(env.out)).toBe(true);
    expect(out.page_count).toBe(6);
    const doc = await load(out.output_path);
    expect(doc.getPages().map((p) => p.getRotation().angle)).toEqual([90, 90, 0, 0, 0, 0]);
    expect(doc.getPages().map((p) => Math.round(p.getWidth()))).toEqual([842, 595, 595, 595, 842, 842]);
    // 한 원본의 쪽은 한 번에 옮겨 글꼴을 쪽마다 따로 싣지 않는다 (가·나 각 한 벌)
    expect(fonts(doc)).toBe(2);
  });

  it('같은 쪽을 두 번 넣어도(복제) 따로 들어간다', async () => {
    const r = await call('pdf_compose', { source: A, outputs: [{ name: '복제', pages: [{ path: A, page: 2 }, { path: A, page: 2, rotate: 180 }] }] });
    const doc = await load(r.outputs[0].output_path);
    expect(doc.getPages().map((p) => p.getRotation().angle)).toEqual([0, 180]);
  });

  it('같은 쪽 여러 번 + 쪽 번호: 쪽마다 제 번호만 (내용 묶음을 같이 쓰지 않음)', async () => {
    const r = await call('pdf_compose', { source: A, page_numbers: true, outputs: [{ name: '복제 쪽번호', pages: [{ path: A, page: 1 }, { path: A, page: 1 }, { path: A, page: 2 }, { path: A, page: 1 }] }] });
    const doc = await load(r.outputs[0].output_path);
    // 쪽 번호 "- n -" 은 Helvetica 글자 코드(16진)로 들어간다
    const label = (n: number) => Buffer.from(`- ${n} -`, 'latin1').toString('hex').toUpperCase();
    const text = (i: number) => {
      const c = doc.getPage(i).node.Contents();
      const refs = c instanceof PDFArray ? c.asArray() : c ? [c] : [];
      return refs.map((ref) => {
        const st = doc.context.lookup(ref);
        return st instanceof PDFRawStream ? Buffer.from(decodePDFRawStream(st).decode()).toString('latin1') : '';
      }).join('\n').toUpperCase();
    };
    for (let i = 0; i < 4; i++) {
      const t = text(i);
      expect([1, 2, 3, 4].filter((n) => t.includes(label(n)))).toEqual([i + 1]);
    }
  });

  it('나누기: 결과 여러 개, 같은 이름은 (2) 로 피하고 원본은 그대로', async () => {
    const before = readFileSync(A);
    const r = await call('pdf_compose', {
      source: A,
      outputs: [
        { name: '가_1', pages: [{ path: A, page: 1 }] },
        { name: '가_1', pages: [{ path: A, page: 2 }, { path: A, page: 3 }] },
      ],
    });
    expect(r.outputs.map((o: { output_path: string }) => basename(o.output_path))).toEqual(['가_1.pdf', '가_1 (2).pdf']);
    expect(r.outputs.map((o: { page_count: number }) => o.page_count)).toEqual([1, 2]);
    expect(readFileSync(A).equals(before)).toBe(true);
  });

  it('고른 폴더에, 쪽 번호·워터마크·용량 줄이기와 함께', async () => {
    const dir = join(env.base, '고른 폴더');
    const r = await call('pdf_compose', { source: A, output_dir: dir, page_numbers: true, watermark: 'COPY', shrink: 'normal', outputs: [{ name: '표시', pages: [{ path: A, page: 1 }, { path: B, page: 1 }] }] });
    expect(r.outputs[0].output_path).toBe(join(dir, '표시.pdf'));
    expect(existsSync(r.outputs[0].output_path)).toBe(true);
    expect(r.outputs[0].bytes).toBe(readFileSync(r.outputs[0].output_path).length);
  });

  it('A4 에 맞추기: 크기가 제각각인 쪽을 보이는 방향대로 A4 세로·가로에', async () => {
    const small = await pdf('영수증.pdf', ['R'], { size: [210, 400] });
    const r = await call('pdf_compose', {
      source: A, fit_a4: true,
      outputs: [{ name: 'A4 맞춤', pages: [{ path: small, page: 1 }, { path: B, page: 1 }, { path: A, page: 2, rotate: 90 }, { blank: { width: 842, height: 595 } }] }],
    });
    const doc = await load(r.outputs[0].output_path);
    expect(doc.getPages().map((p) => [Math.round(p.getWidth()), Math.round(p.getHeight()), p.getRotation().angle])).toEqual([
      [595, 842, 0], [595, 842, 0], [842, 595, 0], [842, 595, 0],
    ]);
    // 그린 결과: 돌린 쪽(가 2쪽 → 가로)은 글자가 있는 윗부분이 오른쪽으로
    const img = await call('pdf_to_images', { path: r.outputs[0].output_path, pages: '3', dpi: 36 });
    const { data, info } = await sharp(readFileSync(img.files[0])).greyscale().raw().toBuffer({ resolveWithObject: true });
    const dark = (x0: number, x1: number) => { let n = 0; for (let y = 0; y < info.height; y++) for (let x = x0; x < x1; x++) if (data[y * info.width + x] < 128) n++; return n; };
    expect(dark(Math.floor(info.width / 2), info.width)).toBeGreaterThan(dark(0, Math.floor(info.width / 2)));
  });

  it('없는 쪽·빈 목록은 알아들을 말로 거절', async () => {
    await expect(call('pdf_compose', { outputs: [{ name: 'x', pages: [{ path: A, page: 4 }] }] })).rejects.toThrow(/없는 쪽입니다 \(4쪽\)/);
    await expect(call('pdf_compose', { outputs: [{ name: 'x', pages: [] }] })).rejects.toThrow(/쪽을 하나 이상/);
    await expect(call('pdf_compose', { outputs: [] })).rejects.toThrow(/쪽을 하나 이상/);
  });
});

describe('pdf_to_images', () => {
  it('쪽마다 그림 파일, dpi 대로 (A4 폭 595pt 를 144dpi 면 1190px)', async () => {
    const r = await call('pdf_to_images', { path: A, pages: '1,3', dpi: 144 });
    expect(basename(r.output_dir)).toBe('가_그림');
    expect(r.files.map((f: string) => basename(f))).toEqual(['가_01.png', '가_03.png']);
    expect((await sharp(readFileSync(r.files[0])).metadata()).width).toBe(1190);
    const hi = await call('pdf_to_images', { path: A, pages: '1', dpi: 300 });
    expect((await sharp(readFileSync(hi.files[0])).metadata()).width).toBe(2479);
    const again = await call('pdf_to_images', { path: A, pages: '2', format: 'jpg', dpi: 72 });
    expect(basename(again.output_dir)).toBe('가_그림 (3)');
    expect(basename(again.files[0])).toBe('가_02.jpg');
  });

  it('작업 화면의 쪽 차례·돌린 각 그대로 (차례 번호로 이름)', async () => {
    const r = await call('pdf_to_images', { source: B, dpi: 72, items: [{ path: A, page: 2, rotate: 90 }, { path: B, page: 1 }] });
    expect(r.files.map((f: string) => basename(f))).toEqual(['나_01.png', '나_02.png']);
    // 가 2쪽(세로 595×842)을 돌려 가로로
    expect((await sharp(readFileSync(r.files[0])).metadata()).width).toBe(842);
  });
});

const SECURED = 'licbyl2/8536495_쌀가공산업 육성 및 쌀 이용 촉진에 관한 법률 시행규칙_전문인력 양성기관 지정신청서.pdf';
describe.skipIf(!hasCorpus(SECURED))('보안 설정 PDF', () => {
  it('열면 secured, 합치면 쪽 그림으로 넣고 알린다', async () => {
    const o = await call('pdf_open', { path: corpus(SECURED) });
    expect(o.secured).toBe(true);
    const r = await call('pdf_compose', { source: A, outputs: [{ name: '보안 섞기', pages: [{ path: A, page: 1 }, { path: corpus(SECURED), page: 1 }] }] });
    expect(r.secured).toEqual([corpus(SECURED)]);
    expect((await load(r.outputs[0].output_path)).getPageCount()).toBe(2);
  }, 60_000);
});
