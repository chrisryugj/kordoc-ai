/** 문서 수합 — 같은 서식 한글 5개 + 엑셀·CSV 제출물 + 서식이 다른 문서 + 부서 명단 → 엑셀(수합·제출 현황)·미제출·독촉 글·다시 만들기 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import JSZip from 'jszip';
import { markdownToHwpx } from 'kordoc';
import { call, sample, setupEnv } from './doc-helpers.js';
import { buildXlsx } from '../src/core/excel/xlsx.js';
import { colKey } from '../src/core/collect/gather.js';
import { deptStem, matchDept, rosterFromText } from '../src/core/collect/dept.js';
import { columnTotals, numberOf } from '../src/core/collect/book.js';

vi.mock('../src/infra/progress.js', async (orig) => ({ ...(await orig<typeof import('../src/infra/progress.js')>()), sendProgress: vi.fn(), sendNotification: vi.fn() }));

const DEPTS = ['총무과', '기획예산과', '민원봉사과', '복지정책과', '도시계획과'];
const ROSTER = ['총무과', '기획예산과', '민원봉사과', '복지정책과', '도시계획과', '세무과', '가온1동', '교통행정과', '환경위생과', '문화체육과'];
let env: ReturnType<typeof setupEnv>;
let dir: string;
let files: string[];

type Cell = { v: string; s: string };
/** 시험용 xlsx 읽기 — 시트 이름 → 칸 주소 → 값·스타일 번호 */
async function readBook(path: string): Promise<Record<string, Record<string, Cell>>> {
  const zip = await JSZip.loadAsync(readFileSync(path));
  const wb = await zip.file('xl/workbook.xml')!.async('string');
  const names = [...wb.matchAll(/<sheet name="([^"]+)"/g)].map((m) => m[1]);
  const out: Record<string, Record<string, Cell>> = {};
  for (const [i, name] of names.entries()) {
    const xml = await zip.file(`xl/worksheets/sheet${i + 1}.xml`)!.async('string');
    const cells: Record<string, Cell> = {};
    for (const m of xml.matchAll(/<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const s = /s="(\d+)"/.exec(m[2])?.[1] ?? '0';
      const inner = m[3] ?? '';
      const v = /<t[^>]*>([\s\S]*?)<\/t>/.exec(inner)?.[1] ?? /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? '';
      cells[m[1]] = { v: v.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"'), s };
    }
    out[name] = cells;
  }
  return out;
}
/** 한 행의 값들 (A부터 열 수만큼) */
const rowOf = (cells: Record<string, Cell>, r: number, cols = 12) => Array.from({ length: cols }, (_, c) => cells[`${String.fromCharCode(65 + c)}${r}`]?.v ?? '');
const findRow = (cells: Record<string, Cell>, text: string) => {
  for (let r = 1; r < 200; r++) if (rowOf(cells, r).includes(text)) return r;
  return -1;
};

beforeAll(async () => {
  env = setupEnv();
  dir = join(env.work, '제출물');
  mkdirSync(dir, { recursive: true });
  files = DEPTS.map((d) => {
    const to = join(dir, `교육수요조사서_${d}.hwpx`);
    copyFileSync(sample(`취합/교육수요조사서_${d}.hwpx`), to);
    return to;
  });
  // 도시계획과 제출물은 희망 시기 칸을 비워 낸 것 (빈 필수 칸)
  const zip = await JSZip.loadAsync(readFileSync(files[4]));
  for (const name of Object.keys(zip.files).filter((n) => /Contents\/section\d+\.xml$/.test(n))) {
    const xml = await zip.file(name)!.async('string');
    zip.file(name, xml.replace(/>12월</, '><'));
  }
  writeFileSync(files[4], await zip.generateAsync({ type: 'nodebuffer' }));

  // 엑셀 제출물 (제목 줄 + 머리 줄 이름이 조금 다름 + 합계 줄) — 세무과
  const tax = join(dir, '교육수요_세무과.xlsx');
  writeFileSync(tax, await buildXlsx([{ name: '제출', rows: [
    ['2026년 하반기 직무교육 수요조사 (세무과)'],
    ['부서', '담당자', '내선 번호', '희망교육과정', '희망 인원(명)', '희망 시기', '비고'],
    ['세무과', '한누리', '1701', '지방세 체납 관리 실무', '3', '11월', '오전 희망'],
    ['세무과', '서다인', '1702', '', '2', '12월', ''],
    ['합계', '', '', '', '5', '', ''],
  ] }]));
  // CSV 제출물 — 파일 이름에 부서가 없고 칸에 동 이름만 (가온1동)
  const dong = join(dir, '수요조사_제출.csv');
  writeFileSync(dong, '﻿부서명,담당자,내선번호,희망 교육과정,희망 인원,희망 시기\r\n가온 1동,문하늘,2101,민원 응대 실무,4명,10월\r\n');
  // 서식이 다른 문서 (표 없이 글만) — 교통행정과
  const other = join(dir, '교통행정과_의견서.hwpx');
  writeFileSync(other, Buffer.from(await markdownToHwpx('# 교육 수요 의견\n\n교통행정과는 이번 조사에 별도 서식 없이 의견만 드립니다. 운전직 안전교육이 필요합니다.')));
  files.push(tax, dong, other);
});

describe('부서 이름 맞추기', () => {
  it('명단 글: 줄·쉼표·번호·괄호 설명·머리말', () => {
    expect(rosterFromText('부서명\n1. 총무과\n2) 기획예산과(예산팀 포함), 민원봉사과\n총무과\n\n')).toEqual(['총무과', '기획예산과', '민원봉사과']);
  });
  it('줄기·끝말 바뀜·띄어쓰기', () => {
    expect(deptStem('총무과')).toBe('총무');
    expect(deptStem('가온1동')).toBe('가온1');
    expect(matchDept(ROSTER, { path: '/x/수요조사_총무팀.hwpx', values: [], text: '' })).toEqual({ dept: '총무과', in_roster: true });
    expect(matchDept(ROSTER, { path: '/x/제출.csv', values: ['가온 1동'], text: '' })).toEqual({ dept: '가온1동', in_roster: true });
    // 본문은 온이름이나 줄기+과·팀·동만: "가온시" 는 가온1동이 아니다
    expect(matchDept(ROSTER, { path: '/x/제출.hwpx', values: [], text: '가온시 세무팀에서 제출합니다' })).toEqual({ dept: '세무과', in_roster: true });
    expect(matchDept(['가온동'], { path: '/x/제출.hwpx', values: [], text: '가온시장 귀하' }).in_roster).toBe(false);
    // 명단 없으면 부서 칸 → 파일 이름 토막
    expect(matchDept([], { path: '/x/조사서_도시계획과.hwpx', values: [], text: '' }).dept).toBe('도시계획과');
  });
  it('열 이름: 띄어쓰기·괄호 설명·흔한 다른 이름', () => {
    expect(colKey('희망 인원(명)')).toBe(colKey('희망인원'));
    expect(colKey('부서')).toBe(colKey('부서명'));
    expect(colKey('내선 번호')).toBe(colKey('연락처'));
  });
  it('합계: 단위 붙은 숫자는 더하고 번호·시기 열은 빼고, 글이 섞이면 안 더한다', () => {
    expect(numberOf('6명')).toBe(6);
    expect(numberOf('1,200원')).toBe(1200);
    expect(numberOf('0101')).toBeNull();
    const cols = [{ key: 'a', label: '희망 인원', required: true }, { key: 'b', label: '내선번호', required: true }, { key: 'c', label: '비고', required: false }];
    const rows = [
      { file: '1', dept: '', cells: new Map([['a', '6명'], ['b', '1201'], ['c', '3']]) },
      { file: '2', dept: '', cells: new Map([['a', '4'], ['b', '1302'], ['c', '없음']]) },
    ];
    expect([...columnTotals(cols, rows)]).toEqual([['a', 10]]);
  });
});

describe('collect_roster', () => {
  it('붙여 넣은 글·엑셀 명단', async () => {
    expect((await call('collect_roster', { text: ROSTER.join('\n') })).names).toEqual(ROSTER);
    const p = join(env.work, '부서명단.xlsx');
    writeFileSync(p, await buildXlsx([{ name: '명단', rows: [['연번', '부서명', '부서장'], ...ROSTER.map((d, i) => [String(i + 1), d, '홍길동'])] }]));
    expect((await call('collect_roster', { path: p })).names).toEqual(ROSTER);
    await expect(call('collect_roster', { text: '  \n' })).rejects.toThrow(/한 줄에 하나씩/);
  });
});

describe('collect_gather', () => {
  let first: any;

  it('한글 5개 + 엑셀 + CSV + 다른 서식 → 수합 시트·합계·빈칸·제출 현황·미제출·독촉 글', async () => {
    first = await call('collect_gather', { paths: files, roster: ROSTER, deadline: '10. 20.(화)' });
    expect(first.failed).toEqual([]);
    expect(first.by_kind).toEqual({ form: 5, excel: 2, ai: 0 });
    // 한글 5줄 + 세무과 2줄(합계 줄 뺌) + 가온1동 1줄 + 따로 볼 문서 1줄
    expect(first.rows).toBe(9);
    expect(first.columns.slice(0, 7).map((c: { label: string }) => c.label)).toEqual(['부서명', '담당자', '내선번호', '희망 교육과정', '희망 인원', '희망 시기', '건의 사항']);
    expect(first.columns.find((c: { label: string }) => c.label === '비고')).toMatchObject({ required: false });
    expect(first.columns.find((c: { label: string }) => c.label === '희망 인원').total).toBe(6 + 4 + 9 + 7 + 5 + 3 + 2 + 4);
    expect(first.separate).toEqual([{ path: files[7], dept: '교통행정과', reason: '표나 누름틀 칸이 없는 문서입니다' }]);
    expect(first.missing).toEqual(['환경위생과', '문화체육과']);
    expect(first.title).toBe('2026년 하반기 직무교육 수요조사서');
    expect(first.reminder).toContain('「2026년 하반기 직무교육 수요조사서」');
    expect(first.reminder).toContain('아직 받지 못한 부서: 환경위생과, 문화체육과');
    expect(first.reminder).toContain('제출 기한: 10. 20.(화)까지');
    expect(first.reminder).not.toMatch(/[—–]/);
    // 빈 필수 칸: 도시계획과 희망 시기, 세무과 서다인 희망 교육과정·건의 사항 둘, 세무과 한누리 건의 사항, 가온1동 건의 사항
    expect(first.blanks).toBe(5);
    expect(basename(first.output_path)).toBe('2026년 하반기 직무교육 수요조사서_수합.xlsx');

    const book = await readBook(first.output_path);
    expect(Object.keys(book)).toEqual(['수합', '제출 현황']);
    const s = book['수합'];
    expect(rowOf(s, 1, 3)).toEqual(['제출 파일', '부서', '부서명']);
    // 제출물의 '비고' 열과 수합이 다는 '확인 사항' 열은 따로
    expect(rowOf(s, 1, 11).slice(9)).toEqual(['비고', '확인 사항']);
    // 명단 순서: 총무과가 첫 줄
    expect(rowOf(s, 2, 4)).toEqual(['교육수요조사서_총무과.hwpx', '총무과', '총무과', '이가람']);
    const city = findRow(s, '교육수요조사서_도시계획과.hwpx');
    expect(s[`H${city}`]).toMatchObject({ v: '', s: '5' }); // 희망 시기 빈칸 노란 표시
    const tax = findRow(s, '서다인');
    expect(rowOf(s, tax, 2)).toEqual(['교육수요_세무과.xlsx', '세무과']);
    expect(s[`F${tax}`]).toMatchObject({ v: '', s: '5' });
    const dong = findRow(s, '문하늘');
    expect(s[`B${dong}`].v).toBe('가온1동');
    const other = findRow(s, '교통행정과_의견서.hwpx');
    expect(rowOf(s, other, 12)).toContain('서식이 달라 따로 확인');
    const sum = findRow(s, '합계');
    expect(sum).toBe(11);
    expect(s[`G${sum}`]).toMatchObject({ v: '40', s: '7' });
    expect(s[`E${sum}`]?.v ?? '').toBe(''); // 내선번호는 더하지 않는다
    expect(Object.values(s).filter((c) => c.s === '5')).toHaveLength(5);

    const st = book['제출 현황'];
    expect(rowOf(st, 1, 4)).toEqual(['부서', '제출 여부', '파일', '빈칸 수']);
    expect(rowOf(st, 2, 4)).toEqual(['총무과', '제출', '교육수요조사서_총무과.hwpx', '0']);
    expect(rowOf(st, 6, 4)).toEqual(['도시계획과', '제출', '교육수요조사서_도시계획과.hwpx', '1']);
    expect(rowOf(st, 7, 4)).toEqual(['세무과', '제출', '교육수요_세무과.xlsx', '3']);
    expect(rowOf(st, 10, 2)).toEqual(['환경위생과', '미제출']);
    expect(st.B10.s).toBe('5');
    expect(rowOf(st, 11, 2)).toEqual(['문화체육과', '미제출']);
  }, 60_000);

  it('늦게 온 파일 더 넣기: 같은 파일에 다시 만들기(overwrite) 또는 번호 붙은 새 파일', async () => {
    const late = join(dir, '교육수요_환경위생과.csv');
    writeFileSync(late, '부서,담당자,내선번호,희망 교육과정,희망 인원,희망 시기,건의 사항\r\n환경위생과,오세찬,1801,식품위생 점검 실무,2,11월,없음\r\n');
    const again = await call('collect_gather', { paths: [...files, late], roster: ROSTER, output_path: first.output_path, overwrite: true });
    expect(again.output_path).toBe(first.output_path);
    expect(again.missing).toEqual(['문화체육과']);
    expect(again.rows).toBe(10);
    const st = (await readBook(again.output_path))['제출 현황'];
    expect(rowOf(st, 10, 3)).toEqual(['환경위생과', '제출', '교육수요_환경위생과.csv']);

    // 제출물 폴더 옆에 저장된 수합 엑셀은 폴더째 다시 넣어도 제출물로 치지 않는다
    const numbered = await call('collect_gather', { paths: [...files, late, first.output_path], roster: ROSTER, output_path: first.output_path });
    expect(numbered.rows).toBe(10);
    expect(basename(numbered.output_path)).toBe('2026년 하반기 직무교육 수요조사서_수합 (2).xlsx');
    expect(existsSync(numbered.output_path)).toBe(true);
  }, 60_000);

  it('명단 없이: 부서는 부서 칸·파일 이름에서, 미제출은 모름', async () => {
    const r = await call('collect_gather', { paths: files.slice(0, 5) });
    expect(r.missing).toEqual([]);
    expect(r.reminder).toBe('');
    expect(r.status.map((s: { dept: string }) => s.dept)).toEqual(['기획예산과', '도시계획과', '민원봉사과', '복지정책과', '총무과']);
  }, 60_000);

  it('읽지 못한 파일은 실패로 남기고 나머지는 모은다', async () => {
    const bad = join(dir, '깨진파일_세무과.hwpx');
    writeFileSync(bad, 'PK not really');
    const r = await call('collect_gather', { paths: [files[0], files[1], bad], roster: ['총무과', '기획예산과', '세무과'] });
    expect(r.failed).toHaveLength(1);
    expect(r.failed[0].path).toBe(bad);
    expect(r.status.find((s: { dept: string }) => s.dept === '세무과')).toMatchObject({ submitted: true, files: ['깨진파일_세무과.hwpx'] });
    await expect(call('collect_gather', { paths: [] })).rejects.toThrow(/하나 이상/);
  }, 60_000);
});
