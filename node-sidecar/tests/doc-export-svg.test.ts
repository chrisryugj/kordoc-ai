/** PDF 조립: 쪽 SVG id 가 겹치지 않게 (겹치면 뒤쪽 표 칸이 앞쪽 clipPath 로 잘린다) */
import { describe, it, expect } from 'vitest';
import { pagesHtml, scopeSvgIds } from '../src/core/export/chromium.js';

const page = (label: string) => `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><defs><clipPath id="cell-clip-8"><rect width="10" height="10"/></clipPath><linearGradient id="g1"/></defs><g clip-path="url(#cell-clip-8)"><text>${label}</text></g><rect fill="url('#g1')"/><use xlink:href="#cell-clip-8"/><use href="#g1"/></svg>`;

describe('scopeSvgIds', () => {
  it('id·url(#)·href(#) 를 함께 바꾼다', () => {
    const out = scopeSvgIds(page('A'), 'p0-');
    expect(out).toContain('id="p0-cell-clip-8"');
    expect(out).toContain('clip-path="url(#p0-cell-clip-8)"');
    expect(out).toContain(`fill="url('#p0-g1')"`);
    expect(out).toContain('xlink:href="#p0-cell-clip-8"');
    expect(out).toContain('href="#p0-g1"');
    expect(out).not.toMatch(/url\(#cell-clip-8\)/);
  });
  it('여러 쪽을 넣어도 id 가 하나도 겹치지 않는다', () => {
    const html = pagesHtml([{ svg: page('A'), width: 794, height: 1123 }, { svg: page('B'), width: 794, height: 1123 }]);
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(html).toContain('url(#p1-cell-clip-8)');
  });
  it('비슷한 이름(접두가 같은 id)도 정확히 그 id 만 바꾼다', () => {
    const svg = '<svg><clipPath id="c1"/><clipPath id="c10"/><g clip-path="url(#c10)"/><g clip-path="url(#c1)"/></svg>';
    const out = scopeSvgIds(svg, 'x-');
    expect(out).toContain('url(#x-c10)');
    expect(out).toContain('url(#x-c1)');
    expect(out).not.toContain('x-x-');
  });
});
