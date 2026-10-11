/** kordoc 목차 틀이 rhwp 에서 제 폭으로 조판되는지 — 보정 전에는 "추진 배 / 경" 으로 끊겼다 */
import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { markdownToHwpx } from 'kordoc';
import { rhwpCompat } from '../src/core/gongmun/rhwp-compat.js';
import { openRhwp } from '../src/core/render/rhwp.js';

/** kordoc 이 그대로 낸 목차 있는 개조식 보고서 (보정 전) */
const raw = async () => new Uint8Array(await markdownToHwpx('# 추진계획\n\n> 시험을 위해 만든 보고서임\n\n## 추진 배경\n\n- 내용\n\n## 추진 목표\n\n- 내용\n', { gongmun: { preset: '개조식', cover: { org: '가온시' }, toc: true } }));

/** 목차 쪽 SVG 에서 '배'·'경' 글자 y 좌표 — 같은 줄이면 같다 */
async function tocLineYs(bytes: Uint8Array) {
  const doc = (await openRhwp(bytes)) as unknown as { renderPageSvg(i: number): string; free?(): void };
  const svg = doc.renderPageSvg(1);
  doc.free?.();
  const y = (ch: string) => Number(new RegExp(`<text x="[\\d.]+" y="([\\d.]+)"[^>]*>${ch}</text>`).exec(svg)?.[1]);
  return { bae: y('배'), gyeong: y('경') };
}

describe('rhwpCompat', () => {
  it('목차 틀 pageBreak CELL → NONE', async () => {
    const out = await rhwpCompat(await raw());
    const zip = await JSZip.loadAsync(out);
    const xml = await zip.file('Contents/section0.xml')!.async('string');
    const tag = xml.slice(xml.lastIndexOf('<hp:tbl ', xml.indexOf('추진 배경')), xml.indexOf('추진 배경'));
    expect(tag).toContain('pageBreak="NONE"');
    expect(Object.keys(zip.files)[0]).toBe('mimetype');
  });

  it('보정하면 목차 제목이 한 줄에 들어간다 (보정 전엔 두 줄)', async () => {
    const before = await tocLineYs(await raw());
    expect(before.gyeong).not.toBe(before.bae); // 버그 재현 (rhwp 가 고쳐지면 이 줄을 지운다)
    const after = await tocLineYs(await rhwpCompat(await raw()));
    expect(after.gyeong).toBe(after.bae);
  });
});
