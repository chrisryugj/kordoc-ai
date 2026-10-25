/** 한컴 한글 단축키 판정 (editor-host/hangul-keys.js) — 한컴 공식 단축키 일람 기준 */
import { describe, expect, it } from 'vitest';
import { CHORDS, MENU_LABELS, SINGLES, TABLE_KEYS, dateText, colName, easyFormula, equalWidthDeltas, keyName, resolveKey } from '../editor-host/hangul-keys.js';

type K = { key?: string; code?: string; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean; metaKey?: boolean };
const ev = (k: K) => ({ key: '', code: '', ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...k });
const letter = (c: string, mods: K = {}) => ev({ key: c, code: `Key${c.toUpperCase()}`, ...mods });

describe('hangul-keys', () => {
  it('물리 키로 글쇠 이름을 읽는다 (한글 입력 중 Process 여도)', () => {
    expect(keyName(ev({ key: 'Process', code: 'KeyT' }))).toBe('t');
    expect(keyName(ev({ key: 'ㅅ', code: 'KeyT' }))).toBe('t');
    expect(keyName(ev({ key: '3', code: 'Digit3' }))).toBe('3');
    expect(keyName(ev({ key: 'F2', code: 'F2' }))).toBe('f2');
  });

  it('Ctrl+N,T 는 표 만들기 (둘째 글쇠는 Ctrl 을 떼도·누른 채여도·한글 입력 중이어도)', () => {
    for (const second of [letter('t'), letter('t', { ctrlKey: true }), ev({ key: 'Process', code: 'KeyT' })]) {
      const st = { chord: null as string | null };
      expect(resolveKey(letter('n', { ctrlKey: true }), st)).toEqual({ chord: 'n' });
      expect(resolveKey(ev({ key: 'Control', code: 'ControlLeft' }), st)).toEqual({ wait: true });
      expect(resolveKey(second, st)).toEqual({ commands: ['table:create'] });
      expect(st.chord).toBeNull();
    }
  });

  it('Ctrl+N 을 길게 눌러 반복된 키는 둘째 글쇠가 아니다', () => {
    const st = { chord: null as string | null };
    expect(resolveKey(letter('n', { ctrlKey: true }), st)).toEqual({ chord: 'n' });
    expect(resolveKey({ ...letter('n', { ctrlKey: true }), repeat: true }, st)).toEqual({ wait: true });
    expect(resolveKey(letter('t'), st)).toEqual({ commands: ['table:create'] });
    expect(resolveKey({ ...letter('n', { ctrlKey: true }), repeat: true }, { chord: null })).toBeNull();
  });

  it('겹글쇠 둘째 자리의 모르는 글쇠·Esc 는 삼켜 문서에 들어가지 않는다', () => {
    const st = { chord: 'n' as string | null };
    expect(resolveKey(letter('x'), st)).toEqual({ swallow: true });
    st.chord = 'q';
    expect(resolveKey(ev({ key: 'Escape', code: 'Escape' }), st)).toEqual({ swallow: true });
  });

  it('공식 일람의 겹글쇠', () => {
    const run = (a: string, b: string) => { const st = { chord: null as string | null }; resolveKey(letter(a, { ctrlKey: true }), st); return resolveKey(letter(b), st); };
    expect(run('n', 'n')).toEqual({ commands: ['insert:footnote'] });
    expect(run('n', 'e')).toEqual({ commands: ['insert:endnote'] });
    expect(run('k', 'd')).toEqual({ commands: ['ext:kordoc-date'] });
    expect(run('q', 'a')).toEqual({ commands: ['edit:find-replace'] });
    expect(run('m', 'r')).toEqual({ commands: ['ext:kordoc-color-r'] });
    expect(run('g', 'p')).toEqual({ commands: ['view:zoom-fit-page'] });
    expect(run('n', 'k')?.commands?.[0]).toBe('format:object-properties');
  });

  it('맥에서 겹글쇠는 Control 만 (⌘+N·⌘+Q 는 앱 메뉴 몫)', () => {
    const st = { chord: null as string | null };
    expect(resolveKey(letter('n', { metaKey: true }), st, true)).toBeNull();
    expect(resolveKey(letter('n', { ctrlKey: true }), st, true)).toEqual({ chord: 'n' });
  });

  it('한 글쇠: Ctrl+Y 한 줄 지우기·Alt+Y 줄 뒤 지우기·정렬·글자 모양·문자표', () => {
    const one = (k: K) => resolveKey(ev(k), { chord: null });
    expect(one({ key: 'y', code: 'KeyY', ctrlKey: true })).toEqual({ commands: ['ext:kordoc-delete-line'] });
    expect(one({ key: 'y', code: 'KeyY', altKey: true })).toEqual({ commands: ['ext:kordoc-delete-line-end'] });
    expect(one({ key: 'C', code: 'KeyC', ctrlKey: true, shiftKey: true })).toEqual({ commands: ['format:align-center'] });
    expect(one({ key: 'B', code: 'KeyB', altKey: true, shiftKey: true })).toEqual({ commands: ['format:bold'] });
    expect(one({ key: 'C', code: 'KeyC', altKey: true, shiftKey: true })).toEqual({ commands: ['ext:kordoc-normal-shape'] });
    expect(one({ key: 'F10', code: 'F10', ctrlKey: true })).toEqual({ commands: ['insert:symbols'] });
    // 다시 실행 Ctrl+Shift+Z, 복사 Ctrl+C 는 스튜디오에 맡긴다
    expect(one({ key: 'Z', code: 'KeyZ', ctrlKey: true, shiftKey: true })).toBeNull();
    expect(one({ key: 'c', code: 'KeyC', ctrlKey: true })).toBeNull();
    expect(one({ key: 'a', code: 'KeyA' })).toBeNull();
  });

  it('Ctrl+1~0·Ctrl+Alt+1~0 은 문서의 스타일 1~10번째', () => {
    expect(resolveKey(ev({ key: '1', code: 'Digit1', ctrlKey: true }), { chord: null })).toEqual({ commands: ['ext:kordoc-style'], params: { n: 1 } });
    expect(resolveKey(ev({ key: '0', code: 'Digit0', ctrlKey: true, altKey: true }), { chord: null })).toEqual({ commands: ['ext:kordoc-style'], params: { n: 10 } });
  });

  it('표가 서로 겹치지 않는다', () => {
    const singles = SINGLES.map(([c, s, a, k]) => `${c}${s}${a}${k}`);
    expect(new Set(singles).size).toBe(singles.length);
    for (const first of Object.keys(CHORDS)) expect(SINGLES.some(([c, s, a, k]) => c && !s && !a && k === first)).toBe(false);
    expect(Object.values(MENU_LABELS).every((l) => /^(Ctrl|Alt)/.test(l))).toBe(true);
  });

  it('표 칸 안: Ctrl+Enter 줄 추가·Ctrl+Backspace 줄 지우기·Alt+Insert, 표 밖에선 스튜디오 몫(쪽 나누기 등)', () => {
    const cell = { cell: true };
    expect(resolveKey(ev({ key: 'Enter', code: 'Enter', ctrlKey: true }), { chord: null }, false, cell)).toEqual({ commands: ['table:insert-row-below'] });
    expect(resolveKey(ev({ key: 'Backspace', code: 'Backspace', ctrlKey: true }), { chord: null }, false, cell)).toEqual({ commands: ['table:delete-row'] });
    expect(resolveKey(ev({ key: 'Insert', code: 'Insert', altKey: true }), { chord: null }, false, cell)).toEqual({ commands: ['table:insert-row-col'] });
    expect(resolveKey(ev({ key: 'Enter', code: 'Enter', ctrlKey: true }), { chord: null })).toBeNull();
    // 셀 블록 글자는 블록일 때만 (칸 안에서 h 는 글자)
    expect(resolveKey(letter('h'), { chord: null }, false, cell)).toBeNull();
    expect(resolveKey(ev({ key: 'Process', code: 'KeyH' }), { chord: null }, false, { cell: true, block: true })).toEqual({ commands: ['table:cell-height-equal'] });
    expect(resolveKey(ev({ key: 'Escape', code: 'Escape', shiftKey: true }), { chord: null }, false, { cell: true, block: true })).toEqual({ commands: ['ext:kordoc-table-exit'] });
    expect(resolveKey(ev({ key: 'Escape', code: 'Escape' }), { chord: null }, false, { cell: true, block: true })).toBeNull();
    // 중첩 표 칸의 Ctrl+Enter 는 삼킨다 (쪽 나누기로 바깥 문단이 갈리지 않게), 다른 키는 스튜디오 몫
    expect(resolveKey(ev({ key: 'Enter', code: 'Enter', ctrlKey: true }), { chord: null }, false, { nested: true })).toEqual({ swallow: true });
    expect(resolveKey(ev({ key: 'Backspace', code: 'Backspace', ctrlKey: true }), { chord: null }, false, { nested: true })).toBeNull();
    // 맥 ⌘+Backspace(줄 시작까지 지우기)는 표 키가 아니다: 표 키의 Ctrl 은 Control 만
    expect(resolveKey(ev({ key: 'Backspace', code: 'Backspace', metaKey: true }), { chord: null }, true, cell)).toBeNull();
    expect(resolveKey(ev({ key: 'Backspace', code: 'Backspace', ctrlKey: true }), { chord: null }, true, cell)).toEqual({ commands: ['table:delete-row'] });
    // 겹글쇠 둘째 자리는 표 키보다 먼저
    const st = { chord: 'n' as string | null };
    expect(resolveKey(letter('t'), st, false, { cell: true, block: true })).toEqual({ commands: ['table:create'] });
    const keys = TABLE_KEYS.map(([w, c, s2, a, k]) => `${w}${c}${s2}${a}${k}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('셀 너비 같게: 고른 칸들이 걸친 칸 전체를 평균 너비로, 경계를 넘는 합친 셀이 있으면 하지 않음', () => {
    // 2줄 3칸, 칸 너비 100·200·300 / 둘째 줄 앞 두 칸은 합친 셀(300)
    const cell = (i: number, col: number, colSpan: number, width: number) => ({ i, col, colSpan, width });
    const cells = [cell(0, 0, 1, 100), cell(1, 1, 1, 200), cell(2, 2, 1, 300), cell(3, 0, 2, 300), cell(4, 2, 1, 300)];
    expect(equalWidthDeltas(cells, 0, 1)).toEqual([{ cellIdx: 0, widthDelta: 50 }, { cellIdx: 1, widthDelta: -50 }]); // 합친 셀은 합이 그대로
    expect(equalWidthDeltas(cells, 1, 2)).toBeNull(); // 합친 셀이 칸 0~1 에 걸침
    expect(equalWidthDeltas(cells, 2, 2)).toBeNull(); // 한 칸뿐
  });

  it('쉬운 계산식: 가로는 맨 왼쪽~바로 앞 칸, 세로는 맨 위~바로 위 칸 (도움말 "가로 합계"·"세로 합계")', () => {
    expect(easyFormula(1, 3, 'row-sum')).toBe('=SUM(A2:C2)');
    expect(easyFormula(4, 1, 'col-avg')).toBe('=AVERAGE(B1:B4)');
    expect(easyFormula(0, 2, 'col-product')).toBeNull(); // 위 칸이 없음
    expect(easyFormula(2, 0, 'row-sum')).toBeNull();
    expect([0, 25, 26, 27].map(colName)).toEqual(['A', 'Z', 'AA', 'AB']);
    expect(resolveKey(letter('h', { ctrlKey: true, shiftKey: true }), { chord: null }, false, { cell: true })).toEqual({ commands: ['ext:kordoc-easy-row-sum'] });
    expect(resolveKey(letter('p'), { chord: null }, false, { object: true })).toEqual({ commands: ['format:object-properties'] });
  });

  it('날짜 문자열은 한컴 기본 꼴', () => {
    expect(dateText(new Date(2026, 9, 5))).toBe('2026년 10월 5일');
  });
});
