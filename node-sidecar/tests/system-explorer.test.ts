/** 탐색기 인자 — 쉼표 든 경로의 "폴더에서 보기"·열기 (8차 LOW 13). 탐색기는 띄우지 않는다(child_process 가짜) */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mockExecFile = vi.fn();
vi.mock('node:child_process', () => ({
  execFile: (cmd: string, args: string[], opts: unknown, cb: unknown) => {
    mockExecFile(cmd, args, opts);
    if (typeof cb === 'function') (cb as (e: unknown) => void)(null);
    return { kill: vi.fn() };
  },
}));
vi.mock('../src/infra/logger.js', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { explorerArgs, registerSystem } from '../src/rpc/methods/system.js';
import { RpcRouter } from '../src/rpc/router.js';

describe('explorerArgs', () => {
  it('경로를 큰따옴표로 감싸 쉼표에서 잘리지 않게', () => {
    expect(explorerArgs('C:/문서/회의,결과/보고.pdf', true)).toEqual(['/select,"C:\\문서\\회의,결과\\보고.pdf"']);
    expect(explorerArgs('C:\\a,b\\c.hwpx')).toEqual(['"C:\\a,b\\c.hwpx"']);
  });
});

describe.skipIf(process.platform !== 'win32')('reveal_file·open_file·open_folder (윈도)', () => {
  let dir: string;
  let file: string;
  const noLaunch = process.env.KORDOC_AI_NO_LAUNCH;
  beforeAll(() => {
    delete process.env.KORDOC_AI_NO_LAUNCH; // 인자를 보려고 launch 까지 간다 (execFile 은 가짜)
    dir = join(mkdtempSync(join(tmpdir(), 'kordoc-explorer-')), 'a,b');
    mkdirSync(dir);
    file = join(dir, 'x,y.pdf');
    writeFileSync(file, '%PDF-1.4');
  });
  afterAll(() => {
    if (noLaunch !== undefined) process.env.KORDOC_AI_NO_LAUNCH = noLaunch;
    rmSync(join(dir, '..'), { recursive: true, force: true });
  });

  it('따옴표 친 경로를 Node 가 다시 감싸지 않게(windowsVerbatimArguments) 넘긴다', async () => {
    const router = new RpcRouter();
    registerSystem(router);
    for (const [method, want] of [['reveal_file', `/select,"${file}"`], ['open_file', `"${file}"`], ['open_folder', `"${dir}"`]] as const) {
      mockExecFile.mockClear();
      const r = await router.dispatch(method, { path: method === 'open_folder' ? dir : file });
      expect(r.error).toBeUndefined();
      const [cmd, args, opts] = mockExecFile.mock.calls[0] as [string, string[], { windowsVerbatimArguments?: boolean }];
      expect(cmd).toMatch(/explorer\.exe$/i);
      expect(args).toEqual([want]);
      expect(opts.windowsVerbatimArguments).toBe(true);
    }
  });
});
