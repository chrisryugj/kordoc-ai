/**
 * 우리 기관 문서 모음 — 설정에서 폴더째 넣기 → 갈래·대표 견본 → AI 초안이 기관 구성을 받고 견본 서식으로 만든다 → 서식함 "우리 기관 견본"
 *  - 가짜 OpenAI 호환 서버: 초안은 보고서 마크다운, JSON 요청(한 줄 맞춤 등)은 빈 목록
 *  - 견본 HWPX 의 header 에 견본에만 있는 글꼴 이름을 심어, 만든 문서가 견본 모드로 만들어졌는지 가른다
 *  - 화면 오류 0, 외톨이 줄 0
 *
 * 사용: node scripts/e2e-ui/n-org-corpus.mjs --port 7741 --out <스크린샷 폴더>
 *   앞서 필요: node scripts/build-sidecar.mjs, node scripts/build-rhwp-studio.mjs, 화면 서버(vite 5173)
 */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { openUi, ROOT, sleep } from './ui-lib.mjs';

const require = createRequire(join(ROOT, 'node-sidecar', 'package.json'));
const JSZip = require('jszip');

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const PORT = Number(arg('--port', '7741'));
const RELAY = `http://127.0.0.1:${PORT}`;
const OUT = arg('--out', join(process.cwd(), 'e2e-out'));
const DATA = process.env.KORDOC_DATA || mkdtempSync(join(tmpdir(), 'kordoc-e2e-org-'));
const DOCS = join(OUT, '기관문서');
mkdirSync(DOCS, { recursive: true });
const MARK_FONT = '견본전용명조';

const checks = [];
const check = (name, ok, detail = '') => { checks.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` : ${detail}` : ''}`); };

// ── 가짜 AI ──
const DRAFT = `# 청렴 교육 추진 보고

> 직원 청렴 의식을 높이기 위해 청렴 교육을 추진하고자 함

## 추진 배경

□ 청렴도 평가 결과 개선 필요
  ㅇ 2025년 종합청렴도 3등급
    - 내부 청렴도 하락

## 추진 계획

□ 교육 일정: 2026. 11. 20.(금)
  ㅇ 대상: 전 직원
`;
const asked = [];
const ai = createServer((req, res) => {
  if (req.url?.startsWith('/v1/models')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ object: 'list', data: [{ id: 'test-model', object: 'model' }] })); return; }
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    if (!req.url?.includes('/chat/completions') || !raw) { res.writeHead(404); res.end(); return; }
    const body = JSON.parse(raw);
    asked.push(body);
    const text = body.response_format ? '{"items":[]}' : DRAFT;
    if (body.stream === false) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }] }));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: text } }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`);
    res.end('data: [DONE]\n\n');
  });
});
await new Promise((r) => ai.listen(0, '127.0.0.1', r));
const AI = `http://127.0.0.1:${ai.address().port}/v1`;

const invoke = async (method, params) => (await (await fetch(`${RELAY}/invoke`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cmd: 'sidecar_call', args: { method, params } }) })).json());
const rp = spawn(process.execPath, ['scripts/dev-relay.mjs', '--port', String(PORT), '--data', DATA], { cwd: ROOT, stdio: 'ignore' });
for (let i = 0; i < 60; i++) { await sleep(500); if ((await invoke('ping', {}).catch(() => ({}))).ok) break; }
await invoke('update_settings', { settings: { ai: { provider: 'openai', openai: { base_url: AI, model: 'test-model', api_key: 'test' } }, privacy: { offline: false }, org: { name: '가온시', dept: '총무과' } } });

// ── 우리 기관 보고서 둘 (kordoc 보고서 갈래로 만들고, 나중에 대표로 고를 것의 header 에 견본 표지 글꼴). 폴더는 이름 차례로 읽는다 ──
const report = (title, extra) => `# ${title}\n\n> ${title}을 하고자 함\n\n## 추진 배경\n\n□ 시민 불편 해소 필요\n  ㅇ 관련 민원 해마다 늘어남\n    - 2025년 민원 120건\n\n## 추진 내용\n\n□ 추진 일정: 2026. 11.\n  ㅇ ${extra}\n\n※ 소요 예산은 기정 예산으로 집행함\n`;
const make = async (name, md) => {
  const r = await invoke('generate_hwpx', { markdown: md, preset: 'report', output_path: join(DOCS, name) });
  if (!r.ok) throw new Error(r.error);
  return r.result.output_path;
};
await make('누리집 개편 결과 보고.hwpx', report('누리집 개편 결과 보고', '화면 정비'));
const second = await make('민원 처리 개선 보고.hwpx', report('민원 처리 개선 보고', '처리 기간 단축'));
{
  const z = await JSZip.loadAsync(readFileSync(second));
  const head = await z.file('Contents/header.xml').async('string');
  const face = /<hh:font\b[^>]*\bface="([^"]+)"/.exec(head)?.[1];
  z.file('Contents/header.xml', head.split(`face="${face}"`).join(`face="${MARK_FONT}"`));
  writeFileSync(second, await z.generateAsync({ type: 'nodebuffer' }));
}
writeFileSync(join(DOCS, '메모.txt'), '한글 문서가 아님');

const ui = await openUi({ relay: RELAY, width: 1440, height: 900, prefs: { 'kordoc-first-run-done': true, 'kordoc-theme': 'light' } });
const { page } = ui;
const scr = '.kd-screen:not([hidden])';
const selectByLabel = (label, value) => page.evaluate((l, v) => {
  const lab = [...document.querySelectorAll('.kd-screen:not([hidden]) label')].find((x) => x.textContent.trim().startsWith(l) && x.htmlFor);
  const sel = lab && document.getElementById(lab.htmlFor);
  if (!sel) return false;
  const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
  set.call(sel, v);
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}, label, value);
try {
  // ── 설정: 폴더째 넣기 ──
  await ui.click('설정', { within: '.kd-nav' });
  await page.waitForSelector('#set-orgdocs');
  await ui.dialog([DOCS]);
  await ui.click('폴더째 넣기', { within: '#set-orgdocs' });
  await ui.waitText('2건 넣었습니다', 60000);
  await sleep(500);
  const sec = () => page.$eval('#set-orgdocs', (el) => el.innerText);
  let text = await sec();
  check('폴더째 넣기: 한글 문서 둘, 한글 아닌 것은 건너뜀', /보고서\s*2건/.test(text) && (await page.evaluate(() => document.body.innerText)).includes('건너뜀 1건'), text.slice(0, 200));
  check('갈래마다 처음 넣은 문서가 대표 견본', /대표 견본\s*누리집 개편 결과 보고/.test(text), text.slice(0, 300));
  // 다른 문서를 대표로
  await page.evaluate(() => {
    const row = [...document.querySelectorAll('#set-orgdocs .kd-orgdocs-row')].find((r) => r.textContent.includes('민원 처리 개선 보고'));
    [...row.querySelectorAll('button')].find((b) => b.textContent.includes('대표로')).click();
  });
  await sleep(600);
  text = await sec();
  check('대표로 바꾸기', /대표 견본\s*민원 처리 개선 보고/.test(text), text.slice(0, 300));
  await ui.shot(join(OUT, 'n-01-settings.png'));

  // ── 새로 쓰기 › AI 초안: 보고서 갈래 ──
  await ui.click('새로 쓰기', { within: '.kd-nav' });
  await ui.click('AI 초안', { within: scr });
  await page.waitForSelector(`${scr} textarea[aria-label="AI에게 부탁할 내용"]`);
  check('문서 갈래 고르기', await selectByLabel('문서 갈래', 'report'));
  await ui.waitText('우리 기관 서식으로', 20000);
  const line = await page.$eval(`${scr} .kd-orgline`, (el) => el.innerText);
  check('우리 기관 서식 줄: 켜짐·보고서 2건·견본 서식 그대로', line.includes('보고서 2건') && line.includes('민원 처리 개선 보고') && line.includes('그대로 만듭니다'), line);
  await page.type(`${scr} textarea[aria-label="AI에게 부탁할 내용"]`, '직원 청렴 교육 추진 보고를 써 줘');
  await ui.click('초안 쓰기', { within: scr });
  await ui.waitText('우리 기관 보고서 2건의 구성을 따라 썼습니다', 60000);
  const draftAsk = asked.find((b) => !b.response_format && b.messages?.some((m) => m.role === 'user' && String(m.content).includes('청렴 교육')));
  const userMsg = draftAsk?.messages.filter((m) => m.role === 'user').map((m) => m.content).join('\n') ?? '';
  check('AI 에 우리 기관 구성·표현이 갔다', userMsg.includes('[우리 기관 문서 구성]') && userMsg.includes('추진 배경') && userMsg.includes('※ 소요 예산은 기정 예산으로 집행함'), userMsg.slice(0, 200));
  // 미리보기 그림이 나오고, 서식 옵션은 견본을 따른다고 알림
  await page.waitForFunction((s) => document.querySelector(`${s} .kd-draft-right`)?.innerText.includes('전체'), { timeout: 60000 }, scr);
  const fold = await page.$eval(`${scr} .kd-draft-left`, (el) => el.innerText);
  check('서식 옵션: 우리 기관 견본 서식 그대로', fold.includes('우리 기관 견본 서식 그대로'), fold.slice(-300));
  await ui.shot(join(OUT, 'n-02-draft.png'));

  // ── 한글 문서로 만들기 → 견본 모드로 만들어졌다 (견본에만 있는 글꼴 이름) ──
  const workDir = dirname((await ui.call('working_path', { name: 'x.hwpx' })).path);
  const t0 = Date.now();
  await ui.click('한글 문서로 만들어 편집하기', { within: scr });
  let made = '';
  for (let i = 0; i < 60 && !made; i++) {
    await sleep(500);
    made = readdirSync(workDir).map((f) => join(workDir, f)).filter((f) => f.endsWith('.hwpx') && f.includes('청렴 교육') && statSync(f).mtimeMs >= t0 - 1000).pop() ?? '';
  }
  const header = made ? await (await JSZip.loadAsync(readFileSync(made))).file('Contents/header.xml').async('string') : '';
  check('만든 문서는 대표 견본 서식 (견본 header 그대로)', header.includes(MARK_FONT), made);

  // ── 끄면 공문 프리셋 서식 ──
  await ui.click('새로 쓰기', { within: '.kd-nav' });
  await ui.click('1. 작성', { within: scr }).catch(() => undefined);
  await ui.click('AI 초안', { within: scr });
  await page.evaluate((s) => document.querySelector(`${s} .kd-orgline input[type=checkbox]`)?.click(), scr);
  await sleep(400);
  const off = await page.$eval(`${scr} .kd-orgline`, (el) => el.innerText);
  check('끄기: 안내가 바뀌고 서식 옵션이 다시 열린다', off.includes('켜면') && !(await page.$eval(`${scr} .kd-draft-left`, (el) => el.innerText)).includes('우리 기관 견본 서식 그대로'), off);
  await page.evaluate((s) => document.querySelector(`${s} .kd-orgline input[type=checkbox]`)?.click(), scr);

  // ── 서식함: 우리 기관 견본 ──
  await ui.click('서식함에서 고르기', { within: scr });
  await ui.waitText('우리 기관 견본', 20000);
  await page.evaluate(() => {
    const g = [...document.querySelectorAll('.kd-library-list .kd-label')].find((h) => h.textContent.includes('우리 기관 견본'));
    g.parentElement.querySelector('.kd-tpl-main').click();
  });
  await ui.waitText('이 갈래로 AI 초안', 20000);
  const detail = await page.$eval(`${scr} .kd-library-detail`, (el) => el.innerText);
  check('서식함 우리 기관 견본: 대표 견본·모음 수', detail.includes('우리 기관 보고서') && detail.includes('민원 처리 개선 보고') && detail.includes('모음 2건'), detail.slice(0, 200));
  await ui.shot(join(OUT, 'n-03-library.png'));
  await ui.click('이 갈래로 AI 초안', { within: scr });
  await sleep(600);
  const preset = await page.evaluate(() => {
    const lab = [...document.querySelectorAll('.kd-screen:not([hidden]) label')].find((x) => x.textContent.trim().startsWith('문서 갈래') && x.htmlFor);
    return lab ? document.getElementById(lab.htmlFor)?.value : '';
  });
  check('이 갈래로 AI 초안: 보고서 갈래로 넘어간다', preset === 'report', preset);

  // ── 견본이 없는 갈래: 넣는 곳 안내 ──
  await selectByLabel('문서 갈래', 'press');
  await ui.waitText('문서를 넣어 두면 그 구성과 서식으로 씁니다', 20000);
  check('견본 없는 갈래는 넣는 곳 안내', true);

  const orphans = await ui.orphans();
  check('외톨이 줄 0', orphans.length === 0, JSON.stringify(orphans).slice(0, 200));
  check('화면 오류 0', ui.errors.length === 0, ui.errors.join(' | ').slice(0, 300));

  // ── 첫 실행 마법사: 우리 기관 문서 폴더 넣기 (이미 넣은 문서면 그렇다고 알림) ──
  const first = await openUi({ relay: RELAY, width: 1280, height: 800, prefs: { 'kordoc-theme': 'light' } });
  try {
    await first.page.waitForSelector('.kd-wizard', { timeout: 30000 });
    await first.dialog([DOCS]);
    await first.click('폴더 넣기', { within: '.kd-wizard' });
    await first.waitText('모음: 보고서 2건', 30000);
    const wiz = await first.page.$eval('.kd-wizard', (el) => el.innerText);
    check('첫 실행: 폴더 넣기 → 모음 요약·이미 넣은 문서 안내', wiz.includes('새로 넣은 문서가 없습니다 · 이미 넣은 문서 2건'), wiz.slice(0, 400));
    const wo = await first.orphans();
    check('첫 실행 외톨이 줄 0', wo.length === 0, JSON.stringify(wo).slice(0, 200));
    check('첫 실행 화면 오류 0', first.errors.length === 0, first.errors.join(' | ').slice(0, 300));
    await first.shot(join(OUT, 'n-04-wizard.png'));
  } finally {
    await first.browser.close();
  }
} catch (e) {
  await ui.shot(join(OUT, 'n-99-fail.png')).catch(() => undefined);
  console.log('FAIL 멈춤:', String(e).slice(0, 300));
  checks.push({ name: '멈춤', ok: false });
} finally {
  await ui.browser.close();
  rp.kill('SIGKILL');
  ai.close();
}
const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} 통과`);
process.exit(failed.length ? 1 : 0);
