/** 지출조서 만들기 — 줄들 → 클립보드용 TSV·HTML 표, 저장하면 HWPX (기본 서식 또는 등록한 기관 서식)
 *
 * 기본 서식: 제목 "지출조서", 기관·부서·작성일 한 줄, 표(연번 | 지출일자 | 거래처 | 사업자등록번호 | 적요(품목) | 금액 | 결제방법 | 비고).
 * 합계 줄은 머리줄 바로 아래(공문 표 관행). 금액은 천 단위 쉼표. 기관 서식이면 그 표의 칸 차례·이름·합계 줄 자리를 따른다
 * (미리보기·복사 표도 저장 파일과 같은 차례).
 */

import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { markdownToHwpx } from 'kordoc';
import type { ReceiptRow } from '../../types/rpc-contract.js';
import { getSettings } from '../../infra/config.js';
import { outputFile } from '../output/index.js';
import { fillTemplate, templateTotalAt } from './template.js';

const DEFAULT_COLUMNS: Array<{ header: string; field: string }> = [
  { header: '연번', field: 'seq' }, { header: '지출일자', field: 'date' }, { header: '거래처', field: 'vendor' }, { header: '사업자등록번호', field: 'brn' },
  { header: '적요(품목)', field: 'purpose' }, { header: '금액', field: 'amount' }, { header: '결제방법', field: 'payment' }, { header: '비고', field: 'note' },
];
const MONEY_FIELDS = new Set(['amount', 'supply', 'vat']);

/** 숫자만 (쉼표·원·₩ 빼고, 전각 숫자는 반각으로). 공문서의 음수 표기 △·▲·(괄호)는 빼는 금액. 못 읽으면 0 */
export const toNumber = (s: string | undefined) => {
  const t = (s ?? '').normalize('NFKC').trim();
  const d = t.replace(/[^\d-]/g, '');
  const n = Number(d);
  if (!d || !Number.isFinite(n)) return 0;
  return n > 0 && /^[△▲]|^\(.*\)$/.test(t) ? -n : n;
};
export const comma = (n: number) => n.toLocaleString('en-US');

/** 2026-10-28 · 2026.10.28 · 2026/10/28 · 2026년 10월 28일 → 2026. 10. 28. (공문 날짜 표기). 꼴이 다르면 그대로 */
export function dateText(s: string): string {
  const m = /^(\d{4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})\s*[.일]?$/.exec(s.trim());
  return m ? `${m[1]}. ${Number(m[2])}. ${Number(m[3])}.` : s.trim();
}

/** 칸 글 (field → 그 줄 값) */
function cellOf(row: ReceiptRow, field: string, i: number): string {
  if (field === 'seq') return String(i + 1);
  if (field === 'date') return dateText(row.date);
  const v = (row as unknown as Record<string, string | undefined>)[field] ?? '';
  if (MONEY_FIELDS.has(field)) return v.trim() ? comma(toNumber(v)) : '';
  return v.replace(/\s+/g, ' ').trim();
}

export interface ReportTable {
  headers: string[];
  fields: string[];
  /** 합계 줄 (첫 칸 "합계") */
  total: string[];
  rows: string[][];
  /** 합계 줄 자리: 머리줄 바로 아래(기본)·줄들 아래·없음 (기관 서식을 따름) */
  totalAt: 'top' | 'bottom' | 'none';
}

/** template: 기관 서식. 서식의 합계 줄에는 금액만 들어가므로 "영수증 N장" 은 넣지 않는다 */
export function buildTable(rows: ReceiptRow[], columns = DEFAULT_COLUMNS, totalAt: ReportTable['totalAt'] = 'top', template = false): ReportTable {
  const fields = columns.map((c) => c.field);
  const body = rows.map((r, i) => fields.map((f) => cellOf(r, f, i)));
  const sums = Object.fromEntries([...MONEY_FIELDS].map((f) => [f, rows.reduce((s, r) => s + toNumber((r as unknown as Record<string, string>)[f]), 0)]));
  const total = fields.map((f, k) => {
    if (MONEY_FIELDS.has(f)) return f === 'amount' || sums[f] ? comma(sums[f]) : '';
    if (f === 'purpose' && !template) return `영수증 ${rows.length}장`;
    return k === 0 ? '합계' : '';
  });
  if (total[0] !== '합계' && !MONEY_FIELDS.has(fields[0])) total[0] = '합계';
  return { headers: columns.map((c) => c.header || ''), fields, total, rows: body, totalAt };
}

/** 머리줄 다음 줄들 (합계 줄 자리대로) */
const ordered = <T>(t: ReportTable, total: T, rows: T[]): T[] => (t.totalAt === 'top' ? [total, ...rows] : t.totalAt === 'bottom' ? [...rows, total] : rows);

const tsvCell = (s: string) => s.replace(/[\t\r\n]+/g, ' ');
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** 엑셀·한글 붙여 넣기: 머리줄 · 합계 · 줄들 (합계 자리는 totalAt) */
export function toTsv(t: ReportTable): string {
  return [t.headers, ...ordered(t, t.total, t.rows)].map((r) => r.map(tsvCell).join('\t')).join('\r\n');
}

/** 한글·워드·메일에 붙여 넣는 HTML 표 (테두리·금액 오른쪽 맞춤·합계 굵게) */
export function toHtml(t: ReportTable): string {
  const td = (s: string, f: string, tag = 'td', extra = '') =>
    `<${tag} style="border:1px solid #000;padding:2px 6px;${MONEY_FIELDS.has(f) ? 'text-align:right;' : f === 'seq' || f === 'date' || f === 'payment' ? 'text-align:center;' : ''}${extra}">${esc(s)}</${tag}>`;
  const head = `<tr>${t.headers.map((h) => `<th style="border:1px solid #000;padding:2px 6px;background:#f2f2f2;text-align:center;">${esc(h)}</th>`).join('')}</tr>`;
  const total = `<tr>${t.total.map((s, k) => td(s, t.fields[k], 'td', 'font-weight:bold;')).join('')}</tr>`;
  const rows = t.rows.map((r) => `<tr>${r.map((s, k) => td(s, t.fields[k])).join('')}</tr>`);
  return `<table style="border-collapse:collapse;font-size:10pt;">${head}${ordered(t, total, rows).join('')}</table>`;
}

const mdCell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ') || ' ';

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.`;
}

async function defaultHwpx(t: ReportTable, title: string): Promise<Uint8Array> {
  const { org } = getSettings();
  const who = [org.name, org.dept].filter(Boolean).join(' ');
  const md = [
    `# ${title}`,
    '',
    `${who ? `${who} · ` : ''}작성일 ${today()}`,
    '',
    `| ${t.headers.map(mdCell).join(' | ')} |`,
    `| ${t.headers.map(() => '---').join(' | ')} |`,
    `| ${t.total.map(mdCell).join(' | ')} |`,
    ...t.rows.map((r) => `| ${r.map(mdCell).join(' | ')} |`),
    '',
  ].join('\n');
  // 보고서 갈래 표(머리 음영·가운데 맞춤)로, A4 세로에 여덟 칸이 들어간다 (가로 용지는 표가 본문 폭을 채우지 않아 세로로)
  return new Uint8Array(await markdownToHwpx(md, { gongmun: { preset: 'report', cover: false, toc: false, totalRow: 'top' } }));
}

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

export async function receiptReport(p: { rows: ReceiptRow[]; save?: boolean; template?: boolean; output_path?: string; output_dir?: string; title?: string }, signal: AbortSignal): Promise<{
  output_path?: string; tsv: string; html: string; total: number; count: number; template?: string; warnings: string[];
}> {
  const warnings: string[] = [];
  const s = getSettings().receipt;
  const useTemplate = p.template !== false && !!s?.template_path;
  if (useTemplate && !existsSync(s.template_path)) warnings.push('등록한 지출조서 서식 사본이 없어 기본 서식으로 만들었습니다. 설정 › 내 기관 정보에서 서식을 다시 넣으세요.');
  const tpl = useTemplate && existsSync(s.template_path) ? s : null;
  const columns = tpl ? tpl.columns.filter((c) => c.field).map((c) => ({ header: c.header, field: c.field })) : DEFAULT_COLUMNS;
  if (tpl && !columns.length) warnings.push('서식의 칸 대응표가 비어 있습니다. 설정 › 내 기관 정보의 지출조서 서식에서 칸을 고르세요.');
  const fromTpl = !!tpl && columns.length > 0;
  const totalAt = tpl && fromTpl ? await templateTotalAt(tpl.template_path).catch(() => 'top' as const) : 'top';
  const table = buildTable(p.rows, fromTpl ? columns : DEFAULT_COLUMNS, totalAt, fromTpl);
  const total = p.rows.reduce((sum, r) => sum + toNumber(r.amount), 0);
  const out = { tsv: toTsv(table), html: toHtml(table), total, count: p.rows.length, ...(tpl ? { template: tpl.template_name } : {}), warnings };
  if (p.save === false) return out;
  signal.throwIfAborted();
  let bytes: Uint8Array;
  if (tpl) {
    const values = p.rows.map((r, i) => Object.fromEntries(tpl.columns.filter((c) => c.field).map((c) => [c.field, cellOf(r, c.field, i)])));
    const totals = Object.fromEntries(table.fields.map((f, k) => [f, table.total[k]]).filter(([f]) => MONEY_FIELDS.has(f)));
    const r = await fillTemplate(tpl.template_path, tpl.columns, values, totals);
    bytes = r.bytes;
    warnings.push(...r.warnings);
  } else {
    bytes = await defaultHwpx(table, p.title?.trim() || '지출조서');
  }
  const output_path = outputFile({ output_path: p.output_path, output_dir: p.output_dir, name: `지출조서_${stamp()}.hwpx` });
  await writeFile(output_path, bytes);
  return { ...out, output_path };
}
