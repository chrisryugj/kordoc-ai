/** 편집기 AI 문서 연산 (studio-plugin/kordoc-ai-ops.mjs) — 실제 rhwp 엔진에서 읽고 고치고 HWP·HWPX 로 저장해 다시 읽는다 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import init, { HwpDocument } from '@rhwp/core';
import * as ops from '../studio-plugin/kordoc-ai-ops.mjs';

const require = createRequire(import.meta.url);
beforeAll(async () => {
  await init({ module_or_path: readFileSync(join(dirname(require.resolve('@rhwp/core')), 'rhwp_bg.wasm')) });
});

const REPORT = join(__dirname, '..', 'samples', '4-보고서_디지털 행정 혁신 추진계획.hwpx');
const report = () => new HwpDocument(new Uint8Array(readFileSync(REPORT)));
function blank(lines: string[] = ['첫 문단']) {
  const doc = HwpDocument.createEmpty();
  doc.createBlankDocument();
  lines.forEach((t, i) => {
    if (i > 0) doc.splitParagraph(0, i - 1, doc.getParagraphLength(0, i - 1));
    doc.insertText(0, i, 0, t);
  });
  return doc;
}
const text = (doc: HwpDocument, id: string) => ops.outline(doc).blocks.find((b: { id: string }) => b.id === id)?.text;
/** 저장했다 다시 읽은 문서 (HWP·HWPX 둘 다) */
const reopen = (doc: HwpDocument, fmt: 'hwp' | 'hwpx') => new HwpDocument(fmt === 'hwp' ? doc.exportHwp() : doc.exportHwpx());

describe('읽기', () => {
  it('개요: 문단 자리·글·표', () => {
    const o = ops.outline(report());
    expect(o.total).toBeGreaterThan(20);
    const withTable = o.blocks.find((b: { tables?: unknown[] }) => b.tables);
    expect(withTable.tables[0].id).toMatch(/^0\.\d+\.0$/);
    expect(o.blocks.some((b: { text: string }) => b.text.includes('반복 문서 업무'))).toBe(true);
  });

  it('표 읽기: 격자', () => {
    const doc = report();
    const id = ops.outline(doc).blocks.find((b: { tables?: unknown[] }) => b.tables).tables[0].id;
    const t = ops.readTable(doc, { table: id });
    expect(t.cells.length).toBe(t.rows);
    expect(t.cells.flat().filter((c: string | null) => c !== null).join('')).not.toBe('');
  });

  it('찾기: 본문과 표 칸', () => {
    const r = ops.find(report(), { text: '디지털' });
    expect(r.count).toBeGreaterThan(1);
    expect(r.matches.some((m: { cell?: number }) => m.cell !== undefined)).toBe(true);
  });

  it('스타일 목록·모양, 내부 칸 이름은 숨김', () => {
    const doc = report();
    expect(ops.styles(doc).find((s: { name: string }) => s.name === '바탕글')?.kind).toBe('para');
    expect(ops.readStyle(doc, { name: '바탕글' }).size_pt).toBeGreaterThan(5);
    expect(ops.fields(doc).every((f: { name: string }) => !f.name.startsWith('__kordoc_'))).toBe(true);
  });

  it('잘못된 자리는 문서를 건드리지 않고 이유를 말한다', () => {
    const doc = blank();
    expect(() => ops.setParagraph(doc, { id: '0.99', text: 'x' })).toThrow(/없습니다/);
    expect(() => ops.readTable(doc, { table: 'abc' })).toThrow(/구역\.문단\.번호/);
  });
});

describe('고치기', () => {
  it('찾아 바꾸기: 여럿이면 몇 번째인지 묻고, all 은 모두', () => {
    const doc = blank(['사과 하나', '사과 둘']);
    expect(() => ops.replace(doc, { find: '사과', replace: '배' })).toThrow(/2곳/);
    expect(ops.replace(doc, { find: '사과', replace: '배', occurrence: 2 }).replaced).toBe(1);
    expect(text(doc, '0.1')).toBe('배 둘');
    expect(ops.replace(doc, { find: '사과', replace: '귤', all: true }).replaced).toBe(1);
    expect(text(doc, '0.0')).toBe('귤 하나');
  });

  it('표 칸 안 글도 바꾼다', () => {
    const doc = report();
    const before = ops.find(doc, { text: '디지털' }).count;
    ops.replace(doc, { find: '디지털', replace: 'AI', all: true });
    expect(ops.find(doc, { text: '디지털' }).count).toBe(0);
    expect(ops.find(doc, { text: 'AI' }).count).toBeGreaterThanOrEqual(before);
  });

  it('문단 넣기·바꾸기·지우기', () => {
    const doc = blank(['하나', '셋']);
    ops.insertParagraphs(doc, { after: '0.0', texts: ['둘', '둘 반'] });
    expect(ops.outline(doc).blocks.map((b: { text: string }) => b.text)).toEqual(['하나', '둘', '둘 반', '셋']);
    ops.setParagraph(doc, { id: '0.2', text: '둘과 반' });
    ops.deleteParagraphs(doc, { ids: ['0.1', '0.3'] });
    expect(ops.outline(doc).blocks.map((b: { text: string }) => b.text)).toEqual(['하나', '둘과 반']);
    expect(() => ops.insertParagraphs(doc, { after: '0.0', texts: ['a\nb'] })).toThrow(/줄바꿈/);
  });

  it('표 넣기·칸 채우기·줄 넣고 빼기, 저장해도 남는다', () => {
    const doc = blank(['앞 문단']);
    const r = ops.insertTable(doc, { after: '0.0', rows: [['항목', '금액'], ['인건비', '100'], ['운영비', '']] });
    expect(r).toMatchObject({ rows: 3, cols: 2 });
    ops.fillCells(doc, { table: r.table, cells: [{ row: 2, col: 1, text: '50\n(추정)' }] });
    ops.addRows(doc, { table: r.table, after_row: 2, count: 1 });
    ops.fillCells(doc, { table: r.table, cells: [{ row: 3, col: 0, text: '합계' }] });
    ops.removeRows(doc, { table: r.table, rows: [1] });
    for (const fmt of ['hwp', 'hwpx'] as const) {
      const again = reopen(doc, fmt);
      const id = ops.outline(again).blocks.find((b: { tables?: unknown[] }) => b.tables).tables[0].id;
      expect(ops.readTable(again, { table: id }).cells, fmt).toEqual([['항목', '금액'], ['운영비', '50\n(추정)'], ['합계', '']]);
    }
    expect(() => ops.fillCells(doc, { table: r.table, cells: [{ row: 9, col: 0, text: 'x' }] })).toThrow(/칸이 없습니다/);
  });

  it('글자·문단 서식', () => {
    const doc = blank(['중요 안내 사항']);
    ops.formatText(doc, { id: '0.0', find: '중요', bold: true, color: '#ff0000', size_pt: 14 });
    const c = JSON.parse(doc.getCharPropertiesAt(0, 0, 0));
    expect(c).toMatchObject({ bold: true, textColor: '#ff0000', fontSize: 1400 });
    expect(JSON.parse(doc.getCharPropertiesAt(0, 0, 4)).bold).toBe(false);
    ops.formatParagraphs(doc, { ids: ['0.0'], align: 'center', line_spacing: 180, left_pt: 10, indent_pt: 5, before_pt: 10 });
    // 엔진은 px(96dpi)로 돌려준다: 10pt = 13.3px
    expect(JSON.parse(doc.getParaPropertiesAt(0, 0))).toMatchObject({ alignment: 'center', lineSpacing: 180, marginLeft: 13.3, indent: 6.7, spacingBefore: 13.3 });
    expect(() => ops.formatText(doc, { id: '0.0', color: 'red' })).toThrow(/#RRGGBB/);
    ops.formatText(doc, { id: '0.0', font: '맑은 고딕' });
    expect(JSON.parse(doc.getCharPropertiesAt(0, 0, 0)).fontFamily).toBe('맑은 고딕');
  });

  it('구역 첫 문단도 고치고, 첫 문단 지우기·같은 문단 두 번 지우기는 막는다', () => {
    const doc = blank(['제목', '가', '나', '다']);
    ops.setParagraph(doc, { id: '0.0', text: '새 제목' });
    expect(text(doc, '0.0')).toBe('새 제목');
    expect(() => ops.deleteParagraphs(doc, { ids: ['0.0'] })).toThrow(/첫 문단/);
    ops.deleteParagraphs(doc, { ids: ['0.1', '0.1'] });
    expect(ops.outline(doc).blocks.map((b: { text: string }) => b.text)).toEqual(['새 제목', '나', '다']);
  });

  it('바꿀 글의 줄바꿈·없는 표·잘못된 줄 수는 거절', () => {
    const doc = blank(['가']);
    expect(() => ops.replace(doc, { find: '가', replace: 'a\nb' })).toThrow(/줄바꿈/);
    expect(() => ops.addRows(doc, { table: '0.0.3', after_row: 0 })).toThrow(/표 0\.0\.3 이 없습니다/);
    const r = ops.insertTable(doc, { after: '0.0', rows: [['a\nb', 'c']] });
    expect(() => ops.addRows(doc, { table: r.table, after_row: 0, count: 0 })).toThrow(/count/);
    // 머리줄은 칸 안 모든 줄이 진하게
    const t = ops.parseTable(r.table);
    expect(JSON.parse(doc.getCellCharPropertiesAt(t.sec, t.para, t.ctrl, 0, 1, 0)).bold).toBe(true);
  });

  it('새 스타일은 바탕 스타일 모양(글꼴·장평·간격)을 이어받는다', () => {
    const doc = report();
    const base = ops.readStyle(doc, { name: '개요 1' });
    ops.createStyle(doc, { name: '개요 1 굵게', based_on: '개요 1', bold: true });
    expect(ops.readStyle(doc, { name: '개요 1 굵게' })).toMatchObject({ ...base, name: '개요 1 굵게', bold: true });
  });

  it('잘못된 서식 값은 스타일을 만들거나 고치지 않고 거절', () => {
    const doc = blank(['가']);
    const before = ops.styles(doc).length;
    expect(() => ops.createStyle(doc, { name: '빨강', color: 'red' })).toThrow(/#RRGGBB/);
    expect(ops.styles(doc).length).toBe(before);
    expect(() => ops.editStyle(doc, { name: '바탕글', bold: true, size_pt: 0 })).toThrow(/size_pt/);
    expect(ops.readStyle(doc, { name: '바탕글' }).bold).toBe(false);
  });

  it('각주: 낱말 바로 뒤에 번호를 달고 글을 넣는다, 저장해도 남는다, 모호하거나 없는 자리는 거절', () => {
    const doc = blank(['전자정부법에 따라 추진한다', '둘째 문단']);
    expect(ops.insertFootnote(doc, { id: '0.0', after: '전자정부법', text: '「전자정부법」 제1조' })).toMatchObject({ id: '0.0', number: 1 });
    ops.insertFootnote(doc, { id: '0.1', text: '문단 끝 각주' });
    for (const fmt of ['hwp', 'hwpx'] as const) {
      const again = reopen(doc, fmt);
      // 문단의 컨트롤 가운데 각주인 것 (구역 첫 문단엔 구역·단 정의가 앞에 있다)
      const notes = [0, 1].map((p) => {
        for (let c = 0; c < 6; c++) { try { return JSON.parse(again.getFootnoteInfo(0, p, c)).texts.join('').trim(); } catch { /* 각주 아님 */ } }
        return null;
      });
      expect(notes, fmt).toEqual(['「전자정부법」 제1조', '문단 끝 각주']);
    }
    // 본문 글은 그대로 (각주 번호는 글자가 아니다)
    expect(text(doc, '0.0')).toBe('전자정부법에 따라 추진한다');
    expect(() => ops.insertFootnote(doc, { id: '0.0', after: '없는 글', text: 'x' })).toThrow(/찾지 못했습니다/);
    const twice = blank(['법 법']);
    expect(() => ops.insertFootnote(twice, { id: '0.0', after: '법', text: 'x' })).toThrow(/여러 곳/);
    expect(() => ops.insertFootnote(twice, { id: '0.0', text: 'a\nb' })).toThrow(/줄바꿈/);
  });

  it('스타일 만들기·고치기·걸기, 저장해도 남는다', () => {
    const doc = blank(['제목', '본문']);
    ops.createStyle(doc, { name: '보고서 제목', based_on: '바탕글', bold: true, size_pt: 18, align: 'center' });
    expect(() => ops.createStyle(doc, { name: '보고서 제목' })).toThrow(/이미 있습니다/);
    ops.applyStyle(doc, { ids: ['0.0'], style: '보고서 제목' });
    expect(JSON.parse(doc.getStyleAt(0, 0)).name).toBe('보고서 제목');
    ops.editStyle(doc, { name: '보고서 제목', new_name: '큰 제목', size_pt: 20 });
    for (const fmt of ['hwp', 'hwpx'] as const) {
      const again = reopen(doc, fmt);
      expect(JSON.parse(again.getStyleAt(0, 0)).name, fmt).toBe('큰 제목');
      expect(ops.readStyle(again, { name: '큰 제목' }), fmt).toMatchObject({ bold: true, size_pt: 20, align: 'center' });
    }
  });
});
