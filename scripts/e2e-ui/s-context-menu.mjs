/**
 * 우클릭 메뉴
 *  - 웹뷰 기본 메뉴(새로 고침·뒤로)는 막고, 글 쓰는 칸은 기본 메뉴를 그대로 둔다. 고른 글이 있으면 복사 메뉴
 *  - 홈 최근 문서: 문서 화면에서 열기·폴더에서 보기·경로 복사·최근 목록에서 빼기
 *  - 키보드: 화살표·End·Esc, 닫으면 초점이 누른 곳으로 돌아온다. 화면 끝에서는 반대쪽으로 펼친다
 *  - 문서 보기 연 문서 목록(닫기·다른 문서 모두 닫기), 접수함 줄(끝냄·목록에서 빼기… → 한 번 더 묻기)
 *  - PDF 작업: 여러 쪽 고름 머리글·고른 쪽만 저장, 파일 칩, 빈 바탕, 더 보기의 책상 비우기
 *  - AI 대화 붙인 파일 칩, 대화 목록
 *
 * 사용: node scripts/e2e-ui/s-context-menu.mjs --port 7753 --out <스크린샷 폴더>
 *   앞서 필요: node scripts/build-sidecar.mjs, 화면 서버(vite 5173)
 */
import { spawn } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openUi, ROOT, SAMPLES, sleep } from './ui-lib.mjs';

const require = createRequire(join(ROOT, 'node-sidecar', 'package.json'));
const { PDFDocument, StandardFonts } = require('pdf-lib');

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const PORT = Number(arg('--port', '7753'));
const RELAY = `http://127.0.0.1:${PORT}`;
const OUT = arg('--out', join(process.cwd(), 'e2e-out'));
const DATA = process.env.KORDOC_DATA || mkdtempSync(join(tmpdir(), 'kordoc-e2e-menu-'));
const DOCS = join(OUT, 'docs');
mkdirSync(DOCS, { recursive: true });

const LETTER = join(DOCS, '받은공문.hwpx');
copyFileSync(join(SAMPLES, '1-받은공문_도민체육대회 참가 협조 요청.hwpx'), LETTER);
const REPORT = join(DOCS, '보고서.hwpx');
copyFileSync(join(SAMPLES, '4-보고서_디지털 행정 혁신 추진계획.hwpx'), REPORT);
const PDF = join(DOCS, '가.pdf');
{
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  for (const l of ['A1', 'A2', 'A3']) doc.addPage([595, 842]).drawText(l, { x: 60, y: 700, size: 72, font });
  writeFileSync(PDF, await doc.save());
}

const checks = [];
const check = (name, ok, detail = '') => { checks.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` : ${detail}` : ''}`); };

const invoke = async (method, params) => (await (await fetch(`${RELAY}/invoke`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cmd: 'sidecar_call', args: { method, params } }) })).json());
const rp = spawn(process.execPath, ['scripts/dev-relay.mjs', '--port', String(PORT), '--data', DATA], { cwd: ROOT, stdio: 'ignore' });
for (let i = 0; i < 60; i++) { await sleep(500); if ((await invoke('ping', {}).catch(() => ({}))).ok) break; }
await invoke('inbox_add', { paths: [LETTER] });

const recent = [REPORT, LETTER].map((path, i) => ({ path, name: path.split(/[\\/]/).pop(), format: 'hwpx', at: Date.now() - i * 60000 }));
const ui = await openUi({ relay: RELAY, width: 1440, height: 900, prefs: { 'kordoc-first-run-done': true, 'kordoc-theme': 'light', 'kordoc-recent': recent, 'kordoc-pdf-zoom': 'm' } });
const { page } = ui;
const scr = '.kd-screen:not([hidden])';
const MENU = '.kd-context-menu';
const labels = () => page.$$eval(`${MENU} [role=menuitem]`, (els) => els.map((e) => e.querySelector('.kd-ctx-label')?.firstChild?.textContent?.trim() ?? e.textContent.trim()));
const menuOpen = () => page.$(MENU).then((e) => !!e);
const rightClick = async (selector, dx = 0.5, dy = 0.5) => {
  const el = typeof selector === 'string' ? await page.$(selector) : selector;
  if (!el) throw new Error(`우클릭할 곳을 못 찾음: ${selector}`);
  const b = await el.boundingBox();
  await page.mouse.click(b.x + b.width * dx, b.y + b.height * dy, { button: 'right' });
  await sleep(250);
};
/** 기본 메뉴가 뜨는가 = contextmenu 를 아무도 막지 않았는가 */
const nativeAt = (selector) => page.evaluate((s) => {
  const el = document.querySelector(s);
  const r = el.getBoundingClientRect();
  const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: r.left + 4, clientY: r.top + 4 });
  el.dispatchEvent(e);
  return !e.defaultPrevented;
}, selector);
const has = (list, ...want) => want.every((w) => list.some((x) => x.includes(w)));

try {
  // ── 기본 메뉴 ──
  check('빈 바탕: 웹뷰 기본 메뉴(새로 고침)를 막는다', !(await nativeAt('.kd-nav')) && !(await menuOpen()));
  check('글 쓰는 칸: 기본 메뉴(붙여넣기)를 그대로 둔다', await nativeAt(`${scr} textarea.kd-ask-input`));
  await page.evaluate(() => {
    const el = document.querySelector('.kd-screen:not([hidden]) h1, .kd-screen:not([hidden]) h2');
    const r = document.createRange();
    r.selectNodeContents(el);
    const s = getSelection();
    s.removeAllRanges();
    s.addRange(r);
  });
  await rightClick(`${scr} h1, ${scr} h2`);
  check('고른 글이 있으면 복사 메뉴', has(await labels(), '복사'), (await labels()).join('|'));
  await page.keyboard.press('Escape');
  await page.evaluate(() => getSelection().removeAllRanges());
  await sleep(150);
  check('Esc 로 닫힌다', !(await menuOpen()));

  // ── 홈 최근 문서 ──
  const row = `${scr} section[aria-labelledby="recent-t"] .kd-row`;
  await page.waitForSelector(row, { timeout: 20000 });
  await rightClick(row);
  const recentItems = await labels();
  check('최근 문서 메뉴: 열기·편집기·AI·기본 프로그램·폴더·복사·빼기', has(recentItems, '문서 화면에서 열기', '편집기에서 고치기', 'AI에게 시키기', '기본 프로그램으로 열기', '폴더에서 보기', '경로 복사', '파일 이름 복사', '최근 목록에서 빼기'), recentItems.join('|'));
  check('메뉴 이름에 파일 이름 (화면 읽기)', (await page.$eval(MENU, (e) => e.getAttribute('aria-label'))).includes('보고서.hwpx'));
  await ui.shot(join(OUT, 's-01-recent.png'));

  // 키보드
  await page.keyboard.press('ArrowDown');
  const first = await page.evaluate(() => document.activeElement?.textContent ?? '');
  await page.keyboard.press('End');
  const last = await page.evaluate(() => document.activeElement?.textContent ?? '');
  await page.keyboard.press('ArrowDown');
  const wrap = await page.evaluate(() => document.activeElement?.textContent ?? '');
  check('화살표·End: 첫 항목 → 끝 항목 → 다시 첫 항목', first.includes('문서 화면에서 열기') && last.includes('최근 목록에서 빼기') && wrap.includes('문서 화면에서 열기'), `${first} / ${last} / ${wrap}`);
  await page.keyboard.press('Escape');
  await sleep(150);
  check('Esc 뒤 초점이 누른 줄로 돌아온다', await page.evaluate((s) => document.activeElement === document.querySelector(s), row));

  // 경로 복사
  await rightClick(row);
  await ui.click('경로 복사', { within: MENU });
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  check('경로 복사: 클립보드에 경로, 알림', clip === REPORT && (await page.evaluate(() => document.body.innerText.includes('경로를 복사했습니다'))), clip.slice(-30));

  // 화면 끝에서는 반대쪽으로
  await page.mouse.click(1436, 896, { button: 'right' });
  await sleep(200);
  check('빈 곳 우클릭: 메뉴 없음', !(await menuOpen()));
  await rightClick(`${row}:last-of-type`, 0.98, 0.5);
  const box = await page.$eval(MENU, (e) => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; });
  check('메뉴가 화면 안에 있다', box.l >= 0 && box.t >= 0 && box.r <= 1440 && box.b <= 900, JSON.stringify(box));
  await page.mouse.click(700, 40);
  await sleep(200);
  check('바깥을 누르면 닫힌다', !(await menuOpen()));

  // 빼기
  await rightClick(`${row}:last-of-type`);
  await ui.click('최근 목록에서 빼기', { within: MENU });
  check('최근 목록에서 빼기: 한 줄만 빠진다', (await page.$$eval(row, (e) => e.length)) === 1);

  // ── 문서 보기: 연 문서 목록 ──
  await rightClick(row);
  await ui.click('문서 화면에서 열기', { within: MENU });
  await page.waitForSelector('.kd-wb', { timeout: 20000 });
  await ui.emitOpen([LETTER], '연 문서 2');
  const item = `${scr} .kd-docitem`;
  await page.waitForSelector(item, { timeout: 20000 });
  await rightClick(item);
  const docItems = await labels();
  check('연 문서 메뉴: 문서 화면에서 열기는 없고 닫기·다른 문서 모두 닫기', !has(docItems, '문서 화면에서 열기') && has(docItems, '편집기에서 고치기', '닫기', '다른 문서 모두 닫기'), docItems.join('|'));
  await ui.shot(join(OUT, 's-02-doclist.png'));
  await ui.click('다른 문서 모두 닫기', { within: MENU });
  await sleep(300);
  check('다른 문서 모두 닫기: 하나 남는다', (await page.$$eval('.kd-docitem, .kd-doc', (e) => e.length)) <= 1 && (await page.evaluate(() => !document.body.innerText.includes('연 문서 2'))));

  // ── 접수함 ──
  await page.click('.kd-nav-item[data-screen="inbox"]');
  await page.waitForSelector(`${scr} .kd-inbox-row`, { timeout: 20000 });
  await rightClick(`${scr} .kd-inbox-row td:nth-child(4)`);
  const inboxItems = await labels();
  check('접수함 줄 메뉴: 회신·끝냄·자세히·빼기', has(inboxItems, '회신 쓰기', '끝냄으로 표시', '자세히 보기', '목록에서 빼기…', '폴더에서 보기'), inboxItems.join('|'));
  await ui.shot(join(OUT, 's-03-inbox.png'));
  await ui.click('목록에서 빼기…', { within: MENU });
  await page.waitForSelector(`${scr} .kd-confirm`, { timeout: 5000 });
  check('목록에서 빼기…: 바로 빼지 않고 줄을 펼쳐 한 번 더 묻는다', (await page.$$eval(`${scr} .kd-inbox-row`, (e) => e.length)) === 1 && (await page.$eval(`${scr} .kd-confirm`, (e) => e.textContent)).includes('목록에서 뺄까요'));
  await ui.click('취소', { within: `${scr} .kd-confirm`, exact: true });
  await rightClick(`${scr} .kd-inbox-row td:nth-child(4)`);
  await ui.click('끝냄으로 표시', { within: MENU });
  await sleep(500);
  check('끝냄으로 표시: 할 일에서 빠진다', await page.evaluate(() => document.body.innerText.includes('할 일 0')));

  // ── PDF 작업 ──
  await page.click('.kd-nav-item[data-screen="pdf"]');
  await ui.waitText('PDF·그림·한글 문서를 끌어다 놓기');
  await ui.dialog([[PDF]]);
  await ui.click('파일 고르기', { within: scr });
  await page.waitForFunction((s) => document.querySelectorAll(`${s} .kd-pg`).length === 3 && !document.querySelector(`${s} .kd-pdf-opening`), { timeout: 60000 }, scr);
  const card = (n) => page.$(`${scr} .kd-pg:nth-of-type(${n})`);
  const clickCard = async (n, shift = false) => {
    const b = await (await card(n)).boundingBox();
    if (shift) await page.keyboard.down('Shift');
    await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2 - 10);
    if (shift) await page.keyboard.up('Shift');
    await sleep(120);
  };
  await clickCard(1);
  await clickCard(2, true);
  {
    const b = await (await card(2)).boundingBox();
    await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2 - 10, { button: 'right' });
    await sleep(250);
  }
  const head = await page.$eval(`${MENU} .kd-ctx-header`, (e) => e.textContent).catch(() => '');
  const pageItems = await labels();
  check('여러 쪽 고름: 머리글 "2쪽 고름", 고른 쪽만 저장·2쪽 지우기', head.includes('2쪽 고름') && has(pageItems, '고른 2쪽만 PDF로 저장', '2쪽 지우기'), `${head} / ${pageItems.join('|')}`);
  await ui.shot(join(OUT, 's-04-pdf-pages.png'));
  await ui.click('오른쪽으로 돌리기', { within: MENU });
  await sleep(200);
  // 메뉴로 돌린 뒤에도 키가 듣는다 (초점이 쪽으로 돌아왔다)
  await page.keyboard.press('Delete');
  await sleep(300);
  check('메뉴를 쓴 뒤에도 Delete 가 듣는다 (초점 복원)', (await page.$$eval(`${scr} .kd-pg`, (e) => e.length)) === 1);
  await page.keyboard.down('Control'); await page.keyboard.press('KeyZ'); await page.keyboard.up('Control');
  await sleep(300);

  await rightClick(`${scr} .kd-pdf-chip`);
  const chipItems = await labels();
  check('파일 칩 메뉴: 쪽 모두 고르기·폴더에서 보기·책상에서 빼기', has(chipItems, '이 파일 쪽 모두 고르기', '폴더에서 보기', '경로 복사', '책상에서 빼기'), chipItems.join('|'));
  await ui.click('이 파일 쪽 모두 고르기', { within: MENU });
  check('이 파일 쪽 모두 고르기', await page.evaluate((s) => document.querySelector(`${s} .kd-pdf-count`).textContent.includes('3 / 3쪽 고름'), scr));

  {
    const desk = await (await page.$(`${scr} .kd-pdf-desk`)).boundingBox();
    await page.mouse.click(desk.x + desk.width - 30, desk.y + desk.height - 30, { button: 'right' });
    await sleep(250);
  }
  const deskItems = await labels();
  check('빈 바탕 메뉴: 파일 추가·모두 고르기·되돌리기', has(deskItems, '파일 추가', '모두 고르기', '고르기 풀기', '되돌리기'), deskItems.join('|'));
  await ui.shot(join(OUT, 's-05-pdf-desk.png'));
  await page.keyboard.press('Escape');
  await sleep(150);

  await page.click(`${scr} .kd-pdf-tool[aria-label="더 보기"]`);
  await sleep(250);
  check('더 보기 단추: 열린 동안 aria-expanded', (await page.$eval(`${scr} .kd-pdf-tool[aria-label="더 보기"]`, (e) => e.getAttribute('aria-expanded'))) === 'true');
  const clear = await page.evaluate((m) => {
    const all = [...document.querySelectorAll(`${m} > *`)];
    const i = all.findIndex((e) => e.textContent.includes('책상 비우기'));
    return { sep: all[i - 1]?.getAttribute('role') === 'separator', hint: all[i]?.querySelector('.kd-ctx-hint')?.textContent ?? '' };
  }, MENU);
  check('책상 비우기: 구분선으로 떼고 되돌릴 수 있음을 밝힌다', clear.sep && clear.hint.includes('Ctrl+Z'), JSON.stringify(clear));
  await ui.shot(join(OUT, 's-06-pdf-more.png'));
  await page.keyboard.press('Escape');
  await sleep(150);

  // ── AI 대화 ──
  await page.click('.kd-nav-item[data-screen="chat"]');
  await page.waitForSelector(`${scr} textarea.kd-ask-input`, { timeout: 20000 });
  await ui.dialog([[REPORT]]);
  await ui.click('파일 첨부', { within: scr });
  await page.waitForSelector(`${scr} .kd-ask-file`, { timeout: 10000 });
  await rightClick(`${scr} .kd-ask-file`);
  const chipMenu = await labels();
  check('붙인 파일 메뉴: 열기·폴더·붙인 파일에서 빼기', has(chipMenu, '문서 화면에서 열기', '폴더에서 보기', '붙인 파일에서 빼기'), chipMenu.join('|'));
  await ui.click('붙인 파일에서 빼기', { within: MENU });
  check('붙인 파일에서 빼기', (await page.$$eval(`${scr} .kd-ask-file`, (e) => e.length)) === 0);

  const orphans = await ui.orphans();
  check('외톨이 줄 0', orphans.length === 0, JSON.stringify(orphans).slice(0, 200));
  check('화면 오류 0', ui.errors.length === 0, ui.errors.join(' | ').slice(0, 300));
} catch (e) {
  await ui.shot(join(OUT, 's-99-fail.png')).catch(() => undefined);
  console.log('FAIL 멈춤:', String(e).slice(0, 300));
  checks.push({ name: '멈춤', ok: false });
} finally {
  await ui.browser.close();
  rp.kill('SIGKILL');
}
const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} 통과`);
process.exit(failed.length ? 1 : 0);
