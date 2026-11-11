/** 주소 보충 규칙 — kordoc 이 놓치는 도로명·지번 꼴은 잡고, 평범한 행정 문장은 건드리지 않는다 */

import { describe, it, expect } from 'vitest';
import { countRead, extraAddressHits, redactText, tighten } from '../src/core/redact/rules.js';

const found = (s: string) => extraAddressHits(s).map((h) => s.slice(h.index, h.index + h.length));
const mask = (s: string) => redactText(s, { rules: ['address'] }).text;

describe('주소 보충 규칙', () => {
  it('도로명·지번 + 동·호 주소를 잡는다', () => {
    expect(found('주소: 가온시 한빛로 123, 101동 1004호')).toEqual(['한빛로 123, 101동 1004호']);
    expect(found('경기도 가온시 중앙동 123-4번지')).toEqual(['중앙동 123-4번지']);
    expect(found('가온시 한빛로12번길 34')).toEqual(['한빛로12번길 34']);
    expect(found('서울특별시 중구 세종대로 110')).toEqual(['세종대로 110']);
    expect(found('광주광역시 동구 금남로 245 (금남로1가)')).toEqual(['금남로 245 (금남로1가)']);
    expect(found('가온시 중앙동 123 101동 202호')).toEqual(['중앙동 123 101동 202호']);
    expect(found('가온시 시청로 1')).toEqual(['시청로 1']);
  });

  it('평범한 행정 문장은 주소로 잡지 않는다 (낱말·숫자가 가려지면 글의 뜻이 달라진다)', () => {
    for (const s of [
      '2026년도 추가 3명을 배정함',
      '광진구 평가 2회 실시',
      '필요시 추가로 10일 연장',
      '서울시 인구가 940만 명',
      '올해도 증가 12건',
      '가온시 서면으로 2부 제출',
      '가온시 예산이 전년도 대비 5 늘었음',
      '경기도 평가 3 단계 중 2 단계',
      '가온시 별도로 3 가지를 검토',
      '가온시 중앙동 12 가구가 참여',
    ]) expect(found(s), s).toEqual([]);
    expect(mask('2026년도 추가 3명을 배정함')).toBe('2026년도 추가 3명을 배정함');
  });

  it('가릴 때는 시·군·구 이름을 남기고 그 뒤를 같은 길이로', () => {
    expect(mask('주소: 가온시 한빛로 123, 101동 1004호')).toBe('주소: 가온시 ●●● ●●●, ●●●● ●●●●●');
    expect(mask('경기도 가온시 중앙동 123-4번지')).toBe('경기도 가온시 ●●● ●●●●●●●');
  });
});

describe('글자 읽기로 얻은 글', () => {
  it('@ 앞뒤·숫자 사이 줄표 앞뒤 띄어쓰기를 빼고, 자리는 읽은 글 기준으로 되돌린다', () => {
    const read = '문의 hong @ gaon.example 까지';
    const t = tighten(read);
    expect(t.text).toBe('문의 hong@gaon.example 까지');
    const at = t.text.indexOf('gaon');
    expect(read.slice(t.at[at])).toMatch(/^gaon/);
    expect(tighten('010 - 1234 - 5678').text).toBe('010-1234-5678');
    // 평범한 글은 그대로 (목록 줄표·낱말 사이 줄표)
    for (const s of ['- 3 건 접수', '가 - 나 구간', '접수 3건 - 처리 2건']) expect(tighten(s).text, s).toBe(s);
  });

  it('줄표 자리에서 줄이 바뀐 번호는 붙이고, 다음 줄의 목록 표지("- ")는 붙이지 않는다', () => {
    expect(tighten('010-1234-\n5678', true).text).toBe('010-1234-5678');
    expect(tighten('900101-\r\n1234567', true).text).toBe('900101-1234567');
    expect(tighten('총 인원 900101\n- 1234567명 참석', true).text).toBe('총 인원 900101\n- 1234567명 참석');
    // 줄을 넘기지 않는 쪽(기본)은 줄바꿈을 건드리지 않는다
    expect(tighten('010-1234-\n5678').text).toBe('010-1234-\n5678');
  });

  it('띄어 읽힌 전자우편·전화번호도 센다', () => {
    const keep = () => false;
    expect(countRead('hong @ gaon.example', ['email'], keep)).toBe(1);
    expect(countRead('010 - 1234 - 5678', ['phone'], keep)).toBe(1);
    expect(countRead('접수 3건 - 처리 2건', ['email', 'phone'], keep)).toBe(0);
  });
});
