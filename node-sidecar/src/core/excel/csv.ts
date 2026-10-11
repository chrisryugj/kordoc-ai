/** CSV 읽기·쓰기 — 쓰기는 엑셀 호환(BOM UTF-8·CRLF), 읽기는 따옴표·줄바꿈 칸 처리 */

// 엑셀이 칸을 수식으로 실행하지 않게 (= + - @ 로 시작하는 칸 앞에 '). 그냥 숫자(-5, +3.2, 12%)는 그대로
const neutral = (v: string) => (/^[=+\-@\t\r]/.test(v) && !/^[-+]?\d[\d,.]*%?$/.test(v) ? `'${v}` : v);
const escapeCell = (v: string) => {
  const n = neutral(v);
  return /[",\r\n]/.test(n) ? `"${n.replace(/"/g, '""')}"` : n;
};

export function toCsv(rows: string[][]): string {
  return `﻿${rows.map((r) => r.map((c) => escapeCell(c ?? '')).join(',')).join('\r\n')}\r\n`;
}

/** RFC 4180 — 쉼표 구분, 큰따옴표 칸 안의 쉼표·줄바꿈·"" 허용 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}
