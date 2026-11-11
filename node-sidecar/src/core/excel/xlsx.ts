/** 최소 XLSX 작성기 (jszip) — 시트 여러 장·칸 병합·머리 행·줄바꿈·숫자 칸·노란 표시 칸·굵은 행
 *
 * 공유 문자열 없이 inlineStr 로 쓴다. 숫자는 앞자리 0 이 없는 것만 숫자 칸으로
 * (전화번호·우편번호·문서번호가 숫자로 바뀌어 0 이 사라지는 것을 막는다).
 */

import JSZip from 'jszip';

export interface Sheet {
  name: string;
  rows: string[][];
  /** 0-based 시작 칸 + 행·열 병합 수 */
  merges?: Array<{ r: number; c: number; rs: number; cs: number }>;
  /** 첫 행을 머리로 (굵게·음영·틀 고정) */
  header?: boolean;
  /** 노란 바탕으로 표시할 칸 (0-based 행·열, 예: 문서 수합의 빈 필수 칸) */
  marks?: Array<{ r: number; c: number }>;
  /** 굵게 쓸 행 (0-based, 예: 합계 행) */
  bold?: number[];
}

const BAD_XML = /[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g;
const esc = (s: string) => s.replace(BAD_XML, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function colName(i: number): string {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

// 쉼표 없는 12자리 이상은 글 칸으로 둔다: 계좌·등록·관리 번호가 숫자 칸이 되면 엑셀이 1.10123E+11 꼴로 보여 준다 (금액은 11자리면 충분하다)
const NUMBER = /^-?(0|[1-9]\d{0,10}|[1-9]\d{0,2}(,\d{3})+)(\.\d+)?$/;

/** 동아시아 글자는 두 칸으로 세어 열 너비 */
function textWidth(s: string): number {
  let w = 0;
  for (const line of s.split('\n')) {
    let lw = 0;
    for (const ch of line) lw += /[ᄀ-ᇿ　-鿿가-힯＀-￯]/.test(ch) ? 2 : 1;
    w = Math.max(w, lw);
  }
  return w;
}

function sheetName(name: string, used: Set<string>): string {
  const base = (name.replace(/[[\]:*?/\\]/g, ' ').trim() || '시트').slice(0, 31);
  let n = base;
  for (let i = 2; used.has(n.toLowerCase()); i++) n = `${base.slice(0, 31 - String(i).length - 1)}_${i}`;
  used.add(n.toLowerCase());
  return n;
}

function sheetXml(s: Sheet): string {
  const cols = Math.max(0, ...s.rows.map((r) => r.length));
  const widths = Array.from({ length: cols }, (_, c) => Math.min(60, Math.max(8, ...s.rows.slice(0, 500).map((r) => textWidth(r[c] ?? '') + 2))));
  const colsXml = cols ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
  const view = s.header && s.rows.length > 1
    ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
    : '<sheetViews><sheetView workbookViewId="0"/></sheetViews>';
  const marked = new Set((s.marks ?? []).map((m) => `${m.r},${m.c}`));
  const bold = new Set(s.bold ?? []);
  const rowsXml = s.rows.map((row, r) => {
    const cells = Array.from({ length: cols }, (_, c) => {
      const v = row[c] ?? '';
      const ref = `${colName(c)}${r + 1}`;
      if (s.header && r === 0) return `<c r="${ref}" t="inlineStr" s="1"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
      const t = v.trim();
      const b = bold.has(r);
      // 소수는 적힌 자릿수 그대로 보이는 표시 형식을 준다. 일반 숫자 칸으로 쓰면 "11.10"·"2026.10"·"84.90" 의 끝 0 이 사라져
      // 11.1 로 보이고(11월 10일이 11월 1일로 읽힌다), 천 단위 서식(#,##0)은 "1,234.5" 를 1,235 로 보인다.
      // 글 칸으로 두면 보이기는 맞지만 엑셀의 합계(SUM)에서 조용히 빠진다 → 숫자 칸 + 표시 형식
      if (NUMBER.test(t)) {
        const digits = t.includes('.') ? t.length - t.indexOf('.') - 1 : 0;
        const comma = t.includes(',');
        if (digits === 0) return `<c r="${ref}" s="${b ? 7 : comma ? 3 : 4}"><v>${t.replace(/,/g, '')}</v></c>`;
        if (digits <= MAX_DECIMALS) return `<c r="${ref}" s="${decimalStyle(digits, comma, b)}"><v>${t.replace(/,/g, '')}</v></c>`;
      }
      const st = marked.has(`${r},${c}`) ? 5 : b ? 6 : 2;
      return v ? `<c r="${ref}" t="inlineStr" s="${st}"><is><t xml:space="preserve">${esc(v)}</t></is></c>` : `<c r="${ref}" s="${st}"/>`;
    }).join('');
    return `<row r="${r + 1}">${cells}</row>`;
  }).join('');

  // 병합 — 범위 밖·겹침은 버린다 (엑셀이 '복구' 경고를 띄움)
  const taken = new Set<string>();
  const merges: string[] = [];
  for (const m of s.merges ?? []) {
    if (m.rs * m.cs <= 1 || m.r + m.rs > s.rows.length || m.c + m.cs > cols) continue;
    const keys: string[] = [];
    for (let r = m.r; r < m.r + m.rs; r++) for (let c = m.c; c < m.c + m.cs; c++) keys.push(`${r},${c}`);
    if (keys.some((k) => taken.has(k))) continue;
    keys.forEach((k) => taken.add(k));
    merges.push(`<mergeCell ref="${colName(m.c)}${m.r + 1}:${colName(m.c + m.cs - 1)}${m.r + m.rs}"/>`);
  }
  const mergeXml = merges.length ? `<mergeCells count="${merges.length}">${merges.join('')}</mergeCells>` : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${view}${colsXml}<sheetData>${rowsXml}</sheetData>${mergeXml}</worksheet>`;
}

/** 소수 자릿수별 표시 형식 (1~6자리 × 쉼표 유무 × 굵게). 칸 서식 번호는 기본 8개 뒤에 차례로 붙는다 */
const MAX_DECIMALS = 6;
const BASE_XFS = 8;
const decimalStyle = (digits: number, comma: boolean, bold: boolean) => BASE_XFS + (digits - 1) * 4 + (comma ? 2 : 0) + (bold ? 1 : 0);
const decimalFmtId = (digits: number, comma: boolean) => 164 + (digits - 1) * 2 + (comma ? 1 : 0);
const DECIMAL_FMTS = Array.from({ length: MAX_DECIMALS }, (_, i) => i + 1).flatMap((d) => [false, true].map((comma) => `<numFmt numFmtId="${decimalFmtId(d, comma)}" formatCode="${comma ? '#,##0' : '0'}.${'0'.repeat(d)}"/>`));
const DECIMAL_XFS = Array.from({ length: MAX_DECIMALS }, (_, i) => i + 1).flatMap((d) => [false, true].flatMap((comma) => [false, true].map((bold) =>
  `<xf numFmtId="${decimalFmtId(d, comma)}" fontId="${bold ? 1 : 0}" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"${bold ? ' applyFont="1"' : ''}/>`)));

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="${DECIMAL_FMTS.length}">${DECIMAL_FMTS.join('')}</numFmts>
<fonts count="2"><font><sz val="11"/><name val="맑은 고딕"/><family val="3"/><charset val="129"/></font><font><b/><sz val="11"/><name val="맑은 고딕"/><family val="3"/><charset val="129"/></font></fonts>
<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF2F2F2"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFEB9C"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFBFBFBF"/></left><right style="thin"><color rgb="FFBFBFBF"/></right><top style="thin"><color rgb="FFBFBFBF"/></top><bottom style="thin"><color rgb="FFBFBFBF"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="${BASE_XFS + DECIMAL_XFS.length}"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="3" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/><xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="3" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyNumberFormat="1" applyBorder="1"/>${DECIMAL_XFS.join('')}</cellXfs>
<cellStyles count="1"><cellStyle name="표준" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

export async function buildXlsx(sheets: Sheet[]): Promise<Buffer> {
  if (!sheets.length) throw new Error('엑셀에 넣을 내용이 없습니다.');
  const used = new Set<string>();
  const names = sheets.map((s) => sheetName(s.name, used));
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`);
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  zip.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  zip.file('xl/styles.xml', STYLES);
  sheets.forEach((s, i) => zip.file(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s)));
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}
