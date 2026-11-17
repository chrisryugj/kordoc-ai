/** 바꿔 넣기 다시 하기 — 백신·문서보안이 막 쓴 파일을 잠깐 잡아 rename 이 EPERM 이 나도 저장이 된다 */

import { describe, expect, it, vi } from 'vitest';

const calls: string[] = [];
let failures: string[] = [];
vi.mock('node:fs/promises', async (orig) => ({
  ...(await orig<typeof import('node:fs/promises')>()),
  rename: async (from: string) => {
    calls.push(from);
    const code = failures.shift();
    if (code) throw Object.assign(new Error(code), { code });
  },
}));

const { renameRetry } = await import('../src/infra/rename-retry.js');

describe('renameRetry', () => {
  it('Windows 에서 EPERM·EBUSY 가 잠깐 나면 다시 해서 바꿔 넣는다', async () => {
    calls.length = 0;
    failures = ['EPERM', 'EBUSY'];
    await renameRetry('a.tmp', 'a', { platform: 'win32', delays: [1, 1, 1] });
    expect(calls).toHaveLength(3);
  });

  it('계속 막히면 그 오류를 그대로 던진다 (열려 있는 파일 안내는 errors.ts 가)', async () => {
    calls.length = 0;
    failures = ['EPERM', 'EPERM', 'EPERM', 'EPERM'];
    await expect(renameRetry('a.tmp', 'a', { platform: 'win32', delays: [1, 1, 1] })).rejects.toMatchObject({ code: 'EPERM' });
    expect(calls).toHaveLength(4);
  });

  it('다른 오류나 Windows 가 아니면 다시 하지 않는다', async () => {
    calls.length = 0;
    failures = ['ENOENT'];
    await expect(renameRetry('a.tmp', 'a', { platform: 'win32', delays: [1, 1] })).rejects.toMatchObject({ code: 'ENOENT' });
    failures = ['EPERM'];
    await expect(renameRetry('a.tmp', 'a', { platform: 'linux' })).rejects.toMatchObject({ code: 'EPERM' });
    expect(calls).toHaveLength(2);
  });
});
