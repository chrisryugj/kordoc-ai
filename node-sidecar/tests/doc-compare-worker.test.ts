/** 문서 비교를 작업자 스레드 일로 넘기는지 — 엔진이 비교하는 동안 멈추지 않고 취소가 먹게 (infra/worker)
 *  시험에서는 시작 파일을 모르므로 같은 스레드에서 돈다. 여기서는 넘기는 일·취소 신호·주고받는 값의 복제만 본다 */

import { describe, it, expect, vi } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { markdownToHwpx } from 'kordoc';
import { setupEnv } from './doc-helpers.js';

vi.mock('../src/infra/progress.js', async (orig) => ({ ...(await orig<typeof import('../src/infra/progress.js')>()), sendProgress: vi.fn(), sendNotification: vi.fn() }));
vi.mock('../src/infra/worker.js', async (orig) => {
  const real = await orig<typeof import('../src/infra/worker.js')>();
  return { ...real, runJob: vi.fn(real.runJob) };
});

const { runJob } = await import('../src/infra/worker.js');
const { compareDocs } = await import('../src/core/comparator/index.js');

describe('compare 작업자', () => {
  it('비교를 작업자 일로 넘기고 취소 신호를 함께 준다. 주고받는 값은 구조화 복제된다', async () => {
    const env = setupEnv();
    const a = join(env.work, 'old.hwpx');
    const b = join(env.work, 'new.hwpx');
    writeFileSync(a, Buffer.from(await markdownToHwpx('# 조례\n\n제1조(목적) 이 조례는 복지 향상을 정한다.\n\n| 구분 | 금액 |\n| --- | --- |\n| 인건비 | 1,000 |\n')));
    writeFileSync(b, Buffer.from(await markdownToHwpx('# 조례\n\n제1조(목적) 이 조례는 복지 증진을 정한다.\n\n| 구분 | 금액 |\n| --- | --- |\n| 인건비 | 1,500 |\n')));
    const ac = new AbortController();
    const r = await compareDocs({ old_path: a, new_path: b }, ac.signal);
    expect(r.stats.modified).toBe(2);

    const calls = vi.mocked(runJob).mock.calls.filter(([kind]) => kind === 'compare');
    expect(calls).toHaveLength(1);
    const [, data, opts] = calls[0];
    expect(opts?.signal).toBe(ac.signal);
    // 작업자는 복제된 값(Buffer 가 아닌 Uint8Array)을 받는다: 그 꼴로도 같은 결과이고, 결과도 복제해 돌려받을 수 있어야 한다
    const sent = structuredClone(data) as { a: Uint8Array; b: Uint8Array };
    expect(Buffer.isBuffer(sent.a)).toBe(false);
    const res = await runJob<{ stats: unknown; diffs: unknown[] }>('compare', sent).result;
    expect(structuredClone(res)).toEqual(res);
    expect(res.diffs).toHaveLength(r.stats.modified + r.stats.unchanged + r.stats.added + r.stats.removed);
  });

  it('못 읽는 문서는 작업자에서도 어느 쪽인지 한국어로 짚는다', async () => {
    const env = setupEnv();
    const a = join(env.work, 'old.hwpx');
    const broken = join(env.work, 'broken.hwpx');
    writeFileSync(a, Buffer.from(await markdownToHwpx('제1조 글')));
    writeFileSync(broken, 'not a zip');
    await expect(compareDocs({ old_path: broken, new_path: a })).rejects.toThrow(/^옛 문서를 읽지 못했습니다\./);
  });
});
