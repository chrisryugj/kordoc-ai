/** 나누기·합치기 결과 이름 — 맥 Finder 경로는 자소가 갈라진(NFD) 이름이라, 그대로 쓰면 윈도에서 "ㅂㅗㄱㅗㅅㅓ_1.hwpx" 처럼 보인다 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';

vi.mock('../src/infra/progress.js', async (orig) => ({ ...(await orig<typeof import('../src/infra/progress.js')>()), sendProgress: vi.fn(), sendNotification: vi.fn() }));

import { splitHangul } from '../src/core/merge/index.js';
import { splitPdf } from '../src/core/merge/concat-pdf.js';
import { concatXlsx } from '../src/core/merge/concat-xlsx.js';
import { sample } from './doc-helpers.js';

const nfd = (s: string) => s.normalize('NFD');
const signal = new AbortController().signal;
let dir: string;
beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'merge-split-names-')); });
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('자소가 갈라진 이름(NFD)으로 나누고 합쳐도 결과 이름은 완성형(NFC)', () => {
  it('한글 나누기: 조각 파일 이름', async () => {
    const src = join(dir, nfd('보고서.hwpx'));
    copyFileSync(sample('4-보고서_디지털 행정 혁신 추진계획.hwpx'), src);
    const r = await splitHangul({ path: src, output_dir: join(dir, 'hwpx') }, signal);
    expect(r.output_files.map((f) => basename(f))).toEqual(['보고서_1.hwpx', '보고서_2.hwpx', '보고서_3.hwpx']);
  }, 60_000);

  it('PDF 나누기: 조각 파일 이름 (대문자 .PDF 도 이름에 남지 않는다)', async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    doc.addPage();
    const src = join(dir, nfd('회의자료.PDF'));
    writeFileSync(src, await doc.save());
    const r = await splitPdf({ file: src, output_dir: join(dir, 'pdf') }, signal);
    expect(r.output_files.map((f) => basename(f))).toEqual(['회의자료_p001.pdf', '회의자료_p002.pdf']);
    const ranged = await splitPdf({ file: src, output_dir: join(dir, 'pdf-range'), mode: 'range', ranges: '1,2' }, signal);
    expect(ranged.output_files.map((f) => basename(f))).toEqual(['회의자료_1.pdf', '회의자료_2.pdf']);
  });

  it('엑셀 합치기: 파일 이름을 딴 시트 이름', async () => {
    const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
    const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    const RELS = (body: string) => `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${body}</Relationships>`;
    const xlsx = async (name: string, v: number) => {
      const zip = new JSZip();
      zip.file('xl/worksheets/sheet1.xml', `${HEAD}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1"><v>${v}</v></c></row></sheetData></worksheet>`);
      zip.file('xl/workbook.xml', `${HEAD}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${REL}"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`);
      zip.file('xl/_rels/workbook.xml.rels', RELS(`<Relationship Id="rId1" Target="worksheets/sheet1.xml" Type="${REL}/worksheet"/><Relationship Id="rId90" Target="styles.xml" Type="${REL}/styles"/>`));
      zip.file('xl/styles.xml', `${HEAD}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"/>`);
      zip.file('[Content_Types].xml', `${HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>`);
      zip.file('_rels/.rels', RELS(`<Relationship Id="rId1" Target="xl/workbook.xml" Type="${REL}/officeDocument"/>`));
      const path = join(dir, nfd(name));
      writeFileSync(path, await zip.generateAsync({ type: 'nodebuffer' }));
      return path;
    };
    const out = join(dir, '합본.xlsx');
    await concatXlsx({ files: [await xlsx('총무과.xlsx', 1), await xlsx('재무과.xlsx', 2)], output_path: out, mode: 'native' }, signal);
    const wb = await (await JSZip.loadAsync(readFileSync(out))).file('xl/workbook.xml')!.async('text');
    expect([...wb.matchAll(/<sheet name="([^"]*)"/g)].map((m) => m[1])).toEqual(['총무과', '재무과']);
  });
});
