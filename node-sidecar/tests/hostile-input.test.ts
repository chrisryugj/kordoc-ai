/** 받은 문서가 일부러 꾸민 꼴이어도 엔진이 멈추지 않는다 — 닫는 태그 없는 여는 태그 수만 개(제곱 시간 정규식), 기본 속성 이름의 누름틀,
 *  문단 수만 개 나누기. 시간 상한은 고치기 전 실측의 몇 분의 일
 *  (고치기 전 같은 시험: 누름틀 2만 개 6.4초, run 없는 누름틀 2만 개 123초, DOCX 32초, XLSX 5.9초, 문단 2만 개 나누기 18초) */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';

vi.mock('../src/infra/progress.js', async (orig) => ({ ...(await orig<typeof import('../src/infra/progress.js')>()), sendProgress: vi.fn(), sendNotification: vi.fn() }));
vi.mock('../src/infra/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { showFieldGuides } from '../src/core/render/guides.js';
import { concatDocx, withDocDefaults } from '../src/core/merge/concat-docx.js';
import { concatXlsx } from '../src/core/merge/concat-xlsx.js';
import { scopeSvgIds } from '../src/core/export/chromium.js';
import { templateFields } from '../src/core/template/index.js';
import { splitHangul } from '../src/core/merge/index.js';
import { splitHwpx } from '../src/core/merge/hwpx-split.js';
import { sample } from './doc-helpers.js';

let dir: string;
beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'kordoc-hostile-')); });
afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

const ms = async (fn: () => Promise<unknown>) => { const t = performance.now(); await fn(); return performance.now() - t; };

const HEADER = '<hh:head xmlns:hh="h"><hh:refList><hh:charProperties itemCnt="1"><hh:charPr id="0" height="1000" textColor="#000000"><hh:spacing hangul="0"/></hh:charPr></hh:charProperties></hh:refList></hh:head>';
const FIELD = (cmd: string) => `<hp:ctrl><hp:fieldBegin id="1" type="CLICK_HERE" name="x"><hp:parameters cnt="1"><hp:stringParam name="Command">${cmd}</hp:stringParam></hp:parameters></hp:fieldBegin></hp:ctrl><hp:ctrl><hp:fieldEnd beginIDRef="1"/></hp:ctrl>`;
const GUIDE = 'Clickhere:set:4:Direction:wstring:2:성명 HelpState:wstring:0: ';

async function hwpx(section: string, header = HEADER): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('mimetype', 'application/hwp+zip', { compression: 'STORE' });
  zip.file('Contents/header.xml', header);
  zip.file('Contents/section0.xml', section);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
const sectionOf = async (b: Uint8Array) => (await JSZip.loadAsync(b)).file('Contents/section0.xml')!.async('string');

describe('미리보기 안내문 넣기 (showFieldGuides)', () => {
  it('마지막 닫는 태그 뒤 여는 누름틀 2만 개: 금방 끝나고 앞의 누름틀은 그대로 채운다', async () => {
    const section = `<hs:sec xmlns:hs="s" xmlns:hp="p"><hp:p><hp:run charPrIDRef="0"><hp:t>담당 </hp:t>${FIELD(GUIDE)}<hp:t> 끝</hp:t></hp:run></hp:p>${'<hp:ctrl><hp:fieldBegin id="1" type="CLICK_HERE" name="x">'.repeat(20_000)}</hs:sec>`;
    const src = await hwpx(section);
    let out!: Uint8Array;
    expect(await ms(async () => { out = await showFieldGuides(src); })).toBeLessThan(1500);
    expect(await sectionOf(out)).toContain('<hp:t>성명</hp:t>');
  });

  it('머리의 닫히지 않는 글자 모양 4만 개도 금방', async () => {
    const header = HEADER.replace('</hh:charProperties>', `</hh:charProperties>${'<hh:charPr id="7" height="1000">'.repeat(40_000)}`);
    const src = await hwpx(`<hs:sec xmlns:hs="s" xmlns:hp="p"><hp:p><hp:run charPrIDRef="0">${FIELD(GUIDE)}</hp:run></hp:p></hs:sec>`, header);
    expect(await ms(() => showFieldGuides(src))).toBeLessThan(1500);
  });

  it('누름틀 앞에 run 이 없는 누름틀 2만 개 (누름틀마다 문서 처음까지 거꾸로 훑지 않는다)', async () => {
    const src = await hwpx(`<hs:sec xmlns:hs="s" xmlns:hp="p"><hp:p>${FIELD(GUIDE).repeat(20_000)}</hp:p></hs:sec>`);
    expect(await ms(() => showFieldGuides(src))).toBeLessThan(2000);
  });

  it('글자 모양이 20만 개인 머리에서도 RangeError 없이', async () => {
    const many = Array.from({ length: 200_000 }, (_, i) => `<hh:charPr id="${i + 1}"></hh:charPr>`).join('');
    const src = await hwpx(`<hs:sec xmlns:hs="s" xmlns:hp="p"><hp:p><hp:run charPrIDRef="0">${FIELD(GUIDE)}</hp:run></hp:p></hs:sec>`, HEADER.replace('</hh:charProperties>', `${many}</hh:charProperties>`));
    const head = await (await JSZip.loadAsync(await showFieldGuides(src))).file('Contents/header.xml')!.async('string');
    expect(head).toContain('<hh:charPr id="200001"');
  }, 20_000);
});

// ─── 서식 유지 합치기 (DOCX·XLSX) ───

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
async function docx(name: string, body: string, styles: string, numbering?: string): Promise<string> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>');
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${W}"><w:body>${body}<w:sectPr/></w:body></w:document>`);
  zip.file('word/_rels/document.xml.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>');
  zip.file('word/styles.xml', styles);
  if (numbering) zip.file('word/numbering.xml', numbering);
  const path = join(dir, name);
  writeFileSync(path, await zip.generateAsync({ type: 'nodebuffer' }));
  return path;
}
const STYLES = (extra = '') => `<?xml version="1.0" encoding="UTF-8"?><w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>${extra}</w:styles>`;

describe('DOCX 합치기: 닫히지 않는 서식·번호 수만 개', () => {
  it('styles·numbering 에 닫는 태그 없는 여는 태그 2만 개씩: 금방 끝나고 본문은 합쳐진다', async () => {
    const a = await docx('a.docx', `<w:p><w:r><w:t>첫 문서</w:t></w:r></w:p>`, STYLES(), `<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="0"><w:nsid w:val="00000001"/></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`);
    const evil = `${'<w:style w:type="paragraph" w:styleId="s">'.repeat(20_000)}`;
    const b = await docx('b.docx', `<w:p><w:r><w:t>둘째 문서</w:t></w:r></w:p>`,
      STYLES(evil).replace('<w:sz w:val="22"/>', `<w:sz w:val="20"/>${'<w:b>'.repeat(20_000)}`),
      `<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="0"/><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>${'<w:abstractNum w:abstractNumId="1">'.repeat(20_000)}${'<w:num w:numId="2">'.repeat(20_000)}</w:numbering>`);
    const out = join(dir, 'ab.docx');
    let r!: Awaited<ReturnType<typeof concatDocx>>;
    expect(await ms(async () => { r = await concatDocx({ files: [a, b], output_path: out, mode: 'native' }, new AbortController().signal); })).toBeLessThan(4000);
    expect(r.failed_files).toEqual([]);
    const doc = await (await JSZip.loadAsync(readFileSync(out))).file('word/document.xml')!.async('string');
    expect(doc).toContain('둘째 문서');
  }, 20_000);

  it('문서 기본값(rPrDefault) 안의 닫히지 않는 요소 2만 개 (withDocDefaults)', async () => {
    const donor = STYLES().replace('<w:sz w:val="22"/>', `<w:sz w:val="20"/>${'<w:i>'.repeat(20_000)}`);
    expect(await ms(async () => { withDocDefaults(donor, STYLES()); })).toBeLessThan(1000);
  });
});

async function xlsx(name: string, sheet: string, shared: string[]): Promise<string> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>');
  zip.file('xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>');
  zip.file('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>');
  zip.file('xl/worksheets/sheet1.xml', `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheet}</sheetData></worksheet>`);
  zip.file('xl/sharedStrings.xml', `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${shared.map((s) => `<si><t>${s}</t></si>`).join('')}</sst>`);
  zip.file('xl/styles.xml', `<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/></font>${'<font a="1">'.repeat(20_000)}</fonts><cellXfs count="1"><xf numFmtId="0"/></cellXfs></styleSheet>`);
  const path = join(dir, name);
  writeFileSync(path, await zip.generateAsync({ type: 'nodebuffer' }));
  return path;
}

describe('XLSX 합치기: 닫히지 않는 칸·글꼴 수만 개', () => {
  it('공유 문자열 칸 뒤에 닫히지 않는 칸 2만 개: 금방 끝나고 앞 칸의 글은 옮긴다', async () => {
    const a = await xlsx('a.xlsx', '<row r="1"><c r="A1" t="s"><v>0</v></c></row>', ['첫 파일']);
    const b = await xlsx('b.xlsx', `<row r="1"><c r="A1" t="s"><v>0</v></c></row>${'<c r="B1" t="s">'.repeat(20_000)}`, ['둘째 파일']);
    const out = join(dir, 'ab.xlsx');
    let r!: Awaited<ReturnType<typeof concatXlsx>>;
    expect(await ms(async () => { r = await concatXlsx({ files: [a, b], output_path: out, mode: 'native' }, new AbortController().signal); })).toBeLessThan(4000);
    expect(r.failed_files).toEqual([]);
    const sheet2 = await (await JSZip.loadAsync(readFileSync(out))).file('xl/worksheets/sheet2.xml')!.async('string');
    expect(sheet2).toContain('<is><t>둘째 파일</t></is>');
  }, 20_000);
});

describe('쪽 SVG id 접두어 (scopeSvgIds)', () => {
  it('id 4만 개 쪽: 금방, 모두 바꾼다 (고치기 전 1.6초: id 를 모두 | 로 묶은 정규식)', () => {
    const id = (i: number) => `k${(Math.imul(i + 1, 2654435761) >>> 0).toString(36)}${i.toString(36)}`;
    const svg = `<svg>${Array.from({ length: 40_000 }, (_, i) => `<clipPath id="${id(i)}"><rect/></clipPath><g clip-path="url(#${id(i)})"/><use href="#${id(i)}"/>`).join('')}</svg>`;
    const t = performance.now();
    const out = scopeSvgIds(svg, 'p0-');
    expect(performance.now() - t).toBeLessThan(500);
    expect(out).toContain(`id="p0-${id(39_999)}"`);
    expect(out).toContain(`url(#p0-${id(39_999)})`);
    expect(out).toContain(`href="#p0-${id(39_999)}"`);
    expect(out).not.toMatch(/url\(#k/);
  });
  it('쪽 글에 적힌 url(# 수만 개는 그대로 두고 금방', () => {
    const svg = `<svg><clipPath id="c1"/><text>${'url(#'.repeat(50_000)}</text><g clip-path="url(#c1)"/></svg>`;
    const t = performance.now();
    const out = scopeSvgIds(svg, 'p0-');
    expect(performance.now() - t).toBeLessThan(500);
    expect(out).toContain('url(#p0-c1)');
    expect(out.split('url(#').length - 1).toBe(50_001);
  });
});

describe('누름틀 이름이 객체 기본 속성 이름', () => {
  it('받은 서식의 누름틀 이름이 constructor·toString 이어도 칸 목록이 나온다 (TypeError 없이)', async () => {
    const zip = await JSZip.loadAsync(readFileSync(sample('1-받은공문_도민체육대회 참가 협조 요청.hwpx')));
    const before = await zip.file('Contents/section0.xml')!.async('string');
    const names = [...before.matchAll(/type="CLICK_HERE"[^>]*\bname="([^"]+)"/g)].map((m) => m[1]);
    expect(names.length).toBeGreaterThanOrEqual(2);
    zip.file('Contents/section0.xml', before.replace(`name="${names[0]}"`, 'name="constructor"').replace(`name="${names[1]}"`, 'name="toString"'));
    const path = join(dir, '서식.hwpx');
    writeFileSync(path, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
    const r = await templateFields({ path });
    expect(r.fields.map((f) => f.name)).toEqual(expect.arrayContaining(['constructor', 'toString']));
  });
});

// ─── 한글 나누기: 문단 수만 개 ───

const SEC_NS = 'xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph"';
const para = (text: string, brk = false) => `<hp:p paraPrIDRef="0" styleIDRef="0" pageBreak="${brk ? 1 : 0}"><hp:run charPrIDRef="0"><hp:t>${text}</hp:t></hp:run></hp:p>`;
async function splitDoc(paras: number, breaks: number): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('mimetype', 'application/hwp+zip', { compression: 'STORE' });
  zip.file('Contents/header.xml', `<hh:head xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head" secCnt="1"><hh:refList/></hh:head>`);
  zip.file('Contents/content.hpf', '<opf:package xmlns:opf="http://www.idpf.org/2007/opf/"><opf:manifest><opf:item id="header" href="Contents/header.xml" media-type="application/xml"/><opf:item id="section0" href="Contents/section0.xml" media-type="application/xml"/></opf:manifest><opf:spine><opf:itemref idref="header" linear="yes"/><opf:itemref idref="section0" linear="yes"/></opf:spine></opf:package>');
  const body = [para('첫 쪽'), ...Array.from({ length: paras }, (_, i) => para(`본문 ${i}`)), ...Array.from({ length: breaks }, (_, i) => para(`쪽 ${i}`, true))].join('');
  zip.file('Contents/section0.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?><hs:sec ${SEC_NS}>${body}</hs:sec>`);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

describe('한글 나누기: 문단이 아주 많은 문서', () => {
  it('문단 2만 개 + 쪽 나눔 2개: 조각마다 구역 전체를 다시 읽지 않아 금방, 조각 글은 그대로', async () => {
    const src = await splitDoc(20_000, 2);
    let r!: Awaited<ReturnType<typeof splitHwpx>>;
    expect(await ms(async () => { r = await splitHwpx(src); })).toBeLessThan(10_000);
    expect(r.parts).toHaveLength(3);
    const first = await sectionOf(r.parts[0]);
    expect(first).toContain('<hp:t>본문 19999</hp:t>');
    expect(first).not.toContain('쪽 0');
    expect(await sectionOf(r.parts[2])).toContain('<hp:t>쪽 1</hp:t>');
  }, 60_000);

  it('멈추면 결과 파일을 하나도 남기지 않는다', async () => {
    const path = join(dir, '나눌문서.hwpx');
    writeFileSync(path, await splitDoc(6000, 3));
    const out = join(dir, '나누기결과');
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 50);
    await expect(splitHangul({ path, output_dir: out }, ac.signal)).rejects.toThrow(/abort/i);
    expect(existsSync(out) ? readdirSync(out) : []).toEqual([]);
  }, 30_000);
});
