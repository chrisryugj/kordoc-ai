/** 서식 유지 수합 (native concat) 테스트 — JSZip으로 최소 ZIP 생성 후 검증 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
import JSZip from 'jszip';

// progress/logger mock — concat 모듈이 직접 import
vi.mock('../src/infra/progress.js', () => ({
  sendProgress: vi.fn(),
}));
vi.mock('../src/infra/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { concatHwpx } from '../src/core/merge/concat-hwpx.js';
import { concatDocx } from '../src/core/merge/concat-docx.js';
import { concatXlsx } from '../src/core/merge/concat-xlsx.js';

// 한/글 COM + pyhwpx 사용 가능 여부
import { execSync } from 'node:child_process';
let hasHwpCom = false;
try {
  execSync('python -c "from pyhwpx import Hwp"', { timeout: 10_000, stdio: 'pipe' });
  const out = execSync(
    'reg query "HKLM\\SOFTWARE\\Classes\\HWPFrame.HwpObject" /ve',
    { timeout: 5_000, stdio: 'pipe', encoding: 'utf-8' },
  );
  hasHwpCom = out.includes('HWPFrame');
} catch { /* 한컴오피스 또는 pyhwpx 미설치 */ }

// HWPX 테스트 fixture 경로
const hwpxFixturesDir = resolve(process.cwd(), '../../kordoc/tests/fixtures/real');
const hasHwpxFixtures = existsSync(hwpxFixturesDir);

const signal = new AbortController().signal;
let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'concat-test-'));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

// ─── HWPX는 실제 fixture 파일로 테스트 (순수 XML 병합) ──

// ─── DOCX 테스트 헬퍼 ──────────────────────────────────

async function createMinimalDocx(paragraphs: string[]): Promise<Buffer> {
  const zip = new JSZip();
  const bodyContent = paragraphs.map(p =>
    `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`,
  ).join('\n');

  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${bodyContent}
    <w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr>
  </w:body>
</w:document>`);

  zip.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Target="styles.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles"/>
</Relationships>`);

  zip.file('word/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>
`);

  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`);

  return Buffer.from(await zip.generateAsync({ type: 'arraybuffer' }));
}

// ─── XLSX 테스트 헬퍼 ──────────────────────────────────

async function createMinimalXlsx(sheetName: string, cells: string[][]): Promise<Buffer> {
  const zip = new JSZip();

  // shared strings
  const allStrings = cells.flat();
  const ssItems = allStrings.map(s => `<si><t>${s}</t></si>`).join('');
  zip.file('xl/sharedStrings.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${allStrings.length}" uniqueCount="${allStrings.length}">
${ssItems}
</sst>`);

  // worksheet — 셀을 shared string 인덱스로 참조
  let idx = 0;
  const colLetters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const rows = cells.map((row, ri) => {
    const rowCells = row.map((_, ci) => {
      const ref = `${colLetters[ci]}${ri + 1}`;
      return `<c r="${ref}" t="s"><v>${idx++}</v></c>`;
    }).join('');
    return `<row r="${ri + 1}">${rowCells}</row>`;
  }).join('\n');

  zip.file('xl/worksheets/sheet1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>${rows}</sheetData>
</worksheet>`);

  // workbook
  zip.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
          xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="${sheetName}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`);

  zip.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Target="worksheets/sheet1.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"/>
  <Relationship Id="rId2" Target="sharedStrings.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings"/>
</Relationships>`);

  zip.file('xl/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"/>
`);

  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
</Types>`);

  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Target="xl/workbook.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"/>
</Relationships>`);

  return Buffer.from(await zip.generateAsync({ type: 'arraybuffer' }));
}

// ─── 스타일 포함 HWPX 테스트 헬퍼 ─────���──────────────────

// (createStyledHwpx 헬퍼 제거됨 — 순수 XML 병합으로 전환)

// ─── 스타일 포함 XLSX 테스트 헬퍼 ────────────────────────

async function createStyledXlsx(opts: {
  sheetName: string;
  fonts: string[];
  fills: string[];
  borders: string[];
  cellXfs: string[];
  cells: Array<{ ref: string; style: number; value: string }>;
}): Promise<Buffer> {
  const zip = new JSZip();

  const fontsXml = `<fonts count="${opts.fonts.length}">${opts.fonts.join('')}</fonts>`;
  const fillsXml = `<fills count="${opts.fills.length}">${opts.fills.join('')}</fills>`;
  const bordersXml = `<borders count="${opts.borders.length}">${opts.borders.join('')}</borders>`;
  const cellStyleXfsXml = `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>`;
  const cellXfsXml = `<cellXfs count="${opts.cellXfs.length}">${opts.cellXfs.join('')}</cellXfs>`;

  zip.file('xl/styles.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `${fontsXml}${fillsXml}${bordersXml}${cellStyleXfsXml}${cellXfsXml}` +
    `</styleSheet>`);

  const rows = new Map<number, string[]>();
  for (const cell of opts.cells) {
    const rowNum = parseInt(cell.ref.replace(/[A-Z]+/, ''), 10);
    if (!rows.has(rowNum)) rows.set(rowNum, []);
    rows.get(rowNum)!.push(`<c r="${cell.ref}" s="${cell.style}" t="inlineStr"><is><t>${cell.value}</t></is></c>`);
  }
  const sheetData = [...rows.entries()].sort((a, b) => a[0] - b[0])
    .map(([r, cells]) => `<row r="${r}">${cells.join('')}</row>`).join('');

  zip.file('xl/worksheets/sheet1.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetData>${sheetData}</sheetData></worksheet>`);

  zip.file('xl/workbook.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheets><sheet name="${opts.sheetName}" sheetId="1" r:id="rId1"/></sheets></workbook>`);

  zip.file('xl/_rels/workbook.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Target="worksheets/sheet1.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"/>` +
    `<Relationship Id="rId2" Target="styles.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles"/>` +
    `</Relationships>`);

  zip.file('[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    `</Types>`);

  zip.file('_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Target="xl/workbook.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"/>` +
    `</Relationships>`);

  return Buffer.from(await zip.generateAsync({ type: 'arraybuffer' }));
}

// ─── 스타일 포함 DOCX 테스트 헬퍼 ────────────────────────

async function createStyledDocx(opts: {
  styles: Array<{ styleId: string; type: string; name: string; bold?: boolean; fontSize?: number }>;
  paragraphs: Array<{ text: string; styleId?: string }>;
}): Promise<Buffer> {
  const zip = new JSZip();

  const stylesXml = opts.styles.map(s => {
    const rPr = [];
    if (s.bold) rPr.push('<w:b/>');
    if (s.fontSize) rPr.push(`<w:sz w:val="${s.fontSize}"/>`);
    const rPrXml = rPr.length > 0 ? `<w:rPr>${rPr.join('')}</w:rPr>` : '';
    return `<w:style w:type="${s.type}" w:styleId="${s.styleId}"><w:name w:val="${s.name}"/>${rPrXml}</w:style>`;
  }).join('');

  zip.file('word/styles.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
    `${stylesXml}</w:styles>`);

  const bodyContent = opts.paragraphs.map(p => {
    const pPr = p.styleId ? `<w:pPr><w:pStyle w:val="${p.styleId}"/></w:pPr>` : '';
    return `<w:p>${pPr}<w:r><w:t>${p.text}</w:t></w:r></w:p>`;
  }).join('');

  zip.file('word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
    `<w:body>${bodyContent}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>`);

  zip.file('word/_rels/document.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Target="styles.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles"/>` +
    `</Relationships>`);

  zip.file('[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
    `</Types>`);

  return Buffer.from(await zip.generateAsync({ type: 'arraybuffer' }));
}

// ─── 테스트 ────────────────────────────────────────────

describe('HWPX COM 자동화 수합', () => {
  const canRun = hasHwpCom && hasHwpxFixtures;

  it.skipIf(!canRun)('재활용센터 + 제물포터널 병합 → 성공 + 출력 파일 생성', async () => {
    const file1 = join(hwpxFixturesDir, '재활용센터현황.hwpx');
    const file2 = join(hwpxFixturesDir, '제물포터널협약서.hwpx');
    const out = join(tmpDir, 'merged_com.hwpx');

    const result = await concatHwpx({ files: [file1, file2], output_path: out, mode: 'native' }, signal);
    expect(result.success).toBe(true);
    expect(result.failed_files).toHaveLength(0);
    expect(result.file_count).toBe(2);
    expect(result.total_length).toBeGreaterThan(0);
    expect(existsSync(out)).toBe(true);
  }, 60_000);

  it.skipIf(!canRun)('5개 HWPX 일괄 병합 — 오류 없이 완료', async () => {
    const files = [
      '재활용센터현황.hwpx', '재활용센터현황2.hwpx', '제물포터널협약서.hwpx',
      '지역아동센터계획.hwpx', '특별구급대실적.hwpx',
    ].map(f => join(hwpxFixturesDir, f));
    const out = join(tmpDir, 'merged_5_com.hwpx');

    const result = await concatHwpx({ files, output_path: out, mode: 'native' }, signal);
    expect(result.success).toBe(true);
    expect(result.failed_files).toHaveLength(0);
    expect(result.file_count).toBe(5);
    expect(result.total_length).toBeGreaterThan(0);
  }, 120_000);

  it.skipIf(hasHwpCom)('한컴오피스 미설치 시 에러 메시지 포함', async () => {
    const out = join(tmpDir, 'fail.hwpx');
    await expect(
      concatHwpx({ files: ['nonexistent.hwpx', 'also.hwpx'], output_path: out, mode: 'native' }, signal),
    ).rejects.toThrow('한컴오피스');
  });
});

describe('DOCX 서식 유지 수합', () => {
  it('2개 DOCX 병합 → body 요소 합산 + page break 삽입', async () => {
    const file1 = join(tmpDir, 'a.docx');
    const file2 = join(tmpDir, 'b.docx');
    const out = join(tmpDir, 'merged.docx');

    const buf1 = await createMinimalDocx(['단락A1', '단락A2']);
    const buf2 = await createMinimalDocx(['단락B1']);

    await Promise.all([
      import('node:fs/promises').then(fs => fs.writeFile(file1, buf1)),
      import('node:fs/promises').then(fs => fs.writeFile(file2, buf2)),
    ]);

    const result = await concatDocx({ files: [file1, file2], output_path: out, mode: 'native' }, signal);

    expect(result.success).toBe(true);
    expect(result.failed_files).toHaveLength(0);

    // 출력 ZIP 검증
    const outBuf = await readFile(out);
    const outZip = await JSZip.loadAsync(outBuf);
    const docXml = await outZip.file('word/document.xml')!.async('text');

    // 원본 단락 3개 + page break 1개 + sectPr 1개 = 최소 5개 자식
    expect(docXml).toContain('단락A1');
    expect(docXml).toContain('단락A2');
    expect(docXml).toContain('단락B1');
    // page break 존재
    expect(docXml).toContain('w:type="page"');
    // sectPr 존재 (마지막 파일 것)
    expect(docXml).toContain('sectPr');
  });
});

describe('DOCX 스타일 병합', () => {
  it('충돌하는 스타일 리네이밍 + 참조 리매핑', async () => {
    const file1 = join(tmpDir, 'a.docx');
    const file2 = join(tmpDir, 'b.docx');
    const out = join(tmpDir, 'merged.docx');

    // 파일 A: Heading1 = bold
    const bufA = await createStyledDocx({
      styles: [
        { styleId: 'Normal', type: 'paragraph', name: 'Normal', fontSize: 22 },
        { styleId: 'Heading1', type: 'paragraph', name: 'Heading 1', bold: true, fontSize: 28 },
      ],
      paragraphs: [
        { text: '파일A 제목', styleId: 'Heading1' },
        { text: '파일A 본문' },
      ],
    });

    // 파일 B: Heading1 = 다른 정의 (fontSize 36, bold 없음) → 충돌!
    const bufB = await createStyledDocx({
      styles: [
        { styleId: 'Normal', type: 'paragraph', name: 'Normal', fontSize: 22 },
        { styleId: 'Heading1', type: 'paragraph', name: 'Heading 1', fontSize: 36 },
        { styleId: 'CustomB', type: 'paragraph', name: 'Custom B', bold: true },
      ],
      paragraphs: [
        { text: '파일B 제목', styleId: 'Heading1' },
        { text: '파일B 커스텀', styleId: 'CustomB' },
      ],
    });

    const { writeFile: wf } = await import('node:fs/promises');
    await wf(file1, bufA);
    await wf(file2, bufB);

    const result = await concatDocx({ files: [file1, file2], output_path: out, mode: 'native' }, signal);
    expect(result.success).toBe(true);

    const outZip = await JSZip.loadAsync(await readFile(out));
    const stylesXml = await outZip.file('word/styles.xml')!.async('text');
    const docXml = await outZip.file('word/document.xml')!.async('text');

    // Heading1 (원본 A) 유지
    expect(stylesXml).toContain('w:styleId="Heading1"');
    // Heading1_2 (B에서 리네이밍)
    expect(stylesXml).toContain('w:styleId="Heading1_2"');
    // CustomB (새 스타일, 충돌 없이 추가)
    expect(stylesXml).toContain('w:styleId="CustomB"');
    // Normal (동일 — A것 유지, 1번만)
    const normalCount = (stylesXml.match(/w:styleId="Normal"/g) || []).length;
    expect(normalCount).toBe(1);

    // 내용 검증: Heading1_2 스타일에 fontSize 36이 포함되어야 함
    expect(stylesXml).toMatch(/w:styleId="Heading1_2"[^]*?w:sz w:val="36"/);
    // 원본 Heading1에 bold가 포함되어야 함
    expect(stylesXml).toMatch(/w:styleId="Heading1"[^]*?<w:b\/>/);

    // body에서 파일B의 Heading1 참조가 Heading1_2로 리매핑
    expect(docXml).toContain('파일B 제목');
    // 실제로 Heading1_2를 참조하는지
    expect(docXml).toContain('w:val="Heading1_2"');
    expect(docXml).toContain('파일B 커스텀');
  });

  it('basedOn 교차 참조 리매핑 — donor 스타일간 상속 관계 유지', async () => {
    const file1 = join(tmpDir, 'a.docx');
    const file2 = join(tmpDir, 'b.docx');
    const out = join(tmpDir, 'merged.docx');

    // 파일 A: MyBase = bold
    const zipA = new JSZip();
    zipA.file('word/styles.xml',
      `<?xml version="1.0"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
      `<w:style w:type="paragraph" w:styleId="MyBase"><w:name w:val="MyBase"/><w:rPr><w:b/></w:rPr></w:style>` +
      `</w:styles>`);
    zipA.file('word/document.xml',
      `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
      `<w:body><w:p><w:r><w:t>A</w:t></w:r></w:p><w:sectPr/></w:body></w:document>`);
    zipA.file('word/_rels/document.xml.rels',
      `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>` );
    zipA.file('[Content_Types].xml',
      `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `</Types>`);

    // 파일 B: MyBase = italic (충돌!) + MyChild basedOn="MyBase"
    const zipB = new JSZip();
    zipB.file('word/styles.xml',
      `<?xml version="1.0"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
      `<w:style w:type="paragraph" w:styleId="MyBase"><w:name w:val="MyBase"/><w:rPr><w:i/></w:rPr></w:style>` +
      `<w:style w:type="paragraph" w:styleId="MyChild"><w:name w:val="MyChild"/><w:basedOn w:val="MyBase"/></w:style>` +
      `</w:styles>`);
    zipB.file('word/document.xml',
      `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
      `<w:body><w:p><w:pPr><w:pStyle w:val="MyChild"/></w:pPr><w:r><w:t>B</w:t></w:r></w:p><w:sectPr/></w:body></w:document>`);
    zipB.file('word/_rels/document.xml.rels',
      `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>` );
    zipB.file('[Content_Types].xml',
      `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `</Types>`);

    const { writeFile: wf } = await import('node:fs/promises');
    await wf(file1, Buffer.from(await zipA.generateAsync({ type: 'arraybuffer' })));
    await wf(file2, Buffer.from(await zipB.generateAsync({ type: 'arraybuffer' })));

    const result = await concatDocx({ files: [file1, file2], output_path: out, mode: 'native' }, signal);
    expect(result.success).toBe(true);

    const outZip = await JSZip.loadAsync(await readFile(out));
    const stylesXml = await outZip.file('word/styles.xml')!.async('text');

    // MyBase는 충돌 → MyBase_2로 리네이밍
    expect(stylesXml).toContain('w:styleId="MyBase_2"');
    // MyChild의 basedOn이 MyBase_2를 가리켜야 함
    expect(stylesXml).toMatch(/<w:style[^>]*w:styleId="MyChild"[^]*?<w:basedOn w:val="MyBase_2"\/>/);
  });
});

describe('XLSX 스타일 병합', () => {
  it('다른 폰트/채우기를 가진 2파일 병합 — 셀 s 속성 리매핑', async () => {
    const file1 = join(tmpDir, 'a.xlsx');
    const file2 = join(tmpDir, 'b.xlsx');
    const out = join(tmpDir, 'merged.xlsx');

    // 파일 A: 2 fonts, 2 fills, 1 border, 2 cellXfs
    const bufA = await createStyledXlsx({
      sheetName: 'SheetA',
      fonts: [
        '<font><sz val="11"/><name val="Calibri"/></font>',
        '<font><b/><sz val="14"/><name val="Calibri"/></font>',
      ],
      fills: [
        '<fill><patternFill patternType="none"/></fill>',
        '<fill><patternFill patternType="gray125"/></fill>',
      ],
      borders: ['<border><left/><right/><top/><bottom/></border>'],
      cellXfs: [
        '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>',
        '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0"/>',
      ],
      cells: [
        { ref: 'A1', style: 0, value: '일반' },
        { ref: 'A2', style: 1, value: '볼드' },
      ],
    });

    // 파일 B: 다른 폰트 + 노란 채우기
    const bufB = await createStyledXlsx({
      sheetName: 'SheetB',
      fonts: [
        '<font><sz val="11"/><name val="Arial"/></font>',
        '<font><i/><sz val="12"/><name val="Arial"/></font>',
      ],
      fills: [
        '<fill><patternFill patternType="none"/></fill>',
        '<fill><patternFill patternType="gray125"/></fill>',
        '<fill><patternFill patternType="solid"><fgColor rgb="FFFFFF00"/></patternFill></fill>',
      ],
      borders: ['<border><left/><right/><top/><bottom/></border>'],
      cellXfs: [
        '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>',
        '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0"/>',
      ],
      cells: [
        { ref: 'A1', style: 0, value: 'Arial일반' },
        { ref: 'A2', style: 1, value: '이탤릭+노랑' },
      ],
    });

    const { writeFile: wf } = await import('node:fs/promises');
    await wf(file1, bufA);
    await wf(file2, bufB);

    const result = await concatXlsx({ files: [file1, file2], output_path: out, mode: 'native' }, signal);
    expect(result.success).toBe(true);

    const outZip = await JSZip.loadAsync(await readFile(out));
    const stylesXml = await outZip.file('xl/styles.xml')!.async('text');

    // 폰트: Calibri 11(A0), Calibri 14 bold(A1), Arial 11(B0), Arial 12 italic(B1)
    // Calibri 11 ≠ Arial 11 → 중복 없음 → 4개
    const fontCount = (stylesXml.match(/<font[> ]/g) || []).length;
    expect(fontCount).toBeGreaterThanOrEqual(3); // 최소 3개 (일부 중복 가능)

    // fills: none, gray125는 공통 → 중복 제거 → 2(공통) + 1(노랑) = 3
    const fillCount = (stylesXml.match(/<fill[> ]/g) || []).length;
    expect(fillCount).toBeGreaterThanOrEqual(3);

    // 파일B의 시트에서 s 속성이 유효한 cellXfs 인덱스를 참조하는지
    const sheet2Xml = await outZip.file('xl/worksheets/sheet2.xml')!.async('text');
    const sRefs: number[] = [];
    const sr = /\bs="(\d+)"/g;
    let m;
    while ((m = sr.exec(sheet2Xml))) sRefs.push(parseInt(m[1], 10));

    // cellXfs count 확인
    const xfCountMatch = stylesXml.match(/<cellXfs count="(\d+)"/);
    const xfCount = xfCountMatch ? parseInt(xfCountMatch[1], 10) : 0;
    expect(xfCount).toBeGreaterThanOrEqual(3);

    // 모든 s 값이 0 ~ xfCount-1 범위
    for (const s of sRefs) {
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThan(xfCount);
    }
  });

  it('동일 폰트 중복 제거', async () => {
    const file1 = join(tmpDir, 'a.xlsx');
    const file2 = join(tmpDir, 'b.xlsx');
    const out = join(tmpDir, 'merged.xlsx');

    const sameFont = '<font><sz val="11"/><name val="Calibri"/></font>';
    const sameFill0 = '<fill><patternFill patternType="none"/></fill>';
    const sameFill1 = '<fill><patternFill patternType="gray125"/></fill>';
    const sameBorder = '<border><left/><right/><top/><bottom/></border>';
    const sameXf = '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>';

    const bufA = await createStyledXlsx({
      sheetName: 'A', fonts: [sameFont], fills: [sameFill0, sameFill1],
      borders: [sameBorder], cellXfs: [sameXf],
      cells: [{ ref: 'A1', style: 0, value: 'hello' }],
    });
    const bufB = await createStyledXlsx({
      sheetName: 'B', fonts: [sameFont], fills: [sameFill0, sameFill1],
      borders: [sameBorder], cellXfs: [sameXf],
      cells: [{ ref: 'A1', style: 0, value: 'world' }],
    });

    const { writeFile: wf } = await import('node:fs/promises');
    await wf(file1, bufA);
    await wf(file2, bufB);

    const result = await concatXlsx({ files: [file1, file2], output_path: out, mode: 'native' }, signal);
    expect(result.success).toBe(true);

    const outZip = await JSZip.loadAsync(await readFile(out));
    const stylesXml = await outZip.file('xl/styles.xml')!.async('text');

    // 완전 동일 → 중복 제거 → 폰트 1개, 셀스타일 1개
    const fontCount = (stylesXml.match(/<font[> ]/g) || []).length;
    expect(fontCount).toBe(1);

    const xfCountMatch = stylesXml.match(/<cellXfs count="(\d+)"/);
    expect(parseInt(xfCountMatch![1], 10)).toBe(1);
  });
});

describe('XLSX dxfId(조건부 서식) 리매핑', () => {
  it('donor의 dxfId가 base dxfs 수만큼 오프셋됨', async () => {
    const file1 = join(tmpDir, 'a.xlsx');
    const file2 = join(tmpDir, 'b.xlsx');
    const out = join(tmpDir, 'merged.xlsx');

    // 파일 A: dxfs 2개, 시트에 조건부 서식
    const zipA = new JSZip();
    zipA.file('xl/styles.xml',
      `<?xml version="1.0"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
      `<fonts count="1"><font><sz val="11"/></font></fonts>` +
      `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>` +
      `<borders count="1"><border><left/><right/><top/><bottom/></border></borders>` +
      `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
      `<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>` +
      `<dxfs count="2"><dxf><font><color rgb="FF0000"/></font></dxf><dxf><fill><patternFill><bgColor rgb="FFFF00"/></patternFill></fill></dxf></dxfs>` +
      `</styleSheet>`);
    zipA.file('xl/worksheets/sheet1.xml',
      `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
      `<sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>A</t></is></c></row></sheetData>` +
      `<conditionalFormatting sqref="A1"><cfRule type="duplicateValues" dxfId="0" priority="1"/></conditionalFormatting>` +
      `</worksheet>`);
    zipA.file('xl/workbook.xml',
      `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="A" sheetId="1" r:id="rId1"/></sheets></workbook>`);
    zipA.file('xl/_rels/workbook.xml.rels',
      `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"/></Relationships>`);
    zipA.file('[Content_Types].xml',
      `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/></Types>`);
    zipA.file('_rels/.rels',
      `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="xl/workbook.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"/></Relationships>`);

    // 파일 B: dxfs 1개, 시트에 조건부 서식 dxfId="0"
    const zipB = new JSZip();
    zipB.file('xl/styles.xml',
      `<?xml version="1.0"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
      `<fonts count="1"><font><sz val="11"/></font></fonts>` +
      `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>` +
      `<borders count="1"><border><left/><right/><top/><bottom/></border></borders>` +
      `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
      `<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>` +
      `<dxfs count="1"><dxf><font><b/><color rgb="00FF00"/></font></dxf></dxfs>` +
      `</styleSheet>`);
    zipB.file('xl/worksheets/sheet1.xml',
      `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
      `<sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>B</t></is></c></row></sheetData>` +
      `<conditionalFormatting sqref="A1"><cfRule type="duplicateValues" dxfId="0" priority="1"/></conditionalFormatting>` +
      `</worksheet>`);
    zipB.file('xl/workbook.xml',
      `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="B" sheetId="1" r:id="rId1"/></sheets></workbook>`);
    zipB.file('xl/_rels/workbook.xml.rels',
      `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"/></Relationships>`);
    zipB.file('[Content_Types].xml',
      `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/></Types>`);
    zipB.file('_rels/.rels',
      `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="xl/workbook.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"/></Relationships>`);

    const { writeFile: wf } = await import('node:fs/promises');
    await wf(file1, Buffer.from(await zipA.generateAsync({ type: 'arraybuffer' })));
    await wf(file2, Buffer.from(await zipB.generateAsync({ type: 'arraybuffer' })));

    const result = await concatXlsx({ files: [file1, file2], output_path: out, mode: 'native' }, signal);
    expect(result.success).toBe(true);

    const outZip = await JSZip.loadAsync(await readFile(out));
    const stylesXml = await outZip.file('xl/styles.xml')!.async('text');

    // dxfs: 2(A) + 1(B) = 3
    const dxfCountMatch = stylesXml.match(/<dxfs count="(\d+)"/);
    expect(dxfCountMatch).not.toBeNull();
    expect(parseInt(dxfCountMatch![1], 10)).toBe(3);

    // 파일A 시트: dxfId="0" 그대로 유지
    const sheet1Xml = await outZip.file('xl/worksheets/sheet1.xml')!.async('text');
    expect(sheet1Xml).toContain('dxfId="0"');

    // 파일B 시트: dxfId="0" → dxfId="2" (offset=2)
    const sheet2Xml = await outZip.file('xl/worksheets/sheet2.xml')!.async('text');
    expect(sheet2Xml).toContain('dxfId="2"');
    expect(sheet2Xml).not.toContain('dxfId="0"');
  });
});

// (HWPX section 원본 보존 mock 테스트 제거됨 — 순수 XML 병합으로 전환)

describe('XLSX 실제 파일 스타일 병합', () => {
  const fixturesDir = resolve(process.cwd(), '../../kordoc/tests/fixtures/real');
  // 디렉터리 존재만 보면 코퍼스를 일부만 받은 머신에서 skip 이 아니라 **실패**한다
  // ("수합할 유효한 XLSX 파일이 없습니다"). 실제로 쓰는 파일까지 확인해야 가드가 산다.
  const requiredFixtures = ['공공체육시설.xlsx', '서식민원처리실적.xlsx'];
  const hasFixtures =
    existsSync(fixturesDir) && requiredFixtures.every((f) => existsSync(join(fixturesDir, f)));

  it.skipIf(!hasFixtures)('공공체육시설 + 서식민원처리실적 병합 — 셀 스타일 유효성', async () => {
    const [file1, file2] = requiredFixtures.map((f) => join(fixturesDir, f));
    const out = join(tmpDir, 'merged_real.xlsx');

    const result = await concatXlsx({ files: [file1, file2], output_path: out, mode: 'native' }, signal);
    expect(result.success).toBe(true);
    expect(result.failed_files).toHaveLength(0);

    const outZip = await JSZip.loadAsync(await readFile(out));
    const stylesXml = await outZip.file('xl/styles.xml')!.async('text');

    // cellXfs count 파싱
    const xfCountMatch = stylesXml.match(/<cellXfs count="(\d+)"/);
    expect(xfCountMatch).not.toBeNull();
    const xfCount = parseInt(xfCountMatch![1], 10);
    expect(xfCount).toBeGreaterThan(1);

    // 모든 시트의 모든 셀 s 속성이 유효 범위인지
    const sheetFiles = outZip.file(/xl\/worksheets\/sheet\d+\.xml$/);
    for (const sf of sheetFiles) {
      const sheetXml = await sf.async('text');
      const sr = /\bs="(\d+)"/g;
      let m;
      while ((m = sr.exec(sheetXml))) {
        const s = parseInt(m[1], 10);
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThan(xfCount);
      }
    }

    // fonts/fills/borders/dxfs count 정합
    for (const tag of ['fonts', 'fills', 'borders', 'dxfs']) {
      const countMatch = stylesXml.match(new RegExp(`<${tag} count="(\\d+)"`));
      if (countMatch) {
        const count = parseInt(countMatch[1], 10);
        const singular = tag.replace(/s$/, '');
        const blockRe = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`);
        const blockMatch = stylesXml.match(blockRe);
        if (blockMatch) {
          const elements = (blockMatch[1].match(new RegExp(`<${singular}[> /]`, 'g')) || []).length;
          expect(elements).toBe(count);
        }
      }
    }

    // dxfs가 있으면 모든 시트의 dxfId가 유효 범위
    const dxfCountMatch = stylesXml.match(/<dxfs count="(\d+)"/);
    if (dxfCountMatch) {
      const dxfCount = parseInt(dxfCountMatch[1], 10);
      for (const sf of sheetFiles) {
        const sheetXml = await sf.async('text');
        const dr = /\bdxfId="(\d+)"/g;
        let dm;
        while ((dm = dr.exec(sheetXml))) {
          const d = parseInt(dm[1], 10);
          expect(d).toBeGreaterThanOrEqual(0);
          expect(d).toBeLessThan(dxfCount);
        }
      }
    }

    // OOXML 구조 검증: workbook.xml의 시트 수와 실제 시트 파일 수 일치
    const wbXml = await outZip.file('xl/workbook.xml')!.async('text');
    const wbSheetCount = (wbXml.match(/<sheet /g) || []).length;
    expect(sheetFiles.length).toBe(wbSheetCount);

    // workbook.xml.rels의 worksheet 관계 수와 시트 수 일치
    const relsXml = await outZip.file('xl/_rels/workbook.xml.rels')!.async('text');
    const wsRelCount = (relsXml.match(/relationships\/worksheet/g) || []).length;
    expect(wsRelCount).toBe(wbSheetCount);

    // [Content_Types].xml의 worksheet Override 수와 시트 수 일치
    const ctXml = await outZip.file('[Content_Types].xml')!.async('text');
    const ctWsCount = (ctXml.match(/<Override[^>]*spreadsheetml\.worksheet[^>]*\/>/g) || []).length;
    expect(ctWsCount).toBe(wbSheetCount);
  });
});

describe('XLSX 서식 유지 수합', () => {
  it('2개 XLSX 병합 → 시트 2개 + shared strings 통합', async () => {
    const file1 = join(tmpDir, 'a.xlsx');
    const file2 = join(tmpDir, 'b.xlsx');
    const out = join(tmpDir, 'merged.xlsx');

    const buf1 = await createMinimalXlsx('매출', [['제품', '금액'], ['A', '1000']]);
    const buf2 = await createMinimalXlsx('재고', [['제품', '수량'], ['B', '50']]);

    await Promise.all([
      import('node:fs/promises').then(fs => fs.writeFile(file1, buf1)),
      import('node:fs/promises').then(fs => fs.writeFile(file2, buf2)),
    ]);

    const result = await concatXlsx({ files: [file1, file2], output_path: out, mode: 'native' }, signal);

    expect(result.success).toBe(true);
    expect(result.failed_files).toHaveLength(0);

    // 출력 ZIP 검증
    const outBuf = await readFile(out);
    const outZip = await JSZip.loadAsync(outBuf);

    // 시트 2개
    const sheets = outZip.file(/xl\/worksheets\/sheet\d+\.xml$/);
    expect(sheets.length).toBe(2);

    // workbook.xml에 시트명 포함
    const wbXml = await outZip.file('xl/workbook.xml')!.async('text');
    // 파일당 1시트이므로 파일명이 시트명으로 사용됨
    expect(wbXml).toContain('a');
    expect(wbXml).toContain('b');

    // shared strings 통합 — '제품'은 중복이므로 dedup
    const ssXml = await outZip.file('xl/sharedStrings.xml')!.async('text');
    // '제품'이 1번만 나와야 함 (dedup)
    const productCount = (ssXml.match(/<t>제품<\/t>/g) || []).length;
    expect(productCount).toBe(1);
  });
});
