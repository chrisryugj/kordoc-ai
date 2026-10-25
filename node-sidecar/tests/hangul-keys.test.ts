/** 한컴 한글 단축키 판정 (editor-host/hangul-keys.js) — 한컴 공식 단축키 일람 기준 */
import { describe, expect, it } from 'vitest';
import { CHORDS, MENU_LABELS, SINGLES, dateText, keyName, resolveKey } from '../editor-host/hangul-keys.js';

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

  it('날짜 문자열은 한컴 기본 꼴', () => {
    expect(dateText(new Date(2026, 9, 5))).toBe('2026년 10월 5일');
  });
});
