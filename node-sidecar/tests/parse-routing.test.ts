/** 작업자로 보낼지는 압축을 푼 크기로 (converter parseBytes·files docInfo) — 200KB HWPX 의 XML 이 43MB 라
 *  압축된 크기(30MB 기준)로만 보면 엔진 스레드에서 읽어 RSS 1.26GB 를 썼다. 작업자 길(runJob)은 가짜로 바꿔 불렸는지만 본다 */

import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';

const runJob = vi.fn((_kind: string, _data: unknown) => ({
  result: Promise.resolve({ success: true, fileType: 'hwpx', markdown: '가짜', blocks: [], metadata: { pageCount: 1 } }),
  next() {},
  stop() {},
}));
vi.mock('../src/infra/worker.js', () => ({ registerJob: vi.fn(), runJob: (kind: string, data: unknown) => runJob(kind, data), setWorkerEntry: vi.fn() }));

import { parseBytes } from '../src/core/converter/index.js';
import { docInfo } from '../src/core/files/index.js';
import { sample } from './doc-helpers.js';

const dir = mkdtempSync(join(tmpdir(), 'kordoc-route-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
beforeEach(() => runJob.mockClear());

/** 구역 XML 을 빈칸으로 mb 만큼 불린 HWPX (압축하면 몇십 KB) */
async function inflated(mb: number): Promise<Buffer> {
  const zip = await JSZip.loadAsync(readFileSync(sample('1-받은공문_도민체육대회 참가 협조 요청.hwpx')));
  const x = await zip.file('Contents/section0.xml')!.async('string');
  zip.file('Contents/section0.xml', x + ' '.repeat(mb * 1024 * 1024));
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

describe('작업자로 보내는 기준', () => {
  it('압축은 작아도 XML 이 30MB 넘게 풀리는 HWPX 는 작업자에서 읽는다', async () => {
    const buf = await inflated(40);
    expect(buf.length).toBeLessThan(1024 * 1024);
    await parseBytes(buf, { images: false });
    expect(runJob).toHaveBeenCalledTimes(1);
    expect(runJob.mock.calls[0][0]).toBe('parse');
  }, 30_000);

  it('보통 크기 HWPX 는 그대로 엔진 스레드에서 (작업자를 띄우지 않는다)', async () => {
    const r = await parseBytes(await inflated(0), { images: false });
    expect(r.success).toBe(true);
    expect(runJob).not.toHaveBeenCalled();
  });

  it('문서 정보(doc_info)도 같은 기준으로 작업자에', async () => {
    const path = join(dir, '부푼문서.hwpx');
    writeFileSync(path, await inflated(40));
    const info = await docInfo(path);
    expect(runJob).toHaveBeenCalledTimes(1);
    expect(info.page_count).toBe(1);
  }, 30_000);
});
