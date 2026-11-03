/** 앱 공용 HWP → HWPX 변환(core/render/rhwp.ts rhwpConvert) — kordoc hwpToHwpx 가 먼저 (실측 2026-11-03: 서식 일치 0.997 대 rhwp 0.980) */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { parse } from 'kordoc';
import { rhwpConvert } from '../src/core/render/rhwp.js';
import { sample } from './doc-helpers.js';

// 글자만 견준다: HWP·HWPX 파서는 같은 글에 제목 표시(#)·표 기호를 다르게 붙인다
const flat = (s: string) => s.replace(/[\s#*|>`_-]+/g, '');

describe('HWP → HWPX 는 kordoc 변환', () => {
  it('HWP 5 를 kordoc 이 바꾸고(version.xml application=kordoc), 본문이 그대로', async () => {
    const hwpx = new Uint8Array(readFileSync(sample('4-보고서_디지털 행정 혁신 추진계획.hwpx')));
    const hwp = await rhwpConvert(hwpx, 'hwp');
    expect([...hwp.subarray(0, 4)]).toEqual([0xd0, 0xcf, 0x11, 0xe0]);
    const back = await rhwpConvert(hwp, 'hwpx');
    const zip = await JSZip.loadAsync(back);
    expect(await zip.file('version.xml')!.async('string')).toMatch(/application="kordoc"/);
    // 원래 HWPX 를 읽은 글과 견준다 (HWP 파서는 목차·장 띠를 다르게 풀어 같은 문서라도 글이 다르다)
    const buf = (u: Uint8Array) => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
    const [a, b] = await Promise.all([parse(buf(hwpx)), parse(buf(back))]);
    expect(a.success && b.success).toBe(true);
    if (a.success && b.success) expect(flat(b.markdown)).toBe(flat(a.markdown));
  }, 60_000);

  it('HWPX → HWP 는 그대로 rhwp', async () => {
    const hwpx = new Uint8Array(readFileSync(sample('1-받은공문_도민체육대회 참가 협조 요청.hwpx')));
    const hwp = await rhwpConvert(hwpx, 'hwp');
    expect([...hwp.subarray(0, 4)]).toEqual([0xd0, 0xcf, 0x11, 0xe0]);
  }, 60_000);
});
