/** CSV 출력 유틸 — BOM UTF-8, Excel 호환 */

/** 셀 값 이스케이프 (쉼표, 줄바꿈, 따옴표 포함 시) */
function escapeCell(value: string): string {
  if (/[,"\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export interface CsvRow {
  file: string;
  fields: Record<string, string>;
}

/**
 * 배치 추출 결과를 BOM UTF-8 CSV 문자열로 변환.
 * 1행: 파일명, 필드1, 필드2, ...
 * 이후: 각 파일별 값
 */
export function buildCsv(headers: string[], rows: CsvRow[]): string {
  const BOM = '\uFEFF';
  const headerLine = ['파일명', ...headers].map(escapeCell).join(',');
  const dataLines = rows.map((row) => {
    const cells = [row.file, ...headers.map((h) => row.fields[h] ?? '')];
    return cells.map(escapeCell).join(',');
  });
  return BOM + [headerLine, ...dataLines].join('\r\n') + '\r\n';
}
