/** 문서 수합 — 모은 행 → 엑셀 두 장(수합·제출 현황)·합계·빈칸 표시·독촉 글
 *
 * 합계는 값이 모두 숫자(끝에 명·원·건 같은 단위가 붙어도 됨)인 열만 낸다. 번호·전화·날짜·시기 같은 열은 숫자여도 더하지 않는다.
 */

import type { CollectGatherResult } from '../../types/rpc-contract.js';
import type { Sheet } from '../excel/xlsx.js';

export interface Column {
  key: string;
  label: string;
  required: boolean;
}

export interface GatherRow {
  file: string;
  dept: string;
  /** 열 key → 값 */
  cells: Map<string, string>;
  /** 비고 칸 글 */
  note?: string;
  /** 값을 못 옮긴 행 (서식이 다르거나 못 읽음): 빈칸·합계에서 뺀다 */
  skip?: boolean;
}

const UNIT = '명|원|천원|만원|백만원|억원|건|개|개소|곳|회|대|권|부|가구|세대|kg|㎏|㎡|m²|톤|시간';
const NUMERIC = new RegExp(`^([-+]?(?:\\d{1,3}(?:,\\d{3})+|0|[1-9]\\d*)(?:\\.\\d+)?)\\s*(?:${UNIT})?$`);
const NOT_SUMMED = /번호|전화|연락처|내선|휴대|우편|연도|년도|일자|날짜|기간|시기|일시|생년|주민|코드|순번|연번|차수|학년|나이|연령/;

export function numberOf(v: string): number | null {
  const m = NUMERIC.exec(v.trim());
  return m ? Number(m[1].replace(/,/g, '')) : null;
}

/** 열마다 합계 (더할 수 있는 열만) */
export function columnTotals(columns: Column[], rows: GatherRow[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const col of columns) {
    if (NOT_SUMMED.test(col.label.replace(/\s/g, ''))) continue;
    const vals = rows.filter((r) => !r.skip).map((r) => (r.cells.get(col.key) ?? '').trim()).filter(Boolean);
    if (!vals.length) continue;
    const nums = vals.map(numberOf);
    if (nums.some((n) => n === null)) continue;
    out.set(col.key, Math.round((nums as number[]).reduce((a, b) => a + b, 0) * 1e6) / 1e6);
  }
  return out;
}

const blanksOf = (columns: Column[], r: GatherRow) => (r.skip ? 0 : columns.filter((c) => c.required && !(r.cells.get(c.key) ?? '').trim()).length);

export function buildBook(columns: Column[], rows: GatherRow[], status: CollectGatherResult['status'], hasRoster: boolean): { sheets: Sheet[]; totals: Map<string, number>; blanks: number } {
  const noted = rows.some((r) => r.note);
  // 제출물에 '비고' 열이 흔해서 수합이 다는 말은 따로 '확인 사항' 열에
  const header = ['제출 파일', '부서', ...columns.map((c) => c.label), ...(noted ? ['확인 사항'] : [])];
  const body: string[][] = [];
  const marks: Array<{ r: number; c: number }> = [];
  let blanks = 0;
  rows.forEach((row, i) => {
    body.push([row.file, row.dept, ...columns.map((c) => row.cells.get(c.key) ?? ''), ...(noted ? [row.note ?? ''] : [])]);
    if (row.skip) return;
    columns.forEach((c, j) => {
      if (c.required && !(row.cells.get(c.key) ?? '').trim()) {
        marks.push({ r: i + 1, c: j + 2 });
        blanks++;
      }
    });
  });
  const totals = columnTotals(columns, rows);
  const sheetRows = [header, ...body];
  const bold: number[] = [];
  if (totals.size) {
    sheetRows.push(['합계', '', ...columns.map((c) => (totals.has(c.key) ? String(totals.get(c.key)) : '')), ...(noted ? [''] : [])]);
    bold.push(sheetRows.length - 1);
  }

  const statusRows = status.map((s) => [
    s.dept ? (hasRoster && !s.in_roster ? `${s.dept} (명단에 없음)` : s.dept) : '부서 확인 필요',
    s.submitted ? '제출' : '미제출',
    s.files.join('\n'),
    s.submitted ? String(s.blanks) : '',
  ]);
  const statusMarks = statusRows.flatMap((r, i) => (r[1] === '미제출' ? [{ r: i + 1, c: 1 }] : []));
  return {
    sheets: [
      { name: '수합', header: true, rows: sheetRows, marks, bold },
      { name: '제출 현황', header: true, rows: [['부서', '제출 여부', '파일', '빈칸 수'], ...statusRows], marks: statusMarks },
    ],
    totals,
    blanks,
  };
}

/** 제출 현황 — 명단 순서대로, 그 뒤 명단에 없는 부서(이름 순), 마지막에 부서를 모르는 파일 */
export function buildStatus(
  roster: string[],
  subs: Array<{ file: string; dept: string; in_roster: boolean }>,
  rows: GatherRow[],
  columns: Column[],
): CollectGatherResult['status'] {
  const blanksBy = new Map<string, number>();
  for (const r of rows) blanksBy.set(r.dept, (blanksBy.get(r.dept) ?? 0) + blanksOf(columns, r));
  const filesBy = new Map<string, string[]>();
  for (const s of subs) filesBy.set(s.dept, [...(filesBy.get(s.dept) ?? []), s.file]);
  const out: CollectGatherResult['status'] = roster.map((dept) => ({
    dept, in_roster: true, submitted: filesBy.has(dept), files: filesBy.get(dept) ?? [], blanks: blanksBy.get(dept) ?? 0,
  }));
  const rosterSet = new Set(roster);
  const others = [...filesBy.keys()].filter((d) => d && !rosterSet.has(d)).sort((a, b) => a.localeCompare(b, 'ko'));
  for (const dept of others) out.push({ dept, in_roster: false, submitted: true, files: filesBy.get(dept)!, blanks: blanksBy.get(dept) ?? 0 });
  if (filesBy.has('')) out.push({ dept: '', in_roster: false, submitted: true, files: filesBy.get('')!, blanks: blanksBy.get('') ?? 0 });
  return out;
}

/** 미제출 부서에 보낼 짧은 독촉 글 (메신저·메일에 붙여 넣는 글) */
export function reminderText(missing: string[], title: string, deadline?: string): string {
  if (!missing.length) return '';
  const what = title ? `「${title}」` : '요청드린 자료';
  return [
    `${what} 제출을 다시 부탁드립니다.`,
    '',
    `아직 받지 못한 부서: ${missing.join(', ')}`,
    `제출 기한: ${deadline?.trim() || '○○. ○○.(○)'}까지`,
    '',
    '바쁘시겠지만 기한 안에 제출하여 주시기 바랍니다. 이미 보내셨다면 이 안내는 넘겨 주십시오. 감사합니다.',
  ].join('\n');
}
