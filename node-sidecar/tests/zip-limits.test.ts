/** 압축 폭탄 (files/zip-read) — 앱이 JSZip 으로 직접 여는 길도 kordoc 과 같은 상한으로 끊는다.
 *  상한은 KORDOC_MAX_UNZIP_MB 로 줄여(4MB) 작은 파일로 잰다. 고치기 전에는 1.8MB HWPX 하나로 미리보기 안내문 넣기가 RSS 2.4GB 를 쓰고 영어 오류로 죽었다 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDeflateRaw } from 'node:zlib';
import JSZip from 'jszip';
import * as CFB from 'cfb';

vi.mock('../src/infra/progress.js', async (orig) => ({ ...(await orig<typeof import('../src/infra/progress.js')>()), sendProgress: vi.fn(), sendNotification: vi.fn() }));
vi.mock('../src/infra/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { entryText, zipXmlBytes } from '../src/core/files/zip-read.js';
import { showFieldGuides } from '../src/core/render/guides.js';
import { readHwpx } from '../src/core/style/hwpx-read.js';
import { splitHwpx } from '../src/core/merge/hwpx-split.js';
import { mergeFiles } from '../src/core/merge/index.js';
import { concatDocx } from '../src/core/merge/concat-docx.js';
import { concatXlsx } from '../src/core/merge/concat-xlsx.js';
import { seal } from '../src/core/hwpx-tools/index.js';
import { readHwp5 } from '../src/core/hwp-save/hwp5.js';
import { makePng, sample } from './doc-helpers.js';

const TOO_BIG = /너무 커서\(4MB 넘음\)/;
const MB = 1024 * 1024;
let dir: string;
const env = process.env.KORDOC_MAX_UNZIP_MB;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'kordoc-zipbomb-'));
  process.env.KORDOC_MAX_UNZIP_MB = '4';
});
afterAll(() => {
  if (env === undefined) delete process.env.KORDOC_MAX_UNZIP_MB;
  else process.env.KORDOC_MAX_UNZIP_MB = env;
  rmSync(dir, { recursive: true, force: true });
});

const LETTER = sample('1-받은공문_도민체육대회 참가 협조 요청.hwpx');

/** 원본 묶음에서 name 항목을 빈칸 mb 메가바이트(앞에 원래 글)로 바꾼 묶음 */
async function bomb(src: Buffer, name: string, mb: number): Promise<Buffer> {
  const zip = await JSZip.loadAsync(src);
  const head = (await zip.file(name)?.async('string')) ?? '';
  zip.file(name, head + ' '.repeat(mb * MB));
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

/** 중앙 목록·지역 머리의 비압축 크기를 size 로 고쳐 적는다 (거짓 크기) */
function lie(zip: Buffer, name: string, size: number): Buffer {
  const out = Buffer.from(zip);
  const want = Buffer.from(name);
  for (let i = 0; i + 46 < out.length; i++) {
    if (out.readUInt32LE(i) === 0x02014b50 && out.subarray(i + 46, i + 46 + out.readUInt16LE(i + 28)).equals(want)) {
      out.writeUInt32LE(size, i + 24);
      out.writeUInt32LE(size, out.readUInt32LE(i + 42) + 22);
    }
  }
  return out;
}

const elapsed = async (p: Promise<unknown>) => { const t = performance.now(); await p.catch(() => {}); return performance.now() - t; };

describe('entryText (풀며 세기)', () => {
  it('적힌 크기가 상한을 넘으면 풀지 않고 알아들을 오류', async () => {
    const zip = await JSZip.loadAsync(await bomb(readFileSync(LETTER), 'Contents/section0.xml', 6));
    await expect(entryText(zip, 'Contents/section0.xml')).rejects.toMatchObject({ code: 'ZIP_TOO_BIG', message: expect.stringMatching(TOO_BIG) });
  });

  it('적힌 크기를 작게 속인 항목(실제 20MB)은 적힌 만큼 풀고 바로 끊는다', async () => {
    const buf = lie(await bomb(readFileSync(LETTER), 'Contents/section0.xml', 20), 'Contents/section0.xml', 4096);
    const zip = await JSZip.loadAsync(buf);
    const p = entryText(zip, 'Contents/section0.xml');
    await expect(p).rejects.toMatchObject({ code: 'ZIP_TOO_BIG' });
    expect(await elapsed(p)).toBeLessThan(500);
  });

  it('한 묶음에서 푼 양을 합쳐 센다 (3MB 두 항목이면 둘째에서 끊는다)', async () => {
    const z = new JSZip();
    z.file('a.xml', 'a'.repeat(3 * MB));
    z.file('b.xml', 'b'.repeat(3 * MB));
    const zip = await JSZip.loadAsync(await z.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
    expect((await entryText(zip, 'a.xml'))!.length).toBe(3 * MB);
    await expect(entryText(zip, 'b.xml')).rejects.toMatchObject({ code: 'ZIP_TOO_BIG' });
    expect(await entryText(zip, 'none.xml')).toBeUndefined();
  });

  it('zipXmlBytes: 풀지 않고 중앙 목록의 .xml 비압축 크기 합 (ZIP 이 아니면 0)', async () => {
    const z = new JSZip();
    z.file('Contents/section0.xml', 'x'.repeat(5000));
    z.file('Contents/header.xml', 'y'.repeat(300));
    z.file('BinData/image1.png', Buffer.alloc(9000));
    expect(zipXmlBytes(await z.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }))).toBe(5300);
    expect(zipXmlBytes(new Uint8Array(Buffer.from('%PDF-1.7 ...')))).toBe(0);
  });
});

describe('한글 문서를 직접 여는 길', () => {
  it('미리보기 안내문 넣기·서식 읽기·나누기: 폭탄 HWPX 는 한국어 오류로 끊는다', async () => {
    const big = await bomb(readFileSync(LETTER), 'Contents/section0.xml', 6);
    const lying = lie(await bomb(readFileSync(LETTER), 'Contents/section0.xml', 20), 'Contents/section0.xml', 4096);
    for (const b of [big, lying]) {
      await expect(showFieldGuides(new Uint8Array(b))).rejects.toThrow(TOO_BIG);
      await expect(readHwpx(new Uint8Array(b))).rejects.toThrow(TOO_BIG);
      await expect(splitHwpx(new Uint8Array(b))).rejects.toThrow(TOO_BIG);
    }
  });

  it('합치기: 폭탄 파일만 까닭과 함께 빼고 나머지는 합친다', async () => {
    const evil = join(dir, '그림폭탄.hwpx');
    const zip = await JSZip.loadAsync(readFileSync(LETTER));
    zip.file('BinData/big.bmp', Buffer.alloc(6 * MB));
    writeFileSync(evil, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
    const r = await mergeFiles({ files: [LETTER, evil, sample('4-보고서_디지털 행정 혁신 추진계획.hwpx')], output_path: join(dir, '합본.hwpx'), mode: 'native' }, new AbortController().signal);
    expect(r.file_count).toBe(2);
    expect(r.failed).toEqual([{ path: evil, error: expect.stringMatching(TOO_BIG) }]);
  }, 30_000);

  it('도장 찍기: 폭탄 HWPX 는 한국어 오류', async () => {
    const path = join(dir, '도장폭탄.hwpx');
    writeFileSync(path, await bomb(readFileSync(LETTER), 'Contents/section0.xml', 6));
    const img = join(dir, '도장.png');
    writeFileSync(img, await makePng(60, 60, '印'));
    await expect(seal({ path, image_path: img, anchor: '(인)' })).rejects.toThrow(TOO_BIG);
  });
});

describe('DOCX·XLSX 합치기', () => {
  it('본문·시트가 폭탄인 파일은 까닭과 함께 뺀다', async () => {
    const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const docx = async (text: string) => {
      const z = new JSZip();
      z.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
      z.file('word/document.xml', `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p><w:sectPr/></w:body></w:document>`);
      return z.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    };
    const a = join(dir, 'a.docx');
    const b = join(dir, 'b.docx');
    writeFileSync(a, await docx('첫 문서'));
    writeFileSync(b, await bomb(await docx('폭탄'), 'word/document.xml', 6));
    const r = await concatDocx({ files: [a, b, a], output_path: join(dir, 'ab.docx'), mode: 'native' }, new AbortController().signal);
    expect(r.failed).toEqual([{ path: b, error: expect.stringMatching(TOO_BIG) }]);

    const xlsx = async () => {
      const z = new JSZip();
      z.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
      z.file('xl/workbook.xml', '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>');
      z.file('xl/_rels/workbook.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>');
      z.file('xl/worksheets/sheet1.xml', '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData/></worksheet>');
      return z.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    };
    const x = join(dir, 'a.xlsx');
    const y = join(dir, 'b.xlsx');
    writeFileSync(x, await xlsx());
    writeFileSync(y, await bomb(await xlsx(), 'xl/worksheets/sheet1.xml', 6));
    const s = await concatXlsx({ files: [x, y], output_path: join(dir, 'ab.xlsx'), mode: 'native' }, new AbortController().signal);
    expect(s.failed).toEqual([{ path: y, error: expect.stringMatching(TOO_BIG) }]);
  });
});

describe('HWP 저장 보정 (hwp5)', () => {
  it('구역 하나가 풀면 256MB 를 넘는 HWP 는 다 풀기 전에 한국어 오류', async () => {
    // 0 으로 300MB → 압축하면 300KB 남짓
    const z = createDeflateRaw();
    const chunks: Buffer[] = [];
    z.on('data', (c: Buffer) => chunks.push(c));
    const done = new Promise((r) => z.on('end', r));
    const mb = Buffer.alloc(MB);
    for (let i = 0; i < 300; i++) if (!z.write(mb)) await new Promise((r) => z.once('drain', r));
    z.end();
    await done;
    const cfb = CFB.utils.cfb_new();
    const header = Buffer.alloc(256);
    header.write('HWP Document File', 0);
    header.writeUInt32LE(1, 36); // 압축
    CFB.utils.cfb_add(cfb, '/FileHeader', header);
    CFB.utils.cfb_add(cfb, '/BodyText/Section0', Buffer.concat(chunks));
    const bytes = new Uint8Array(CFB.write(cfb, { type: 'buffer' }) as Buffer);
    expect(() => readHwp5(bytes)).toThrow(/문서 본문을 풀면 너무 커서\(구역 하나가 256MB 넘음\)/);
  }, 30_000);
});
