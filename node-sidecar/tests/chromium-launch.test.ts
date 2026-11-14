/** PDF 내보내기의 브라우저 띄우기 — 띄우는 동안 멈춤이 먹는지, 한 번의 띄우기 실패로 샌드박스가 꺼진 채 남지 않는지 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const launches = vi.hoisted(() => ({ calls: [] as string[][], next: [] as Array<() => Promise<unknown>> }));
vi.mock('puppeteer-core', () => ({
  default: {
    launch: (o: { args: string[] }) => {
      launches.calls.push(o.args);
      const f = launches.next.shift();
      return f ? f() : Promise.reject(new Error('Failed to launch the browser process'));
    },
  },
}));
// 브라우저 찾기는 있는 파일이면 통과한다 (띄우기는 위에서 가짜로 바꿨다)
process.env.PUPPETEER_EXECUTABLE_PATH = process.execPath;

import { pagesToPdf } from '../src/core/export/chromium.js';

async function* noPages(): AsyncGenerator<{ svg: string; width: number; height: number }> { /* 쪽 없음 */ }

beforeEach(() => { launches.calls = []; launches.next = []; });

describe('브라우저 띄우기', () => {
  it('띄우기가 한 번 실패했다고(둘 다 실패) 다음 문서부터 샌드박스를 끄지 않는다', async () => {
    await expect(pagesToPdf(noPages())).rejects.toThrow('Failed to launch');
    expect(launches.calls).toEqual([[], ['--no-sandbox', '--disable-setuid-sandbox']]);
    launches.calls = [];
    await expect(pagesToPdf(noPages())).rejects.toThrow('Failed to launch');
    // 다음 문서도 샌드박스를 켠 채 먼저 띄운다
    expect(launches.calls[0]).toEqual([]);
  });

  it('띄우는 동안 멈추면 기다리지 않고 끝내고, 뒤늦게 뜬 브라우저는 닫는다', async () => {
    const ac = new AbortController();
    const close = vi.fn(async () => undefined);
    let up!: (b: unknown) => void;
    launches.next = [() => new Promise((done) => { up = done; })];
    const run = pagesToPdf(noPages(), undefined, ac.signal);
    await new Promise((r) => setTimeout(r, 20));
    ac.abort();
    await expect(run).rejects.toThrow();
    // 샌드박스를 끄고 다시 띄우지 않는다
    expect(launches.calls).toHaveLength(1);
    up({ close });
    await new Promise((r) => setTimeout(r, 20));
    expect(close).toHaveBeenCalled();
  });

  it('이미 멈춘 요청은 브라우저를 띄우지 않는다', async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(pagesToPdf(noPages(), undefined, ac.signal)).rejects.toThrow();
    expect(launches.calls).toHaveLength(0);
  });
});
