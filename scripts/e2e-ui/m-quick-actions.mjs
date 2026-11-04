/**
 * 우클릭 빠른 동작 — Rust 가 넘기는 것과 같은 kordoc:// 주소(파일 하나는 ?path=, 여럿은 batch 목록 파일)로
 *  - 하나로 합치기(섞이면 PDF 한 권·한글 문서끼리면 HWPX 하나, 이름 차례·폴더째), 나누기(PDF 쪽마다), 옛 주소 pdfmerge, 쪽마다 그림으로, 한글 문서로, 용량 줄이기, 표를 엑셀로,
 *    쪽 번호 넣기, 엑셀 하나로 합치기(폴더째), 받은 공문 접수하기가
 *    창을 열지 않고(shell_show 없음) 결과 파일을 만들고 끝 알림 + shell_quick_done
 *  - 실패(깨진 PDF)는 창을 열고(shell_show) PDF 작업 화면에 그 파일을 놓는다
 *  - 합칠 PDF 가 하나뿐이면 PDF 작업 화면으로
 *  - 화면 동작: PDF 쪽 편집하기 → PDF 작업, 여러 파일 한꺼번에 열기(폴더) → 그 화면에 안의 파일, 결재 전 점검 → 문서 검토,
 *    영수증으로 지출조서(카드 "본창에서 열기"가 본창으로 넘기는 주소) → 서무 도구의 그 할 일로 바로 읽기 (카드 창 자체는 p-receipt.mjs)
 *
 * 사용: node scripts/e2e-ui/m-quick-actions.mjs --port 7734 --out <폴더>
 *   앞서 필요: node scripts/build-sidecar.mjs, 화면 서버(vite 5173)
 */
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openUi, ROOT, SAMPLES, sleep } from './ui-lib.mjs';

const require = createRequire(join(ROOT, 'node-sidecar', 'package.json'));
const { PDFDocument, StandardFonts } = require('pdf-lib');

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const PORT = Number(arg('--port', '7734'));
const RELAY = `http://127.0.0.1:${PORT}`;
const OUT = arg('--out', join(process.cwd(), 'e2e-out'));
const DATA = process.env.KORDOC_DATA || mkdtempSync(join(tmpdir(), 'kordoc-e2e-quick-'));
const DOCS = join(OUT, '받은 문서');
const SAVED = join(OUT, 'saved');
mkdirSync(DOCS, { recursive: true });
mkdirSync(SAVED, { recursive: true });

async function pdf(name, n) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= n; i++) doc.addPage([595, 842]).drawText(`PAGE ${i}`, { x: 60, y: 760, size: 30, font });
  const p = join(DOCS, name);
  writeFileSync(p, await doc.save());
  return p;
}
const P1 = await pdf('1_공문.pdf', 2);
const P2 = await pdf('2_붙임.pdf', 3);
const HWPX = join(DOCS, '3_보고서.hwpx');
copyFileSync(join(SAMPLES, '4-보고서_디지털 행정 혁신 추진계획.hwpx'), HWPX);
const BAD = join(OUT, '깨진.pdf');
writeFileSync(BAD, '%PDF-1.4 이건 PDF 가 아닙니다');
// 엑셀 합치기·공문 접수용 (받은 문서 폴더 밖: 폴더째 PDF 합치기에 섞이지 않게)
const { buildXlsx } = await import(pathToFileURL(join(ROOT, 'node-sidecar', 'dist', 'core', 'excel', 'xlsx.js')).href);
const XLSX_DIR = join(OUT, '엑셀');
mkdirSync(XLSX_DIR, { recursive: true });
writeFileSync(join(XLSX_DIR, '1_세무과.xlsx'), await buildXlsx([{ name: '제출', rows: [['부서', '인원'], ['세무과', '3']] }]));
writeFileSync(join(XLSX_DIR, '2_민원과.xlsx'), await buildXlsx([{ name: '제출', rows: [['부서', '인원'], ['민원과', '2']] }]));
const LETTER = join(OUT, '받은공문_체육대회.hwpx');
copyFileSync(join(SAMPLES, '1-받은공문_도민체육대회 참가 협조 요청.hwpx'), LETTER);

const checks = [];
const check = (name, ok, detail = '') => { checks.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` : ${detail}` : ''}`); };
const post = async (path, body) => (await fetch(`${RELAY}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
const invoke = (method, params) => post('/invoke', { cmd: 'sidecar_call', args: { method, params } });

const rp = spawn(process.execPath, ['scripts/dev-relay.mjs', '--port', String(PORT), '--data', DATA], { cwd: ROOT, stdio: 'ignore' });
for (let i = 0; i < 60; i++) { await sleep(500); if ((await invoke('ping', {}).catch(() => ({}))).ok) break; }
await invoke('update_settings', { settings: { convert: { output_dir: SAVED } } });

const ui = await openUi({ relay: RELAY, width: 1400, height: 900, query: 'notify', prefs: { 'kordoc-first-run-done': true, 'kordoc-theme': 'light' } });
const { page } = ui;
const link = (action, path) => post('/emit', { event: 'deep-link', payload: `kordoc://${action}?path=${encodeURIComponent(path)}` });
let seq = 0;
const many = (action, files) => {
  const m = join(tmpdir(), `kordoc-batch-${Date.now()}${seq++}.json`);
  writeFileSync(m, JSON.stringify({ action, files, created_at: String(Date.now()) }));
  return post('/emit', { event: 'deep-link', payload: `kordoc://batch?manifest=${encodeURIComponent(m)}` });
};
const log = () => post('/log', { clear: true }).then((r) => r.log);
/** 빠른 동작이 끝날 때까지 (shell_quick_done) 기다리며 모은 기록 */
async function until(timeout = 90000) {
  const all = [];
  for (const end = Date.now() + timeout; Date.now() < end;) {
    all.push(...(await log()));
    if (all.some((x) => x.cmd === 'shell_quick_done')) return all;
    await sleep(300);
  }
  return all;
}
const notes = (l) => l.filter((x) => x.cmd === 'plugin:notification|notify').map((x) => `${x.args.title} / ${x.args.body}`);
const shown = (l) => l.some((x) => x.cmd === 'shell_show');
const saved = () => readdirSync(SAVED);
const pages = async (p) => (await PDFDocument.load(readFileSync(p))).getPageCount();
const screenNow = () => page.$eval('.kd-nav-item[aria-current="page"]', (e) => e.dataset.screen);

try {
  await log();
  // ── 합치기: 여러 파일 (Rust 는 여럿을 batch 목록으로) ──
  await many('join', [P2, HWPX, P1]);
  let l = await until();
  const merged = saved().find((f) => f === '1_공문_외2건_합본.pdf');
  check('하나로 합치기(PDF·한글 섞임): 이름 차례로 PDF 한 권, 한글 문서도 PDF로', merged && (await pages(join(SAVED, merged))) > 5, `${merged ?? saved().join(', ')} ${merged ? await pages(join(SAVED, merged)) : ''}쪽`);
  check('창 없이 끝 알림만', !shown(l) && notes(l).some((n) => n.includes('하나로 합치기 끝') && n.includes('1_공문_외2건_합본.pdf')), notes(l).join(' | '));
  check('끝나면 shell_quick_done', l.some((x) => x.cmd === 'shell_quick_done'));
  await ui.shot(join(OUT, 'm-01-after-merge.png'));
  check('화면은 그대로 (홈)', (await screenNow()) === 'home', await screenNow());

  // ── 폴더째 합치기 ──
  await link('join', DOCS);
  l = await until();
  check('폴더째 합치기: 폴더 이름_합본', saved().includes('받은 문서_합본.pdf') && !shown(l), saved().join(', '));

  // ── 한글 문서끼리 하나로 합치기 → HWPX 하나 ──
  await many('join', [LETTER, HWPX]);
  l = await until(120000);
  check('하나로 합치기(한글끼리): 서식 그대로 HWPX 하나', saved().includes('3_보고서_외1건_합본.hwpx') && !shown(l) && notes(l).some((n) => n.includes('하나로 합치기 끝') && n.includes('2개 문서')), notes(l).join(' | '));

  // ── 옛 판 주소(pdfmerge)도 그대로 ──
  await many('pdfmerge', [P1, P2]);
  l = await until();
  check('옛 주소 pdfmerge: PDF 한 권', saved().includes('1_공문_외1건_합본.pdf') && !shown(l) && notes(l).some((n) => n.includes('PDF 하나로 합치기 끝')), notes(l).join(' | '));

  // ── 쪽마다 나누기 · 그림으로 · 한글로 · 용량 · 표 ──
  await link('split', P2);
  l = await until();
  const split = saved().find((f) => f.startsWith('2_붙임_나누기'));
  check('나누기(PDF): 쪽마다 3개', split && readdirSync(join(SAVED, split)).filter((f) => f.endsWith('.pdf')).length === 3 && !shown(l), split ?? '');
  await link('pdfimages', P1);
  l = await until();
  const imgs = saved().find((f) => f === '1_공문_그림');
  check('쪽마다 그림으로: PNG 2장', imgs && readdirSync(join(SAVED, imgs)).length === 2 && !shown(l), imgs ?? saved().join(', '));
  await link('hwpx', P1);
  l = await until(120000);
  check('한글 문서로 바꾸기: HWPX', saved().some((f) => f.startsWith('1_공문') && f.endsWith('.hwpx')) && !shown(l), notes(l).join(' | '));
  await link('tables', HWPX);
  l = await until();
  check('표를 엑셀로 뽑기: 알림 (표가 있으면 엑셀)', !shown(l) && notes(l).some((n) => n.includes('표를 엑셀로 뽑기 끝')), notes(l).join(' | '));

  await link('shrink', P1);
  l = await until();
  check('PDF 용량 줄이기: 줄일 것 없으면 그 까닭을 알림에', !shown(l) && notes(l).some((n) => n.includes('용량 줄이기 끝') && n.includes('더 줄일 것이 없습니다')), notes(l).join(' | '));
  await link('pdf', HWPX);
  l = await until(120000);
  check('PDF로 저장: 한글 문서 → PDF', saved().includes('3_보고서.pdf') && !shown(l), notes(l).join(' | '));

  // ── 쪽 번호 넣기 · 엑셀 하나로 합치기 · 받은 공문 접수하기 ──
  await link('pagenum', P2);
  l = await until();
  check('쪽 번호 넣기: 새 PDF, 알림에 파일 이름', saved().includes('2_붙임_쪽번호.pdf') && !shown(l) && notes(l).some((n) => n.includes('쪽 번호 넣기 끝') && n.includes('2_붙임_쪽번호.pdf')), notes(l).join(' | '));
  await link('xlsxmerge', XLSX_DIR);
  l = await until();
  check('엑셀 하나로 합치기(폴더): 폴더 이름_합본.xlsx', saved().includes('엑셀_합본.xlsx') && !shown(l) && notes(l).some((n) => n.includes('엑셀 하나로 합치기 끝') && n.includes('2개 파일')), notes(l).join(' | '));
  await link('inbox', LETTER);
  l = await until(120000);
  const inbox = (await invoke('inbox_list', {})).result?.items ?? [];
  check('받은 공문 접수하기: 접수함에 들어가고 끝 알림', inbox.some((x) => x.name.startsWith('받은공문_체육대회')) && !shown(l) && notes(l).some((n) => n.includes('받은 공문 접수하기 끝')), notes(l).join(' | '));

  // ── 실패: 창을 열고 PDF 작업에 ──
  await link('split', BAD);
  l = await until();
  await sleep(800);
  check('깨진 PDF 나누기 → 창 열고 PDF 작업 화면으로', shown(l) && (await screenNow()) === 'pdf', `${shown(l)} ${await screenNow()}`);
  const toast = await page.evaluate(() => document.body.innerText.includes('나누기: '));
  check('실패 까닭을 알림 글로', toast);

  // ── 합칠 PDF 가 하나 → PDF 작업 ──
  await page.click('.kd-nav-item[data-screen="home"]');
  await link('join', P2);
  l = await until();
  await page.waitForFunction(() => document.querySelectorAll('.kd-screen:not([hidden]) .kd-pg').length === 3, { timeout: 30000 }).catch(() => undefined);
  check('하나로 합치기에 PDF 하나 → PDF 작업에 그 파일', (await screenNow()) === 'pdf' && (await page.$$eval('.kd-screen:not([hidden]) .kd-pg', (e) => e.length)) === 3);

  // ── 화면 동작 ──
  await link('pdfwork', P1);
  await page.waitForFunction(() => document.querySelectorAll('.kd-screen:not([hidden]) .kd-pg').length === 2, { timeout: 30000 }).catch(() => undefined);
  check('PDF 쪽 편집하기 → PDF 작업에 그 파일만', (await page.$$eval('.kd-screen:not([hidden]) .kd-pg', (e) => e.length)) === 2);
  await link('tools', DOCS);
  await sleep(2000);
  const batchFiles = await page.$$eval('.kd-screen:not([hidden]) .kd-filerow', (e) => e.length).catch(() => 0);
  check('여러 파일 한꺼번에 열기(폴더) → 그 화면에 안의 문서', (await screenNow()) === 'batch' && batchFiles >= 3, `${await screenNow()} ${batchFiles}개`);
  await link('precheck', HWPX);
  await page.waitForFunction(() => document.body.innerText.includes('결재 전') && document.querySelector('.kd-nav-item[aria-current="page"]')?.dataset.screen === 'workbench', { timeout: 60000 }).catch(() => undefined);
  check('결재 전 점검 → 문서 화면 검토', (await screenNow()) === 'workbench');
  const RECEIPT = join(OUT, '영수증_마트.png');
  copyFileSync(join(ROOT, 'node-sidecar', 'tests', 'fixtures', 'receipts', 'mart.png'), RECEIPT);
  await link('receipt', RECEIPT);
  await page.waitForFunction(() => document.querySelector('.kd-screen:not([hidden]) .kd-receipt-table tbody tr'), { timeout: 90000 }).catch(() => undefined);
  const task = await page.$eval('.kd-taskitem[aria-pressed="true"]', (e) => e.dataset.task).catch(() => '');
  check('영수증으로 지출조서 → 서무 도구 그 할 일로 바로 읽기', (await screenNow()) === 'batch' && task === 'receipt' && (await page.$$eval('.kd-screen:not([hidden]) .kd-receipt-table tbody tr', (e) => e.length)) === 1, `${await screenNow()} ${task}`);
  await ui.shot(join(OUT, 'm-02-precheck.png'));
  check('화면 오류 0', ui.errors.length === 0, ui.errors.join(' | ').slice(0, 300));
} catch (e) {
  await ui.shot(join(OUT, 'm-99-fail.png')).catch(() => undefined);
  console.log('FAIL 멈춤:', String(e).slice(0, 300));
  checks.push({ name: '멈춤', ok: false });
} finally {
  await ui.browser.close();
  rp.kill('SIGKILL');
}
const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} 통과`);
process.exit(failed.length ? 1 : 0);
