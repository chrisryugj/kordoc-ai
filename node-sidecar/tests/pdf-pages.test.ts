/** PDF 작업 화면 엔진 (pdf_open·pdf_thumbs·pdf_compose·pdf_to_images) — 쪽 조립 하나로 합치기·뽑기·순서·돌리기·빈 쪽·나누기 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { basename, join } from 'node:path';
import sharp from 'sharp';
import {
  PDFArray, PDFDocument, PDFName, PDFRawStream, StandardFonts, concatTransformationMatrix, decodePDFRawStream, degrees, fill, rectangle, setFillingGrayscaleColor,
} from 'pdf-lib';
import { call, corpus, hasCorpus, makePng, setupEnv } from './doc-helpers.js';
import { pdfCompose } from '../src/core/pdf-pages/index.js';
import { capScale, MAX_PIXELS, rasterPdfPage } from '../src/core/render/pdfium.js';

vi.mock('../src/infra/progress.js', async (orig) => ({ ...(await orig<typeof import('../src/infra/progress.js')>()), sendProgress: vi.fn(), sendNotification: vi.fn() }));
// 보안 PDF 를 몇 쪽 그리는지 센다 (그리는 일은 그대로)
vi.mock('../src/core/render/pdfium.js', async (orig) => {
  const m = await orig<typeof import('../src/core/render/pdfium.js')>();
  return { ...m, rasterPdfPage: vi.fn(m.rasterPdfPage) };
});

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

describe('A4 에 맞추기 — 입력 칸·체크·메모 (8차 M8)', () => {
  /** 72dpi 그림의 [x0,x1)×[y0,y1) (위에서부터 px) 안 어두운 점 수 */
  async function ink(pdfPath: string, box: [number, number, number, number]) {
    const img = await call('pdf_to_images', { path: pdfPath, pages: '1', dpi: 72 });
    const { data, info } = await sharp(readFileSync(img.files[0])).greyscale().raw().toBuffer({ resolveWithObject: true });
    let n = 0;
    for (let y = box[2]; y < box[3]; y++) for (let x = box[0]; x < box[1]; x++) if (data[y * info.width + x] < 128) n++;
    return n;
  }

  it('값·체크·메모를 쪽에 그려 넣고, 굳힌 것·못 넣은 것·링크를 알린다', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([500, 700]);
    const form = doc.getForm();
    const name = form.createTextField('applicant');
    name.setText('HONG GILDONG');
    name.addToPage(page, { x: 130, y: 550, width: 250, height: 28, font });
    const chk = form.createCheckBox('agree');
    chk.addToPage(page, { x: 130, y: 430, width: 24, height: 24 });
    chk.check();
    // 모양 상자(BBox)가 원점에서 떨어진 메모: 검은 상자가 Rect 를 꽉 채워야 한다
    const ap = doc.context.register(doc.context.formXObject([setFillingGrayscaleColor(0), rectangle(10, 10, 100, 20), fill()], { BBox: [10, 10, 110, 30] }));
    page.node.addAnnot(doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'FreeText', Rect: [50, 100, 250, 140], AP: { N: ap } })));
    page.node.addAnnot(doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [50, 200, 150, 220] })));
    page.node.addAnnot(doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Text', Rect: [400, 600, 420, 620] }))); // 모양 없는 메모
    // 쪽 내용이 좌표계를 옮긴 채(q/Q 없이 cm) 끝나도 주석 자리는 밀리지 않아야 한다
    page.pushOperators(concatTransformationMatrix(1, 0, 0, 1, 1000, 1000));
    const src = join(env.work, 'form-fit.pdf');
    writeFileSync(src, await doc.save());

    const plain = await call('pdf_compose', { source: src, outputs: [{ name: 'form-plain', pages: [{ path: src, page: 1 }] }] });
    expect(plain.outputs[0].notice).toBeUndefined();
    const r = await call('pdf_compose', { source: src, fit_a4: true, outputs: [{ name: 'form-fit', pages: [{ path: src, page: 1 }] }] });
    const out = r.outputs[0].output_path;
    // 500×700 → A4: 1.1906배, 위아래 4.25pt 띄움. 72dpi 그림이라 1px = 1pt, y 는 위에서부터
    expect(await ink(out, [160, 440, 155, 180])).toBeGreaterThan(30); // 이름 칸 글자
    expect(await ink(out, [160, 178, 302, 321])).toBeGreaterThan(5); // 체크 표시
    const memo = await ink(out, [70, 290, 680, 710]);
    expect(memo).toBeGreaterThan(220 * 30 * 0.9); // 메모 상자가 Rect 를 채움
    expect(r.outputs[0].notice).toMatch(/입력 칸·메모 3개는 A4에 맞추며 쪽에 그려 넣어/);
    expect(r.outputs[0].notice).toMatch(/모양 정보가 없는 입력 칸·메모 1개는 결과에 들어가지 않았습니다/);
    expect(r.outputs[0].notice).toMatch(/링크 1개/);
  });

  it('같은 쪽을 두 번 넣어도 주석은 한 번만 세어 알린다', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([400, 400]);
    const ap = doc.context.register(doc.context.formXObject([setFillingGrayscaleColor(0), rectangle(0, 0, 10, 10), fill()], { BBox: [0, 0, 10, 10] }));
    page.node.addAnnot(doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Square', Rect: [100, 100, 200, 200], AP: { N: ap } })));
    const src = join(env.work, 'form-twice.pdf');
    writeFileSync(src, await doc.save());
    const r = await call('pdf_compose', { source: src, fit_a4: true, outputs: [{ name: 'twice', pages: [{ path: src, page: 1 }, { path: src, page: 1 }] }] });
    const out = await load(r.outputs[0].output_path);
    expect(out.getPageCount()).toBe(2);
    expect(r.outputs[0].notice).toMatch(/입력 칸·메모 1개는/);
  });
});

/** 열기 암호 없이 보안(RC4 40비트, 표준 보안 R2)만 건 PDF — 쪽마다 "Pn". pdf-lib 은 못 열고 PDFium 은 연다 */
function securedPdf(pages: number): Buffer {
  const PAD = Buffer.from('28BF4E5E4E758A4164004E56FFFA01082E2E00B6D0683E802F0CA9FE6453697A', 'hex');
  const md5 = (...b: Buffer[]) => createHash('md5').update(Buffer.concat(b)).digest();
  const rc4 = (key: Buffer, data: Buffer) => {
    const s = Array.from({ length: 256 }, (_, i) => i);
    for (let i = 0, j = 0; i < 256; i++) { j = (j + s[i] + key[i % key.length]) & 255; [s[i], s[j]] = [s[j], s[i]]; }
    const out = Buffer.alloc(data.length);
    for (let k = 0, i = 0, j = 0; k < data.length; k++) { i = (i + 1) & 255; j = (j + s[i]) & 255; [s[i], s[j]] = [s[j], s[i]]; out[k] = data[k] ^ s[(s[i] + s[j]) & 255]; }
    return out;
  };
  const id = Buffer.from('0123456789abcdef0123456789abcdef', 'hex');
  const P = -3904;
  const O = rc4(md5(PAD).subarray(0, 5), PAD);
  const p4 = Buffer.alloc(4);
  p4.writeInt32LE(P);
  const key = md5(PAD, O, p4, id).subarray(0, 5);
  const parts: Buffer[] = [Buffer.from('%PDF-1.4\n')];
  const offsets: number[] = [];
  let len = parts[0].length;
  const add = (num: number, body: string | Buffer) => {
    offsets[num] = len;
    const b = Buffer.concat([Buffer.from(`${num} 0 obj\n`), Buffer.isBuffer(body) ? body : Buffer.from(body, 'latin1'), Buffer.from('\nendobj\n')]);
    parts.push(b);
    len += b.length;
  };
  add(1, '<< /Type /Catalog /Pages 2 0 R >>');
  add(2, `<< /Type /Pages /Kids [${Array.from({ length: pages }, (_, i) => `${5 + 2 * i} 0 R`).join(' ')}] /Count ${pages} >>`);
  add(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  add(4, `<< /Filter /Standard /V 1 /R 2 /O <${O.toString('hex')}> /U <${rc4(key, PAD).toString('hex')}> /P ${P} >>`);
  for (let i = 0; i < pages; i++) {
    const n = 6 + 2 * i;
    const enc = rc4(md5(key, Buffer.from([n & 255, (n >> 8) & 255, (n >> 16) & 255, 0, 0])).subarray(0, 10), Buffer.from(`BT /F1 40 Tf 60 700 Td (P${i + 1}) Tj ET`));
    add(5 + 2 * i, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${n} 0 R >>`);
    add(n, Buffer.concat([Buffer.from(`<< /Length ${enc.length} >>\nstream\n`), enc, Buffer.from('\nendstream')]));
  }
  const size = 5 + 2 * pages;
  let tail = `xref\n0 ${size}\n0000000000 65535 f \n`;
  for (let k = 1; k < size; k++) tail += `${String(offsets[k]).padStart(10, '0')} 00000 n \n`;
  tail += `trailer\n<< /Size ${size} /Root 1 0 R /Encrypt 4 0 R /ID [<${id.toString('hex')}> <${id.toString('hex')}>] >>\nstartxref\n${len}\n%%EOF\n`;
  return Buffer.concat([...parts, Buffer.from(tail, 'latin1')]);
}

describe('보안 설정 PDF — 쓰는 쪽만 그리고 취소가 먹는다 (8차 M9)', () => {
  const raster = vi.mocked(rasterPdfPage);
  let SEC: string;
  beforeAll(() => {
    SEC = join(env.work, 'secured12.pdf');
    writeFileSync(SEC, securedPdf(12));
  });

  it('12쪽 가운데 한 쪽만 쓰면 그 쪽만 그린다', async () => {
    raster.mockClear();
    const r = await call('pdf_compose', { source: A, outputs: [{ name: 'sec-one', pages: [{ path: SEC, page: 3 }] }] });
    expect(r.secured).toEqual([SEC]);
    expect(raster).toHaveBeenCalledTimes(1);
    expect(raster.mock.calls[0][1]).toBe(3);
    expect((await load(r.outputs[0].output_path)).getPageCount()).toBe(1);
  });

  it('그리는 중에 취소하면 다음 쪽에서 멈추고 결과 파일을 쓰지 않는다', async () => {
    const actual = await vi.importActual<typeof import('../src/core/render/pdfium.js')>('../src/core/render/pdfium.js');
    const dir = join(env.base, 'sec-cancel');
    const ac = new AbortController();
    raster.mockClear();
    raster.mockImplementationOnce(async (...a) => { ac.abort(); return actual.rasterPdfPage(...a); });
    const all = Array.from({ length: 12 }, (_, i) => ({ path: SEC, page: i + 1 }));
    await expect(pdfCompose({ output_dir: dir, source: SEC, outputs: [{ name: 'sec-all', pages: all }] }, ac.signal)).rejects.toThrow(/abort/i);
    expect(raster).toHaveBeenCalledTimes(1);
    expect(existsSync(join(dir, 'sec-all.pdf'))).toBe(false);
  });

  it('마지막 쪽을 그린 뒤 취소해도 파일을 쓰지 않는다 (쓰기 앞에서 다시 본다)', async () => {
    const actual = await vi.importActual<typeof import('../src/core/render/pdfium.js')>('../src/core/render/pdfium.js');
    const dir = join(env.base, 'sec-cancel2');
    const ac = new AbortController();
    raster.mockImplementationOnce(async (...a) => { const r = await actual.rasterPdfPage(...a); ac.abort(); return r; });
    await expect(pdfCompose({ output_dir: dir, source: SEC, outputs: [{ name: 'sec-last', pages: [{ path: SEC, page: 1 }] }] }, ac.signal)).rejects.toThrow(/abort/i);
    expect(existsSync(join(dir, 'sec-last.pdf'))).toBe(false);
  });
});

describe('PDF 작업 임시 사본이 지워졌을 때 (셸 3-4)', () => {
  it('원래 파일에서 다시 만들어 쪽 조립·쪽 그림이 된다', async () => {
    const png = join(env.work, 'restore1.png');
    writeFileSync(png, await makePng(400, 300, 'R1'));
    const { source } = await call('pdf_open', { path: png });
    rmSync(source);
    const r = await call('pdf_compose', { source: png, outputs: [{ name: 'restored', pages: [{ path: source, page: 1 }] }] });
    expect(r.outputs[0].page_count).toBe(1);
    expect(existsSync(source)).toBe(true);
    rmSync(source);
    expect((await call('pdf_thumbs', { path: source, pages: '1', width: 100 })).pages).toHaveLength(1);
  });

  it('엔진을 다시 켜도(사본 옆 .src) 다시 만들고, 원래 파일이 바뀌었거나 없으면 다시 넣게 한다', async () => {
    const png = join(env.work, 'restore2.png');
    writeFileSync(png, await makePng(400, 300, 'R2'));
    const { source } = await call('pdf_open', { path: png });
    rmSync(source);
    vi.resetModules(); // 원래 파일을 기억한 엔진 메모리를 비운다
    const fresh = await import('../src/core/pdf-pages/index.js');
    const one = (name: string) => ({ output_dir: env.out, source: png, outputs: [{ name, pages: [{ path: source, page: 1 }] }] });
    const signal = new AbortController().signal;
    expect((await fresh.pdfCompose(one('restart'), signal)).outputs[0].page_count).toBe(1);
    rmSync(source);
    writeFileSync(png, await makePng(500, 300, 'R2 changed'));
    await expect(fresh.pdfCompose(one('changed'), signal)).rejects.toThrow(/그 사이 바뀌었습니다/);
    rmSync(png);
    await expect(fresh.pdfCompose(one('gone'), signal)).rejects.toThrow(/찾을 수 없습니다/);
  });
});

describe('아주 큰 쪽 그림 (2A0 300dpi)', () => {
  it('sharp 화소 상한을 넘으면 해상도를 낮춘다 (PDFium 처럼 폭·높이를 내림해 셈)', () => {
    const [w, h] = [1189 / 25.4 * 72, 1682 / 25.4 * 72];
    const want = 300 / 72;
    expect(Math.floor(Math.floor(w) * want) * Math.floor(Math.floor(h) * want)).toBeGreaterThan(MAX_PIXELS);
    const s = capScale(w, h, want);
    expect(s).toBeLessThan(want);
    expect(Math.floor(Math.floor(w) * s) * Math.floor(Math.floor(h) * s)).toBeLessThanOrEqual(MAX_PIXELS);
    expect(capScale(595, 842, want)).toBe(want); // A4 는 그대로
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
