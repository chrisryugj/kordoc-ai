/**
 * PDF 작업 화면
 *  - 빈 책상 안내 → 파일 고르기로 PDF 둘·그림·한글 문서를 넣으면 이름 차례로 쪽이 한 줄 (한글은 PDF 로 바꿔서)
 *  - 누르기·Shift 누르기로 고르기, R 돌리기, Alt+화살표 옮기기, 끌어 옮기기, Delete, Ctrl+Z·Ctrl+Shift+Z
 *  - 쪽 사이 가위로 나눌 곳 → 나눠 저장 두 개, PDF 하나로 저장(쪽 차례·돌린 각이 결과에), 고른 쪽만, 그림으로
 *  - 빈 쪽 넣기 → 빈 쪽 찾아 고르기, 우클릭 메뉴 → 크게 보기 → Esc
 *  - 서무 도구 "PDF 나누기·쪽 뽑기"를 시작하면 이 화면에 그 파일만 놓인다
 *  - 화면 오류 0, 외톨이 줄 0
 *
 * 사용: node scripts/e2e-ui/l-pdf-work.mjs --port 7733 --out <스크린샷 폴더>
 *   앞서 필요: node scripts/build-sidecar.mjs, 화면 서버(vite 5173)
 */
import { spawn } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { openUi, ROOT, SAMPLES, sleep } from './ui-lib.mjs';

const require = createRequire(join(ROOT, 'node-sidecar', 'package.json'));
const { PDFDocument, StandardFonts, degrees } = require('pdf-lib');
const sharp = require('sharp');

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const PORT = Number(arg('--port', '7733'));
const RELAY = `http://127.0.0.1:${PORT}`;
const OUT = arg('--out', join(process.cwd(), 'e2e-out'));
const DATA = process.env.KORDOC_DATA || mkdtempSync(join(tmpdir(), 'kordoc-e2e-pdf-'));
const DOCS = join(OUT, 'docs');
const SAVED = join(OUT, 'saved');
mkdirSync(DOCS, { recursive: true });
mkdirSync(SAVED, { recursive: true });

async function pdf(name, labels, size = [595, 842]) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  for (const l of labels) doc.addPage(size).drawText(l, { x: 60, y: size[1] - 140, size: 72, font });
  const p = join(DOCS, name);
  writeFileSync(p, await doc.save());
  return p;
}
const A = await pdf('가.pdf', ['A1', 'A2', 'A3']);
const B = await pdf('나.pdf', ['B1', 'B2'], [842, 595]);
const PNG = join(DOCS, '그림.png');
writeFileSync(PNG, await sharp({ create: { width: 900, height: 600, channels: 3, background: '#d8e6f5' } }).png().toBuffer());
const HWPX = join(DOCS, '다_보고서.hwpx');
copyFileSync(join(SAMPLES, '4-보고서_디지털 행정 혁신 추진계획.hwpx'), HWPX);

const checks = [];
const check = (name, ok, detail = '') => { checks.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` : ${detail}` : ''}`); };

const invoke = async (method, params) => (await (await fetch(`${RELAY}/invoke`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cmd: 'sidecar_call', args: { method, params } }) })).json());
const rp = spawn(process.execPath, ['scripts/dev-relay.mjs', '--port', String(PORT), '--data', DATA], { cwd: ROOT, stdio: 'ignore' });
for (let i = 0; i < 60; i++) { await sleep(500); if ((await invoke('ping', {}).catch(() => ({}))).ok) break; }
// 저장은 정해 둔 폴더로 (원본 옆이 아니라)
await invoke('update_settings', { settings: { convert: { output_dir: SAVED } } });

const ui = await openUi({ relay: RELAY, width: 1440, height: 900, prefs: { 'kordoc-first-run-done': true, 'kordoc-theme': 'light', 'kordoc-pdf-zoom': 'm' } });
const { page } = ui;
const scr = '.kd-screen:not([hidden])';
const caps = () => page.$$eval(`${scr} .kd-pg .kd-pg-src`, (els) => els.map((e) => e.textContent.trim()));
const count = () => page.$$eval(`${scr} .kd-pg`, (els) => els.length);
const picked = () => page.$$eval(`${scr} .kd-pg[data-sel="true"] .kd-pg-n`, (els) => els.map((e) => Number(e.textContent)));
const card = (n) => page.$(`${scr} .kd-pg:nth-of-type(${n})`);
const rotations = () => page.$$eval(`${scr} .kd-pg-sheet`, (els) => els.map((e) => Number(/rotate\((-?\d+)deg\)/.exec(e.style.transform)?.[1] ?? 0)));
const waitCount = (n, timeout = 90000) => page.waitForFunction((s, k) => document.querySelectorAll(`${s} .kd-pg`).length === k, { timeout }, scr, n);
const clickCard = async (n, mods = []) => {
  const el = await card(n);
  const box = await el.boundingBox();
  for (const m of mods) await page.keyboard.down(m);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2 - 10);
  for (const m of mods) await page.keyboard.up(m);
  await sleep(120);
};
const latest = (dir) => readdirSync(dir).filter((f) => f.endsWith('.pdf')).map((f) => join(dir, f));
const pdfInfo = async (p) => { const d = await PDFDocument.load(readFileSync(p)); return { pages: d.getPageCount(), rot: d.getPages().map((x) => x.getRotation().angle), w: d.getPages().map((x) => Math.round(x.getWidth())) }; };

try {
  await page.click('.kd-nav-item[data-screen="pdf"]');
  await ui.waitText('PDF·그림·한글 문서를 끌어다 놓으세요');
  check('빈 책상: 할 수 있는 일 여섯 가지', (await page.$$eval(`${scr} .kd-pdf-can > div`, (e) => e.length)) === 6);
  await ui.shot(join(OUT, 'l-01-empty.png'));

  // ── 넣기: 이름 차례 (가 → 그림 → 나 → 다_보고서) ──
  await ui.dialog([[B, HWPX, PNG, A]]);
  await ui.click('파일 고르기', { within: scr });
  await page.waitForFunction((s) => document.querySelectorAll(`${s} .kd-pg`).length >= 6 && !document.querySelector(`${s} .kd-pdf-chip-wait`), { timeout: 120000 }, scr);
  const n0 = await count();
  const c0 = await caps();
  check('넣은 차례는 파일 이름 차례, 한글 문서는 PDF로 바꿔서', c0.slice(0, 6).join('|') === '가 · 1|가 · 2|가 · 3|그림 · 1|나 · 1|나 · 2' && c0.slice(6).every((c) => c.startsWith('다_보고서')) && n0 > 6, `${n0}쪽: ${c0.join('|').slice(0, 120)}`);
  const tags = await page.$$eval(`${scr} .kd-pdf-chip`, (els) => els.map((e) => e.textContent));
  check('파일 칩에 쪽 수, 바꾼 파일 표시', tags.some((t) => t.includes('가.pdf') && t.includes('3쪽')) && tags.some((t) => t.includes('다_보고서') && t.includes('PDF로 바꿈')), tags.join(' / ').slice(0, 160));
  await page.waitForFunction((s) => [...document.querySelectorAll(`${s} .kd-pg-sheet img`)].length >= 6, { timeout: 30000 }, scr);
  check('보이는 쪽 그림이 온다', (await page.$$eval(`${scr} .kd-pg-sheet img`, (e) => e.length)) >= 6);
  await ui.shot(join(OUT, 'l-02-board.png'));

  // 한글 문서 쪽은 빼고 시험 (칩의 빼기 단추)
  await page.evaluate((s) => [...document.querySelectorAll(`${s} .kd-pdf-chip`)].find((c) => c.textContent.includes('다_보고서'))?.querySelector('button')?.click(), scr);
  await waitCount(6);

  // ── 고르기·돌리기 ──
  await clickCard(1);
  await clickCard(3, ['Shift']);
  check('누르기 + Shift 누르기로 1~3쪽', (await picked()).join(',') === '1,2,3', (await picked()).join(','));
  check('고른 쪽 수 표시', (await page.$eval(`${scr} .kd-pdf-count`, (e) => e.textContent)).includes('3 / 6쪽 고름'));
  await page.keyboard.press('KeyR');
  await sleep(250);
  check('R 로 고른 쪽만 90도', (await rotations()).join(',') === '90,90,90,0,0,0', (await rotations()).join(','));
  await page.keyboard.down('Shift'); await page.keyboard.press('KeyR'); await page.keyboard.up('Shift');
  await sleep(200);
  check('Shift+R 로 되돌아감', (await rotations()).join(',') === '0,0,0,0,0,0');
  await clickCard(1);
  await page.keyboard.press('KeyR');
  await sleep(150);

  // ── 옮기기: Alt+화살표, 끌기 ──
  await clickCard(1);
  await page.keyboard.down('Alt'); await page.keyboard.press('ArrowRight'); await page.keyboard.up('Alt');
  await sleep(200);
  check('Alt+→ 로 한 칸 뒤로', (await caps()).join('|') === '가 · 2|가 · 1|가 · 3|그림 · 1|나 · 1|나 · 2', (await caps()).join('|'));
  {
    const from = await (await card(6)).boundingBox();
    const to = await (await card(1)).boundingBox();
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2 - 10);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++) await page.mouse.move(from.x + (to.x + 8 - from.x) * (i / 12), from.y + (to.y + to.height / 2 - from.y) * (i / 12), { steps: 2 });
    await sleep(120);
    const caret = await page.$(`${scr} .kd-pdf-caret`);
    await page.mouse.up();
    await sleep(250);
    check('끌어 옮기는 동안 놓을 자리 표시', !!caret);
    check('나 2쪽을 끌어 맨 앞으로', (await caps())[0] === '나 · 2', (await caps()).join('|'));
  }

  // ── 지우기·되돌리기 ──
  const before = await caps();
  await clickCard(5);
  await page.keyboard.press('Delete');
  await sleep(200);
  check('Delete 로 고른 쪽 지우고 다음 쪽을 고름', (await count()) === 5 && (await picked()).join(',') === '5', `${await count()}쪽, 고름 ${(await picked()).join(',')}`);
  await page.keyboard.down('Control'); await page.keyboard.press('KeyZ'); await page.keyboard.up('Control');
  await sleep(200);
  check('Ctrl+Z 로 되돌림', (await caps()).join('|') === before.join('|'));
  await page.keyboard.down('Control'); await page.keyboard.down('Shift'); await page.keyboard.press('KeyZ'); await page.keyboard.up('Shift'); await page.keyboard.up('Control');
  await sleep(200);
  check('Ctrl+Shift+Z 로 다시', (await count()) === 5);
  const order = await caps();

  // ── 나눌 곳 → 나눠 저장 ──
  {
    const el = await card(3);
    const box = await el.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await sleep(200);
    await page.evaluate((s) => document.querySelector(`${s} .kd-pg:nth-of-type(3) .kd-pg-cut`).click(), scr);
    await sleep(200);
    check('가위로 3쪽 앞에서 나눔 (새 파일 번호 표시)', (await page.$eval(`${scr} .kd-pg:nth-of-type(3)`, (e) => e.dataset.cut)) === 'true' && (await page.$$eval(`${scr} .kd-pg-group`, (e) => e.map((x) => x.textContent).join(','))) === '1,2');
  }
  await ui.click('나눠 저장', { within: `${scr} .kd-pdf-side` });
  await ui.waitText('PDF 2개를 저장했습니다', 30000);
  const parts = latest(SAVED).filter((f) => /_0[12]\.pdf$/.test(f)).sort();
  const pinfo = await Promise.all(parts.map(pdfInfo));
  check('나눠 저장: 두 파일, 2쪽·3쪽', parts.length === 2 && pinfo.map((x) => x.pages).join(',') === '2,3', parts.map((p) => basename(p)).join(', '));

  // ── 하나로 저장 (Ctrl+S): 쪽 차례·돌린 각 ──
  await page.focus(`${scr} .kd-pg:nth-of-type(1)`);
  await page.keyboard.down('Control'); await page.keyboard.press('KeyS'); await page.keyboard.up('Control');
  await ui.waitText('저장했습니다 (5쪽', 30000);
  const whole = latest(SAVED).find((f) => f.endsWith('_합본.pdf'));
  const winfo = whole && await pdfInfo(whole);
  const expectRot = order.map((c) => (c === '가 · 1' ? 90 : 0));
  check('Ctrl+S 하나로 저장: 5쪽, 돌린 쪽은 결과에서도 90도', winfo?.pages === 5 && winfo.rot.join(',') === expectRot.join(','), `${whole ? basename(whole) : '없음'} ${winfo?.rot.join(',')} (기대 ${expectRot.join(',')})`);
  await ui.shot(join(OUT, 'l-03-saved.png'));

  // ── 고른 쪽만 · 그림으로 ──
  await clickCard(2);
  // 맥에서 Control+누르기는 우클릭이라 ⌘
  await clickCard(4, [process.platform === 'darwin' ? 'Meta' : 'Control']);
  await ui.click('고른 쪽만 저장', { within: `${scr} .kd-pdf-side` });
  await ui.waitText('저장했습니다 (2쪽', 30000);
  const only = latest(SAVED).find((f) => /_2,4쪽\.pdf$/.test(f));
  check('고른 쪽만 저장: 2,4쪽 이름으로 2쪽', !!only && (await pdfInfo(only)).pages === 2, only ? basename(only) : readdirSync(SAVED).join(', '));
  await ui.click('그림으로 저장', { within: `${scr} .kd-pdf-side` });
  await ui.waitText('그림 2장을 저장했습니다', 30000);
  const imgDir = readdirSync(SAVED).find((f) => f.endsWith('_그림'));
  check('그림으로 저장: 고른 2쪽이 PNG 2장', !!imgDir && readdirSync(join(SAVED, imgDir)).filter((f) => f.endsWith('.png')).length === 2, imgDir ?? '');

  // ── 빈 쪽 넣기 → 빈 쪽 찾기 ──
  await page.keyboard.press('Escape');
  await clickCard(1);
  await ui.click('빈 쪽', { within: `${scr} .kd-pdf-tools` });
  await sleep(200);
  check('빈 쪽 넣기: 고른 쪽 뒤에', (await caps())[1] === '빈 쪽', (await caps()).join('|'));
  await ui.click('고르기', { within: `${scr} .kd-pdf-tools` });
  await ui.click('빈 쪽 찾아 고르기', { within: '.kd-context-menu' });
  await page.waitForFunction((s) => document.querySelector(`${s} .kd-pdf-count`)?.textContent.includes('고름'), { timeout: 30000 }, scr);
  await sleep(300);
  check('빈 쪽 찾기: 넣은 빈 쪽만 (글자 쪽·하늘색 그림은 아님)', (await picked()).join(',') === '2', (await picked()).join(','));

  // ── 우클릭 → 크게 보기 → Esc ──
  {
    const el = await card(1);
    const box = await el.boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2 - 10, { button: 'right' });
    await sleep(250);
    const items = await page.$$eval('.kd-context-menu [role=menuitem]', (els) => els.map((e) => e.textContent));
    check('우클릭 메뉴: 크게 보기·돌리기·나누기·지우기', ['크게 보기', '오른쪽으로 돌리기', '지우기'].every((t) => items.some((x) => x.includes(t))), items.join('|').slice(0, 160));
    await ui.click('크게 보기', { within: '.kd-context-menu' });
    await page.waitForSelector('.kd-pdf-view img', { timeout: 20000 });
    await ui.shot(join(OUT, 'l-04-view.png'));
    await page.keyboard.press('ArrowRight');
    await sleep(200);
    const head = await page.$eval('.kd-pdf-view-head', (e) => e.textContent);
    await page.keyboard.press('Escape');
    await sleep(200);
    check('크게 보기: 화살표로 다음 쪽, Esc 로 닫기', head.includes('2 / ') && !(await page.$('.kd-pdf-view')), head.slice(0, 40));
  }

  // ── 서무 도구에서 넘겨받기 ──
  await page.click('.kd-nav-item[data-screen="batch"]');
  await sleep(300);
  await ui.dialog([[A]]);
  await ui.click('파일 추가', { within: `${scr} .kd-head` });
  await sleep(1500);
  await page.evaluate(() => document.querySelector('.kd-tasklist [data-task="pdftools"]').click());
  await sleep(300);
  await ui.click('시작', { within: `${scr} .kd-batch-opts` });
  await waitCount(3, 30000);
  check('서무 도구 "PDF 나누기·쪽 뽑기" → PDF 작업에 그 파일만', (await caps()).join('|') === '가 · 1|가 · 2|가 · 3' && (await page.$eval('.kd-nav-item[aria-current="page"]', (e) => e.dataset.screen)) === 'pdf');
  await page.keyboard.down('Control'); await page.keyboard.press('KeyZ'); await page.keyboard.up('Control');
  await sleep(300);
  check('넘겨받기 전 책상은 되돌리기로', (await count()) > 3, String(await count()));

  // ── 양면 스캔 섞기 · A4 맞추기 ──
  await page.click(`${scr} .kd-pdf-tools [aria-label="더 보기"]`);
  await sleep(200);
  await ui.click('책상 비우기', { within: '.kd-context-menu' });
  await sleep(200);
  await ui.dialog([[A, B]]);
  await ui.click('파일 고르기', { within: scr });
  await waitCount(5, 30000);
  await page.click(`${scr} .kd-pdf-tools [aria-label="더 보기"]`);
  await sleep(200);
  await ui.click('번갈아 섞기, 뒤 파일은 거꾸로', { within: '.kd-context-menu' });
  await sleep(200);
  check('양면 스캔: 앞 파일·뒤 파일(거꾸로) 번갈아', (await caps()).join('|') === '가 · 1|나 · 2|가 · 2|나 · 1|가 · 3', (await caps()).join('|'));
  await ui.click('A4로 맞추기', { within: `${scr} .kd-pdf-side` });
  await ui.click('PDF 하나로 저장', { within: `${scr} .kd-pdf-side` });
  await ui.waitText('저장했습니다 (5쪽', 30000);
  const fitted = latest(SAVED).filter((f) => /_합본( \(\d+\))?\.pdf$/.test(f)).sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs).pop();
  const finfo = fitted && await pdfInfo(fitted);
  check('A4 맞추기: 세로 쪽은 A4 세로, 가로 쪽은 A4 가로', finfo && finfo.w.join(',') === '595,842,595,842,595', `${fitted ? basename(fitted) : ''} ${finfo?.w.join(',')}`);

  const orphans = await ui.orphans();
  check('외톨이 줄 0', orphans.length === 0, JSON.stringify(orphans).slice(0, 200));
  check('화면 오류 0', ui.errors.length === 0, ui.errors.join(' | ').slice(0, 300));
} catch (e) {
  // 멈춘 자리 보기: 스크린샷과 오른쪽 칸 글
  await ui.shot(join(OUT, 'l-99-fail.png')).catch(() => undefined);
  console.log('FAIL 멈춤:', String(e).slice(0, 200));
  console.log((await page.$eval(`${scr} .kd-pdf-side`, (el) => el.innerText).catch(() => '')).slice(-400));
  checks.push({ name: '멈춤', ok: false });
} finally {
  await ui.browser.close();
  rp.kill('SIGKILL');
}
const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} 통과`);
process.exit(failed.length ? 1 : 0);
