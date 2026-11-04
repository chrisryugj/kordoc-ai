/** 효과 집계 — 달은 이 PC 시각 기준 (한국 시각 1일 새벽 기록이 지난달로 가지 않는다), 도장을 못 찍으면 세지 않는다 */

import { describe, it, expect, afterAll, afterEach, beforeEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { reload } from '../src/infra/config.js';
import { recordUsage, usageReport, usageReset } from '../src/infra/usage.js';

const dir = mkdtempSync(join(tmpdir(), 'kordoc-usage-'));
process.env.KORDOC_AI_DATA_DIR = dir;
reload();

// 저장 타이머(2초 뒤 usage.json)도 가짜로: 시험 뒤 지운 폴더를 다시 만들지 않게
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const count = (key: string) => usageReport('month').items.find((i) => i.key === key)?.count ?? 0;

describe('효과 집계 달 경계', () => {
  it('이 PC 시각으로 달이 바뀐 직후 기록은 새 달에 든다', async () => {
    vi.setSystemTime(new Date(2026, 10, 1, 0, 30)); // 이 PC 시각 11월 1일 0시 30분 (한국이면 UTC 로는 10월 31일)
    await usageReset();
    recordUsage('export_pdf', { path: 'a.hwpx' }, {});
    const r = usageReport('month');
    expect(r.since).toBe('2026-11-01');
    expect(count('pdf')).toBe(1);
    expect(usageReport('all').since).toBe('2026-11-01');

    vi.setSystemTime(new Date(2026, 9, 31, 23, 50)); // 같은 기록을 지난달 기준으로 보면 비어 있다
    expect(count('pdf')).toBe(0);
  });

  it('도장을 찍지 못했으면(placed 0) 세지 않는다', async () => {
    await usageReset();
    recordUsage('seal', {}, { output_path: '', placed: 0 });
    expect(count('seal')).toBe(0);
    recordUsage('seal', {}, { output_path: 'x.hwpx', placed: 1 });
    expect(count('seal')).toBe(1);
  });
});
