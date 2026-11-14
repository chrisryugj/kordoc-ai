/** 효과 집계 — 달은 이 PC 시각 기준 (한국 시각 1일 새벽 기록이 지난달로 가지 않는다), 도장을 못 찍으면 세지 않는다 */

import { describe, it, expect, afterAll, afterEach, beforeEach, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
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

  it('기록 파일을 잠깐 못 읽고 시작해도 지난 기록을 지우지 않는다 (저장 전에 다시 읽어 합친다)', async () => {
    vi.useRealTimers();
    const file = join(dir, 'usage.json');
    const aside = join(dir, 'usage.aside');
    writeFileSync(aside, JSON.stringify({ version: 1, since: '2026-01-05T00:00:00.000Z', months: { '2026-01': { pdf: 7 } } }));
    rmSync(file, { recursive: true, force: true });
    mkdirSync(file); // 파일 자리에 폴더: 읽기가 실패한다
    vi.resetModules();
    const fresh = await import('../src/infra/usage.js');
    fresh.recordUsage('export_pdf', { path: 'a.hwpx' }, {});
    fresh.flushUsage(); // 아직 못 읽는다 → 저장을 건너뛴다
    expect(statSync(file).isDirectory()).toBe(true);
    rmSync(file, { recursive: true, force: true });
    renameSync(aside, file);
    fresh.recordUsage('export_pdf', { path: 'b.hwpx' }, {});
    fresh.flushUsage();
    const saved = JSON.parse(readFileSync(file, 'utf-8'));
    expect(saved.months['2026-01'].pdf).toBe(7);
    expect(saved.since).toBe('2026-01-05T00:00:00.000Z');
    expect(fresh.usageReport('all').items.find((i) => i.key === 'pdf')?.count).toBe(9);
    rmSync(file, { force: true });
  });

  it('다른 엔진(MCP)이 그사이 저장한 건수를 덮어 지우지 않는다 — 더한 몫만 얹는다', async () => {
    vi.useRealTimers();
    const file = join(dir, 'usage.json');
    rmSync(file, { recursive: true, force: true });
    vi.resetModules();
    const app = await import('../src/infra/usage.js');
    app.recordUsage('export_pdf', { path: 'a.hwpx' }, {});
    app.flushUsage();
    const month = Object.keys(JSON.parse(readFileSync(file, 'utf-8')).months)[0];
    // 다른 엔진이 같은 파일에 PDF 5건·OCR 3쪽을 더해 저장했다
    const other = JSON.parse(readFileSync(file, 'utf-8'));
    other.months[month].pdf += 5;
    other.months[month].ocr = 3;
    writeFileSync(file, JSON.stringify(other));
    app.recordUsage('export_pdf', { path: 'b.hwpx' }, {});
    app.flushUsage();
    const saved = JSON.parse(readFileSync(file, 'utf-8'));
    expect(saved.months[month].pdf).toBe(7);
    expect(saved.months[month].ocr).toBe(3);
    // 지우기는 합치지 않고 비운다
    await app.usageReset();
    app.flushUsage();
    expect(JSON.parse(readFileSync(file, 'utf-8')).months).toEqual({});
    rmSync(file, { force: true });
  });

  it('저장에 실패한 몫은 버리지 않고 다음 저장에 얹는다', async () => {
    const file = join(dir, 'usage.json');
    const tmp = `${file}.${process.pid}.tmp`;
    rmSync(file, { recursive: true, force: true });
    vi.resetModules();
    const { logger } = await import('../src/infra/logger.js');
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const fresh = await import('../src/infra/usage.js');
    mkdirSync(tmp); // 임시 파일 자리에 폴더: 쓰기가 실패한다 (다른 프로그램이 쥔 것과 같은 길)
    fresh.recordUsage('export_pdf', { path: 'a.hwpx' }, {});
    await vi.advanceTimersByTimeAsync(2000);
    vi.useRealTimers();
    await vi.waitFor(() => expect(warn).toHaveBeenCalledWith(expect.stringContaining('저장 실패')));
    rmSync(tmp, { recursive: true, force: true });
    // 그사이 다른 엔진이 기록 파일을 만들었다: 다음 저장은 이 파일에 얹는다
    writeFileSync(file, JSON.stringify({ version: 1, since: '2026-01-05T00:00:00.000Z', months: {} }));
    fresh.recordUsage('export_pdf', { path: 'b.hwpx' }, {});
    fresh.flushUsage();
    const saved = JSON.parse(readFileSync(file, 'utf-8'));
    expect(Object.values(saved.months as Record<string, Record<string, number>>)[0].pdf).toBe(2);
    warn.mockRestore();
    rmSync(file, { force: true });
  });

  it('엔진이 꺼지는 길마다 미뤄 둔 저장을 먼저 한다 (기록 2초 안에 꺼져도 건수가 남는다)', () => {
    for (const src of ['../src/main.ts', '../src/mcp/server.ts']) {
      const text = readFileSync(new URL(src, import.meta.url), 'utf-8');
      const exits = text.match(/process\.exit\(0\)/g)?.length ?? 0;
      expect(exits, src).toBeGreaterThan(0);
      expect(text.match(/flushUsage\(\);\s*process\.exit\(0\)/g)?.length ?? 0, src).toBe(exits);
    }
  });

  it('도장을 찍지 못했으면(placed 0) 세지 않는다', async () => {
    await usageReset();
    recordUsage('seal', {}, { output_path: '', placed: 0 });
    expect(count('seal')).toBe(0);
    recordUsage('seal', {}, { output_path: 'x.hwpx', placed: 1 });
    expect(count('seal')).toBe(1);
  });
});
