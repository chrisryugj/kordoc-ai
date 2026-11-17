/** 폴더 감시 다시 훑기 — fs.watch 이벤트가 오지 않아도(공유 폴더·바쁠 때) 새 문서를 변환한다 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { copyFileSync, mkdirSync, readFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';

// 이벤트를 하나도 내지 않는 fs.watch (SMB·NAS 공유 폴더에서 흔한 상황)
vi.mock('node:fs', async (orig) => ({ ...(await orig<typeof import('node:fs')>()), watch: () => Object.assign(new EventEmitter(), { close: () => undefined }) }));
vi.mock('../src/infra/progress.js', async (orig) => ({ ...(await orig<typeof import('../src/infra/progress.js')>()), sendProgress: vi.fn(), sendNotification: vi.fn() }));
// 한글이 쥐고 있는 파일 (Windows 는 읽기가 EBUSY): 처음 두 번은 못 읽는다
const busy = vi.hoisted(() => ({ left: 2 }));
vi.mock('../src/core/converter/index.js', async (orig) => {
  const real = await orig<typeof import('../src/core/converter/index.js')>();
  return {
    ...real,
    convert: (p: Parameters<typeof real.convert>[0], ...rest: unknown[]) => {
      if (p.path.endsWith('잠긴.hwpx') && busy.left-- > 0) return Promise.reject(Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY', syscall: 'open', path: p.path }));
      return (real.convert as (...a: unknown[]) => ReturnType<typeof real.convert>)(p, ...rest);
    },
  };
});

import { sendNotification } from '../src/infra/progress.js';
import { call, sample, setupEnv } from './doc-helpers.js';

let env: ReturnType<typeof setupEnv>;

beforeAll(() => {
  env = setupEnv();
});

describe('watch 다시 훑기', () => {
  it('이벤트 없이도 새로 넣은 문서를 변환하고, 감시 시작 때 있던 문서는 건드리지 않는다', async () => {
    const dir = join(env.base, 'share');
    const out = join(env.base, 'share-out');
    mkdirSync(dir, { recursive: true });
    copyFileSync(sample('4-보고서_디지털 행정 혁신 추진계획.hwpx'), join(dir, '원래있던.hwpx'));
    const { id } = await call('watch_start', { dir, out_dir: out, format: 'md' });
    const events = () => vi.mocked(sendNotification).mock.calls.filter(([m]) => m === 'watch_event').map(([, p]) => p as { ok: boolean; path: string; output_path: string });
    try {
      copyFileSync(sample('1-받은공문_도민체육대회 참가 협조 요청.hwpx'), join(dir, '새공문.hwpx'));
      const deadline = Date.now() + 30_000;
      while (!events().length && Date.now() < deadline) await new Promise((r) => setTimeout(r, 200));
      await new Promise((r) => setTimeout(r, 6000)); // 한 번 더 훑어도 시작 때 있던 문서는 그대로
      expect(events()).toHaveLength(1);
      expect(events()[0]).toMatchObject({ ok: true, path: join(dir, '새공문.hwpx') });
      expect(readFileSync(events()[0].output_path, 'utf-8')).toContain('체육대회');
    } finally {
      await call('watch_stop', { id });
    }
  }, 60_000);

  it('한글이 쥐고 있어 못 읽은 문서는 처리한 것으로 적지 않고 다시 해 본다 (실패 알림은 한 번)', async () => {
    const dir = join(env.base, 'locked');
    const out = join(env.base, 'locked-out');
    mkdirSync(dir, { recursive: true });
    const { id } = await call('watch_start', { dir, out_dir: out, format: 'md' });
    const events = () => vi.mocked(sendNotification).mock.calls.filter(([m, p]) => m === 'watch_event' && (p as { path: string }).path === join(dir, '잠긴.hwpx')).map(([, p]) => p as { ok: boolean; output_path?: string });
    try {
      copyFileSync(sample('1-받은공문_도민체육대회 참가 협조 요청.hwpx'), join(dir, '잠긴.hwpx'));
      const deadline = Date.now() + 40_000;
      while (!events().some((e) => e.ok) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 200));
      expect(events().map((e) => e.ok)).toEqual([false, true]);
      expect(readFileSync(events()[1].output_path!, 'utf-8')).toContain('체육대회');
    } finally {
      await call('watch_stop', { id });
    }
  }, 60_000);

  it('폴더를 잠깐 못 보면(네트워크 드라이브 끊김) 멈추지 않고 다시 보다가, 오래 못 볼 때만 멈추고 알린다', async () => {
    const { watchRetry } = await import('../src/core/watch/index.js');
    const saved = { ...watchRetry };
    // (임시 폴더 안 이름은 영문으로)
    const dir = join(env.base, 'flaky');
    const away = join(env.base, 'flaky-away');
    const out = join(env.base, 'flaky-out');
    mkdirSync(dir, { recursive: true });
    vi.mocked(sendNotification).mockClear();
    const events = () => vi.mocked(sendNotification).mock.calls.filter(([m]) => m === 'watch_event').map(([, p]) => p as { ok: boolean; path: string; error?: string });
    const listed = async (id: string) => (await call('watch_list')).some((w: { id: string }) => w.id === id);
    const until = async (ok: () => boolean | Promise<boolean>, ms: number) => {
      const deadline = Date.now() + ms;
      while (!(await ok()) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
    };
    Object.assign(watchRetry, { firstWaitMs: 200, maxWaitMs: 400, giveUpMs: 60_000 });
    const { id } = await call('watch_start', { dir, out_dir: out, format: 'md' });
    try {
      renameSync(dir, away); // 드라이브가 빠짐
      await new Promise((r) => setTimeout(r, 6500)); // 첫 다시 훑기(5초)와 그 뒤 몇 번 더
      expect(events()).toHaveLength(0);
      expect(await listed(id)).toBe(true);
      renameSync(away, dir); // 다시 붙음
      copyFileSync(sample('1-받은공문_도민체육대회 참가 협조 요청.hwpx'), join(dir, 'new.hwpx'));
      await until(() => events().length > 0, 30_000);
      expect(events()[0]).toMatchObject({ ok: true, path: join(dir, 'new.hwpx') });
      // 오래 못 보면 멈추고 알린다
      watchRetry.giveUpMs = 0;
      renameSync(dir, away);
      await until(async () => !(await listed(id)), 15_000);
      expect(await listed(id)).toBe(false);
      expect(events().at(-1)).toMatchObject({ ok: false, path: dir, error: expect.stringMatching(/네트워크 드라이브라면 연결을 확인/) });
    } finally {
      Object.assign(watchRetry, saved);
      await call('watch_stop', { id });
    }
  }, 90_000);
});
