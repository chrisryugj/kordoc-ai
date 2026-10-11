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

export async function pagesToPdf(pages: AsyncIterable<{ svg: string; width: number; height: number }>, onPage?: (n: number) => void): Promise<Uint8Array> {
  const executablePath = findBrowser();
  if (!executablePath) throw new Error(NO_BROWSER);
  const puppeteer = (await import('puppeteer-core')).default;
  sweepProfiles();
  const userDataDir = mkdtempSync(join(tmpdir(), PROFILE_PREFIX));
  try {
    // pipe: 엔진이 강제로 꺼져도 연결 파이프가 닫혀 브라우저가 스스로 끝난다 (웹소켓 연결이면 Chromium 이 남는다)
    const browser = await puppeteer.launch({ executablePath, headless: true, pipe: true, userDataDir, timeout: 90_000, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    try {
      return await printPages(browser, pages, onPage);
    } finally {
      await browser.close();
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
  const esc = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const alt = [...ids].sort((a, b) => b.length - a.length).map(esc).join('|');
  return svg
    .replace(new RegExp(`\\bid="(${alt})"`, 'g'), (_m, v: string) => `id="${prefix}${v}"`)
    .replace(new RegExp(`url\\(\\s*(['"]?)#(${alt})\\1\\s*\\)`, 'g'), (_m, q: string, v: string) => `url(${q}#${prefix}${v}${q})`)
    .replace(new RegExp(`(\\b(?:xlink:)?href)="#(${alt})"`, 'g'), (_m, a: string, v: string) => `${a}="#${prefix}${v}"`);
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
