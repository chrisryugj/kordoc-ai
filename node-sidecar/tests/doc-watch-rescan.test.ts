/** 폴더 감시 다시 훑기 — fs.watch 이벤트가 오지 않아도(공유 폴더·바쁠 때) 새 문서를 변환한다 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// 이벤트를 하나도 내지 않는 fs.watch (SMB·NAS 공유 폴더에서 흔한 상황)
vi.mock('node:fs', async (orig) => ({ ...(await orig<typeof import('node:fs')>()), watch: () => Object.assign(new EventEmitter(), { close: () => undefined }) }));
vi.mock('../src/infra/progress.js', async (orig) => ({ ...(await orig<typeof import('../src/infra/progress.js')>()), sendProgress: vi.fn(), sendNotification: vi.fn() }));

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
});
