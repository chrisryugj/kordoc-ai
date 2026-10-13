/** 접수대장 엑셀 (inbox_export) — 받은 공문 목록을 접수대장 꼴 한 장으로 (할 일 먼저 기한 순, 목록 화면과 같은 순서) */

import { writeFile } from 'node:fs/promises';
import { buildXlsx } from '../excel/xlsx.js';
import { outputFile } from '../output/index.js';
import { todayIso } from './dates.js';
import { inboxList } from './index.js';

const HEADER = ['접수일', '보낸 곳', '문서번호', '시행일', '제목', '요청 사항', '기한', '상태', '메모', '파일'];

/** ISO 시각 → 이 PC 시간대의 YYYY-MM-DD */
const localDate = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export async function inboxExport(p: { output_path?: string }): Promise<{ output_path: string; count: number }> {
  const { items } = await inboxList();
  if (!items.length) throw new Error('받은 공문이 없습니다. 공문을 먼저 넣은 뒤 접수대장을 만드세요.');
  const rows = items.map((it) => [
    localDate(it.added_at),
    it.sender ?? '',
    it.doc_number ?? '',
    it.sent_date ?? '',
    it.title ?? '',
    it.requests.map((r) => (r.due ? `${r.text} (${r.due}까지)` : r.text)).join('\n'),
    it.due ?? '',
    it.status === 'done' ? '끝남' : '할 일',
    it.note ?? '',
    it.name,
  ]);
  const data = await buildXlsx([{ name: '접수대장', header: true, rows: [HEADER, ...rows] }]);
  const outPath = outputFile({ output_path: p.output_path, name: `접수대장_${todayIso().replace(/-/g, '')}.xlsx` });
  await writeFile(outPath, data);
  return { output_path: outPath, count: items.length };
}
