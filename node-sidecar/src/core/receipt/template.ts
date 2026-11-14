/** 기관 지출조서 서식 — 표 머리 칸 이름으로 칸마다 넣을 값을 정하고(학습), 서식 사본의 표 줄을 채운다
 *
 * 서식은 HWPX(HWP 는 rhwp 로 서식 그대로 HWPX)로 앱 데이터 receipt/template.hwpx 에 사본을 두고, 원본은 건드리지 않는다.
 * 표 찾기: 문서의 표(칸 속 표까지) 가운데 머리 칸 이름이 가장 많이 맞는 줄이 있는 표. 대응표는 설정 receipt.columns.
 * 채우기: 머리줄 아래 빈 줄(연번 숫자만 있는 줄 포함)에 차례로, 모자라면 마지막 빈 줄을 복제해 더하고(rowAddr·rowCnt·표 높이 맞춤),
 * 합계 줄이 있으면 금액 칸에 합. 제목·결재란·서명란 등 나머지는 그대로.
 */

import { existsSync, mkdirSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { basename, join } from 'node:path';
import JSZip from 'jszip';
import { buildParagraphSplices, applySplices, scanSectionXml, type ScanCell, type ScanTable, type SpliceEdit } from 'kordoc';
import type { ReceiptColumn, ReceiptTemplateInfo } from '../../types/rpc-contract.js';
import { dataDir, getSettings, updateSettings } from '../../infra/config.js';
import { aiConfigured, ask, parseJsonLoose } from '../../infra/llm/index.js';
import { logger } from '../../infra/logger.js';
import { errorText } from '../errors.js';
import { atomicWriteFile } from '../files/io.js';
import { sampleBytes } from '../style/extract.js';

export const FIELDS: ReceiptColumn[] = ['seq', 'date', 'vendor', 'brn', 'purpose', 'amount', 'supply', 'vat', 'payment', 'approval', 'owner', 'address', 'note'];

/** 머리 칸 이름 → 값 (공백·괄호 속 단위를 뺀 이름으로, 먼저 같은 것 다음 포함) */
const SYNONYMS: Array<[ReceiptColumn, string[]]> = [
  ['seq', ['연번', '번호', '순번', '순', 'no']],
  ['brn', ['사업자등록번호', '사업자번호', '등록번호']],
  ['date', ['지출일자', '지출일', '일자', '날짜', '거래일', '거래일자', '사용일', '사용일자', '집행일', '집행일자', '결제일', '결제일자', '구입일', '구입일자', '연월일', '년월일']],
  ['vendor', ['거래처', '거래처명', '상호', '상호명', '지급처', '업체', '업체명', '가맹점', '가맹점명', '사용처', '판매처', '채주', '구입처']],
  ['supply', ['공급가액', '공급가']],
  ['vat', ['부가세', '부가가치세', '세액']],
  ['amount', ['금액', '지출액', '지출금액', '합계금액', '결제금액', '사용금액', '집행액', '집행금액', '총액', '청구금액', '구입금액']],
  ['purpose', ['적요', '내역', '품명', '품목', '내용', '사용내역', '지출내역', '용도', '사용목적', '지출내용', '구입내역', '사용용도']],
  ['payment', ['결제방법', '지급방법', '결제수단', '지급수단', '결제구분', '지출방법', '카드현금']],
  ['approval', ['승인번호']],
  ['owner', ['대표자', '대표자명']],
  ['address', ['주소', '소재지', '사업장소재지']],
  ['note', ['비고', '참고']],
];

export const headerKey = (s: string) => s.toLowerCase().replace(/\([^)]*\)|\[[^\]]*\]/g, '').replace(/[\s·/,.:]/g, '');

export function fieldOf(header: string): ReceiptColumn | '' {
  const k = headerKey(header);
  if (!k) return '';
  for (const [f, names] of SYNONYMS) if (names.includes(k)) return f;
  // 포함으로 맞출 때 '번호'만으로는 연번이 아니다 (카드승인번호·전화번호·계좌번호 칸에 연번이 들어간다)
  for (const [f, names] of SYNONYMS) if (names.some((n) => n.length >= 2 && n !== '번호' && n !== 'no' && k.includes(n))) return f;
  return '';
}

const TOTAL_CELL = /^(합\s*계|총\s*계|계|소\s*계|총\s*액)$/;
const cellText = (c: ScanCell) => c.paragraphs.map((p) => p.text).join(' ').trim();

interface Located {
  section: string;
  sectionIndex: number;
  xml: string;
  table: ScanTable;
  /** 머리줄 (rows 차례) */
  header: number;
  /** 머리 칸 (colAddr 차례) */
  heads: Array<{ col: number; text: string }>;
}

function allTables(tables: ScanTable[], out: ScanTable[] = [], depth = 0): ScanTable[] {
  if (depth > 8) return out;
  for (const t of tables) {
    out.push(t);
    for (const row of t.rows) for (const c of row) allTables(c.tables, out, depth + 1);
  }
  return out;
}

async function sections(zip: JSZip): Promise<Array<{ name: string; index: number; xml: string }>> {
  const names = Object.keys(zip.files).filter((n) => /[Ss]ection\d+\.xml$/i.test(n))
    .sort((a, b) => Number(a.match(/(\d+)\.xml$/i)?.[1] ?? 0) - Number(b.match(/(\d+)\.xml$/i)?.[1] ?? 0));
  return Promise.all(names.map(async (name, index) => ({ name, index, xml: await zip.file(name)!.async('text') })));
}

/** 머리 칸 이름이 가장 많이 맞는 표·줄 (두 칸 이상). 없으면 칸 이름이 낯선 서식도 쓰게(AI·사용자가 대응표를 고른다)
 *  짧은 이름이 네 칸 넘게 꽉 찬 줄 아래에 줄이 더 있는 첫 표 (결재란 세 칸 표는 빠진다) */
async function locate(zip: JSZip): Promise<Located | null> {
  let best: (Located & { score: number }) | null = null;
  let loose: Located | null = null;
  for (const s of await sections(zip)) {
    const scan = scanSectionXml(s.xml, s.index);
    for (const table of allTables([...scan.tables, ...scan.orphanTables])) {
      table.rows.slice(0, 8).forEach((row, header) => {
        const heads = row.map((c) => ({ col: c.colAddr ?? 0, text: cellText(c) })).sort((a, b) => a.col - b.col);
        const score = new Set(heads.map((h) => fieldOf(h.text)).filter((f) => f && f !== 'seq' && f !== 'note')).size;
        if (score >= 2 && (!best || score > best.score)) best = { section: s.name, sectionIndex: s.index, xml: s.xml, table, header, heads, score };
        if (!loose && header < 3 && header + 1 < table.rows.length && heads.length >= 4 && heads.every((h) => h.text && h.text.length <= 15 && !/^\d+$/.test(h.text))) {
          loose = { section: s.name, sectionIndex: s.index, xml: s.xml, table, header, heads };
        }
      });
    }
  }
  return best ?? loose;
}

/** 머리줄 아래의 빈 줄(연번 숫자만 있어도 빈 줄)·적혀 있는 줄과 합계 줄 */
function bodyRows(t: ScanTable, header: number): { blank: number[]; filled: number[]; total: number } {
  const span = Math.max(1, ...t.rows[header].map((c) => c.rowSpan || 1));
  const blank: number[] = [];
  const filled: number[] = [];
  let total = -1;
  for (let i = header + span; i < t.rows.length; i++) {
    const texts = t.rows[i].map(cellText);
    if (texts.some((x) => TOTAL_CELL.test(x))) { if (total < 0) total = i; continue; }
    const rest = texts.filter((x, k) => x && !(k === 0 && /^\d{1,3}\.?$/.test(x)));
    (rest.length ? filled : blank).push(i);
  }
  // 합계가 아래(빈 줄 뒤)에 있으면 그 밑의 빈 줄은 서식의 여백·서명 줄: 영수증은 합계 위에만
  const above = (rows: number[]) => (total >= 0 && rows.some((r) => r < total) ? rows.filter((r) => r < total) : rows);
  return { blank: above(blank), filled: above(filled), total };
}

const empty = (): ReceiptTemplateInfo => ({ name: '', columns: [], rows: 0, total_row: false, saved: false, warnings: [] });

async function aiColumns(headers: string[], signal: AbortSignal): Promise<Array<ReceiptColumn | ''>> {
  const system = `지출조서 표의 칸 이름마다 넣을 값을 고르세요. 고를 수 있는 값: ${FIELDS.join(', ')} (seq=연번, date=지출일자, vendor=거래처, brn=사업자등록번호, purpose=적요·품목, amount=금액, supply=공급가액, vat=부가세, payment=결제방법, approval=승인번호, owner=대표자, address=주소, note=비고). 맞는 것이 없으면 "". JSON 으로만: {"fields":["…"]} (칸 차례·개수 그대로)`;
  const { text } = await ask({ system, messages: [{ role: 'user', content: JSON.stringify({ headers }) }], json: true, signal, stream: false });
  const out = parseJsonLoose<{ fields?: unknown[] }>(text).fields ?? [];
  return headers.map((_, i) => (FIELDS.includes(out[i] as ReceiptColumn) ? (out[i] as ReceiptColumn) : ''));
}

const templateDir = () => join(dataDir(), 'receipt');

/** 서식 읽기 → 대응표 (save 면 사본·설정 저장) */
export async function templateLearn(p: { path: string; save?: boolean; ai?: boolean }, signal: AbortSignal): Promise<ReceiptTemplateInfo> {
  const bytes = await sampleBytes(p.path, signal);
  const zip = await JSZip.loadAsync(bytes);
  const at = await locate(zip);
  if (!at) throw new Error('서식에서 지출조서 표를 찾지 못했습니다. 표 머리에 지출일자·거래처·금액 같은 칸 이름이 있는 한글 서식을 넣으세요.');
  const info: ReceiptTemplateInfo = { ...empty(), name: basename(p.path) };
  info.columns = at.heads.map((h) => {
    const field = fieldOf(h.text);
    return { header: h.text, field, by: field ? 'rule' : 'none' };
  });
  // 같은 값이 두 칸에 맞으면 앞 칸만
  const seen = new Set<string>();
  for (const c of info.columns) {
    if (!c.field) continue;
    if (seen.has(c.field)) { c.field = ''; c.by = 'none'; } else seen.add(c.field);
  }
  const missing = info.columns.filter((c) => c.by === 'none' && c.header);
  if (missing.length && p.ai && aiConfigured()) {
    try {
      const got = await aiColumns(info.columns.map((c) => c.header), signal);
      info.columns.forEach((c, i) => { if (c.by === 'none' && got[i] && !seen.has(got[i])) { c.field = got[i]; c.by = 'ai'; seen.add(got[i]); } });
    } catch (err) {
      if (signal.aborted) throw err;
      info.warnings.push(`AI가 칸을 맞추지 못했습니다: ${errorText(err)}`);
    }
  }
  const body = bodyRows(at.table, at.header);
  info.rows = body.blank.length;
  info.total_row = body.total >= 0;
  if (!seen.has('amount')) info.warnings.push('금액 칸을 찾지 못했습니다. 아래에서 금액을 넣을 칸을 고르세요.');
  if (p.save) {
    mkdirSync(templateDir(), { recursive: true });
    const dest = join(templateDir(), 'template.hwpx');
    // 앞서 넣은 서식을 바꿀 때 덮는다: 쓰다 끊기면 앞 서식까지 잃지 않게
    await atomicWriteFile(dest, bytes);
    await updateSettings({ receipt: { template_path: dest, template_name: info.name, columns: info.columns } });
    info.saved = true;
    info.template_path = dest;
  }
  return info;
}

export function templateGet(): ReceiptTemplateInfo | null {
  const r = getSettings().receipt;
  if (!r?.template_path) return null;
  return { ...empty(), name: r.template_name, columns: r.columns as ReceiptTemplateInfo['columns'], saved: true, template_path: r.template_path,
    warnings: existsSync(r.template_path) ? [] : ['서식 사본이 지워졌습니다. 서식을 다시 넣으세요.'] };
}

export async function templateSet(fields: Array<ReceiptColumn | ''>): Promise<ReceiptTemplateInfo> {
  const cur = templateGet();
  if (!cur) throw new Error('등록한 지출조서 서식이 없습니다. 서식을 먼저 넣으세요.');
  const columns = cur.columns.map((c, i) => {
    const f = fields[i] ?? c.field;
    const field = FIELDS.includes(f as ReceiptColumn) ? f : '';
    return { header: c.header, field, by: field === c.field ? c.by : 'user' as const };
  });
  await updateSettings({ receipt: { columns } });
  return { ...cur, columns };
}

export async function templateClear(): Promise<boolean> {
  const r = getSettings().receipt;
  if (r?.template_path && r.template_path.startsWith(templateDir())) await rm(r.template_path, { force: true });
  await updateSettings({ receipt: { template_path: '', template_name: '', columns: [] } });
  return true;
}

// ── 채우기 ──

/** 표 줄 r 을 k 번 복제해 바로 뒤에 넣는다: 아래 줄의 rowAddr·표 rowCnt·표 높이를 맞춘다 */
function insertRows(xml: string, t: ScanTable, r: number, k: number): string {
  const range = t.rowRanges[r];
  const rowXml = xml.slice(range.start, range.end);
  const shift = (s: string, by: number) => s.replace(/(<(?:\w+:)?cellAddr\b[^>]*?\browAddr=")(\d+)(")/g, (_m, a, n, b) => `${a}${Number(n) + by}${b}`);
  const copies = Array.from({ length: k }, (_, j) => shift(rowXml, j + 1)).join('');
  const edits: SpliceEdit[] = [{ start: range.end, end: range.end, replacement: copies }];
  for (let i = r + 1; i < t.rows.length; i++) {
    for (const c of t.rows[i]) {
      if (!c.addrTagRange) continue;
      edits.push({ start: c.addrTagRange.start, end: c.addrTagRange.end, replacement: shift(xml.slice(c.addrTagRange.start, c.addrTagRange.end), k) });
    }
  }
  // 표 여는 태그의 rowCnt, 바로 뒤 크기의 높이
  const open = /<(?:\w+:)?tbl\b[^>]*>/.exec(xml.slice(t.start));
  if (open) {
    const s = t.start + open.index;
    edits.push({ start: s, end: s + open[0].length, replacement: open[0].replace(/\browCnt="(\d+)"/, (_m, n) => `rowCnt="${Number(n) + k}"`) });
    const rowH = Number(/<(?:\w+:)?cellSz\b[^>]*\bheight="(\d+)"/.exec(rowXml)?.[1] ?? 0);
    const after = s + open[0].length;
    const sz = /^<(?:\w+:)?sz\b[^>]*\/>/.exec(xml.slice(after));
    if (sz && rowH) edits.push({ start: after, end: after + sz[0].length, replacement: sz[0].replace(/\bheight="(\d+)"/, (_m, n) => `height="${Number(n) + rowH * k}"`) });
  }
  return applySplices(xml, edits);
}

function cellAt(row: ScanCell[], col: number): ScanCell | undefined {
  return row.find((c) => (c.colAddr ?? -1) === col);
}

/** 칸 글 바꾸기 (첫 문단에 쓰고 나머지 문단은 비움) */
function setCell(xml: string, cell: ScanCell | undefined, text: string, edits: SpliceEdit[]): void {
  if (!cell?.paragraphs.length) return;
  cell.paragraphs.forEach((p, i) => {
    const want = i === 0 ? text : '';
    if (p.text === want) return;
    const s = buildParagraphSplices(p, want, xml);
    if (s) edits.push(...s);
  });
}

/** 서식에 값 넣기. values[i][field] = 그 줄의 칸 글, totals[field] = 합계 줄 값 */
/** 서식 표의 합계 줄 자리 — 미리보기·복사 표를 저장 파일과 같은 차례로 (합계 줄이 없으면 none) */
export async function templateTotalAt(templatePath: string): Promise<'top' | 'bottom' | 'none'> {
  const at = await locate(await JSZip.loadAsync(await readFile(templatePath)));
  if (!at) return 'none';
  const { blank, filled, total } = bodyRows(at.table, at.header);
  if (total < 0) return 'none';
  // 빈 줄이 없으면 적혀 있던 줄을 지우고 쓰고, 그것도 없으면 머리줄 바로 아래에 줄을 더한다 (fillTemplate)
  return total > (blank[0] ?? filled[0] ?? at.header) ? 'bottom' : 'top';
}

export async function fillTemplate(templatePath: string, columns: Array<{ field: string }>, values: Array<Record<string, string>>, totals: Record<string, string>): Promise<{ bytes: Uint8Array; warnings: string[] }> {
  const zip = await JSZip.loadAsync(await readFile(templatePath));
  const warnings: string[] = [];
  let at = await locate(zip);
  if (!at) throw new Error('서식에서 지출조서 표를 찾지 못했습니다. 설정 › 내 기관 정보의 지출조서 서식을 다시 넣으세요.');
  // 서식이 바뀌어 칸 수가 달라졌으면 이름으로 다시 맞춘다
  const fields = at.heads.length === columns.length ? columns.map((c) => c.field) : at.heads.map((h) => fieldOf(h.text));
  if (at.heads.length !== columns.length) warnings.push('서식 표의 칸 수가 학습할 때와 달라 칸 이름으로 다시 맞췄습니다.');
  const body = bodyRows(at.table, at.header);
  let { blank, total } = body;
  // 빈 줄이 하나도 없는 서식(다 채운 지난 지출조서를 넣었다): 적혀 있던 줄을 지우고 쓴다. 그대로 두면 옛 줄 아래에 새 줄이 붙고
  // 합계는 새 줄만 더한다. 이때와 머리줄을 본뜰 때는 채우는 줄의 못 맞춘 칸도 비운다 (본뜬 줄의 옛 글·칸 이름이 남지 않게)
  const wipe = !blank.length;
  if (wipe && body.filled.length) {
    blank = body.filled;
    warnings.push('서식 표에 적혀 있던 예전 내용은 지우고 채웠습니다. 빈 서식을 넣으면 이 알림이 나오지 않습니다.');
  }
  if (blank.length < values.length) {
    // 복제할 줄: 마지막 채울 줄 → 머리줄. 사본은 그 줄 바로 뒤에 들어간다
    const src = blank.length ? blank[blank.length - 1] : at.header;
    const need = values.length - blank.length;
    const xml = insertRows(at.xml, at.table, src, need);
    zip.file(at.section, xml);
    at = await locate(zip);
    if (!at) throw new Error('서식 표에 줄을 더하지 못했습니다.');
    total = bodyRows(at.table, at.header).total;
    blank = [...blank, ...Array.from({ length: need }, (_, i) => src + 1 + i)];
  }
  const edits: SpliceEdit[] = [];
  const { xml, table } = at;
  const fieldAt = new Map(at.heads.map((h, k) => [h.col, fields[k]]));
  blank.forEach((r, i) => {
    const v = values[i];
    if (wipe) {
      // 값이 모자라 남은 옛 줄은 통째로 비운다
      for (const c of table.rows[r]) setCell(xml, c, v?.[fieldAt.get(c.colAddr ?? -1) ?? ''] ?? '', edits);
    } else if (v) {
      at!.heads.forEach((h, k) => {
        const f = fields[k];
        if (f) setCell(xml, cellAt(table.rows[r], h.col), v[f] ?? '', edits);
      });
    }
  });
  if (total >= 0) {
    at.heads.forEach((h, k) => {
      const f = fields[k];
      const c = cellAt(table.rows[total], h.col);
      if (f && totals[f] !== undefined && c && !TOTAL_CELL.test(cellText(c))) setCell(xml, c, totals[f], edits);
    });
  }
  zip.file(at.section, applySplices(xml, edits));
  // HWPX 규칙: mimetype 은 맨 앞·압축 없음
  const mimetype = await zip.file('mimetype')?.async('uint8array');
  if (mimetype) zip.file('mimetype', mimetype, { compression: 'STORE' });
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  logger.info(`[receipt] 서식 채움 ${values.length}줄 (${basename(templatePath)})`);
  return { bytes, warnings };
}
