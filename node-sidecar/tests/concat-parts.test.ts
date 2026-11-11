/** 서식 유지 합치기 — 시트 이름·수식·딸린 부품(엑셀), 그림·링크·머리글·각주(워드)가 깨지거나 뒤바뀌지 않는다 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, posix } from 'node:path';
import JSZip from 'jszip';
import { DOMParser } from '@xmldom/xmldom';

vi.mock('../src/infra/progress.js', () => ({ sendProgress: vi.fn() }));
vi.mock('../src/infra/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { concatDocx, withDocDefaults } from '../src/core/merge/concat-docx.js';
import { concatXlsx, renameDefinedNames, renameSheetRefs, safeSheetName } from '../src/core/merge/concat-xlsx.js';

const signal = new AbortController().signal;
let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'concat-parts-')); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const RELS = (body: string) => `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${body}</Relationships>`;

/** XML 이 문법에 맞는가 (깨진 속성·이스케이프 안 된 & 를 잡는다) */
function wellFormed(xml: string): boolean {
  let bad = false;
  new DOMParser({ onError: () => { bad = true; } }).parseFromString(xml, 'text/xml');
  return !bad;
}

/** 묶음 안의 모든 관계가 실제로 있는 부품을 가리키는가, 관계 파일이 문법에 맞는가 */
async function danglingRels(zip: JSZip): Promise<string[]> {
  const bad: string[] = [];
  for (const path of Object.keys(zip.files).filter((p) => p.endsWith('.rels'))) {
    const xml = await zip.file(path)!.async('text');
    if (!wellFormed(xml)) { bad.push(`${path}: 문법`); continue; }
    const owner = posix.dirname(posix.dirname(path));
    for (const m of xml.matchAll(/<Relationship\b[^>]*>/g)) {
      if (/TargetMode="External"/.test(m[0])) continue;
      const target = m[0].match(/Target="([^"]*)"/)![1];
      const full = target.startsWith('/') ? target.slice(1) : posix.normalize(posix.join(owner, target));
      if (!zip.file(full)) bad.push(`${path} → ${target}`);
    }
  }
  return bad;
}

// ─── 엑셀 ──────────────────────────────────────────────

interface SheetSpec { name: string; xml: string; rels?: string }

async function xlsx(path: string, sheets: SheetSpec[], extra: { definedNames?: string; files?: Record<string, string | Uint8Array> } = {}): Promise<string> {
  const zip = new JSZip();
  sheets.forEach((s, i) => {
    zip.file(`xl/worksheets/sheet${i + 1}.xml`, `${HEAD}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${REL}">${s.xml}</worksheet>`);
    if (s.rels) zip.file(`xl/worksheets/_rels/sheet${i + 1}.xml.rels`, RELS(s.rels));
  });
  zip.file('xl/workbook.xml', `${HEAD}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${REL}"><sheets>${sheets.map((s, i) => `<sheet name="${s.name}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>${extra.definedNames ?? ''}</workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', RELS(sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Target="worksheets/sheet${i + 1}.xml" Type="${REL}/worksheet"/>`).join('') + `<Relationship Id="rId90" Target="styles.xml" Type="${REL}/styles"/>`));
  zip.file('xl/styles.xml', `${HEAD}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"/>`);
  zip.file('[Content_Types].xml', `${HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>`);
  zip.file('_rels/.rels', RELS(`<Relationship Id="rId1" Target="xl/workbook.xml" Type="${REL}/officeDocument"/>`));
  for (const [p, body] of Object.entries(extra.files ?? {})) zip.file(p, body);
  await writeFile(path, Buffer.from(await zip.generateAsync({ type: 'arraybuffer' })));
  return path;
}

const cell = (ref: string, v: number, f?: string) => `<c r="${ref}">${f ? `<f>${f}</f>` : ''}<v>${v}</v></c>`;
const data = (...cells: string[]) => `<sheetData><row r="1">${cells.join('')}</row></sheetData>`;

describe('엑셀 서식 유지 합치기 — 시트 이름', () => {
  it('시트 이름으로 못 쓰는 글자를 빼고 31자로 자른다', () => {
    expect(safeSheetName('2026년 [총무과] 예산/결산: 최종?')).toBe('2026년 총무과 예산 결산 최종');
    expect(safeSheetName("'분기'")).toBe('분기');
    expect(safeSheetName('가'.repeat(40))).toHaveLength(31);
    expect(safeSheetName('[]')).toBe('Sheet');
  });

  it('파일 이름에 & 와 대괄호가 있어도 통합 문서가 깨지지 않고, 긴 이름이 겹쳐도 31자 안에서 가른다', async () => {
    const long = '2026년도 상반기 부서별 업무추진비 집행 내역 및 정산 결과 보고';
    const a = await xlsx(join(dir, 'R&D 현황.xlsx'), [{ name: 'Sheet1', xml: data(cell('A1', 1)) }]);
    const b = await xlsx(join(dir, `${long}.xlsx`), [{ name: 'Sheet1', xml: data(cell('A1', 2)) }]);
    const c = await xlsx(join(dir, `${long} [수정].xlsx`), [{ name: 'Sheet1', xml: data(cell('A1', 3)) }]);
    const out = join(dir, 'out.xlsx');
    await concatXlsx({ files: [a, b, c], output_path: out, mode: 'native' }, signal);
    const wb = await (await JSZip.loadAsync(await readFile(out))).file('xl/workbook.xml')!.async('text');
    expect(wellFormed(wb)).toBe(true);
    expect(wb).toContain('name="R&amp;D 현황"');
    const names = [...wb.matchAll(/<sheet name="([^"]*)"/g)].map((m) => m[1]);
    expect(names).toHaveLength(3);
    expect(new Set(names.map((n) => n.toLowerCase())).size).toBe(3);
    for (const n of names) {
      expect(n.replace(/&amp;/g, '&').length).toBeLessThanOrEqual(31);
      expect(n).not.toMatch(/[\\/?*[\]:]/);
    }
  });
});

describe('엑셀 서식 유지 합치기 — 수식과 이름 정의', () => {
  it('수식 속 시트 참조를 새 이름으로 (따옴표 꼴·맨 이름 꼴), 다른 시트는 건드리지 않는다', () => {
    const renames = new Map([['Input', 'Input (2)'], ['집계 표', '집계 표 (2)']]);
    expect(renameSheetRefs('SUM(Input!A1:A3)+MyInput!B1', renames)).toBe("SUM('Input (2)'!A1:A3)+MyInput!B1");
    expect(renameSheetRefs("'집계 표'!B2*2", renames)).toBe("'집계 표 (2)'!B2*2");
    expect(renameSheetRefs('[1]Input!A1', renames)).toBe('[1]Input!A1');
    expect(renameSheetRefs('A1&amp;Input!A1', new Map([['Input', 'R&D']]))).toBe("A1&amp;'R&amp;D'!A1");
  });

  it('수식 속 이름 정의를 새 이름으로: 함수·시트 이름·칸 주소·따옴표 안은 그대로', () => {
    const names = new Map([['rate', 'Rate_2'], ['sum', 'Sum_2']]);
    expect(renameDefinedNames('SUM(A1:A3)*Rate+rate', names)).toBe('SUM(A1:A3)*Rate_2+Rate_2');
    expect(renameDefinedNames(`Sum!A1+'Rate'!B2+"rate"&amp;MyRate`, names)).toBe(`Sum!A1+'Rate'!B2+"rate"&amp;MyRate`);
    expect(renameDefinedNames('Sum+Rate.Old+Table1[Rate]', names)).toBe('Sum_2+Rate.Old+Table1[Rate]');
  });

  it('같은 서식의 두 부서 파일: 둘째 파일의 수식이 첫째 파일 시트가 아니라 자기 시트를 가리킨다', async () => {
    const dept = (v: number) => [
      { name: 'Input', xml: data(cell('A1', v)) },
      { name: 'Sum', xml: data(cell('A1', v * 2, 'Input!A1*2'), cell('B1', v + 1, 'IF(Base&gt;0,Base+1,"Base")')) + '<conditionalFormatting sqref="A1"><cfRule type="expression" priority="1"><formula>Input!A1&gt;0</formula></cfRule></conditionalFormatting>' },
    ];
    const names = '<definedNames><definedName name="_xlnm.Print_Area" localSheetId="1">Sum!$A$1:$C$9</definedName><definedName name="Base">Input!$A$1</definedName></definedNames>';
    const a = await xlsx(join(dir, '총무과.xlsx'), dept(10), { definedNames: names });
    const b = await xlsx(join(dir, '재무과.xlsx'), dept(20), { definedNames: names });
    const out = join(dir, 'out.xlsx');
    const r = await concatXlsx({ files: [a, b], output_path: out, mode: 'native' }, signal);
    const zip = await JSZip.loadAsync(await readFile(out));
    const wb = await zip.file('xl/workbook.xml')!.async('text');
    expect([...wb.matchAll(/<sheet name="([^"]*)"/g)].map((m) => m[1])).toEqual(['Input', 'Sum', 'Input (2)', 'Sum (2)']);
    expect(await zip.file('xl/worksheets/sheet2.xml')!.async('text')).toContain('<f>Input!A1*2</f>');
    const second = await zip.file('xl/worksheets/sheet4.xml')!.async('text');
    expect(second).toContain("<f>'Input (2)'!A1*2</f>");
    expect(second).toContain("<formula>'Input (2)'!A1&gt;0</formula>");
    // 인쇄 영역은 새 시트 번호와 새 이름으로
    expect(wb).toContain('<definedName name="_xlnm.Print_Area" localSheetId="1">Sum!$A$1:$C$9</definedName>');
    expect(wb).toContain(`<definedName name="_xlnm.Print_Area" localSheetId="3">'Sum (2)'!$A$1:$C$9</definedName>`);
    // 통합 문서 범위 이름이 겹치면 뒤 파일 것을 새 이름으로 하고, 뒤 파일의 수식도 그 이름을 쓴다 (글 속의 같은 낱말은 그대로)
    expect(wb).toContain('<definedName name="Base">Input!$A$1</definedName>');
    expect(wb).toContain(`<definedName name="Base_2">'Input (2)'!$A$1</definedName>`);
    expect(await zip.file('xl/worksheets/sheet2.xml')!.async('text')).toContain('<f>IF(Base&gt;0,Base+1,"Base")</f>');
    expect(second).toContain('<f>IF(Base_2&gt;0,Base_2+1,"Base")</f>');
    expect(wellFormed(wb)).toBe(true);
    expect(r.warnings).toBeUndefined();
  });
});

describe('엑셀 서식 유지 합치기 — 딸린 부품', () => {
  it('뒤 파일의 그림·메모·표는 옮기지 않고 참조를 지운다 (첫 파일 그림이 붙지 않게). 바깥 링크는 남긴다', async () => {
    const withParts = (v: number): SheetSpec => ({
      name: 'Sheet1',
      xml: data(cell('A1', v))
        + '<hyperlinks><hyperlink ref="A1" r:id="rId3"/></hyperlinks><pageSetup orientation="landscape" r:id="rId4"/>'
        + '<drawing r:id="rId1"/><legacyDrawing r:id="rId5"/><tableParts count="1"><tablePart r:id="rId2"/></tableParts>',
      rels: `<Relationship Id="rId1" Type="${REL}/drawing" Target="../drawings/drawing1.xml"/>`
        + `<Relationship Id="rId2" Type="${REL}/table" Target="../tables/table1.xml"/>`
        + `<Relationship Id="rId3" Type="${REL}/hyperlink" Target="https://gaon.example/?a=1&amp;b=2" TargetMode="External"/>`
        + `<Relationship Id="rId4" Type="${REL}/printerSettings" Target="../printerSettings/printerSettings1.bin"/>`
        + `<Relationship Id="rId5" Type="${REL}/vmlDrawing" Target="../drawings/vmlDrawing1.vml"/>`,
    });
    const parts = { 'xl/drawings/drawing1.xml': '<xdr/>', 'xl/tables/table1.xml': '<table/>', 'xl/printerSettings/printerSettings1.bin': 'x', 'xl/drawings/vmlDrawing1.vml': '<xml/>' };
    const a = await xlsx(join(dir, 'a.xlsx'), [withParts(1)], { files: parts });
    const b = await xlsx(join(dir, 'b.xlsx'), [withParts(2)], { files: parts });
    const out = join(dir, 'out.xlsx');
    const r = await concatXlsx({ files: [a, b], output_path: out, mode: 'native' }, signal);
    const zip = await JSZip.loadAsync(await readFile(out));
    // 첫 파일은 그대로
    expect(await zip.file('xl/worksheets/sheet1.xml')!.async('text')).toContain('<drawing r:id="rId1"/>');
    const second = await zip.file('xl/worksheets/sheet2.xml')!.async('text');
    expect(second).not.toMatch(/<drawing|<legacyDrawing|<tableParts/);
    expect(second).toContain('<pageSetup orientation="landscape"/>');
    expect(second).toContain('<hyperlink ref="A1" r:id="rId3"/>');
    const rels = await zip.file('xl/worksheets/_rels/sheet2.xml.rels')!.async('text');
    expect([...rels.matchAll(/<Relationship\b/g)]).toHaveLength(1);
    expect(rels).toContain('TargetMode="External"');
    expect(await danglingRels(zip)).toEqual([]);
    expect(r.warnings?.join(' ')).toMatch(/b\.xlsx: 그림·도형·차트, 표 서식은 합본으로 옮기지 못했습니다/);
  });
});

describe('엑셀 서식 유지 합치기 — 시트 상태와 칸', () => {
  it('여러 시트에 걸친 참조는 양 끝 이름을 함께 바꾼다', () => {
    const renames = new Map([['Sheet1', 'Sheet1 (2)'], ['Sheet3', 'Sheet3 (2)'], ['1월', '1월 (2)'], ['12월', '12월 (2)']]);
    expect(renameSheetRefs('SUM(Sheet1:Sheet3!A1)', renames)).toBe("SUM('Sheet1 (2):Sheet3 (2)'!A1)");
    expect(renameSheetRefs("SUM('1월:12월'!C5)+Sheet1!A1", renames)).toBe("SUM('1월 (2):12월 (2)'!C5)+'Sheet1 (2)'!A1");
    expect(renameSheetRefs('SUM(A:B!A1)+SUM(A1:B2)', renames)).toBe('SUM(A:B!A1)+SUM(A1:B2)');
  });

  it('숨긴 시트는 숨긴 채로, 선택된 시트는 하나만 (여러 시트가 묶여 선택된 채 열리지 않게)', async () => {
    const view = '<sheetViews><sheetView tabSelected="1" workbookViewId="0"/></sheetViews>';
    const book = async (name: string) => {
      const p = await xlsx(join(dir, name), [{ name: '자료', xml: view + data(cell('A1', 1)) }, { name: '코드', xml: data(cell('A1', 2)) }]);
      const zip = await JSZip.loadAsync(await readFile(p));
      zip.file('xl/workbook.xml', (await zip.file('xl/workbook.xml')!.async('text')).replace('<sheet name="코드"', '<sheet name="코드" state="hidden"'));
      await writeFile(p, Buffer.from(await zip.generateAsync({ type: 'arraybuffer' })));
      return p;
    };
    const out = join(dir, 'out.xlsx');
    await concatXlsx({ files: [await book('a.xlsx'), await book('b.xlsx')], output_path: out, mode: 'native' }, signal);
    const zip = await JSZip.loadAsync(await readFile(out));
    const wb = await zip.file('xl/workbook.xml')!.async('text');
    expect([...wb.matchAll(/<sheet name="([^"]*)"[^>]*?( state="hidden")?\s+r:id/g)].map((m) => [m[1], !!m[2]])).toEqual([['자료', false], ['코드', true], ['자료 (2)', false], ['코드 (2)', true]]);
    expect(await zip.file('xl/worksheets/sheet1.xml')!.async('text')).toContain('tabSelected="1"');
    expect(await zip.file('xl/worksheets/sheet3.xml')!.async('text')).not.toContain('tabSelected');
  });

  it('값 없는 글 칸에서 다음 칸을 먹지 않고, 앞뒤 빈칸은 지키고, 확장 영역 수식도 바꾼다', async () => {
    const strings = `${HEAD}<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t xml:space="preserve">  들여쓴 글 </t></si><si><r><t>東京</t></r><rPh sb="0" eb="2"><t>トウキョウ</t></rPh></si></sst>`;
    const rows = '<sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"/><c r="D1"><v>2</v></c></row></sheetData>';
    const ext = '<extLst><ext><x14:dataValidations xmlns:x14="x14" xmlns:xm="xm"><x14:dataValidation><x14:formula1><xm:f>코드!$A$1:$A$5</xm:f></x14:formula1></x14:dataValidation></x14:dataValidations></ext></extLst>';
    const book = (name: string) => xlsx(join(dir, name), [{ name: '자료', xml: rows + ext }, { name: '코드', xml: data(cell('A1', 1)) }], { files: { 'xl/sharedStrings.xml': strings } });
    const out = join(dir, 'out.xlsx');
    await concatXlsx({ files: [await book('a.xlsx'), await book('b.xlsx')], output_path: out, mode: 'native' }, signal);
    const second = await (await JSZip.loadAsync(await readFile(out))).file('xl/worksheets/sheet3.xml')!.async('text');
    expect(wellFormed(second)).toBe(true);
    expect(second).toContain('<c r="A1" t="inlineStr"><is><t xml:space="preserve">  들여쓴 글 </t></is></c>');
    expect(second).toContain('<c r="B1" t="inlineStr"><is><t>東京</t></is></c>');
    expect(second).toContain('<c r="C1"/><c r="D1"><v>2</v></c>');
    expect(second).toContain("<xm:f>'코드 (2)'!$A$1:$A$5</xm:f>");
  });

  it('첫 파일의 시트가 파일 이름으로 바뀌면 그 파일 차트의 범위도 따라 바뀐다', async () => {
    const a = await xlsx(join(dir, '총무과.xlsx'), [{ name: 'Sheet1', xml: data(cell('A1', 1)) }], { files: { 'xl/charts/chart1.xml': '<c:chartSpace xmlns:c="c"><c:f>Sheet1!$A$1:$A$3</c:f></c:chartSpace>' } });
    const b = await xlsx(join(dir, '세무과.xlsx'), [{ name: 'Sheet1', xml: data(cell('A1', 2)) }]);
    const out = join(dir, 'out.xlsx');
    await concatXlsx({ files: [a, b], output_path: out, mode: 'native' }, signal);
    const zip = await JSZip.loadAsync(await readFile(out));
    expect(await zip.file('xl/charts/chart1.xml')!.async('text')).toContain("<c:f>'총무과'!$A$1:$A$3</c:f>");
  });

  it('시트 목록을 못 읽는 통합 문서는 넣지 않고 까닭을 알린다 (말없이 빠지거나 깨진 합본이 나오지 않게)', async () => {
    const good = await xlsx(join(dir, 'a.xlsx'), [{ name: '자료', xml: data(cell('A1', 1)) }]);
    const odd = await xlsx(join(dir, 'b.xlsx'), [{ name: '자료', xml: data(cell('A1', 2)) }]);
    const zip = await JSZip.loadAsync(await readFile(odd));
    zip.file('xl/workbook.xml', (await zip.file('xl/workbook.xml')!.async('text')).replace(/<(\/?)(workbook|sheets|sheet)\b/g, '<$1x:$2').replace('<x:workbook ', '<x:workbook xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '));
    await writeFile(odd, Buffer.from(await zip.generateAsync({ type: 'arraybuffer' })));
    const out = join(dir, 'out.xlsx');
    const r = await concatXlsx({ files: [odd, good, odd], output_path: out, mode: 'native' }, signal);
    expect(r.failed_files).toEqual([odd, odd]);
    expect(r.failed?.[0].error).toMatch(/다른 이름으로 저장/);
    const wb = await (await JSZip.loadAsync(await readFile(out))).file('xl/workbook.xml')!.async('text');
    expect([...wb.matchAll(/<sheet name="([^"]*)"/g)].map((m) => m[1])).toEqual(['a']);
  });
});

// ─── 워드 ──────────────────────────────────────────────

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const para = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const picture = (id: string) => `<w:p><w:r><w:drawing><a:graphic xmlns:a="${A}"><a:blip r:embed="${id}"/></a:graphic></w:drawing></w:r></w:p>`;

async function docx(path: string, body: string, o: { rels?: string; sectPr?: string; types?: string; files?: Record<string, string | Uint8Array> } = {}): Promise<string> {
  const zip = new JSZip();
  zip.file('word/document.xml', `${HEAD}<w:document xmlns:w="${W}" xmlns:r="${REL}"><w:body>${body}<w:sectPr>${o.sectPr ?? ''}<w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>`);
  zip.file('word/_rels/document.xml.rels', RELS(`<Relationship Id="rId1" Target="styles.xml" Type="${REL}/styles"/>${o.rels ?? ''}`));
  zip.file('word/styles.xml', `${HEAD}<w:styles xmlns:w="${W}"/>`);
  zip.file('[Content_Types].xml', `${HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${o.types ?? ''}<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  for (const [p, content] of Object.entries(o.files ?? {})) zip.file(p, content);
  await writeFile(path, Buffer.from(await zip.generateAsync({ type: 'arraybuffer' })));
  return path;
}

/** 본문의 n 번째 그림이 가리키는 부품의 내용 */
async function pictureBytes(zip: JSZip, n: number): Promise<string> {
  const doc = await zip.file('word/document.xml')!.async('text');
  const id = [...doc.matchAll(/r:embed="([^"]*)"/g)][n][1];
  const rels = await zip.file('word/_rels/document.xml.rels')!.async('text');
  const target = rels.match(new RegExp(`<Relationship Id="${id}"[^>]*Target="([^"]*)"`))![1];
  return zip.file(`word/${target}`)!.async('text');
}

describe('워드 서식 유지 합치기 — 그림과 링크', () => {
  it('그림 없는 문서 뒤에 같은 이름 그림을 가진 두 문서를 붙여도 그림이 뒤바뀌지 않는다', async () => {
    const image = (id: string) => `<Relationship Id="${id}" Type="${REL}/image" Target="media/image1.png"/>`;
    const png = '<Default Extension="png" ContentType="image/png"/>';
    const a = await docx(join(dir, 'a.docx'), para('가'));
    const b = await docx(join(dir, 'b.docx'), para('나') + picture('rId5'), { rels: image('rId5'), types: png, files: { 'word/media/image1.png': 'B의 그림' } });
    const c = await docx(join(dir, 'c.docx'), para('다') + picture('rId5'), { rels: image('rId5'), types: png, files: { 'word/media/image1.png': 'C의 그림' } });
    const out = join(dir, 'out.docx');
    const r = await concatDocx({ files: [a, b, c], output_path: out, mode: 'native' }, signal);
    expect(r.failed_files).toEqual([]);
    const zip = await JSZip.loadAsync(await readFile(out));
    expect(await pictureBytes(zip, 0)).toBe('B의 그림');
    expect(await pictureBytes(zip, 1)).toBe('C의 그림');
    // 첫 문서에 없던 그림 형식도 종류 표에 들어간다
    expect(await zip.file('[Content_Types].xml')!.async('text')).toContain('<Default Extension="png" ContentType="image/png"/>');
    expect(await danglingRels(zip)).toEqual([]);
  });

  it('바깥 링크는 바깥 링크로 남고(주소의 & 포함), 관계 파일이 깨지지 않는다', async () => {
    const link = `<Relationship Id="rId7" Type="${REL}/hyperlink" Target="https://gaon.example/?a=1&amp;b=2" TargetMode="External"/>`;
    const a = await docx(join(dir, 'a.docx'), para('가'));
    const b = await docx(join(dir, 'b.docx'), `<w:p><w:hyperlink r:id="rId7"><w:r><w:t>누리집</w:t></w:r></w:hyperlink></w:p>`, { rels: link });
    const out = join(dir, 'out.docx');
    await concatDocx({ files: [a, b], output_path: out, mode: 'native' }, signal);
    const zip = await JSZip.loadAsync(await readFile(out));
    const rels = await zip.file('word/_rels/document.xml.rels')!.async('text');
    expect(wellFormed(rels)).toBe(true);
    const doc = await zip.file('word/document.xml')!.async('text');
    expect(wellFormed(doc)).toBe(true);
    const id = doc.match(/<w:hyperlink\b[^>]*\br:id="([^"]*)"/)![1];
    expect(id).not.toBe('rId7');
    expect(rels).toMatch(new RegExp(`<Relationship Id="${id}"[^>]*Target="https://gaon\\.example/\\?a=1&amp;b=2" TargetMode="External"/>`));
  });

  it('그림에 딸린 차트 같은 부품도 그 부품의 관계까지 옮긴다', async () => {
    const chartRel = `<Relationship Id="rId9" Type="${REL}/chart" Target="charts/chart1.xml"/>`;
    const chartType = '<Override PartName="/word/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/><Default Extension="xlsx" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"/>';
    const withChart = (mark: string) => ({
      rels: chartRel, types: chartType,
      files: {
        'word/charts/chart1.xml': `<c:chartSpace xmlns:c="c">${mark}</c:chartSpace>`,
        'word/charts/_rels/chart1.xml.rels': RELS(`<Relationship Id="rId1" Type="${REL}/package" Target="../embeddings/data1.xlsx"/>`),
        'word/embeddings/data1.xlsx': `${mark}의 자료`,
      },
    });
    const body = `<w:p><w:r><w:drawing><c:chart xmlns:c="c" r:id="rId9"/></w:drawing></w:r></w:p>`;
    const a = await docx(join(dir, 'a.docx'), body, withChart('A'));
    const b = await docx(join(dir, 'b.docx'), body, withChart('B'));
    const out = join(dir, 'out.docx');
    await concatDocx({ files: [a, b], output_path: out, mode: 'native' }, signal);
    const zip = await JSZip.loadAsync(await readFile(out));
    expect(await zip.file('word/charts/chart1.xml')!.async('text')).toContain('A');
    expect(await zip.file('word/charts/chart1_2.xml')!.async('text')).toContain('B');
    expect(await zip.file('word/charts/_rels/chart1_2.xml.rels')!.async('text')).toContain('Target="../embeddings/data1_2.xlsx"');
    expect(await zip.file('word/embeddings/data1_2.xlsx')!.async('text')).toBe('B의 자료');
    expect(await zip.file('[Content_Types].xml')!.async('text')).toContain('<Override PartName="/word/charts/chart1_2.xml"');
    expect(await danglingRels(zip)).toEqual([]);
  });
});

describe('워드 서식 유지 합치기 — 머리글·각주', () => {
  it('뒤 문서의 머리글 참조·각주 표시는 지우고 알린다. 합본의 머리글은 첫 문서 것, 쪽 설정은 마지막 문서 것', async () => {
    const header = (id: string) => `<Relationship Id="${id}" Type="${REL}/header" Target="header1.xml"/>`;
    const a = await docx(join(dir, 'a.docx'), para('가'), { rels: header('rId4'), sectPr: '<w:headerReference w:type="default" r:id="rId4"/>', files: { 'word/header1.xml': '<w:hdr/>' } });
    const b = await docx(join(dir, 'b.docx'),
      `<w:p><w:r><w:t>나</w:t></w:r><w:r><w:footnoteReference w:id="2"/></w:r></w:p>`,
      { rels: header('rId8') + `<Relationship Id="rId9" Type="${REL}/footnotes" Target="footnotes.xml"/>`, sectPr: '<w:headerReference w:type="default" r:id="rId8"/><w:pgNumType w:start="5"/>', files: { 'word/header1.xml': '<w:hdr>B</w:hdr>', 'word/footnotes.xml': '<w:footnotes/>' } });
    const out = join(dir, 'out.docx');
    const r = await concatDocx({ files: [a, b], output_path: out, mode: 'native' }, signal);
    const zip = await JSZip.loadAsync(await readFile(out));
    const doc = await zip.file('word/document.xml')!.async('text');
    expect(doc).not.toContain('footnoteReference');
    expect(doc).not.toContain('rId8');
    const sect = doc.match(/<w:sectPr[\s\S]*<\/w:sectPr>/)![0];
    expect(sect).toContain('<w:headerReference w:type="default" r:id="rId4"/>');
    expect(sect).toContain('<w:pgNumType w:start="5"/>');
    // 본문이 쓰는 관계 id 는 모두 관계 파일에 있다
    const rels = await zip.file('word/_rels/document.xml.rels')!.async('text');
    for (const m of doc.matchAll(/\br:(?:id|embed)="([^"]*)"/g)) expect(rels).toContain(`Id="${m[1]}"`);
    expect(await zip.file('word/header1.xml')!.async('text')).toBe('<w:hdr/>');
    expect(await danglingRels(zip)).toEqual([]);
    expect(r.warnings?.join(' ')).toMatch(/각주·미주·메모 1개/);
    expect(r.warnings?.join(' ')).toMatch(/머리글·바닥글은 옮기지 않았습니다/);
  });
});

describe('워드 서식 유지 합치기 — 서식과 번호', () => {
  const styles = (body: string) => `${HEAD}<w:styles xmlns:w="${W}">${body}</w:styles>`;
  const normal = (rsid: string, size = 22) => `<w:style w:type="paragraph" w:default="1" w:styleId="a"><w:name w:val="Normal"/><w:rsid w:val="${rsid}"/><w:rPr><w:sz w:val="${size}"/></w:rPr></w:style>`;
  const heading = (rsid: string) => `<w:style w:type="paragraph" w:styleId="1"><w:name w:val="heading 1"/><w:basedOn w:val="a"/><w:rsid w:val="${rsid}"/><w:rPr><w:b/></w:rPr></w:style>`;
  const link = (id: string) => `<w:style w:type="character" w:styleId="${id}"><w:name w:val="Hyperlink"/><w:rPr><w:u w:val="single"/></w:rPr></w:style>`;
  const body = (mark: string, run = '') => `<w:p><w:pPr><w:pStyle w:val="1"/></w:pPr><w:r><w:t>${mark} 제목</w:t></w:r></w:p><w:p><w:r>${run}<w:t>${mark} 본문</w:t></w:r></w:p><w:p/>`;

  it('같은 이름의 서식이 둘 생기지 않는다: 편집 흔적만 다르면 같은 서식, 정의가 다르면 새 이름의 사본, id 만 다르면 앞 문서 서식으로', async () => {
    const a = await docx(join(dir, 'a.docx'), body('가'), { files: { 'word/styles.xml': styles(normal('00AAAAAA') + heading('00AAAAAA')) } });
    const b = await docx(join(dir, 'b.docx'), body('나', '<w:rPr><w:rStyle w:val="ac"/></w:rPr>'), { files: { 'word/styles.xml': styles(normal('00BBBBBB') + heading('00BBBBBB') + link('ac')) } });
    const c = await docx(join(dir, 'c.docx'), body('다', '<w:rPr><w:rStyle w:val="ad"/></w:rPr>'), { files: { 'word/styles.xml': styles(normal('00CCCCCC', 40) + heading('00CCCCCC') + link('ad')) } });
    const out = join(dir, 'out.docx');
    await concatDocx({ files: [a, b, c], output_path: out, mode: 'native' }, signal);
    const zip = await JSZip.loadAsync(await readFile(out));
    const merged = await zip.file('word/styles.xml')!.async('text');
    const names = [...merged.matchAll(/<w:name w:val="([^"]*)"/g)].map((m) => m[1]);
    // 같은 이름이 둘이면 워드가 문서를 손상으로 본다
    expect(new Set(names.map((n) => n.toLowerCase())).size).toBe(names.length);
    expect(names).toEqual(['Normal', 'heading 1', 'Hyperlink', 'Normal (3)', 'heading 1 (3)']);
    expect(merged.match(/w:default="1"/g)).toHaveLength(1);
    // 셋째 문서의 사본 제목 서식은 사본 기본 서식에 기댄다
    expect(merged).toMatch(/<w:style w:type="paragraph" w:styleId="1_3"><w:name w:val="heading 1 \(3\)"\/><w:basedOn w:val="a_3"\/>/);
    const doc = await zip.file('word/document.xml')!.async('text');
    const part = (mark: string) => doc.slice(doc.indexOf(`${mark} 제목`) - 200, doc.indexOf(`${mark} 본문`) + 200);
    // 둘째 문서: 편집 흔적만 달랐다 → 서식 참조 그대로, 서식을 적지 않은 문단도 그대로
    expect(part('나')).toContain('<w:pStyle w:val="1"/>');
    expect(part('나')).not.toContain('a_3');
    // 셋째 문서: 글자 크기가 다른 기본 서식 → 서식을 적지 않은 문단(빈 문단 포함)에 사본 서식을 적는다. 링크 서식은 id 만 달랐으니 앞 문서 것으로
    expect(part('다')).toContain('<w:pStyle w:val="1_3"/>');
    expect(part('다')).toMatch(/<w:pPr><w:pStyle w:val="a_3"\/><\/w:pPr><w:r><w:rPr><w:rStyle w:val="ac"\/>/);
    expect(doc).toMatch(/<w:p[^>]*><w:pPr><w:pStyle w:val="a_3"\/><\/w:pPr><\/w:p>/);
    expect(doc).not.toContain('w:val="ad"');
  });

  it('문서 기본값(글꼴 크기·문단 간격)이 다른 문서는 그 값을 뿌리 서식에 적어 넣어 본문 모양을 지킨다', async () => {
    const defaults = (size: number, after: number) => `<w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="${size}"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="${after}"/></w:pPr></w:pPrDefault></w:docDefaults>`;
    const plain = '<w:style w:type="paragraph" w:default="1" w:styleId="a"><w:name w:val="Normal"/><w:pPr><w:keepNext/><w:jc w:val="both"/></w:pPr></w:style>';
    const child = '<w:style w:type="paragraph" w:styleId="1"><w:name w:val="heading 1"/><w:basedOn w:val="a"/><w:rPr><w:b/></w:rPr></w:style>';
    const base = styles(defaults(20, 160) + plain + child);
    const donor = styles(defaults(32, 400) + plain + child);
    // 같으면 그대로
    expect(withDocDefaults(base, base)).toBe(base);
    const filled = withDocDefaults(donor, base);
    // 기대는 서식이 없는 서식에만, 문단 속성은 규격 차례로(keepNext → spacing → jc), 글자 속성은 문단 속성 뒤에
    expect(filled).toContain('<w:name w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:after="400"/><w:jc w:val="both"/></w:pPr><w:rPr><w:sz w:val="32"/></w:rPr></w:style>');
    expect(filled).toContain(child);

    const a = await docx(join(dir, 'a.docx'), para('가 본문'), { files: { 'word/styles.xml': base } });
    const b = await docx(join(dir, 'b.docx'), para('나 본문'), { files: { 'word/styles.xml': donor } });
    const out = join(dir, 'out.docx');
    await concatDocx({ files: [a, b], output_path: out, mode: 'native' }, signal);
    const zip = await JSZip.loadAsync(await readFile(out));
    const merged = await zip.file('word/styles.xml')!.async('text');
    // 둘째 문서의 기본 서식은 새 이름의 사본이 되고(크기 32), 서식을 적지 않은 문단에 그 서식을 적는다
    expect(merged).toMatch(/w:styleId="a_2"><w:name w:val="Normal \(2\)"\/>[\s\S]*?<w:sz w:val="32"\/>/);
    const doc = await zip.file('word/document.xml')!.async('text');
    expect(doc).toMatch(/<w:pPr><w:pStyle w:val="a_2"\/><\/w:pPr><w:r><w:t>나 본문/);
    expect(doc).toMatch(/<w:p[^>]*><w:r><w:t>가 본문/);
  });

  it('뒤 문서가 쓰는 이름공간 선언과 "몰라도 되는 확장" 목록을 합본 뿌리에 더한다 (글상자·도형이 든 문서)', async () => {
    const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
    const WPS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';
    const a = await docx(join(dir, 'a.docx'), para('가'));
    const b = await docx(join(dir, 'b.docx'), para('나') + '<w:p><w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing><wps:wsp><wps:txbx/></wps:wsp></w:drawing></mc:Choice><mc:Fallback><w:t>글상자</w:t></mc:Fallback></mc:AlternateContent></w:r></w:p>');
    // 둘째 문서의 뿌리에만 선언이 있다
    const zipB = await JSZip.loadAsync(await readFile(b));
    zipB.file('word/document.xml', (await zipB.file('word/document.xml')!.async('text')).replace('<w:document ', `<w:document xmlns:mc="${MC}" xmlns:wps="${WPS}" xmlns:w14="w14" mc:Ignorable="w14 wps" `));
    await writeFile(b, Buffer.from(await zipB.generateAsync({ type: 'arraybuffer' })));
    const out = join(dir, 'out.docx');
    await concatDocx({ files: [a, b], output_path: out, mode: 'native' }, signal);
    const doc = await (await JSZip.loadAsync(await readFile(out))).file('word/document.xml')!.async('text');
    const root = doc.match(/<w:document\b[^>]*>/)![0];
    expect(root).toContain(`xmlns:wps="${WPS}"`);
    expect(root).toContain(`xmlns:mc="${MC}"`);
    expect(root).toMatch(/mc:Ignorable="[^"]*\bw14\b[^"]*"/);
    expect(wellFormed(doc)).toBe(true);
  });

  it('번호 정의는 규격의 차례로(정의 먼저, 목록 뒤) 넣고 고유 번호가 겹치지 않게 한다. 첫 문서에 번호가 없으면 번호 부품을 문서에 잇는다', async () => {
    const numbering = `${HEAD}<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="0"><w:nsid w:val="103D28EC"/><w:lvl w:ilvl="0"><w:start w:val="1"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`;
    const item = (text: string) => `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
    const numbered = (name: string, text: string) => docx(join(dir, name), item(text), { rels: `<Relationship Id="rId3" Type="${REL}/numbering" Target="numbering.xml"/>`, files: { 'word/numbering.xml': numbering } });
    const a = await numbered('a.docx', '가 하나');
    const b = await numbered('b.docx', '나 하나');
    const out = join(dir, 'out.docx');
    await concatDocx({ files: [a, b], output_path: out, mode: 'native' }, signal);
    const zip = await JSZip.loadAsync(await readFile(out));
    const num = await zip.file('word/numbering.xml')!.async('text');
    expect(num.lastIndexOf('<w:abstractNum ')).toBeLessThan(num.search(/<w:num\s/));
    const nsids = [...num.matchAll(/<w:nsid w:val="([^"]*)"/g)].map((m) => m[1]);
    expect(new Set(nsids).size).toBe(2);
    const doc = await zip.file('word/document.xml')!.async('text');
    expect([...doc.matchAll(/<w:numId w:val="(\d+)"/g)].map((m) => m[1])).toEqual(['1', '3']);
    expect(num).toMatch(/<w:num w:numId="3"><w:abstractNumId w:val="1"\/>/);

    // 번호 없는 문서 뒤에 번호 있는 문서
    const plain = await docx(join(dir, 'plain.docx'), para('번호 없음'));
    const out2 = join(dir, 'out2.docx');
    await concatDocx({ files: [plain, a], output_path: out2, mode: 'native' }, signal);
    const zip2 = await JSZip.loadAsync(await readFile(out2));
    expect(await zip2.file('word/_rels/document.xml.rels')!.async('text')).toMatch(/Type="[^"]*\/numbering" Target="numbering\.xml"/);
    expect(await zip2.file('[Content_Types].xml')!.async('text')).toContain('<Override PartName="/word/numbering.xml"');
    expect(await danglingRels(zip2)).toEqual([]);
  });
});
