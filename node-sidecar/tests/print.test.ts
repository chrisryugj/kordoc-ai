/** print 모듈 + read_batch_manifest RPC — Phase 2 W2 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// 인쇄용 PDF 만들기 mock — 실제로는 PDF 내보내기와 같은 docToPdf (HWP·HWPX 는 rhwp 조판)
const mockDocToPdf = vi.fn();
vi.mock('../src/core/export/index.js', () => ({
  docToPdf: (...args: unknown[]) => mockDocToPdf(...args),
}));

// child_process mock — Start-Process 실제 실행 차단
const mockExecFile = vi.fn();
vi.mock('node:child_process', () => ({
  execFile: (cmd: string, args: string[], opts: unknown, cb: unknown) => {
    // promisified execFile callback 시그니처: (err, {stdout, stderr})
    // 실제 호출은 promisify(execFile) 형태이므로 callback 마지막 인자로 옴
    const callback = typeof opts === 'function' ? opts : cb;
    mockExecFile(cmd, args, typeof opts === 'function' ? undefined : opts);
    if (typeof callback === 'function') {
      // listPrinters 의 stdout 시뮬레이션
      const last = args[args.length - 1] ?? '';
      if (last.includes('Get-CimInstance Win32_Printer')) {
        const stdout = JSON.stringify([
          { Name: 'Microsoft Print to PDF', Default: true, PrinterStatus: 3, DriverName: 'PDF' },
          { Name: 'OfflinePrinter', Default: false, PrinterStatus: 7, DriverName: 'X' },
        ]);
        (callback as (e: unknown, r: unknown) => void)(null, { stdout, stderr: '' });
      } else {
        (callback as (e: unknown, r: unknown) => void)(null, { stdout: '', stderr: '' });
      }
    }
    return { kill: vi.fn() };
  },
}));

// logger mock (stdout 오염 방지)
vi.mock('../src/infra/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { printFiles, listPrinters } from '../src/core/print/index.js';

let tmp: string;
const originalPlatform = process.platform;

beforeEach(async () => {
  vi.clearAllMocks();
  tmp = await mkdtemp(join(tmpdir(), 'kordoc-print-test-'));
  Object.defineProperty(process, 'platform', { value: 'win32' });
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
  Object.defineProperty(process, 'platform', { value: originalPlatform });
});

describe('printFiles', () => {
  it('단일 파일 → docToPdf(조판 그대로) → PrintTo 호출', async () => {
    const file = join(tmp, 'sample.hwpx');
    await writeFile(file, 'dummy');

    mockDocToPdf.mockResolvedValue(Buffer.from('%PDF-1.4 stub'));

    const result = await printFiles({ files: [file], printer: 'Test Printer' }, new AbortController().signal);

    expect(result.queued).toBe(1);
    expect(result.failed).toEqual([]);
    expect(result.jobIds[0]).toMatch(/kordoc-print/);
    expect(mockDocToPdf).toHaveBeenCalledWith(file, expect.anything());
    // execFile 가 PowerShell Start-Process 명령으로 호출됨
    expect(mockExecFile).toHaveBeenCalledWith('powershell', expect.arrayContaining(['-NoProfile', '-NonInteractive', '-Command']), expect.anything());
    const command = mockExecFile.mock.calls[0][1].at(-1) as string;
    expect(command).toContain('Start-Process');
    expect(command).toContain('PrintTo');
    // 프린터·파일 이름은 명령 글이 아니라 환경 변수로
    expect(command).not.toContain('Test Printer');
    const env = (mockExecFile.mock.calls[0][2] as { env: NodeJS.ProcessEnv }).env;
    expect(env.KORDOC_PRINTER).toBe('Test Printer');
    expect(env.KORDOC_PRINT_FILE).toMatch(/kordoc-print/);
  });

  it('파일 이름의 굽은 따옴표(‘ ’)가 PowerShell 명령에 들어가지 않는다', async () => {
    const file = join(tmp, '회의’;calc;#.hwpx');
    await writeFile(file, 'dummy');
    mockDocToPdf.mockResolvedValue(Buffer.from('%PDF-1.4 stub'));
    const result = await printFiles({ files: [file] }, new AbortController().signal);
    expect(result.queued).toBe(1);
    const [, args, opts] = mockExecFile.mock.calls[0] as [string, string[], { env: NodeJS.ProcessEnv }];
    expect(args.at(-1)).not.toMatch(/calc|’/);
    expect(opts.env.KORDOC_PRINT_FILE).toMatch(/print-\d+-0\.pdf$/);
    expect(opts.env.KORDOC_PRINTER).toBeUndefined();
  });

  it('PDF 만들기 실패 시 failed 에 추가하고 다른 파일은 계속 처리', async () => {
    const ok = join(tmp, 'ok.hwpx');
    const bad = join(tmp, 'bad.hwpx');
    await Promise.all([writeFile(ok, 'a'), writeFile(bad, 'b')]);

    mockDocToPdf.mockImplementation(async (path: string) => {
      if (path.endsWith('bad.hwpx')) throw new Error('깨진 파일');
      return Buffer.from('pdf');
    });

    const result = await printFiles({ files: [ok, bad] }, new AbortController().signal);

    expect(result.queued).toBe(1);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].reason).toContain('깨진');
  });

  it('파일이 없으면 안내 오류', async () => {
    await expect(
      printFiles({ files: [] }, new AbortController().signal),
    ).rejects.toThrow(/인쇄할 파일이 없습니다/);
  });

  it('AbortSignal 발화 시 throw', async () => {
    const file = join(tmp, 'a.hwpx');
    await writeFile(file, 'x');
    const ac = new AbortController();
    ac.abort();
    await expect(printFiles({ files: [file] }, ac.signal)).rejects.toThrow();
  });
});

describe('listPrinters', () => {
  it('CIM 결과를 파싱하여 Printer[] 반환', async () => {
    const printers = await listPrinters();
    expect(printers).toHaveLength(2);
    expect(printers[0]).toEqual({
      name: 'Microsoft Print to PDF',
      isDefault: true,
      status: 'ready',
      driver: 'PDF',
    });
    expect(printers[1].status).toBe('offline');
  });
});

// ── read_batch_manifest 테스트는 RPC 라우터를 거치므로 별도 ──
describe('read_batch_manifest (RPC)', () => {
  it('manifest 파일 읽기 + 검증', async () => {
    // manifest 는 OS tmpdir 하위에서만 읽도록 강제 — 실제 tmpdir 사용
    const ts = Date.now();
    const manifestPath = join(tmpdir(), `kordoc-batch-${ts}.json`);
    await writeFile(manifestPath, JSON.stringify({
      action: 'convert_md',
      files: [join(tmp, 'a.hwpx'), join(tmp, 'b.hwpx')],
      created_at: '2026-04-29T00:00:00Z',
    }));

    try {
      const { RpcRouter } = await import('../src/rpc/router.js');
      const { registerAllMethods } = await import('../src/rpc/methods/index.js');
      const router = new RpcRouter();
      registerAllMethods(router);

      const response = await router.dispatch('read_batch_manifest', { path: manifestPath });
      expect(response.error).toBeUndefined();
      expect(response.result).toEqual(expect.objectContaining({
        action: 'convert_md',
        files: expect.arrayContaining([expect.stringMatching(/a\.hwpx$/), expect.stringMatching(/b\.hwpx$/)]),
      }));
    } finally {
      await rm(manifestPath, { force: true });
    }
  });

  it('파일명 패턴이 다르면 거부', async () => {
    const bad = join(tmpdir(), 'random.json');
    await writeFile(bad, '{"action":"x","files":[]}');

    try {
      const { RpcRouter } = await import('../src/rpc/router.js');
      const { registerAllMethods } = await import('../src/rpc/methods/index.js');
      const router = new RpcRouter();
      registerAllMethods(router);

      const response = await router.dispatch('read_batch_manifest', { path: bad });
      expect(response.result).toBeUndefined();
      expect(response.error?.message).toMatch(/허용되지 않은/);
    } finally {
      await rm(bad, { force: true });
    }
  });
});
