/**
 * 영수증으로 지출조서 — 합성 영수증(node-sidecar/tests/fixtures/receipts, 가짜 가게·가짜 사업자번호)으로
 *  - 문서 카드(?card= receipt, 우클릭 "영수증으로 지출조서 만들기"): 세 장을 읽어 값 표(고칠 수 있음·확실하지 않은 칸 노란색) →
 *    지출조서 미리보기(합계 줄이 머리줄 바로 아래) → 끝나면 표가 클립보드에(글·HTML 둘 다) → 칸을 고치고 [표 복사] → [HWPX 저장·열기]
 *  - 기관 서식을 넣으면(설정 › 내 기관 정보 › 지출조서 서식, 쉬운 화면에서도 보임) 칸 대응표가 보이고 카드·미리보기가 그 서식 칸으로
 *  - 서무 도구 "영수증으로 지출조서": 파일 두 장 → 같은 표·복사
 *  - 홈(쉬운 화면) 빠른 작업 아홉 칸이 3×3
 *
 * 사용: node scripts/e2e-ui/p-receipt.mjs --port 7750 --out <폴더>
 *   앞서 필요: node scripts/build-sidecar.mjs, 화면 서버(vite 5173)
 */
import { spawn } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openUi, ROOT, sleep } from './ui-lib.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const PORT = Number(arg('--port', '7750'));
const RELAY = `http://127.0.0.1:${PORT}`;
const OUT = arg('--out', join(process.cwd(), 'e2e-out'));
const DATA = process.env.KORDOC_DATA || mkdtempSync(join(tmpdir(), 'kordoc-e2e-receipt-'));
const FX = join(ROOT, 'node-sidecar', 'tests', 'fixtures', 'receipts');
const DOCS = join(OUT, '영수증');
const SAVED = join(OUT, 'saved');
mkdirSync(DOCS, { recursive: true });
mkdirSync(SAVED, { recursive: true });
const R = ['mart.png', 'restaurant.png', 'card-slip.png'].map((f) => { const p = join(DOCS, f); copyFileSync(join(FX, f), p); return p; });

const checks = [];
const check = (name, ok, detail = '') => { checks.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` : ${detail}` : ''}`); };
const post = async (path, body) => (await fetch(`${RELAY}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
const invoke = async (method, params) => { const r = await post('/invoke', { cmd: 'sidecar_call', args: { method, params } }); if (!r.ok) throw new Error(r.error); return r.result; };

const rp = spawn(process.execPath, ['scripts/dev-relay.mjs', '--port', String(PORT), '--data', DATA], { cwd: ROOT, stdio: 'ignore', env: { ...process.env, KORDOC_AI_NO_LAUNCH: '1' } });
for (let i = 0; i < 60; i++) { await sleep(500); if ((await post('/invoke', { cmd: 'sidecar_call', args: { method: 'ping', params: {} } }).catch(() => ({}))).ok) break; }
await invoke('update_settings', { settings: { convert: { output_dir: SAVED }, org: { name: '가온시', dept: '총무과' } } });

/** 클립보드의 글·HTML (puppeteer 가 권한을 줬다) */
const clip = (page) => page.evaluate(async () => {
  const items = await navigator.clipboard.read();
  const out = { text: '', html: '' };
  for (const it of items) {
    if (it.types.includes('text/plain')) out.text = await (await it.getType('text/plain')).text();
    if (it.types.includes('text/html')) out.html = await (await it.getType('text/html')).text();
  }
  return out;
});
const tableRows = (page) => page.$$eval('.kd-receipt-table tbody tr', (trs) => trs.map((tr) => [...tr.querySelectorAll('input')].map((i) => i.value)));
const setInput = (page, sel, value) => page.evaluate((s, v) => {
  const el = document.querySelector(s);
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  set.call(el, v);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}, sel, value);

let ui;
try {
  // ── 문서 카드 (우클릭) ──
  const q = encodeURIComponent(JSON.stringify({ action: 'receipt', paths: R }));
  ui = await openUi({ relay: RELAY, width: 860, height: 760, query: `card=${q}`, waitFor: '.kd-card', prefs: { 'kordoc-first-run-done': true, 'kordoc-theme': 'light' } });
  let { page } = ui;
  await page.bringToFront();
  await page.waitForSelector('.kd-receipt-table tbody tr', { timeout: 90000 });
  await page.waitForFunction(() => document.body.innerText.includes('클립보드에 넣었습니다') || document.body.innerText.includes('넣지 못했습니다'), { timeout: 30000 });
  await sleep(300);
  await ui.shot(join(OUT, 'p-01-card.png'));
  const rows = await tableRows(page);
  // 칸: 지출일자·거래처·사업자등록번호·적요·금액·결제·비고
  check('카드: 세 장을 한 표로', rows.length === 3, JSON.stringify(rows));
  check('카드: 금액·일자·사업자번호를 읽음', rows[0]?.[4] === '23,800' && rows[0]?.[0] === '2026-10-28' && rows[1]?.[4] === '30,000' && rows[2]?.[4] === '45,100' && rows[2]?.[2] === '317-04-00528', JSON.stringify(rows.map((r) => [r[0], r[2], r[4]])));
  check('카드: 거래처·결제', rows[1]?.[1] === '한빛식당' && rows[2]?.[1] === '가온문구' && rows[1]?.[5] === '현금' && rows[0]?.[5] === '카드', JSON.stringify(rows.map((r) => [r[1], r[5]])));
  const low = await page.$$eval('.kd-receipt-input[data-low]', (e) => e.map((x) => x.getAttribute('aria-label')));
  check('카드: 확실하지 않은 칸 노란색 (품목 없는 카드전표 적요)', low.some((l) => l.includes('card-slip.png 적요')), low.join(', '));
  const tip = await page.$eval('.kd-receipt-table tbody tr td[data-k="amount"] input', (e) => e.title);
  check('카드: 칸 근거 줄 (말풍선)', tip.includes('읽은 줄') && tip.includes('23,800'), tip);
  const preview = await page.$$eval('.kd-receipt-preview tr', (trs) => trs.map((tr) => tr.innerText.replace(/\s+/g, ' ').trim()));
  check('카드: 미리보기 합계가 머리줄 바로 아래', preview[1]?.startsWith('합계') && preview[1]?.includes('98,900') && preview[2]?.includes('가온마트'), preview.slice(0, 3).join(' / '));
  check('카드: 끝나면 표를 클립보드에', await page.evaluate(() => document.body.innerText.includes('클립보드에 넣었습니다')));
  let c = await clip(page);
  check('클립보드: 탭 글(머리·합계·줄)', c.text.split('\r\n')[0]?.startsWith('연번\t지출일자') && c.text.split('\r\n')[1]?.includes('98,900') && c.text.includes('가온마트 한빛점'), c.text.slice(0, 120));
  check('클립보드: HTML 표', c.html.includes('<table') && c.html.includes('한빛식당'), c.html.slice(0, 80));

  // 칸 고치기 → 표 복사
  await setInput(page, '.kd-receipt-table tbody tr:nth-child(2) td[data-k="purpose"] input', '업무 협의 식대');
  await page.waitForFunction(() => document.querySelector('.kd-receipt-preview')?.textContent?.includes('업무 협의 식대'), { timeout: 10000 });
  await ui.click('표 복사');
  await sleep(300);
  c = await clip(page);
  check('고친 값이 미리보기·복사에', c.text.includes('업무 협의 식대'), c.text.split('\r\n')[3] ?? '');
  await ui.click('HWPX 저장·열기');
  await ui.waitText('지출조서를 저장했습니다', 30000);
  check('HWPX 저장 (설정 저장 폴더)', readdirSync(SAVED).some((f) => /^지출조서_\d{8}\.hwpx$/.test(f)), readdirSync(SAVED).join(', '));
  check('카드: 본창에서 열기 단추', await page.evaluate(() => [...document.querySelectorAll('.kd-card-foot button')].some((b) => b.textContent.includes('본창에서 열기'))));
  check('화면 오류 없음 (카드)', ui.errors.length === 0, ui.errors.slice(0, 3).join(' | '));
  await ui.browser.close();

  // ── 기관 서식 (설정, 쉬운 화면) ──
  const { markdownToHwpx } = await import(`file:///${join(ROOT, 'node-sidecar', 'node_modules', 'kordoc', 'dist', 'index.js').replace(/\\/g, '/')}`);
  const tpl = join(OUT, '우리기관_지출조서.hwpx');
  writeFileSync(tpl, Buffer.from(await markdownToHwpx('# 지 출 조 서\n\n| 담당 | 팀장 | 과장 |\n| --- | --- | --- |\n|  |  |  |\n\n| 번호 | 사용일자 | 사용처 | 사용내역 | 지출금액(원) | 확인 |\n| --- | --- | --- | --- | --- | --- |\n| 1 |  |  |  |  |  |\n| 합계 |  |  |  |  |  |\n')));
  ui = await openUi({ relay: RELAY, width: 1280, height: 860, prefs: { 'kordoc-first-run-done': true, 'kordoc-ui-mode': 'easy', 'kordoc-theme': 'light' } });
  page = ui.page;
  // 홈 쉬운 화면: 아홉 칸 3×3
  await page.waitForSelector('.kd-task[data-task="receipt"]', { timeout: 20000 });
  const grid = await page.evaluate(() => ({ n: document.querySelectorAll('.kd-task').length, cols: getComputedStyle(document.querySelector('.kd-tasks-row')).gridTemplateColumns.split(' ').length }));
  check('홈(쉬운 화면): 빠른 작업 아홉 칸 3×3, 영수증 → 지출조서', grid.n === 9 && grid.cols === 3, JSON.stringify(grid));
  await ui.shot(join(OUT, 'p-02-home-easy.png'));
  await page.click('.kd-nav-item[data-screen="settings"]');
  await page.waitForSelector('#set-receipt', { timeout: 20000 });
  check('설정(쉬운 화면): 지출조서 서식 넣기가 보임', await page.evaluate(() => { const b = [...document.querySelectorAll('#set-receipt button')].find((x) => x.textContent.includes('서식 넣기')); return !!b && b.offsetParent !== null; }));
  await ui.dialog([tpl]);
  await ui.click('서식 넣기', { within: '#set-receipt' });
  await page.waitForFunction(() => document.querySelector('#set-receipt')?.textContent?.includes('우리기관_지출조서.hwpx'), { timeout: 30000 });
  await sleep(400);
  const map = await page.$$eval('#set-receipt tbody tr', (trs) => trs.map((tr) => `${tr.cells[0].textContent}=${tr.querySelector('select').value}`));
  check('서식 학습: 칸 대응표 (못 맞춘 칸은 비워 둠)', map.join(',') === '번호=seq,사용일자=date,사용처=vendor,사용내역=purpose,지출금액(원)=amount,확인=', map.join(','));
  await page.select('#set-receipt tbody tr:nth-child(6) select', 'payment');
  await sleep(800);
  check('대응표 고치기 → 바로 저장', (await invoke('receipt_template_get', {})).columns[5].field === 'payment');
  await page.evaluate(() => document.getElementById('set-receipt')?.scrollIntoView({ block: 'center' }));
  await ui.shot(join(OUT, 'p-03-settings-template.png'));

  // ── 홈 "영수증 → 지출조서" → 서무 도구 할 일 (기관 서식 칸으로, 고르면 바로 읽기) ──
  await page.click('.kd-nav-item[data-screen="home"]');
  await page.waitForSelector('.kd-task[data-task="receipt"]', { timeout: 20000 });
  await ui.dialog([R.slice(0, 2)]);
  await page.click('.kd-task[data-task="receipt"]');
  await page.waitForSelector('.kd-screen:not([hidden]) .kd-receipt-table tbody tr', { timeout: 90000 });
  const pressed = await page.$eval('.kd-taskitem[aria-pressed="true"]', (e) => e.dataset.task).catch(() => '');
  check('서무 도구(쉬운 화면): 할 일 "영수증으로 지출조서", 기관 서식 표시', pressed === 'receipt' && await page.evaluate(() => document.querySelector('.kd-batch-opts')?.textContent?.includes('기관 서식(우리기관_지출조서.hwpx)')), pressed);
  await page.waitForFunction(() => document.querySelector('.kd-receipt-preview tr'), { timeout: 20000 });
  await sleep(400);
  const brows = await tableRows(page);
  check('서무 도구: 두 장 → 같은 표', brows.length === 2 && brows[0][4] === '23,800' && brows[1][4] === '30,000', JSON.stringify(brows.map((r) => r[4])));
  const head = await page.$$eval('.kd-receipt-preview tr:first-child th', (e) => e.map((x) => x.textContent).join('|'));
  check('미리보기: 기관 서식 칸 이름·차례', head === '번호|사용일자|사용처|사용내역|지출금액(원)|확인', head);
  await page.bringToFront();
  await ui.click('표 복사');
  await sleep(300);
  c = await clip(page);
  check('서무 도구: 표 복사 (기관 서식 칸, 합계 53,800)', c.text.startsWith('번호\t사용일자') && c.text.split('\r\n')[1]?.includes('53,800') && c.text.includes('카드'), c.text.slice(0, 100));
  await ui.shot(join(OUT, 'p-04-batch.png'));
  check('화면 오류 없음 (본창)', ui.errors.length === 0, ui.errors.slice(0, 3).join(' | '));
} catch (e) {
  await ui?.shot(join(OUT, 'p-99-fail.png')).catch(() => undefined);
  console.log('FAIL 멈춤:', String(e).slice(0, 300));
  checks.push({ name: '멈춤', ok: false });
} finally {
  await ui?.browser.close().catch(() => {});
  rp.kill('SIGKILL');
}
const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} 통과`);
process.exit(failed.length ? 1 : 0);
