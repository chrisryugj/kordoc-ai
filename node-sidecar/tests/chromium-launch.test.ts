/** PDF 만들기 브라우저 띄우기: 앞 후보를 못 띄우면 다음 후보로, 샌드박스 막힘은 기억 (puppeteer 는 가짜, 실제 브라우저를 띄우지 않는다) */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const fake = vi.hoisted(() => ({
  launches: [] as Array<{ exe: string; sandbox: boolean }>,
  /** fail: 띄우기 실패 · norender: 떴지만 쪽을 못 그림 · ok */
  behave: (_exe: string, _sandbox: boolean): 'fail' | 'norender' | 'ok' => 'ok',
}));

vi.mock('puppeteer-core', () => ({
  default: {
    launch: async (o: { executablePath: string; args: string[] }) => {
      const exe = o.executablePath.split(/[\\/]/).pop()!;
      const sandbox = !o.args.includes('--no-sandbox');
      fake.launches.push({ exe, sandbox });
      const how = fake.behave(exe, sandbox);
      if (how === 'fail') throw new Error('Failed to launch the browser process');
      return {
        newPage: async () => ({
          setContent: async () => { if (how === 'norender') throw new Error('Target closed'); },
          close: async () => undefined,
          setJavaScriptEnabled: async () => undefined,
          setRequestInterception: async () => undefined,
          on: () => undefined,
          pdf: async () => Buffer.from(`pdf:${exe}`),
        }),
        close: async () => undefined,
      };
    },
  },
}));

const base = mkdtempSync(join(tmpdir(), 'kordoc-chromium-'));
const saved = { pf: process.env.ProgramFiles, pf86: process.env['ProgramFiles(x86)'], local: process.env.LOCALAPPDATA, pup: process.env.PUPPETEER_EXECUTABLE_PATH, nosb: process.env.KORDOC_CHROMIUM_NO_SANDBOX };
const restore = (k: string, v: string | undefined) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; };

beforeAll(() => {
  // 이 PC 에 깔린 진짜 Edge·Chrome 대신 빈 가짜 파일 자리
  for (const [dir, name] of [[join(base, 'pf', 'Microsoft', 'Edge', 'Application'), 'msedge.exe'], [join(base, 'pf', 'Google', 'Chrome', 'Application'), 'chrome.exe']]) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, name), '');
  }
  process.env.ProgramFiles = join(base, 'pf');
  process.env['ProgramFiles(x86)'] = join(base, 'pf86');
  process.env.LOCALAPPDATA = join(base, 'local');
  delete process.env.PUPPETEER_EXECUTABLE_PATH;
  delete process.env.KORDOC_CHROMIUM_NO_SANDBOX;
});
afterAll(() => {
  restore('ProgramFiles', saved.pf);
  restore('ProgramFiles(x86)', saved.pf86);
  restore('LOCALAPPDATA', saved.local);
  restore('PUPPETEER_EXECUTABLE_PATH', saved.pup);
  restore('KORDOC_CHROMIUM_NO_SANDBOX', saved.nosb);
  rmSync(base, { recursive: true, force: true });
});
beforeEach(() => {
  fake.launches.length = 0;
  vi.resetModules(); // 실행 동안의 기억(샌드박스 막힘·못 쓰는 브라우저)을 시험마다 새로
});

async function* onePage() { yield { svg: '<svg xmlns="http://www.w3.org/2000/svg"/>', width: 100, height: 100 }; }
const text = (b: Uint8Array) => Buffer.from(b).toString();

describe.runIf(process.platform === 'win32')('PDF 만들기 브라우저 후보', () => {
  it('Edge 를 띄우지 못하면(정책이 머리 없는 실행을 막음) Chrome 으로 넘어가고, 다음부터는 Chrome 을 먼저 띄운다', async () => {
    const { findBrowsers, pagesToPdf } = await import('../src/core/export/chromium.js');
    expect(findBrowsers().map((p) => p.split('\\').pop())).toEqual(['msedge.exe', 'chrome.exe']);
    fake.behave = (exe) => (exe === 'msedge.exe' ? 'fail' : 'ok');
    expect(text(await pagesToPdf(onePage()))).toBe('pdf:chrome.exe');
    // Edge 는 샌드박스를 켜도 꺼도 못 띄웠다 → 샌드박스 탓이 아니므로 Chrome 은 샌드박스를 켠 채로
    expect(fake.launches).toEqual([{ exe: 'msedge.exe', sandbox: true }, { exe: 'msedge.exe', sandbox: false }, { exe: 'chrome.exe', sandbox: true }]);
    fake.launches.length = 0;
    expect(text(await pagesToPdf(onePage()))).toBe('pdf:chrome.exe');
    expect(fake.launches).toEqual([{ exe: 'chrome.exe', sandbox: true }]);
  });

  it('샌드박스로는 쪽을 못 그리면 끄고 다시 띄우고, 그 실행 동안은 바로 끄고 띄운다 (8차 기억 그대로)', async () => {
    const { pagesToPdf } = await import('../src/core/export/chromium.js');
    fake.behave = (_exe, sandbox) => (sandbox ? 'norender' : 'ok');
    expect(text(await pagesToPdf(onePage()))).toBe('pdf:msedge.exe');
    expect(fake.launches).toEqual([{ exe: 'msedge.exe', sandbox: true }, { exe: 'msedge.exe', sandbox: false }]);
    fake.launches.length = 0;
    await pagesToPdf(onePage());
    expect(fake.launches).toEqual([{ exe: 'msedge.exe', sandbox: false }]);
  });

  it('모든 후보를 못 띄우면 마지막 실패를 그대로 알린다', async () => {
    const { pagesToPdf } = await import('../src/core/export/chromium.js');
    fake.behave = () => 'fail';
    await expect(pagesToPdf(onePage())).rejects.toThrow(/Failed to launch/);
    expect(fake.launches.map((l) => l.exe)).toEqual(['msedge.exe', 'msedge.exe', 'chrome.exe', 'chrome.exe']);
  });
});
