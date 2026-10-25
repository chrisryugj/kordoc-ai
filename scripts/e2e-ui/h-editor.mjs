/**
 * 한글 편집기 화면 검증 — 한컴 단축키와 복구 사본
 *  - 메뉴에 새 명령(쪽 번호 매기기·거꾸로 찾기·날짜/시간 문자열)과 한컴 키 글자
 *  - Ctrl+K,D 날짜 넣기 · Ctrl+Y 한 줄 지우기 · Ctrl+N,P 쪽 번호 매기기(패치한 엔진의 쪽 번호 개체)
 *  - 고친 채 30초 안에 복구 사본이 생기고, 저장하지 않고 앱이 꺼진 뒤 홈에서 되살리면 고친 내용으로 열린다
 *  - 되살린 문서를 저장하면 저장 창 없이 원래 파일에 들어가고(.bak) 사본은 지워진다
 *
 * 중계기를 스스로 두 번 띄운다(같은 데이터 폴더, 두 번째가 "다시 켠 앱").
 * 사용: node scripts/e2e-ui/h-editor.mjs --port 7728 --out <스크린샷·작업 폴더>
 *   앞서 필요: node scripts/build-sidecar.mjs, node scripts/build-rhwp-studio.mjs, 화면 서버(vite 5173)
 */
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openUi, ROOT, SAMPLES, sleep } from './ui-lib.mjs';

const require = createRequire(join(ROOT, 'node-sidecar', 'package.json'));
const JSZip = require('jszip');

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const PORT = Number(arg('--port', '7728'));
const RELAY = `http://127.0.0.1:${PORT}`;
const OUT = arg('--out', join(process.cwd(), 'e2e-out'));
const DATA = process.env.KORDOC_DATA || mkdtempSync(join(tmpdir(), 'kordoc-e2e-editor-'));
const IN = join(OUT, 'fixtures');
mkdirSync(IN, { recursive: true });
const DOC = join(IN, '보고서.hwpx');
copyFileSync(join(SAMPLES, '4-보고서_디지털 행정 혁신 추진계획.hwpx'), DOC);

const checks = [];
const check = (name, ok, detail = '') => { checks.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` : ${detail}` : ''}`); };

async function relay() {
  const p = spawn(process.execPath, ['scripts/dev-relay.mjs', '--port', String(PORT), '--data', DATA], { cwd: ROOT, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    // 사이드카까지 답하면 준비 끝 (/events 는 SSE 라 답이 끝나지 않는다)
    const ok = await fetch(`${RELAY}/invoke`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cmd: 'sidecar_call', args: { method: 'ping', params: {} } }), signal: AbortSignal.timeout(3000) })
      .then((r) => r.json()).then((r) => r.ok, () => false);
    if (ok) break;
  }
  await sleep(1500);
  return p;
}
const studioOf = (page) => page.frames().find((f) => f.url().includes('/studio/'));
const waitEditor = (page) => page.waitForFunction(() => { const e = document.querySelector('.kd-edit'); return e && !e.hidden && !document.querySelector('.kd-editor-cover'); }, { timeout: 120000 });
/** Ctrl(맥은 ⌘ 도 받는다)+첫 키, 그다음 둘째 키 */
async function chord(page, first, second) {
  await page.keyboard.down('Control');
  await page.keyboard.press(first);
  await page.keyboard.up('Control');
  await sleep(150);
  await page.keyboard.press(second);
  await sleep(500);
}
const recoveryFiles = () => (existsSync(join(DATA, 'recovery')) ? readdirSync(join(DATA, 'recovery')).filter((f) => f.endsWith('.bin')) : []);

// ── 1차: 고치고, 저장하지 않은 채 꺼짐 ──
let rp = await relay();
let ui = await openUi({ relay: RELAY, width: 1280, height: 860, prefs: { 'kordoc-first-run-done': true } });
let { page } = ui;
try {
  await fetch(`${RELAY}/emit`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ event: 'open-files', payload: [DOC] }) });
  await ui.waitText('한글 편집기로 열기', 30000);
  await ui.click('한글 편집기로 열기');
  await waitEditor(page);
  await sleep(2000);
  const studio = studioOf(page);
  const menu = await studio.evaluate(() => ({
    items: ['kordoc:page-number', 'kordoc:find-backward', 'kordoc:insert-date'].map((id) => !!document.querySelector(`.md-item[data-cmd="${id}"]`)),
    center: document.querySelector('.md-item[data-cmd="format:align-center"] .md-shortcut')?.textContent ?? '',
  }));
  check('메뉴에 쪽 번호 매기기·거꾸로 찾기·날짜/시간 문자열', menu.items.every(Boolean), JSON.stringify(menu.items));
  // 맥에선 스튜디오가 Ctrl 을 ⌘ 기호로 보인다
  check('가운데 정렬 키 글자가 한컴 키(Ctrl+Shift+C)', /Ctrl\+Shift\+C|⌘⇧C/.test(menu.center), menu.center);

  // 문서 첫머리에 글 → Ctrl+K,D 날짜 → 새 문단 글을 Ctrl+Y 로 지움
  const box = await studio.evaluate(() => { const r = document.querySelector('#scroll-content canvas')?.getBoundingClientRect(); return r ? { x: r.left + r.width / 2, y: r.top + 120 } : null; });
  const frameBox = await (await page.$('.kd-editor-frame iframe')).boundingBox();
  const inner = await page.frames().find((f) => f.url().includes('host.html'))?.$('iframe');
  const innerBox = inner ? await inner.boundingBox() : { x: frameBox.x, y: frameBox.y };
  await page.mouse.click(innerBox.x + box.x, innerBox.y + box.y);
  await sleep(300);
  await page.keyboard.down('Control'); await page.keyboard.press('Home'); await page.keyboard.up('Control');
  await page.keyboard.type('KEEP-ME ');
  await chord(page, 'KeyK', 'KeyD');
  await page.keyboard.press('Enter');
  await page.keyboard.type('DELETE-ME');
  await sleep(200);
  await page.keyboard.down('Control'); await page.keyboard.press('KeyY'); await page.keyboard.up('Control');
  await sleep(500);
  // Ctrl+N,P → 쪽 번호 매기기 대화상자 → 확인
  await chord(page, 'KeyN', 'KeyP');
  const dlg = await studio.evaluate(() => [...document.querySelectorAll('.dialog-title')].map((e) => e.textContent).join('|'));
  check('Ctrl+N,P 가 쪽 번호 매기기를 연다', dlg.includes('쪽 번호 매기기'), dlg);
  await studio.evaluate(() => [...document.querySelectorAll('.dialog-btn-primary')].find((b) => b.offsetParent !== null)?.click());
  await sleep(800);
  await ui.shot(join(OUT, '01-edited.png'));

  // 복구 사본 (편집기 입력이 멈추면 첫 사본은 몇 초 안에)
  let copies = [];
  for (let i = 0; i < 40 && !(copies = recoveryFiles()).length; i++) await sleep(1000);
  check('저장 안 한 채 복구 사본이 생김', copies.length === 1, copies.join(','));
  const home = await page.evaluate(() => { document.querySelector('.kd-nav-item[data-screen="home"]')?.click(); return true; });
  await sleep(800);
  check('지금 고치는 문서는 홈의 꺼진 문서 목록에 없음', home && !(await page.evaluate(() => document.body.innerText.includes('저장하지 않고 꺼진 문서'))));
} finally {
  // 저장하지 않고 앱이 꺼진다 (창·엔진을 그냥 내림)
  await ui.browser.close();
  rp.kill('SIGKILL');
  await sleep(1500);
}
check('원본 파일은 그대로', !readFileSync(DOC).equals(Buffer.alloc(0)) && !existsSync(`${DOC}.bak`));

// ── 2차: 다시 켜서 되살리고 저장 ──
rp = await relay();
ui = await openUi({ relay: RELAY, width: 1280, height: 860, prefs: { 'kordoc-first-run-done': true } });
({ page } = ui);
try {
  await ui.waitText('저장하지 않고 꺼진 문서', 30000);
  check('홈에 꺼진 문서와 이름', await page.evaluate(() => document.body.innerText.includes('보고서.hwpx')));
  await ui.shot(join(OUT, '02-home.png'));
  await ui.click('되살리기', { exact: true });
  await waitEditor(page);
  await ui.waitText('저장하지 않았던 고친 내용으로 열었습니다', 20000);
  const bar = await page.evaluate(() => document.querySelector('.kd-edit-bar')?.innerText ?? '');
  check('되살린 문서는 저장 안 됨 표시', bar.includes('고친 내용이 아직 저장되지 않았습니다'), bar.replace(/\n/g, ' / '));
  await ui.clearDialog(); // 되살린 사용자 파일은 저장 창 없이 원래 자리로 (창이 뜨면 답이 없어 저장이 취소된다)
  await ui.click('저장', { exact: true, within: '.kd-edit-bar' });
  await ui.waitText('저장했습니다', 30000);
  await sleep(800);
  await ui.shot(join(OUT, '03-saved.png'));
  const zip = await JSZip.loadAsync(readFileSync(DOC));
  const xml = await zip.file('Contents/section0.xml').async('string');
  const text = xml.replace(/<[^>]+>/g, '');
  const today = new Date();
  check('저장한 파일에 고친 글과 Ctrl+K,D 날짜', text.includes('KEEP-ME') && text.includes(`${today.getFullYear()}년 ${today.getMonth() + 1}월 ${today.getDate()}일`), text.slice(0, 80));
  check('Ctrl+Y 로 지운 줄은 없음', !text.includes('DELETE-ME'));
  check('쪽 번호 개체가 들어감', /<hp:pageNum\b/.test(xml));
  check('덮어쓰기 전 원본은 .bak', existsSync(`${DOC}.bak`));
  check('저장 뒤 복구 사본 지워짐', recoveryFiles().length === 0, recoveryFiles().join(','));
  await page.evaluate(() => document.querySelector('.kd-nav-item[data-screen="home"]')?.click());
  await sleep(800);
  check('홈의 꺼진 문서 목록도 사라짐', !(await page.evaluate(() => document.body.innerText.includes('저장하지 않고 꺼진 문서'))));
  const o = await ui.orphans();
  check('외톨이 줄 없음', o.length === 0, JSON.stringify(o));
  check('화면 오류 없음', ui.errors.length === 0, ui.errors.slice(0, 3).join(' | '));
} finally {
  await ui.browser.close();
  rp.kill();
}
const failed = checks.filter((c) => !c.ok).length;
console.log(`${checks.length - failed}/${checks.length} 통과`);
process.exit(failed ? 1 : 0);
