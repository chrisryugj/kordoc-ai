/**
 * 화면 검증 공용 — 실제 프론트(Vite) + 진짜 사이드카(scripts/dev-relay.mjs)를 헤드리스 크롬으로.
 *
 *   const ui = await openUi({ relay: 'http://127.0.0.1:7721', width: 1280, height: 800 });
 *   await ui.dialog(['/path/a.hwpx']);  // 다음 파일 대화상자 답 (열기 = 경로 배열, 저장 = 경로 문자열)
 *   await ui.call('inbox_list', {});    // 사이드카 직접 호출 (준비·확인용)
 *   await ui.orphans()                  // 두 줄 이상 글 덩이 가운데 끝줄이 폭 25% 미만인 것
 *
 * puppeteer-core 는 node-sidecar/node_modules 에서, 크롬은 Playwright 가 받아 둔 Chrome for Testing.
 */
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
export const ROOT = resolve(here, '..', '..');
const require = createRequire(join(ROOT, 'node-sidecar', 'package.json'));
const puppeteer = require('puppeteer-core');

export const CHROME = process.env.CHROME_PATH
  ?? join(homedir(), 'Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
export const APP = process.env.APP_URL ?? 'http://127.0.0.1:5173/';
export const SAMPLES = join(ROOT, 'node-sidecar', 'samples');

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function openUi({ relay, width = 1280, height = 800, dark = false, prefs = {} }) {
  if (!existsSync(CHROME)) throw new Error(`크롬이 없습니다: ${CHROME}`);
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', `--window-size=${width},${height}`] });
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  const origin = new URL(APP).origin;
  await browser.defaultBrowserContext().overridePermissions(origin, ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write']);
  if (dark) await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
  // 첫 실행 표시·접힘 같은 화면 기억값 (localStorage)
  await page.evaluateOnNewDocument((p) => { for (const [k, v] of Object.entries(p)) localStorage.setItem(k, JSON.stringify(v)); }, prefs);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  // 중계기 알림(EventSource)이 늘 열려 있어 networkidle 은 오지 않는다
  await page.goto(`${APP}?relay=${encodeURIComponent(relay)}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.kd-nav', { timeout: 30000 });

  const post = async (path, body) => (await fetch(`${relay}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
  const ui = {
    browser, page, errors,
    dialog: (answers) => post('/dialog', { queue: answers, reset: true }),
    clearDialog: () => post('/dialog', { queue: [], reset: true }),
    async call(method, params = {}) {
      const r = await post('/invoke', { cmd: 'sidecar_call', args: { method, params } });
      if (!r.ok) throw new Error(r.error);
      return r.result;
    },
    shot: (path) => page.screenshot({ path }),
    /** 글자가 보이는 요소를 눌러 (button·a·summary·[role=tab] 가운데 글이 정확히 같거나 포함) */
    async click(text, { exact = false, within = 'body' } = {}) {
      const ok = await page.evaluate((t, ex, sel) => {
        const root = document.querySelector(sel) ?? document.body;
        const els = [...root.querySelectorAll('button, a, summary, [role=tab], label')].filter((e) => e.offsetParent !== null);
        const el = els.find((e) => (ex ? e.textContent.trim() === t : e.textContent.includes(t)));
        if (!el) return false;
        el.scrollIntoView({ block: 'center' });
        el.click();
        return true;
      }, text, exact, within);
      if (!ok) throw new Error(`누를 것을 못 찾음: ${text}`);
      await sleep(250);
    },
    async waitText(text, timeout = 20000) {
      await page.waitForFunction((t) => document.body.innerText.includes(t), { timeout }, text);
    },
    /** 두 줄 이상인 글 덩이 가운데 끝줄이 그 덩이 폭의 25% 미만인 것 (외톨이 줄) */
    orphans(selector = 'p, li, .kd-row-desc, .kd-field-hint, .kd-note, .kd-small, dd, .kd-index-hint') {
      return page.evaluate((sel) => {
        const out = [];
        for (const el of document.querySelectorAll(sel)) {
          if (el.offsetParent === null || el.closest('[hidden]') || el.closest('.markdown-body, pre')) continue;
          if ([...el.children].some((c) => getComputedStyle(c).display === 'block')) continue;
          // 글자 줄만 센다 (아이콘 svg 는 빼고)
          const rects = [];
          const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
          for (let n = tw.nextNode(); n; n = tw.nextNode()) {
            if (!n.textContent.trim()) continue;
            const r = document.createRange();
            r.selectNodeContents(n);
            rects.push(...[...r.getClientRects()].filter((x) => x.width > 0.5));
          }
          if (!rects.length) continue;
          const lines = [];
          for (const x of rects) {
            const l = lines.find((y) => Math.abs(y.top - x.top) < 4);
            if (l) { l.left = Math.min(l.left, x.left); l.right = Math.max(l.right, x.right); } else lines.push({ top: x.top, left: x.left, right: x.right });
          }
          if (lines.length < 2) continue;
          lines.sort((a, b) => a.top - b.top);
          const box = el.getBoundingClientRect();
          const last = lines[lines.length - 1];
          const ratio = (last.right - last.left) / box.width;
          if (ratio < 0.25) out.push({ text: el.textContent.trim().slice(0, 80), ratio: Math.round(ratio * 100) / 100 });
        }
        return out;
      }, selector);
    },
    close: () => browser.close(),
  };
  return ui;
}
