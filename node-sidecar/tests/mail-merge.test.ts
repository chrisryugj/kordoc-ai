/** 명부 합치기 — 엑셀 표시 형식·숨긴 행·머리 두 줄·엑셀 줄 번호·기관 정보 기본 끔·취소 뒷정리 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import JSZip from 'jszip';
import { markdownToHwpx, parse } from 'kordoc';
import { call, setupEnv } from './doc-helpers.js';
import { formatNumber } from '../src/core/template/xlsx-view.js';
import { mailMerge } from '../src/core/template/index.js';

vi.mock('../src/infra/progress.js', async (orig) => ({ ...(await orig<typeof import('../src/infra/progress.js')>()), sendProgress: vi.fn(), sendNotification: vi.fn() }));

let env: ReturnType<typeof setupEnv>;
beforeAll(() => {
  env = setupEnv();
});

type Cell = string | number | null | { v: number; s: number };
const colName = (i: number) => String.fromCharCode(65 + i);
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

/** 손으로 짠 XLSX — 스타일 1=0##-####-####, 2=000000-0000000, 3=0%(9), 4=#,##0(3), 5=000000 */
async function rawXlsx(rows: Array<{ cells: Cell[]; hidden?: boolean }>, merges: string[] = []): Promise<Buffer> {
  const zip = new JSZip();
  const sst: string[] = [];
  const rowsXml = rows.map((row, r) => `<row r="${r + 1}"${row.hidden ? ' hidden="1"' : ''}>${row.cells.map((c, ci) => {
    if (c === null) return '';
    const ref = `${colName(ci)}${r + 1}`;
    if (typeof c === 'string') { sst.push(c); return `<c r="${ref}" t="s"><v>${sst.length - 1}</v></c>`; }
    if (typeof c === 'number') return `<c r="${ref}"><v>${c}</v></c>`;
    return `<c r="${ref}" s="${c.s}"><v>${c.v}</v></c>`;
  }).join('')}</row>`).join('');
  const mergeXml = merges.length ? `<mergeCells count="${merges.length}">${merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : '';
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
  zip.file('xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="명부" sheetId="1" r:id="rId1"/></sheets></workbook>');
  zip.file('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>');
  zip.file('xl/styles.xml', '<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="3"><numFmt numFmtId="164" formatCode="0##-####-####"/><numFmt numFmtId="165" formatCode="000000-0000000"/><numFmt numFmtId="166" formatCode="000000"/></numFmts><cellXfs count="6"><xf numFmtId="0"/><xf numFmtId="164" applyNumberFormat="1"/><xf numFmtId="165" applyNumberFormat="1"/><xf numFmtId="9" applyNumberFormat="1"/><xf numFmtId="3" applyNumberFormat="1"/><xf numFmtId="166" applyNumberFormat="1"/></cellXfs></styleSheet>');
  zip.file('xl/worksheets/sheet1.xml', `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rowsXml}</sheetData>${mergeXml}</worksheet>`);
  zip.file('xl/sharedStrings.xml', `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${sst.map((s) => `<si><t>${esc(s)}</t></si>`).join('')}</sst>`);
  return zip.generateAsync({ type: 'nodebuffer' });
}

/** 라벨-값 표 양식 (누름틀 없음) */
async function labelForm(labels: string[]): Promise<string> {
  const rows: string[] = [];
  for (let i = 0; i < labels.length; i += 2) rows.push(`| ${labels[i]} |   | ${labels[i + 1] ?? ' '} |   |`);
  const p = join(env.work, `form-${labels.length}-${labels[0]}.hwpx`);
  writeFileSync(p, Buffer.from(await markdownToHwpx(`# 확인서\n\n| 항목 | 내용 | 항목 | 내용 |\n| --- | --- | --- | --- |\n${rows.join('\n')}\n`, {})));
  return p;
}

const tableOf = async (p: string) => {
  const r = await parse(readFileSync(p));
  return r.success ? r.markdown : '';
};

describe('엑셀 표시 형식 (formatNumber)', () => {
  it('전화·주민번호 사용자 서식, 백분율, 쉼표, 자리 채움', () => {
    expect(formatNumber(1012345678, '0##-####-####')).toBe('010-1234-5678');
    expect(formatNumber(101013234567, '000000-0000000')).toBe('010101-3234567');
    expect(formatNumber(0.5, '0%')).toBe('50%');
    expect(formatNumber(0.125, '0%')).toBe('13%');
    expect(formatNumber(0.125, '0.0%')).toBe('12.5%');
    expect(formatNumber(1234000, '#,##0')).toBe('1,234,000');
    expect(formatNumber(-1234.5, '#,##0.00')).toBe('-1,234.50');
    expect(formatNumber(-1234, '#,##0 ;(#,##0)')).toBe('(1,234)');
    expect(formatNumber(4321, '000000')).toBe('004321');
    expect(formatNumber(1234567, '[<=9999999]###-####;(0##) ###-####')).toBe('123-4567');
    expect(formatNumber(5000, '#,##0"원"')).toBe('5,000원');
    expect(formatNumber(1.5, '0.##')).toBe('1.5');
    expect(formatNumber(0.0000001, '0.00')).toBe('0.00');
    // 못 그리는 형식은 null (원래 값 그대로 둔다)
    expect(formatNumber(12345, '0.00E+00')).toBeNull();
    expect(formatNumber(12345, '[DBNum1]General')).toBeNull();
  });
});

describe('mail_merge 명부 읽기', () => {
  it('엑셀에 보이는 글로 넣는다 (010-1234-5678 이 101-234-5678 이 되지 않게)', async () => {
    const xlsx = join(env.work, 'fmt.xlsx');
    writeFileSync(xlsx, await rawXlsx([
      { cells: ['성명', '연락처', '주민번호', '감면율', '지급액', '우편번호'] },
      { cells: ['김하나', { v: 1012345678, s: 1 }, { v: 101013234567, s: 2 }, { v: 0.5, s: 3 }, { v: 1234000, s: 4 }, { v: 4321, s: 5 }] },
    ]));
    const form = await labelForm(['성명', '연락처', '주민번호', '감면율', '지급액', '우편번호']);
    const plan = await call('mail_merge_plan', { template_path: form, data_path: xlsx });
    expect(plan.columns.map((c: { sample?: string }) => c.sample)).toEqual(['김하나', '010-1234-5678', '010101-3234567', '50%', '1,234,000', '004321']);
    const r = await call('mail_merge', { template_path: form, data_path: xlsx, output_dir: join(env.out, 'fmt') });
    const md = await tableOf(r.outputs[0]);
    for (const v of ['010-1234-5678', '010101-3234567', '50%', '1,234,000', '004321']) expect(md).toContain(v);
  }, 30_000);

  it('숨긴 행은 건너뛰고 계획에 몇 줄인지 알린다 · 실패 줄 번호는 엑셀 줄 번호', async () => {
    const xlsx = join(env.work, 'hidden.xlsx');
    writeFileSync(xlsx, await rawXlsx([
      { cells: ['제목', '비고'] },
      { cells: ['첫 공문', 'a'] },
      { cells: ['숨긴 공문', 'b'], hidden: true },
      { cells: [] },
      { cells: [null, '제목 없음'] },
      { cells: ['둘째 공문', 'c'] },
    ]));
    const plan = await call('mail_merge_plan', { template: 'gian', data_path: xlsx });
    expect(plan.rows).toBe(3);
    expect(plan.hidden_rows).toBe(1);
    const r = await call('mail_merge', { template: 'gian', data_path: xlsx, output_dir: join(env.out, 'hidden') });
    expect(r.outputs).toHaveLength(2);
    for (const o of r.outputs) expect(await tableOf(o)).not.toContain('숨긴 공문');
    // 빈 4행이 표에서 빠져도 엑셀의 5행으로 알린다
    expect(r.failed.map((f: { row: number }) => f.row)).toEqual([5]);
  });

  it('머리 줄이 둘(합친 머리)이면 아랫줄 이름을 열 이름으로, 둘째 머리 줄로 문서를 만들지 않는다', async () => {
    const xlsx = join(env.work, 'twohead.xlsx');
    writeFileSync(xlsx, await rawXlsx([
      { cells: ['성명', '연락처', null] },
      { cells: [null, '전화', '이메일'] },
      { cells: ['김하나', '010-1111-2222', 'a@example.go.kr'] },
      { cells: ['이두리', '010-3333-4444', 'b@example.go.kr'] },
    ], ['A1:A2', 'B1:C1']));
    const form = await labelForm(['성명', '전화', '이메일']);
    const plan = await call('mail_merge_plan', { template_path: form, data_path: xlsx });
    expect(plan.columns.map((c: { name: string }) => c.name)).toEqual(['성명', '전화', '이메일']);
    expect(plan.rows).toBe(2);
    const r = await call('mail_merge', { template_path: form, data_path: xlsx, name_column: '성명', output_dir: join(env.out, 'two') });
    expect(r.outputs.map((p: string) => p.split(/[\\/]/).pop())).toEqual(['김하나.hwpx', '이두리.hwpx']);
    expect(await tableOf(r.outputs[0])).toContain('a@example.go.kr');
  });

  it('머리가 세 줄 이상으로 합쳐져 있으면 계획 단계에서 까닭을 알리고 막는다', async () => {
    const xlsx = join(env.work, 'threehead.xlsx');
    writeFileSync(xlsx, await rawXlsx([
      { cells: ['성명', '연락처', null] },
      { cells: [null, '전화', null] },
      { cells: [null, '사무실', '휴대폰'] },
      { cells: ['김하나', '02-111-2222', '010-1111-2222'] },
    ], ['A1:A3', 'B1:C1', 'B2:C2']));
    await expect(call('mail_merge_plan', { template: 'gian', data_path: xlsx })).rejects.toThrow(/머리 줄이 세 줄 이상으로 합쳐져.*한 줄로 적은 뒤/);
  });
});

describe('mail_merge 취소', () => {
  it('취소하면 이번에 만든 문서와 이번에 만든 폴더를 지우고, 원래 있던 파일은 그대로', async () => {
    const csv = join(env.work, '취소.csv');
    writeFileSync(csv, '제목\n첫째\n둘째\n셋째\n');
    // 새로 만드는 폴더
    const fresh = join(env.out, 'cancel-new');
    const ac = new AbortController();
    const progress = await import('../src/infra/progress.js');
    vi.mocked(progress.sendProgress).mockImplementation((p: { current?: number }) => { if (p.current === 2) ac.abort(); });
    await expect(mailMerge({ template: 'gian', data_path: csv, output_dir: fresh }, ac.signal)).rejects.toThrow();
    expect(existsSync(fresh)).toBe(false);
    // 원래 있던 폴더: 사용자 파일은 남고 이번 문서만 빠진다
    const mine = join(env.out, 'cancel-mine');
    mkdirSync(mine, { recursive: true });
    writeFileSync(join(mine, '내 메모.txt'), 'x');
    const ac2 = new AbortController();
    vi.mocked(progress.sendProgress).mockImplementation((p: { current?: number }) => { if (p.current === 2) ac2.abort(); });
    await expect(mailMerge({ template: 'gian', data_path: csv, output_dir: mine }, ac2.signal)).rejects.toThrow();
    expect(readdirSync(mine)).toEqual(['내 메모.txt']);
    vi.mocked(progress.sendProgress).mockReset();
  }, 30_000);
});
