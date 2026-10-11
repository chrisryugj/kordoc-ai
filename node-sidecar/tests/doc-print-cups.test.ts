/** 인쇄: macOS·리눅스 CUPS 경로 (실제 인쇄는 하지 않는다 — 명령 구성·출력 해석만) */
import { describe, it, expect } from 'vitest';
import { lpArgs, parseLpstat, listPrinters } from '../src/core/print/index.js';

describe('CUPS', () => {
  it('lp 인자: 프린터 지정·기본', () => {
    expect(lpArgs('/tmp/a.pdf', 'Office_Laser')).toEqual(['-d', 'Office_Laser', '--', '/tmp/a.pdf']);
    expect(lpArgs('/tmp/-weird.pdf')).toEqual(['--', '/tmp/-weird.pdf']);
  });
  it('lpstat 출력 해석', () => {
    const out = 'printer Office_Laser is idle.  enabled since Fri Oct 10 2026\nprinter Floor2 disabled since Thu Oct  9 2026 -\n\treason unknown\nsystem default destination: Office_Laser\n';
    expect(parseLpstat(out)).toEqual([
      { name: 'Office_Laser', isDefault: true, status: 'ready' },
      { name: 'Floor2', isDefault: false, status: 'offline' },
    ]);
    expect(parseLpstat('lpstat: No destinations added.\n')).toEqual([]);
  });
  it.skipIf(process.platform === 'win32')('이 PC 프린터 목록 (없으면 빈 목록, 오류 아님)', async () => {
    expect(Array.isArray(await listPrinters())).toBe(true);
  });
});
