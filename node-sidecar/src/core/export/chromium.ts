/** Chromium(Edge·Chrome) 으로 HTML → PDF — kordoc 과 같은 탐지 순서·같은 잠금(스크립트 끔, data: 외 요청 차단) */

import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function findBrowser(): string | null {
  const env = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (env && existsSync(env)) return env;
  const pf = process.env.ProgramFiles ?? 'C:\\Program Files';
  const pf86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
  const local = process.env.LOCALAPPDATA ?? '';
  const candidates = process.platform === 'win32'
    ? [
        join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        ...(local ? [join(local, 'Google', 'Chrome', 'Application', 'chrome.exe')] : []),
      ]
    : process.platform === 'darwin'
      ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge']
      : ['/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/microsoft-edge'];
  return candidates.find((p) => existsSync(p)) ?? null;
}

export const NO_BROWSER = 'PDF로 내보내려면 Microsoft Edge나 Chrome이 필요합니다. 둘 중 하나를 설치한 뒤 다시 시도하세요.';

/** 쪽 묶음 하나의 크기 상한 — 전 쪽을 한 번에 setContent 하면 큰 문서(사진·수백 쪽)는 CDP 메시지 한도를 넘어
 *  "Target closed" 로 실패하고 메모리를 4~5GB 쓴다. 묶음마다 PDF 로 찍어 pdf-lib 으로 잇는다 */
const CHUNK_CHARS = 12 * 1024 * 1024;

/** 브라우저 임시 프로필. 엔진이 PDF 를 만들다 강제로 꺼지면 남으므로, 한 시간 넘은 것은 다음에 띄울 때 지운다 */
const PROFILE_PREFIX = 'kordoc-ai-chrome-';
function sweepProfiles() {
  const cut = Date.now() - 3_600_000;
  for (const name of readdirSync(tmpdir())) {
    if (!name.startsWith(PROFILE_PREFIX)) continue;
    const dir = join(tmpdir(), name);
    try { if (statSync(dir).mtimeMs < cut) rmSync(dir, { recursive: true, force: true }); } catch { /* 다른 엔진이 쓰는 중 */ }
  }
}

const NO_SANDBOX = ['--no-sandbox', '--disable-setuid-sandbox'];

/** 샌드박스를 켜고 띄울 것인가 — kordoc 과 같은 조건(리눅스 root 는 샌드박스가 뜨지 않는다, 환경변수로 끌 수 있다) */
export function sandboxWanted(env: NodeJS.ProcessEnv = process.env, rootLinux = process.platform === 'linux' && process.getuid?.() === 0): boolean {
  return env.KORDOC_CHROMIUM_NO_SANDBOX !== '1' && !rootLinux;
}

/** 이 브라우저가 쪽을 그릴 수 있는가 (샌드박스 렌더러가 막힌 PC 는 빈 쪽도 못 그린다) */
async function canRender(browser: import('puppeteer-core').Browser, signal?: AbortSignal): Promise<boolean> {
  const probe = (async () => {
    const page = await browser.newPage();
    await page.setContent('<!doctype html><p>.</p>', { waitUntil: 'load', timeout: 20_000 });
    await page.close();
    return true;
  })().catch(() => false);
  // 렌더러가 죽지 않고 매달리는 PC 도 있다(새 쪽 만들기에는 제한 시간이 없다) → 통틀어 20초
  return Promise.race([probe, new Promise<boolean>((done) => {
    setTimeout(() => done(false), 20_000).unref();
    signal?.addEventListener('abort', () => done(false), { once: true });
  })]);
}

/** 띄우는 동안(길면 90초) 멈추면 기다리지 않는다 — 뒤늦게 뜬 브라우저는 닫는다 */
function untilAbort<T extends { close(): Promise<unknown> }>(launching: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return launching;
  return new Promise<T>((resolve, reject) => {
    const stop = () => {
      reject(signal.reason);
      void launching.then((b) => b.close()).catch(() => undefined);
    };
    signal.addEventListener('abort', stop, { once: true });
    launching.then(resolve, reject).finally(() => signal.removeEventListener('abort', stop));
  });
}

/** 샌드박스를 켠 채로는 이 PC 에서 쪽을 못 그렸다 (이 실행 동안 기억) */
let sandboxBlocked = false;

export async function pagesToPdf(pages: AsyncIterable<{ svg: string; width: number; height: number }>, onPage?: (n: number) => void, signal?: AbortSignal): Promise<Uint8Array> {
  const executablePath = findBrowser();
  if (!executablePath) throw new Error(NO_BROWSER);
  const puppeteer = (await import('puppeteer-core')).default;
  sweepProfiles();
  // 띄우기 전에 멈춤을 본다 (띄우기에는 길면 90초가 든다)
  signal?.throwIfAborted();
  const userDataDir = mkdtempSync(join(tmpdir(), PROFILE_PREFIX));
  try {
    // pipe: 엔진이 강제로 꺼져도 연결 파이프가 닫혀 브라우저가 스스로 끝난다 (웹소켓 연결이면 Chromium 이 남는다)
    const launch = (sandbox: boolean) => puppeteer.launch({ executablePath, headless: true, pipe: true, userDataDir, timeout: 90_000, args: sandbox ? [] : NO_SANDBOX });
    // 샌드박스를 켠 채 띄운다. 받은 문서의 그림·글꼴을 이 브라우저가 그리는데, 업무 PC 의 Edge·Chrome 은 오래된 판일 수 있다:
    // 샌드박스가 없으면 렌더러 결함 하나가 곧바로 사용자 권한 코드 실행이 된다.
    // 문서보안·백신이 샌드박스 렌더러를 막는 PC 에서는 빈 쪽도 못 그린다 → 그때만 끄고 다시 띄운다
    // 한 번 막힌 PC 는 이 실행 동안 계속 막힌다: 기억해 두고 다음부터는 바로 끄고 띄운다 (안 그러면 여러 파일을 바꿀 때 파일마다 실패를 되풀이한다)
    // 기억은 샌드박스 탓이 드러났을 때만 한다(띄웠는데 못 그림, 또는 끄니 뜸): 까닭 모를 띄우기 실패 한 번으로 엔진을 끌 때까지 샌드박스 없이 그리지 않게
    let browser: import('puppeteer-core').Browser | null = null;
    let launchFailed = false;
    if (sandboxWanted() && !sandboxBlocked) {
      const b = await untilAbort(launch(true), signal).catch(() => null);
      signal?.throwIfAborted();
      if (b && await canRender(b, signal)) browser = b;
      else {
        await b?.close().catch(() => undefined);
        signal?.throwIfAborted();
        if (b) sandboxBlocked = true;
        else launchFailed = true;
      }
    }
    if (!browser) {
      browser = await untilAbort(launch(false), signal);
      if (launchFailed) sandboxBlocked = true;
    }
    const open = browser;
    // 멈추면 브라우저를 닫는다: setContent·page.pdf 는 취소를 보지 않아(제한 시간 5·10분) 큰 묶음은 멈춘 뒤에도 PDF 를 끝까지 만들었다
    const onAbort = () => { void open.close().catch(() => undefined); };
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      signal?.throwIfAborted();
      return await printPages(open, pages, onPage);
    } catch (err) {
      // 닫아서 난 연결 오류(Target closed 등)는 멈춤으로 알린다
      signal?.throwIfAborted();
      throw err;
    } finally {
      signal?.removeEventListener('abort', onAbort);
      await open.close().catch(() => undefined);
    }
  } finally {
    await rm(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});
  }
}

async function printPages(browser: import('puppeteer-core').Browser, pages: AsyncIterable<{ svg: string; width: number; height: number }>, onPage?: (n: number) => void): Promise<Uint8Array> {
  const { PDFDocument } = await import('pdf-lib');
  const page = await browser.newPage();
  await page.setJavaScriptEnabled(false);
  await page.setRequestInterception(true);
  page.on('request', (req) => void (/^(?:data|about):/i.test(req.url()) ? req.continue() : req.abort()));
  const parts: Uint8Array[] = [];
  let chunk: Array<{ svg: string; width: number; height: number }> = [];
  let size = 0;
  let done = 0;
  const flush = async () => {
    if (!chunk.length) return;
    await page.setContent(pagesHtml(chunk), { waitUntil: 'load', timeout: 300_000 });
    parts.push(new Uint8Array(await page.pdf({ printBackground: true, preferCSSPageSize: true, timeout: 600_000 })));
    chunk = [];
    size = 0;
  };
  for await (const p of pages) {
    chunk.push(p);
    size += p.svg.length;
    onPage?.(++done);
    if (size >= CHUNK_CHARS) await flush();
  }
  await flush();
  if (parts.length === 1) return parts[0];
  const out = await PDFDocument.create();
  for (const part of parts) {
    const src = await PDFDocument.load(part, { updateMetadata: false });
    for (const pg of await out.copyPages(src, src.getPageIndices())) out.addPage(pg);
  }
  return out.save();
}

/** 쪽 SVG 의 id·참조에 접두어 — 여러 쪽을 한 HTML 에 넣으면 쪽마다 같은 id(cell-clip-8 등)가 겹쳐
 *  뒤쪽이 앞쪽 clipPath 를 참조해 표 칸이 잘려 나간다 (rhwp 는 쪽마다 id 를 1부터 다시 센다) */
export function scopeSvgIds(svg: string, prefix: string): string {
  const ids = new Set([...svg.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  if (!ids.size) return svg;
  // 자리는 꼴 하나로 찾고 id 모음으로 가린다. 모든 id 를 정규식 하나에 | 로 묶으면 자리마다 id 들과 견줘 id 가 많은 쪽에서 느려진다(서로 다른 id 10만 개 4.7초, 지금 0.2초)
  return svg
    .replace(/\bid="([^"]+)"/g, (_m, v: string) => `id="${prefix}${v}"`)
    .replace(/url\(\s*(['"]?)#([^'"()\s]+)\1\s*\)/g, (m, q: string, v: string) => (ids.has(v) ? `url(${q}#${prefix}${v}${q})` : m))
    .replace(/(\b(?:xlink:)?href)="#([^"]+)"/g, (m, a: string, v: string) => (ids.has(v) ? `${a}="#${prefix}${v}"` : m));
}

/** 쪽 SVG 들 → 쪽 크기 그대로의 인쇄용 HTML (쪽마다 크기가 다르면 이름 붙인 @page) */
export function pagesHtml(pages: Array<{ svg: string; width: number; height: number }>): string {
  const mm = (px: number) => `${((px * 25.4) / 96).toFixed(2)}mm`;
  const sizeOf = (p: { width: number; height: number }) => `${mm(p.width)} ${mm(p.height)}`;
  const sizes = [...new Set(pages.map(sizeOf))];
  const css = [
    `@page{size:${sizes[0]};margin:0}`,
    ...sizes.map((s, i) => `@page s${i}{size:${s};margin:0}`),
    'html,body{margin:0;padding:0}.p{overflow:hidden;break-after:page}.p:last-child{break-after:auto}.p svg{display:block;width:100%;height:100%}',
  ].join('');
  const body = pages
    .map((p, i) => `<div class="p" style="page:s${sizes.indexOf(sizeOf(p))};width:${mm(p.width)};height:${mm(p.height)}">${scopeSvgIds(p.svg, `p${i}-`)}</div>`)
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'"><style>${css}</style></head><body>${body}</body></html>`;
}
