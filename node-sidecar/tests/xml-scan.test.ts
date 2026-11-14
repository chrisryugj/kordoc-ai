/** files/xml-scan — `/<태그…>[\s\S]*?<\/태그>/g` 정규식과 같은 조각을 글 길이에 비례한 시간에 */

import { describe, it, expect } from 'vitest';
import { replaceSpans, xmlSpans } from '../src/core/files/xml-scan.js';

const spans = (xml: string, open: string, close: string, accept?: (h: string) => boolean) => [...xmlSpans(xml, open, close, accept)].map((s) => xml.slice(s.start, s.end));

describe('xmlSpans', () => {
  it('보통 XML 에서는 정규식과 같은 조각 (빈 요소 포함, 이름이 더 긴 요소는 아님)', () => {
    const xml = '<w:styles><w:style w:styleId="a"><w:name w:val="A"/></w:style><w:style w:styleId="b"/><w:styleX/><w:style w:styleId="c"><w:pPr/></w:style></w:styles>';
    expect(spans(xml, '<w:style', '</w:style>')).toEqual([
      '<w:style w:styleId="a"><w:name w:val="A"/></w:style>',
      '<w:style w:styleId="b"/>',
      '<w:style w:styleId="c"><w:pPr/></w:style>',
    ]);
    const viaRegex = [...xml.matchAll(/<w:style\b[^>]*?(?:\/>|>[\s\S]*?<\/w:style>)/g)].map((m) => m[0]).filter((m) => !m.startsWith('<w:styles'));
    expect(spans(xml, '<w:style', '</w:style>')).toEqual(viaRegex);
  });

  it('머리·안쪽·끝 자리', () => {
    const xml = 'x<c r="A1"><v>1</v></c><c r="B1"/>';
    const [a, b] = [...xmlSpans(xml, '<c', '</c>')];
    expect(a).toEqual({ start: 1, head: '<c r="A1">', inner: '<v>1</v>', end: 23 });
    expect(b).toMatchObject({ head: '<c r="B1"/>', inner: '', end: xml.length });
  });

  it('accept 가 받지 않은 머리는 건너뛰고 그 안에서 다시 찾는다', () => {
    const xml = '<f a="no"><f a="yes">in</f></f>';
    expect(spans(xml, '<f', '</f>', (h) => h.includes('yes'))).toEqual(['<f a="yes">in</f>']);
  });

  it('닫는 표시가 더 없으면 뒤의 여는 자리는 건너뛰되 빈 요소는 낸다', () => {
    const xml = `<a k="1">${'<a k="2">'.repeat(5)}<a k="3"/>`;
    expect(spans(xml, '<a', '</a>')).toEqual(['<a k="3"/>']);
  });

  it('머리 안에 < 가 있으면(깨진 머리) 여는 태그로 보지 않는다', () => {
    expect(spans('<a <a x="1">t</a>', '<a', '</a>')).toEqual(['<a x="1">t</a>']);
  });

  it('닫히지 않는 여는 태그 10만 개도 금방', () => {
    const xml = `<r><a>ok</a>${'<a b="1">'.repeat(100_000)}${'<a <a '.repeat(100_000)}</r>`;
    const t = performance.now();
    expect(spans(xml, '<a', '</a>')).toEqual(['<a>ok</a>']);
    expect(performance.now() - t).toBeLessThan(500);
  });
});

describe('replaceSpans', () => {
  it('고른 조각만 바꾸고 나머지는 그대로', () => {
    const xml = '<r><a>1</a><a>2</a><a>3</a></r>';
    expect(replaceSpans(xml, xmlSpans(xml, '<a', '</a>'), (w, s) => (s.inner === '2' ? '' : undefined))).toBe('<r><a>1</a><a>3</a></r>');
    expect(replaceSpans(xml, xmlSpans(xml, '<b', '</b>'), () => 'x')).toBe(xml);
  });
});
