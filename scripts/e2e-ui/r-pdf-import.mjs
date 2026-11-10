/**
 * PDF 를 편집기로 바로 열기 (rhwp 0.9.0 가져오기) — 720 높이 창(첫 실행 창 크기)에서
 *  - 새로 쓰기 › 가진 파일을 한글로 › PDF 고르기 › "PDF를 편집기로 바로 열기" → 편집기의 가져오기 창, 가져오기 단추가 창 안에 보임
 *  - 가져오기 → 편집기에 열림 → 한글 파일로 저장하기 전에도 출력 단계에서 PDF 저장이 됨(새 파일)
 *  - 첫 저장은 저장 창의 "이름_수정.hwpx", 원본 PDF 바이트는 그대로, 저장한 파일에 본문 글
 *  - 가져오기 창에서 취소 → 안내가 뜨고 작성 단계로 돌아옴(오류 화면·여는 중 표시가 남지 않음), 원본 그대로
 *
 * 사용: node scripts/e2e-ui/r-pdf-import.mjs --port 7752 --out <스크린샷·작업 폴더>
 *   앞서 필요: node scripts/build-sidecar.mjs, node scripts/build-rhwp-studio.mjs(0.9.0), 화면 서버(vite 5173)
 */
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openUi, ROOT, SAMPLES, sleep } from './ui-lib.mjs';

const R = ROOT;
const { parse } = createRequire(join(ROOT, 'node-sidecar', 'package.json'))('kordoc');
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const PORT = Number(arg('--port', '7752'));
const OUT = arg('--out', join(process.cwd(), 'e2e-out'));
const HEIGHT = Number(arg('--height', '720'));
const RELAY = `http://127.0.0.1:${PORT}`;
const DATA = process.env.KORDOC_DATA || mkdtempSync(join(tmpdir(), 'kordoc-e2e-pdfimport-'));
mkdirSync(DATA, { recursive: true });
mkdirSync(OUT, { recursive: true });
// 있을 때만 지운다: Node 24.13(Windows)은 없는 한글 이름 파일에 rmSync force 를 부르면 말없이 죽는다(종료 127, 24.21 에서는 괜찮음)
for (const f of ['받은 공문 사본_수정.hwpx', '출력본.pdf']) if (existsSync(join(OUT, f))) rmSync(join(OUT, f));
const PDF = join(OUT, '받은 공문 사본.pdf');
copyFileSync(join(SAMPLES, '1-받은공문_도민체육대회 참가 협조 요청.pdf'), PDF);
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const before = sha(PDF);
const SAVED = join(OUT, '받은 공문 사본_수정.hwpx');

const checks = [];
const check = (name, ok, detail = '') => { checks.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` : ${detail}` : ''}`); };
const rp = spawn(process.execPath, ['scripts/dev-relay.mjs', '--port', String(PORT), '--data', DATA], { cwd: R, stdio: 'ignore', env: { ...process.env, KORDOC_AI_NO_LAUNCH: '1' } });
for (let i = 0; i < 60; i++) {
  await sleep(500);
  const ok = await fetch(`${RELAY}/invoke`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cmd: 'sidecar_call', args: { method: 'ping', params: {} } }), signal: AbortSignal.timeout(3000) }).then((r) => r.json()).then((r) => r.ok, () => false);
  if (ok) break;
}
await sleep(1500);

async function toDialog(ui) {
  const { page } = ui;
  await page.click('.kd-nav-item[data-screen="create"]');
  await sleep(800);
  await ui.click('가진 파일을 한글로');
  await sleep(600);
  await ui.dialog([[PDF]]);
  await ui.click('파일 고르기', { within: '.kd-screen:not([hidden])' });
  await sleep(1500);
  await ui.click('PDF를 편집기로 바로 열기');
  let frame;
  for (let i = 0; i < 80 && !frame; i++) { await sleep(500); frame = page.frames().find((f) => f.url().includes('/studio/')); }
  await frame.waitForSelector('.dialog-pdf-import', { timeout: 60000 });
  await sleep(1200);
  return frame;
}
/** 편집기 프레임 안 요소의 화면(창) 기준 자리 */
async function boxInWindow(page, frame, selector, text) {
  const inner = await frame.evaluate((sel, t) => {
    const el = [...document.querySelectorAll(sel)].find((e) => !t || e.innerText.trim() === t);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, vh: innerHeight };
  }, selector, text);
  const host = await page.evaluate(() => { const f = [...document.querySelectorAll('iframe')].find((x) => x.offsetParent !== null); const r = f.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, h: r.height, winH: innerHeight }; });
  return { inner, host, bottomInWindow: inner ? host.top + inner.bottom : null };
}

// ── 가져오기 → 저장 ──
let ui = await openUi({ relay: RELAY, width: 1280, height: HEIGHT, prefs: { 'kordoc-first-run-done': true, 'kordoc-nav-collapsed': false } });
try {
  const { page } = ui;
  const frame = await toDialog(ui);
  const btn = await boxInWindow(page, frame, '.dialog-pdf-import button', '가져오기');
  await ui.shot(join(OUT, `01-dialog-${HEIGHT}.png`));
  check(`[${HEIGHT}] 가져오기 단추가 창 안에 보인다`, btn.bottomInWindow != null && btn.bottomInWindow <= btn.host.winH, JSON.stringify(btn));
  await frame.evaluate(() => [...document.querySelectorAll('.dialog-pdf-import button')].find((b) => b.innerText.trim() === '가져오기')?.click());
  await page.waitForFunction(() => { const e = document.querySelector('.kd-edit'); return e && !e.hidden && !document.querySelector('.kd-editor-cover'); }, { timeout: 180000 });
  await sleep(2500);
  await ui.shot(join(OUT, `02-imported-${HEIGHT}.png`));
  const head = await page.evaluate(() => document.querySelector('.kd-screen:not([hidden])')?.innerText.slice(0, 200).replace(/\n+/g, ' | ') ?? '');
  check('가져온 뒤 편집기가 열린다', true, head);
  // 한글 파일로 저장하기 전에 출력 단계에서 PDF 저장 (세션 경로는 아직 원본 PDF)
  const PDF_OUT = join(OUT, '출력본.pdf');
  await ui.click('출력으로');
  await ui.waitText('PDF로 저장', 30000);
  await sleep(1500);
  await ui.dialog([PDF_OUT]);
  await ui.click('PDF로 저장', { exact: true, within: '.kd-screen:not([hidden])' });
  for (let i = 0; i < 80 && !existsSync(PDF_OUT); i++) await sleep(500);
  await sleep(1000);
  const outText = await page.evaluate(() => document.body.innerText);
  const made = existsSync(PDF_OUT) ? readFileSync(PDF_OUT) : null;
  check('저장 전 출력 단계: PDF로 저장이 된다', !!made && made.subarray(0, 5).toString('latin1') === '%PDF-' && !outText.includes('이미 PDF 문서입니다'), made ? `${made.length}B` : (outText.match(/[^\n]*(못했습니다|이미 PDF)[^\n]*/)?.[0] ?? '파일 없음'));
  check('출력 PDF 는 원본 PDF 와 다른 새 파일', !!made && createHash('sha256').update(made).digest('hex') !== before);
  await ui.shot(join(OUT, `02b-output-${HEIGHT}.png`));
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.offsetParent !== null && /편집/.test(b.textContent) && b.closest('.kd-create-head, .kd-head, header'))?.click());
  await sleep(1500);
  await ui.dialog([SAVED]);
  await ui.click('저장', { exact: true, within: '.kd-screen:not([hidden])' });
  for (let i = 0; i < 40 && !existsSync(SAVED); i++) await sleep(500);
  await sleep(1500);
  check('첫 저장은 새 한글 파일(_수정.hwpx)', existsSync(SAVED), existsSync(SAVED) ? `${statSync(SAVED).size}B` : '없음');
  check('원본 PDF 는 그대로', sha(PDF) === before);
  if (existsSync(SAVED)) {
    const r = await parse(readFileSync(SAVED));
    check('저장한 한글 파일에 본문 글이 있다', r.success && r.markdown.includes('체육대회'), r.success ? r.markdown.slice(0, 120).replace(/\n+/g, ' ') : String(r.error));
  }
  await ui.shot(join(OUT, `03-saved-${HEIGHT}.png`));
  console.log('errors', JSON.stringify(ui.errors).slice(0, 600));
} catch (e) {
  check('가져오기 흐름', false, String(e));
  await ui.shot(join(OUT, 'zz-error-run.png')).catch(() => {});
} finally {
  await ui.clearDialog().catch(() => {});
  await ui.close();
}

// ── 취소 ──
ui = await openUi({ relay: RELAY, width: 1280, height: HEIGHT, prefs: { 'kordoc-first-run-done': true, 'kordoc-nav-collapsed': false } });
try {
  const { page } = ui;
  const frame = await toDialog(ui);
  await frame.evaluate(() => [...document.querySelectorAll('.dialog-pdf-import button')].find((b) => b.innerText.trim() === '취소')?.click());
  await page.waitForFunction(() => document.body.innerText.includes('PDF 가져오기를 취소했습니다'), { timeout: 30000 }).then(() => check('취소하면 안내가 뜬다', true), () => check('취소하면 안내가 뜬다', false));
  await sleep(1500);
  const state = await page.evaluate(() => ({ screen: document.querySelector('.kd-nav-item[aria-current="page"]')?.getAttribute('data-screen'), cover: !!document.querySelector('.kd-editor-cover'), text: document.querySelector('.kd-screen:not([hidden])')?.innerText.slice(0, 160).replace(/\n+/g, ' | ') }));
  check('취소 뒤 여는 중 표시가 남지 않는다', !state.cover, JSON.stringify(state));
  await ui.shot(join(OUT, `04-cancelled-${HEIGHT}.png`));
  check('취소해도 원본 PDF 는 그대로', sha(PDF) === before);
  console.log('errors', JSON.stringify(ui.errors).slice(0, 600));
} catch (e) {
  check('취소 흐름', false, String(e));
  await ui.shot(join(OUT, 'zz-error-cancel.png')).catch(() => {});
} finally {
  await ui.clearDialog().catch(() => {});
  await ui.close();
  rp.kill();
}
const failed = checks.filter((c) => !c.ok).length;
console.log(`${checks.length - failed}/${checks.length} 통과`);
process.exit(failed ? 1 : 0);
