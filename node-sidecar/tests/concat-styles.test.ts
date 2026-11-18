/** 서식 유지 합치기 — 서식에 걸린 번호(워드), 서식이 많은 파일·관계 id·표시 형식·칸 안 일부 서식·숨긴 시트·못 읽는 파일(엑셀) */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';
import { DOMParser } from '@xmldom/xmldom';

vi.mock('../src/infra/progress.js', () => ({ sendProgress: vi.fn() }));
vi.mock('../src/infra/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { concatDocx } from '../src/core/merge/concat-docx.js';
import { concatXlsx } from '../src/core/merge/concat-xlsx.js';

const signal = new AbortController().signal;
let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'concat-styles-')); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const RELS = (body: string) => `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${body}</Relationships>`;

function wellFormed(xml: string): boolean {
  let bad = false;
  new DOMParser({ onError: () => { bad = true; } }).parseFromString(xml, 'text/xml');
  return !bad;
}

// ─── 워드 ──────────────────────────────────────────────

describe('워드 합치기 — 서식에 걸린 번호', () => {
  it('번호가 제목 서식에 걸린 같은 서식 두 문서: 뒤 문서 제목은 자기 번호 목록을 써서 1. 부터 다시 시작한다', async () => {
    const heading = '<w:style w:type="paragraph" w:styleId="1"><w:name w:val="heading 1"/><w:basedOn w:val="a"/><w:pPr><w:numPr><w:numId w:val="1"/></w:numPr><w:outlineLvl w:val="0"/></w:pPr></w:style>'
      + '<w:style w:type="paragraph" w:styleId="2"><w:name w:val="heading 2"/><w:basedOn w:val="1"/><w:pPr><w:numPr><w:ilvl w:val="1"/><w:numId w:val="1"/></w:numPr></w:pPr></w:style>';
    const numbering = '<w:abstractNum w:abstractNumId="0"><w:nsid w:val="1A2B3C4D"/><w:multiLevelType w:val="multilevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:pStyle w:val="1"/><w:lvlText w:val="%1."/></w:lvl><w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:pStyle w:val="2"/><w:lvlText w:val="%1.%2"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>';
    const body = (who: string) => ['추진 배경', '추진 계획'].map((t) => `<w:p><w:pPr><w:pStyle w:val="1"/></w:pPr><w:r><w:t>${who} ${t}</w:t></w:r></w:p>`).join('')
      + `<w:p><w:pPr><w:pStyle w:val="2"/><w:jc w:val="left"/></w:pPr><w:r><w:t>${who} 세부</w:t></w:r></w:p><w:p><w:r><w:t>${who} 본문</w:t></w:r></w:p>`;
    const docx = async (name: string, who: string) => {
      const zip = new JSZip();
      zip.file('word/document.xml', `${HEAD}<w:document xmlns:w="${W}" xmlns:r="${REL}"><w:body>${body(who)}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>`);
      zip.file('word/styles.xml', `${HEAD}<w:styles xmlns:w="${W}"><w:style w:type="paragraph" w:default="1" w:styleId="a"><w:name w:val="Normal"/></w:style>${heading}</w:styles>`);
      zip.file('word/numbering.xml', `${HEAD}<w:numbering xmlns:w="${W}">${numbering}</w:numbering>`);
      zip.file('word/_rels/document.xml.rels', RELS(`<Relationship Id="rId1" Type="${REL}/styles" Target="styles.xml"/><Relationship Id="rId2" Type="${REL}/numbering" Target="numbering.xml"/>`));
      zip.file('[Content_Types].xml', `${HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
      const path = join(dir, name);
      await writeFile(path, Buffer.from(await zip.generateAsync({ type: 'arraybuffer' })));
      return path;
    };
    const out = join(dir, 'out.docx');
    await concatDocx({ files: [await docx('a.docx', '총무과'), await docx('b.docx', '회계과')], output_path: out, mode: 'native' }, signal);
    const zip = await JSZip.loadAsync(await readFile(out));
    const doc = await zip.file('word/document.xml')!.async('text');
    const num = await zip.file('word/numbering.xml')!.async('text');
    expect(wellFormed(doc)).toBe(true);
    const para = (text: string) => [...doc.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)].map((m) => m[0]).find((p) => p.includes(text))!;
    // 첫 문서는 그대로 (서식의 번호를 따른다)
    expect(para('총무과 추진 배경')).not.toContain('<w:numId');
    // 뒤 문서: 서식은 첫 문서 서식(같은 정의) 그대로, 번호는 자기 목록(합본의 새 numId) → 그 목록은 뒤 문서의 번호 정의를 가리킨다
    const restarted = para('회계과 추진 배경').match(/<w:numPr><w:ilvl w:val="0"\/><w:numId w:val="(\d+)"\/><\/w:numPr>/);
    expect(restarted).not.toBeNull();
    const newNum = restarted![1];
    expect(newNum).not.toBe('1');
    expect(para('회계과 추진 배경')).toContain('<w:pStyle w:val="1"/>');
    expect(para('회계과 추진 계획')).toContain(`<w:numId w:val="${newNum}"/>`);
    // 둘째 수준 제목은 서식의 수준(1)으로, 문단 속성 차례는 규격대로(pStyle → numPr → jc)
    expect(para('회계과 세부')).toMatch(new RegExp(`<w:pPr><w:pStyle w:val="2"/><w:numPr><w:ilvl w:val="1"/><w:numId w:val="${newNum}"/></w:numPr><w:jc w:val="left"/></w:pPr>`));
    // 번호 없는 본문은 그대로
    expect(para('회계과 본문')).not.toContain('<w:numPr>');
    const abstract = num.match(new RegExp(`<w:num w:numId="${newNum}"><w:abstractNumId w:val="(\\d+)"/>`))?.[1];
    expect(abstract).toBeDefined();
    expect(abstract).not.toBe('0');
    expect(num).toMatch(new RegExp(`<w:abstractNum w:abstractNumId="${abstract}">`));
  });
});

// ─── 엑셀 ──────────────────────────────────────────────

interface Book { sheets?: Array<{ name: string; xml: string; state?: string }>; styles?: string; strings?: string; bookViews?: string; extraRels?: string }

async function xlsx(path: string, b: Book): Promise<string> {
  const sheets = b.sheets ?? [{ name: 'Sheet1', xml: '<sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData>' }];
  const zip = new JSZip();
  sheets.forEach((s, i) => zip.file(`xl/worksheets/sheet${i + 1}.xml`, `${HEAD}<worksheet xmlns="${MAIN}" xmlns:r="${REL}">${s.xml}</worksheet>`));
  zip.file('xl/workbook.xml', `${HEAD}<workbook xmlns="${MAIN}" xmlns:r="${REL}">${b.bookViews ?? ''}<sheets>${sheets.map((s, i) => `<sheet name="${s.name}" sheetId="${i + 1}"${s.state ? ` state="${s.state}"` : ''} r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`);
  const n = sheets.length;
  zip.file('xl/_rels/workbook.xml.rels', RELS(sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
    + `<Relationship Id="rId${n + 1}" Type="${REL}/styles" Target="styles.xml"/>${b.strings ? `<Relationship Id="rId${n + 2}" Type="${REL}/sharedStrings" Target="sharedStrings.xml"/>` : ''}${b.extraRels ?? ''}`));
  zip.file('xl/styles.xml', b.styles ?? `${HEAD}<styleSheet xmlns="${MAIN}"/>`);
  if (b.strings) zip.file('xl/sharedStrings.xml', `${HEAD}<sst xmlns="${MAIN}">${b.strings}</sst>`);
  zip.file('[Content_Types].xml', `${HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>`);
  zip.file('_rels/.rels', RELS(`<Relationship Id="rId1" Target="xl/workbook.xml" Type="${REL}/officeDocument"/>`));
  await writeFile(path, Buffer.from(await zip.generateAsync({ type: 'arraybuffer' })));
  return path;
}

/** 셀 서식 n 개 (shift 가 다르면 서식이 모두 다른 파일) */
const manyStyles = (n: number, shift = 0) => {
  const fonts = Array.from({ length: 100 }, (_, i) => `<font><sz val="${8 + ((i + shift) % 40)}"/><color rgb="FF${(((i + shift) * 4099) % 0xffffff).toString(16).padStart(6, '0').toUpperCase()}"/><name val="맑은 고딕"/></font>`);
  const xfs = Array.from({ length: n }, (_, i) => `<xf numFmtId="${i % 20}" fontId="${(i * 7) % 100}" fillId="${i % 2}" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="${['left', 'center', 'right'][i % 3]}" indent="${(i + shift) % 250}" wrapText="1"/></xf>`);
  return `${HEAD}<styleSheet xmlns="${MAIN}"><fonts count="${fonts.length}">${fonts.join('')}</fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${xfs.length}">${xfs.join('')}</cellXfs><dxfs count="0"/></styleSheet>`;
};

const read = async (out: string, part: string) => (await JSZip.loadAsync(await readFile(out))).file(part)!.async('text');

describe('엑셀 합치기 — 서식이 많은 파일', () => {
  it('셀 서식 3천 개짜리 파일 다섯을 멈추지 않고 합치고, 같은 서식은 하나로 모은다', async () => {
    const same = await Promise.all([0, 1, 2, 3, 4].map((i) => xlsx(join(dir, `same${i}.xlsx`), { styles: manyStyles(3000) })));
    const t = Date.now();
    const out = join(dir, 'same.xlsx');
    await concatXlsx({ files: same, output_path: out, mode: 'native' }, signal);
    // 고치기 전에는 41초(같은 서식)·193초(파일마다 다른 서식) 걸렸다. 넉넉히 잡는다
    expect(Date.now() - t).toBeLessThan(5000);
    expect((await read(out, 'xl/styles.xml')).match(/<cellXfs count="(\d+)"/)?.[1]).toBe('3000');

    const lastStyle = [{ name: 'Sheet1', xml: '<sheetData><row r="1"><c r="A1" s="2999"><v>1</v></c></row></sheetData>' }];
    const differ = await Promise.all([0, 1].map((i) => xlsx(join(dir, `diff${i}.xlsx`), { styles: manyStyles(3000, i * 13), sheets: lastStyle })));
    const t2 = Date.now();
    const out2 = join(dir, 'diff.xlsx');
    await concatXlsx({ files: differ, output_path: out2, mode: 'native' }, signal);
    expect(Date.now() - t2).toBeLessThan(5000);
    const styles = await read(out2, 'xl/styles.xml');
    expect(Number(styles.match(/<cellXfs count="(\d+)"/)?.[1])).toBeGreaterThan(3000);
    // 둘째 파일의 칸 서식 번호는 첫 파일 서식 뒤, 합본 목록 안
    const s = Number((await read(out2, 'xl/worksheets/sheet2.xml')).match(/\bs="(\d+)"/)?.[1]);
    expect(s).toBeGreaterThanOrEqual(3000);
    expect(s).toBeLessThan(Number(styles.match(/<cellXfs count="(\d+)"/)?.[1]));
  }, 30_000);
});

describe('엑셀 합치기 — 관계 id·표시 형식·칸 안 일부 서식', () => {
  it('첫 파일 시트가 100개여도 시트 관계 id 가 서식·공유 문자열 관계 id 와 겹치지 않는다', async () => {
    const sheets = Array.from({ length: 100 }, (_, i) => ({ name: `S${i + 1}`, xml: `<sheetData><row r="1"><c r="A1"><v>${i}</v></c></row></sheetData>` }));
    const a = await xlsx(join(dir, 'a.xlsx'), { sheets, strings: '<si><t>가</t></si>' });
    const b = await xlsx(join(dir, 'b.xlsx'), {});
    const out = join(dir, 'out.xlsx');
    await concatXlsx({ files: [a, b], output_path: out, mode: 'native' }, signal);
    const rels = await read(out, 'xl/_rels/workbook.xml.rels');
    const ids = [...rels.matchAll(/\bId="([^"]*)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(103);
    expect(rels).toMatch(/Id="rId101" Type="[^"]*\/styles"/);
    const wb = await read(out, 'xl/workbook.xml');
    const sheetIds = [...wb.matchAll(/<sheet [^>]*r:id="([^"]*)"/g)].map((m) => m[1]);
    expect(sheetIds).toHaveLength(101);
    for (const id of sheetIds) expect(rels).toMatch(new RegExp(`Id="${id}" Target="worksheets/`));
  });

  it('표시 형식의 $$ 와 $1 이 그대로 남는다', async () => {
    const fmt = (code: string) => `${HEAD}<styleSheet xmlns="${MAIN}"><numFmts count="1"><numFmt numFmtId="164" formatCode="${code}"/></numFmts><fonts count="1"><font><sz val="11"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" applyNumberFormat="1"/></cellXfs></styleSheet>`;
    const a = await xlsx(join(dir, 'a.xlsx'), { styles: fmt('&quot;$$&quot;#,##0') });
    const b = await xlsx(join(dir, 'b.xlsx'), { styles: fmt('[$$-409]#,##0.00;$1') });
    const out = join(dir, 'out.xlsx');
    await concatXlsx({ files: [a, b], output_path: out, mode: 'native' }, signal);
    const styles = await read(out, 'xl/styles.xml');
    expect(styles).toContain('formatCode="&quot;$$&quot;#,##0"');
    expect(styles).toContain('formatCode="[$$-409]#,##0.00;$1"');
  });

  it('뒤 파일 칸 안의 일부 서식(서식 있는 글)과 앞뒤 빈칸을 지킨다', async () => {
    const rich = '<si><r><rPr><b/><sz val="11"/><color rgb="FFFF0000"/><rFont val="맑은 고딕"/></rPr><t>긴급</t></r><r><t xml:space="preserve"> 회신 바람</t></r></si>';
    const a = await xlsx(join(dir, 'a.xlsx'), {});
    const b = await xlsx(join(dir, 'b.xlsx'), {
      strings: `${rich}<si><t xml:space="preserve"> 앞 빈칸</t></si><si><t>A&amp;B</t><rPh sb="0" eb="1"><t>에이</t></rPh></si>`,
      sheets: [{ name: 'Sheet1', xml: '<sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row></sheetData>' }],
    });
    const out = join(dir, 'out.xlsx');
    await concatXlsx({ files: [a, b], output_path: out, mode: 'native' }, signal);
    const sheet = await read(out, 'xl/worksheets/sheet2.xml');
    expect(wellFormed(sheet)).toBe(true);
    expect(sheet).toContain('<c r="A1" t="inlineStr"><is><r><rPr><b/><sz val="11"/><color rgb="FFFF0000"/><rFont val="맑은 고딕"/></rPr><t>긴급</t></r><r><t xml:space="preserve"> 회신 바람</t></r></is></c>');
    expect(sheet).toContain('<c r="B1" t="inlineStr"><is><t xml:space="preserve"> 앞 빈칸</t></is></c>');
    // 서식 없는 글은 글만 (읽는 법 표기는 본문이 아니다)
    expect(sheet).toContain('<c r="C1" t="inlineStr"><is><t>A&amp;B</t></is></c>');
  });
});

describe('엑셀 합치기 — 숨긴 시트', () => {
  const book = (bookViews?: string): Book => ({
    bookViews,
    sheets: [
      { name: '숨김', state: 'hidden', xml: '<sheetViews><sheetView tabSelected="1" workbookViewId="0"/></sheetViews><sheetData><row r="1"><c r="A1"><v>9</v></c></row></sheetData>' },
      { name: '보임', xml: '<sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData>' },
    ],
  });

  it('첫 파일의 첫 시트가 숨긴 시트면 보이는 시트를 열고 선택한다. 숨긴 시트는 숨긴 채로', async () => {
    for (const bookViews of ['<bookViews><workbookView activeTab="0" xWindow="0"/></bookViews>', undefined]) {
      const a = await xlsx(join(dir, 'a.xlsx'), book(bookViews));
      const b = await xlsx(join(dir, 'b.xlsx'), {});
      const out = join(dir, 'out.xlsx');
      await concatXlsx({ files: [a, b], output_path: out, mode: 'native' }, signal);
      const wb = await read(out, 'xl/workbook.xml');
      expect(wellFormed(wb)).toBe(true);
      expect(wb).toMatch(/<workbookView activeTab="1"/);
      expect(wb).toMatch(/<bookViews>[\s\S]*<\/bookViews><sheets>/);
      expect(wb).toMatch(/<sheet name="숨김" sheetId="1" state="hidden"/);
      expect(await read(out, 'xl/worksheets/sheet1.xml')).not.toContain('tabSelected');
      expect(await read(out, 'xl/worksheets/sheet2.xml')).toContain('<sheetView tabSelected="1" workbookViewId="0"/>');
      expect(await read(out, 'xl/worksheets/sheet3.xml')).not.toContain('tabSelected');
    }
  });
});

describe('엑셀 합치기 — 못 읽는 파일', () => {
  const ole = (encrypted: boolean) => Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(504), encrypted ? Buffer.from('EncryptionInfo', 'utf16le') : Buffer.from('Workbook', 'utf16le')]);

  it('암호 걸린 파일·예전 형식·빈 파일은 까닭을 한국어로, 하나도 못 넣으면 어느 파일인지 함께 알린다', async () => {
    const locked = join(dir, '잠긴 예산.xlsx');
    await writeFile(locked, ole(true));
    const old = join(dir, '옛 형식.xlsx');
    await writeFile(old, ole(false));
    const empty = join(dir, '빈 파일.xlsx');
    await writeFile(empty, Buffer.alloc(0));
    const good = await xlsx(join(dir, 'good.xlsx'), {});
    const r = await concatXlsx({ files: [locked, good, old, empty], output_path: join(dir, 'out.xlsx'), mode: 'native' }, signal);
    const why = Object.fromEntries((r.failed ?? []).map((f) => [f.path, f.error]));
    expect(why[locked]).toMatch(/암호가 걸린 파일/);
    expect(why[old]).toMatch(/예전 엑셀 형식/);
    expect(why[empty]).toMatch(/빈 파일/);

    await expect(concatXlsx({ files: [locked, empty], output_path: join(dir, 'none.xlsx'), mode: 'native' }, signal))
      .rejects.toThrow(/합칠 수 있는 엑셀 파일이 없습니다\. 읽지 못한 파일 잠긴 예산\.xlsx: 암호가 걸린 파일[\s\S]*빈 파일\.xlsx: 내용이 없는 빈 파일/);
  });
});
