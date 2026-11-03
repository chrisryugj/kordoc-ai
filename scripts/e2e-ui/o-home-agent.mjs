/**
 * 홈 "무엇을 할까요?"·문서 카드·최종본 찾기 화면 검증 — 가짜 OpenAI 호환 서버가 정해진 차례로 도구를 부른다
 *  - AI 꺼짐: 입력창 아래 AI 켜기 패널
 *  - 예제 칩 → 받은 공문 읽기 → 기안문 만들기 → 결과 카드(원본 그대로), 원본 바이트 불변 → 이어서 "결재 전 점검"
 *  - 문서 화면 "AI 에게 시키기" → 홈 입력창에 그 문서가 붙음
 *  - 문서 카드(?card=, 최종본 찾기): 다른 판 3개, 최종은 "교육계획_최종 (2)", 이름의 '최종'보다 나중 판을 짚음
 *
 * 사용: node scripts/e2e-ui/o-home-agent.mjs --port 7742 --out <스크린샷 폴더>
 *   앞서 필요: node scripts/build-sidecar.mjs, 화면 서버(vite 5173)
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { openUi, ROOT, sleep } from './ui-lib.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const PORT = Number(arg('--port', '7742'));
const RELAY = `http://127.0.0.1:${PORT}`;
const OUT = arg('--out', join(process.cwd(), 'e2e-out'));
const DATA = process.env.KORDOC_DATA || mkdtempSync(join(tmpdir(), 'kordoc-e2e-home-'));
const RESULTS = join(DATA, '결과');
mkdirSync(OUT, { recursive: true });

const checks = [];
const check = (name, ok, detail = '') => { checks.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` : ${detail}` : ''}`); };
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

// ── 가짜 AI: 붙인 파일 → 받은 공문 읽기 → 기안문 쓰기 → 끝 / 이어서 점검 → 끝 ──
let turn = 0;
let made = '';
function reply(body) {
  const user = body.messages.filter((m) => m.role === 'user');
  const last = user.at(-1)?.content ?? '';
  const attached = /- (.+\.hwpx)\s*$/m.exec(user.map((m) => m.content).join('\n'))?.[1]?.trim() ?? '';
  const n = turn++;
  if (n === 0) return { say: '받은 공문을 먼저 읽겠습니다.', calls: [{ tool: 'read_incoming_letter', args: { paths: [attached] } }] };
  if (n === 1) return { say: '', calls: [{ tool: 'write_document', args: { preset: 'official', markdown: '# 도민체육대회 참가 회신\n\n1. 귀 기관의 협조 요청에 따라 아래와 같이 회신합니다.\n  가. 참가 인원: 20명  끝.' } }] };
  if (n === 2) {
    made = /저장함: (.+\.hwpx)/.exec(last)?.[1] ?? '';
    return { say: '회신 기안문을 만들었습니다. 빈칸은 없습니다.', calls: [] };
  }
  if (n === 3) return { say: '', calls: [{ tool: 'precheck', args: { path: made } }] };
  return { say: '점검을 마쳤습니다.', calls: [] };
}
const ai = createServer((req, res) => {
  if (req.url?.startsWith('/v1/models')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ object: 'list', data: [{ id: 'test-model', object: 'model' }] })); return; }
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    if (!req.url?.includes('/chat/completions') || !raw) { res.writeHead(404); res.end(); return; }
    const text = JSON.stringify(reply(JSON.parse(raw)));
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
// AI 없이 시작 (켜기 패널을 먼저 본다)
await invoke('update_settings', { settings: { ai: { provider: 'openai', openai: { base_url: '', model: '', api_key: '' } }, convert: { output_dir: RESULTS }, privacy: { offline: false } } });
const samples = (await invoke('samples_list', {})).result;
const letter = samples.scenarios.find((s) => s.id === 'reply').files.find((f) => f.endsWith('.hwpx'));
const versions = samples.scenarios.find((s) => s.id === 'versions').files;
const letterHash = sha(letter);

let ui = await openUi({ relay: RELAY, width: 1366, height: 768, prefs: { 'kordoc-first-run-done': true } });
let { page } = ui;
try {
  await sleep(1500);
  check('AI 꺼짐: 홈 입력창 아래 AI 켜기 패널', await page.evaluate(() => !!document.querySelector('.kd-home-ask .kd-aion')));
  await ui.shot(join(OUT, '01-home-ai-off.png'));

  await invoke('update_settings', { settings: { ai: { provider: 'openai', openai: { base_url: AI, model: 'test-model', api_key: 'test' } } } });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.kd-home-ask .kd-ask-input');
  await sleep(1200);
  check('AI 켜짐: 켜기 패널 사라짐', await page.evaluate(() => !document.querySelector('.kd-home-ask .kd-aion')));

  // 예제 칩 → 파일이 붙고 글이 채워짐 → 시키기
  await ui.click('받은 공문에 회신 쓰기', { within: '.kd-home-ask' });
  const attached = await page.evaluate(() => [...document.querySelectorAll('.kd-home-ask .kd-ask-file')].map((e) => e.textContent));
  check('예제 칩: 예제 파일이 붙음', attached.some((t) => t.includes('도민체육대회')), JSON.stringify(attached));
  await ui.click('시키기', { within: '.kd-home-ask .kd-ask-bar' });
  await ui.waitText('회신 기안문을 만들었습니다', 60000);
  await sleep(800);
  await ui.shot(join(OUT, '02-home-done.png'));
  const steps = await page.evaluate(() => [...document.querySelectorAll('.kd-home-ask .kd-tl-item')].map((e) => e.textContent));
  check('타임라인: 받은 공문 읽음 → 한글 문서 만듦', steps.some((s) => s.includes('받은 공문 1건 읽음')) && steps.some((s) => s.includes('한글 문서 만듦')), JSON.stringify(steps));
  const card = await page.evaluate(() => { const c = document.querySelector('.kd-home-ask .kd-result'); return c ? c.textContent : ''; });
  check('결과 카드: 이름·원본 그대로·열기', card.includes('.hwpx') && card.includes('원본은 그대로') && card.includes('열기'), card.slice(0, 80));
  check('결과 파일이 결과 폴더에 실제로', !!made && made.startsWith(RESULTS) && existsSync(made), made);
  check('원본(받은 공문)은 바이트 그대로', sha(letter) === letterHash);
  const took = await page.evaluate(() => document.querySelector('.kd-home-ask .kd-job-time')?.textContent ?? '');
  check('결과 줄: 걸린 시간·손으로 하면 약 N분(가정치)', /초 걸림/.test(took) && /손으로 하면 약 \d+분/.test(took) && took.includes('가정치'), took);

  // 이어서: 결재 전 점검
  await ui.click('결재 전 점검', { exact: true, within: '.kd-home-ask .kd-then' });
  await ui.waitText('점검을 마쳤습니다', 60000);
  const steps2 = await page.evaluate(() => [...document.querySelectorAll('.kd-home-ask .kd-job')].at(-1)?.textContent ?? '');
  check('이어서 칩: 방금 만든 문서를 점검', steps2.includes('점검 ·') && steps2.includes(basename(made)), steps2.slice(0, 120));

  // 문서 화면 → AI 에게 시키기 → 홈 입력창에 붙음
  await fetch(`${RELAY}/emit`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ event: 'open-files', payload: [versions[0]] }) });
  await ui.waitText('최종본 찾기', 30000);
  await ui.click('새로 시키기', { within: '.kd-home-ask' }).catch(() => {});
  await page.click('.kd-nav-item[data-screen="workbench"]');
  await sleep(800);
  await ui.click('AI 에게 시키기');
  await sleep(800);
  const now = await page.evaluate(() => ({ screen: document.querySelector('.kd-nav-item[aria-current="page"]')?.getAttribute('data-screen'), files: [...document.querySelectorAll('.kd-home-ask .kd-ask-file')].map((e) => e.textContent) }));
  check('문서 화면 AI 에게 시키기 → 홈에 그 문서가 붙음', now.screen === 'home' && now.files.some((t) => t.includes(basename(versions[0]))), JSON.stringify(now));
  check('화면 오류 없음 (본창)', ui.errors.length === 0, ui.errors.slice(0, 3).join(' | '));
  await ui.browser.close();

  // 문서 카드 창 (최종본 찾기)
  const q = encodeURIComponent(JSON.stringify({ action: 'versions', paths: [versions[0]] }));
  ui = await openUi({ relay: RELAY, width: 520, height: 720, query: `card=${q}`, waitFor: '.kd-card', prefs: { 'kordoc-first-run-done': true } });
  page = ui.page;
  await page.waitForFunction(() => document.querySelector('.kd-card-vers')?.textContent?.includes('다른 판'), { timeout: 30000 });
  await sleep(600);
  await ui.shot(join(OUT, '03-card-versions.png'));
  const vers = await page.evaluate(() => ({ head: document.querySelector('.kd-card-vers > button')?.textContent ?? '', rows: [...document.querySelectorAll('.kd-vers-name')].map((e) => e.textContent), notes: [...document.querySelectorAll('.kd-vers-note')].map((e) => e.textContent).join(' ') }));
  check('카드: 다른 판 3개 (남의 문서는 빠짐)', vers.head.includes('다른 판 3개') && !vers.rows.some((r) => r.includes('예산')), JSON.stringify(vers.rows));
  check('카드: 최종으로 보이는 것 = 교육계획_최종 (2)', vers.head.includes('교육계획_최종 (2).hwpx'), vers.head);
  check('카드: 이름의 "최종"보다 나중 판을 짚음', vers.notes.includes('"최종"이 붙은 교육계획_최종.hwpx'), vers.notes.slice(0, 120));
  check('카드: 추천 칩·입력창', await page.evaluate(() => !!document.querySelector('.kd-card .kd-ask-input') && document.querySelectorAll('.kd-card .kd-ask-sugs .kd-chip').length >= 3));
  const o = await ui.orphans();
  check('카드: 외톨이 줄 없음', o.length === 0, JSON.stringify(o));
  check('화면 오류 없음 (카드)', ui.errors.length === 0, ui.errors.slice(0, 3).join(' | '));
} finally {
  await ui.browser.close().catch(() => {});
  rp.kill();
  ai.close();
}
const failed = checks.filter((c) => !c.ok).length;
console.log(`${checks.length - failed}/${checks.length} 통과`);
process.exit(failed ? 1 : 0);
