/**
 * AI 배선 끝에서 끝까지 — 화면 · 엔진 · 편집기 · 파일이 실제로 이어지는지 (가짜 OpenAI 호환 서버가 요청 갈래를 보고 정해진 답을 준다)
 *  가. 새로 쓰기 › AI 초안: 부탁 글 없으면 꺼짐 → 초안 → 미리보기 → 한글 문서로 만들어 편집하기 → 편집기에 초안
 *  나. 편집기에서 손으로 고침 → 저장 창 → 저장한 한글 파일에 초안과 고친 글
 *  다. 편집기 AI 대화로 고침 → 다시 저장하면 같은 파일에 반영, 되돌리기·다시 실행
 *  라. AI 다듬기: 표 안 커서 안내, 본문 문단 가져오기 → 다듬기 → 바꿔 넣기
 *  마. 점검: 팀장 눈으로 검토 (지금 편집기 내용)
 *  바. 출력: PDF 에 지금 편집기 내용
 *  사. 문서 보기 AI 요약·묻기, "이 공문에 회신 쓰기"(앞 문서가 출력 단계여도 작성 단계가 보임, 앞 부탁 글 안 남음,
 *      앞 문서 저장 여부 묻기) → 회신 초안이 편집기에 열리고 저장하면 앞 문서 파일은 그대로
 *  아. AI 대화 › 글 다듬기 · 문서에 묻기(근거 번호)
 *
 * 사용: node scripts/e2e-ui/q-ai-wiring.mjs --port 7751 --out <스크린샷·작업 폴더>
 *       실제 로컬 모델로: … --model gemma4:e4b   (Ollama http://127.0.0.1:11434, 확인은 느슨하게)
 *   앞서 필요: node scripts/build-sidecar.mjs, node scripts/build-rhwp-studio.mjs, 화면 서버(vite 5173)
 */
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openUi, ROOT, SAMPLES, sleep } from './ui-lib.mjs';

const R = ROOT;
const { parse } = createRequire(join(ROOT, 'node-sidecar', 'package.json'))('kordoc');
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const PORT = Number(arg('--port', '7751'));
const OUT = arg('--out', join(process.cwd(), 'e2e-out'));
const MODEL = arg('--model', '');
const REAL = !!MODEL;
const RELAY = `http://127.0.0.1:${PORT}`;
const DATA = process.env.KORDOC_DATA || mkdtempSync(join(tmpdir(), 'kordoc-e2e-wiring-'));
mkdirSync(DATA, { recursive: true });
rmSync(join(OUT, 'result'), { recursive: true, force: true });
mkdirSync(join(OUT, 'result'), { recursive: true });
const LOG = join(OUT, 'ai-requests.log');
const SAVED = join(OUT, 'result', '안전교육 계획.hwpx');
const PDF_OUT = join(OUT, 'result', '안전교육 계획.pdf');
const REPLY_SAVED = join(OUT, 'result', '회신.hwpx');
const LETTER = join(SAMPLES, '1-받은공문_도민체육대회 참가 협조 요청.hwpx');
const SCR = '.kd-screen:not([hidden])';

const checks = [];
const check = (name, ok, detail = '') => { checks.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` : ${String(detail).slice(0, 280)}` : ''}`); };

// ── 가짜 AI: 요청 글을 보고 갈래를 가린다 ──
const DRAFT = '# 가온시 직원 안전교육 실시 계획\n\n1. 목적\n  가. 재난 상황에서 직원이 스스로 대피하도록 교육한다.\n2. 일시: 2026. 11. 24.(화) 14:00\n3. 장소: 본관 3층 대회의실\n4. 대상: 전 직원 120명';
const REPLY = '# 2026년 가온도민 한마음 체육대회 참가 회신\n\n1. 관련: 가온도 체육진흥과-2187(2026. 9. 30.)\n2. 위 호와 관련하여 우리 시는 체육대회에 참가하고자 하며 참가 신청서를 붙임과 같이 제출합니다.\n\n붙임  참가 신청서 1부.  끝.';
let agentTurn = 0;
function fakeReply(body) {
  const all = body.messages.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
  const sys = String(body.messages.find((m) => m.role === 'system')?.content ?? '');
  const user = String(body.messages.filter((m) => m.role === 'user').at(-1)?.content ?? '');
  appendFileSync(LOG, `--- sys=${sys.slice(0, 140).replace(/\n/g, ' ')} | user=${user.slice(0, 140).replace(/\n/g, ' ')}\n`);
  if (all.includes('"say"') && all.includes('"calls"')) {
    const n = agentTurn++;
    if (n === 0) return JSON.stringify({ say: '문서를 먼저 읽겠습니다.', calls: [{ tool: 'read_document', args: {} }] });
    if (n === 1) return JSON.stringify({ say: '', calls: [{ tool: 'replace_text', args: { find: '대회의실', replace: '소회의실', all: true } }] });
    return JSON.stringify({ say: '장소를 소회의실로 바꿨습니다.', calls: [] });
  }
  if (/근거 조각 번호|문서만 근거로/.test(sys)) return '참가 신청 기한은 2026. 10. 23.(금)입니다. [1]';
  if (/검토|팀장/.test(sys)) return JSON.stringify({ summary: '전체적으로 무난합니다.', issues: [] });
  if (/요약/.test(sys)) return '- 도민 한마음 체육대회 참가 협조 요청\n- 참가 신청은 10월 23일까지';
  if (/회신|받은 공문/.test(all) && /초안|공문서/.test(sys)) return REPLY;
  if (/초안|공문서를 씁|작성/.test(sys)) return DRAFT;
  if (/다듬|고쳐|말투|바꿔 쓰/.test(sys)) return '이번 회의는 금요일에 엽니다.';
  return '참가 신청 기한은 2026. 10. 23.(금)입니다.';
}
let fake = null;
let AI = '';
if (!REAL) {
  fake = createServer((req, res) => {
    if (req.url?.startsWith('/v1/models')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ object: 'list', data: [{ id: 'test-model', object: 'model' }] })); return; }
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (!req.url?.includes('/chat/completions') || !raw) { res.writeHead(404); res.end(); return; }
      const text = fakeReply(JSON.parse(raw));
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      for (let i = 0; i < text.length; i += 24) res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: text.slice(i, i + 24) } }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`);
      res.end('data: [DONE]\n\n');
    });
  });
  await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  AI = `http://127.0.0.1:${fake.address().port}/v1`;
}

const invoke = async (method, params) => (await (await fetch(`${RELAY}/invoke`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cmd: 'sidecar_call', args: { method, params } }) })).json());
const rp = spawn(process.execPath, ['scripts/dev-relay.mjs', '--port', String(PORT), '--data', DATA], { cwd: R, stdio: 'ignore', env: { ...process.env, KORDOC_AI_NO_LAUNCH: '1' } });
for (let i = 0; i < 60; i++) { await sleep(500); if ((await invoke('ping', {}).catch(() => ({}))).ok) break; }
const aiSettings = REAL
  ? { provider: 'local', local: { base_url: 'http://127.0.0.1:11434/v1', model: MODEL } }
  : { provider: 'openai', openai: { base_url: AI, model: 'test-model', api_key: 'test' } };
await invoke('update_settings', { settings: { ai: aiSettings, privacy: { offline: false }, convert: { output_dir: join(OUT, 'result') }, org: { name: '가온시', dept: '총무과' } } });
console.log('ai_status', JSON.stringify((await invoke('ai_status', {})).result).slice(0, 160));

const T = REAL ? 420000 : 60000;
const ui = await openUi({ relay: RELAY, width: 1400, height: 900, prefs: { 'kordoc-first-run-done': true, 'kordoc-nav-collapsed': true } });
const { page } = ui;
const studioOf = () => page.frames().find((f) => f.url().includes('/studio/'));
const waitEditor = () => page.waitForFunction(() => { const e = document.querySelector('.kd-edit'); return e && !e.hidden && !document.querySelector('.kd-editor-cover'); }, { timeout: 180000 });
const probe = (fn) => studioOf().evaluate((src) => {
  const a = window.rhwpStudio.automation;
  if (!window.__kdSvc) { a.registerCommand({ id: 'ext:e2e-services', label: 'e2e', execute: (sv) => { window.__kdSvc = sv; } }); a.execute('ext:e2e-services'); }
  return new Function('w', `return (${src})(w)`)(window.__kdSvc.wasm);
}, fn.toString());
const count = (q) => probe(`(w) => { const r = w.searchAllText(${JSON.stringify(q)}, false, true); return (typeof r === 'string' ? JSON.parse(r) : r).length; }`);
const mdOf = async (file) => { const r = await parse(readFileSync(file)); return r.success ? r.markdown : `PARSE FAIL ${r.error}`; };
const screenText = () => page.evaluate((s) => document.querySelector(s)?.innerText ?? '', SCR);
const flat = (s) => s.replace(/\n+/g, ' | ');
const draftReady = () => page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.offsetParent !== null && b.textContent.includes('한글 문서로 만들어 편집하기') && !b.disabled), { timeout: T });
const clickInEditor = async (dy = 160) => {
  const box = await studioOf().evaluate((y) => { const r = document.querySelector('#scroll-content canvas')?.getBoundingClientRect(); return r ? { x: r.left + r.width / 2, y: r.top + y } : null; }, dy);
  const inner = await page.frames().find((f) => f.url().includes('host.html'))?.$('iframe');
  const innerBox = await inner.boundingBox();
  await page.mouse.click(innerBox.x + box.x, innerBox.y + box.y);
  await sleep(400);
};
async function section(name, fn) {
  try { await fn(); } catch (e) {
    check(`${name} 흐름이 끝까지 간다`, false, String(e));
    await ui.shot(join(OUT, `zz-${name}.png`)).catch(() => {});
    console.log('  SCREEN', flat(await screenText().catch(() => '')).slice(0, 400));
  }
}

await section('가', async () => {
  await page.click('.kd-nav-item[data-screen="create"]');
  await sleep(800);
  await ui.click('AI 초안');
  await page.waitForSelector(`${SCR} textarea[aria-label="AI에게 부탁할 내용"]`);
  const off = await page.evaluate((s) => [...document.querySelectorAll(`${s} button`)].find((b) => b.textContent.includes('초안 쓰기'))?.disabled, SCR);
  check('가-0 부탁 글이 없으면 초안 쓰기가 꺼져 있다', off === true);
  await page.type(`${SCR} textarea[aria-label="AI에게 부탁할 내용"]`, '11월 24일 14시 본관 3층 대회의실에서 전 직원 120명 안전교육을 한다는 계획 보고서');
  await ui.click('초안 쓰기', { within: SCR });
  await draftReady();
  await sleep(REAL ? 8000 : 2500);
  const t = await screenText();
  check('가-1 초안을 쓰고 미리보기가 그려진다', /초안 미리보기 \d+쪽/.test(t) && (await page.evaluate((s) => !!document.querySelector(`${s} .kd-draft-right img, ${s} .kd-draft-right canvas, ${s} .kd-draft-right .kd-page`), SCR)), flat(t).slice(-160));
  await ui.shot(join(OUT, 'a2-draft.png'));
  await ui.click('한글 문서로 만들어 편집하기');
  await waitEditor();
  await sleep(2500);
  const n = REAL ? await probe('(w) => w.getParagraphCount(0)') : await count('대회의실');
  check('가-2 초안이 편집기에 열린다', n >= 1, `편집기 안 ${REAL ? '문단 수' : '"대회의실" 수'} ${n}`);
});

await section('나', async () => {
  await clickInEditor();
  await page.keyboard.press('End');
  await page.keyboard.type(' HANDEDIT');
  await sleep(1200);
  check('나-1 편집기에 친 글이 들어간다', (await count('HANDEDIT')) === 1);
  check('나-2 고치면 저장 안 됨 표시가 뜬다', /아직 저장되지 않았습니다/.test(await screenText()));
  await ui.dialog([SAVED]);
  await ui.click('저장', { exact: true, within: SCR });
  for (let i = 0; i < 60 && !existsSync(SAVED); i++) await sleep(500);
  await sleep(1500);
  const md = existsSync(SAVED) ? await mdOf(SAVED) : '';
  check('나-3 저장한 한글 파일에 초안과 손으로 친 글이 있다', md.includes('HANDEDIT') && (REAL ? md.length > 150 : md.includes('안전교육') && md.includes('대회의실')), flat(md).slice(0, 180) || '파일 없음');
  check('나-4 저장하면 저장 안 됨 표시가 사라진다', !/아직 저장되지 않았습니다/.test(await screenText()));
});

await section('다', async () => {
  agentTurn = 0;
  const target = REAL ? (await count('대회의실')) > 0 ? '대회의실' : null : '대회의실';
  await ui.click('AI 대화', { exact: true, within: SCR });
  await page.waitForSelector('textarea[aria-label="편집기 AI에게 요청"]', { timeout: 20000 });
  await page.type('textarea[aria-label="편집기 AI에게 요청"]', target ? '문서에서 대회의실을 모두 소회의실로 바꿔 줘' : '문서 맨 끝에 "문의: 총무과" 한 줄을 넣어 줘');
  await page.keyboard.press('Enter');
  const want = target ? '소회의실' : '총무과';
  for (let i = 0; i < (REAL ? 200 : 40) && (await count(want)) === 0; i++) await sleep(1500);
  await sleep(REAL ? 8000 : 2500);
  const after = { big: target ? await count('대회의실') : 0, got: await count(want) };
  check('다-1 편집기 AI 가 문서를 실제로 고친다', after.got >= 1 && after.big === 0, JSON.stringify(after));
  await ui.shot(join(OUT, 'c1-agent.png'));
  // AI 가 답을 다 한 뒤 저장 (입력칸이 다시 켜질 때까지)
  await page.waitForFunction(() => { const t = document.querySelector('textarea[aria-label="편집기 AI에게 요청"]'); return t && !t.disabled; }, { timeout: T }).catch(() => {});
  await ui.click('저장', { exact: true, within: SCR });
  await sleep(4000);
  const md = await mdOf(SAVED);
  check('다-2 AI 가 고친 뒤 저장하면 같은 파일에 반영된다', md.includes(want) && md.includes('HANDEDIT') && (!target || !md.includes('대회의실')), flat(md).slice(0, 200));
  // 되돌리기 한 번에 AI 요청 전으로
  await ui.click('되돌리기', { within: SCR });
  await sleep(1500);
  check('다-3 되돌리기로 AI 가 고친 것을 무른다', (await count(want)) === 0 && (await count('HANDEDIT')) === 1, JSON.stringify({ want: await count(want), hand: await count('HANDEDIT') }));
  await page.click(`${SCR} button[aria-label="다시 실행"]`);
  await sleep(1500);
  check('다-4 다시 실행으로 AI 가 고친 것이 돌아온다', (await count(want)) >= 1, `${await count(want)}`);
});

await section('라', async () => {
  // AI 다듬기 탭: 고른 글 가져오기 → 다듬기 → 바꿔 넣기
  await ui.click('AI 다듬기', { exact: true, within: SCR });
  await sleep(600);
  // 기안문 머리(기관명·수신)는 표 안이라 가져올 수 없다: 그때 안내가 뜨는지 보고, 본문 문단을 찾아 내려간다
  await clickInEditor(160);
  await ui.click('고른 글 가져오기', { within: SCR });
  await sleep(1500);
  const tableMsg = await page.evaluate(() => document.querySelector('.kd-assist')?.innerText ?? '');
  check('라-0 표 안에 커서를 두면 까닭과 할 일을 알려 준다', /표 칸 안의 글은 가져올 수 없으니/.test(tableMsg), flat(tableMsg).slice(0, 200));
  let src = '';
  for (const y of [330, 370, 410, 450, 290, 490]) {
    await clickInEditor(y);
    await ui.click('고른 글 가져오기', { within: SCR });
    await sleep(1500);
    src = await page.$eval('textarea[aria-label="고칠 글"]', (e) => e.value);
    if (src.trim()) break;
  }
  check('라-1 편집기 글을 다듬기 칸으로 가져온다', src.trim().length > 0, src.slice(0, 80));
  await page.evaluate(() => [...document.querySelectorAll('.kd-assist button.kd-btn')].find((b) => b.textContent.trim() === '다듬기')?.click());
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.offsetParent !== null && b.textContent.includes('바꿔 넣기') && !b.disabled), { timeout: T });
  const outText = await page.evaluate(() => [...document.querySelectorAll('.kd-assist p.kd-pre[aria-live]')].find((e) => e.offsetParent !== null)?.innerText ?? '');
  check('라-2 다듬은 글이 미리보기에 나온다', REAL ? outText.trim().length > 0 : outText.includes('이번 회의는 금요일에 엽니다'), outText.slice(0, 100));
  await ui.click('바꿔 넣기', { within: SCR });
  await sleep(2000);
  const key = outText.trim().split(/\s+/).slice(0, 2).join(' ');
  const put = key ? await count(key) : 0;
  const err = await page.evaluate(() => [...document.querySelectorAll('.kd-assist .kd-error, .kd-assist [role=alert]')].map((e) => e.innerText).join(' '));
  check('라-3 다듬은 글이 편집기에 바꿔 들어간다', put >= 1, `"${key}" ${put}곳 ${err}`);
  await ui.shot(join(OUT, 'd1-polish.png'));
});

await section('마', async () => {
  // 점검 탭: 팀장 눈으로 검토 (지금 편집기 내용 그대로)
  await ui.click('점검', { exact: true, within: SCR });
  await sleep(600);
  await ui.click('검토 받기', { within: SCR });
  await page.waitForFunction(() => !document.querySelector('.kd-assist')?.innerText.includes('검토하는 중'), { timeout: T });
  await sleep(1500);
  const t = await page.evaluate(() => document.querySelector('.kd-assist')?.innerText ?? '');
  check('마-1 팀장 눈으로 검토가 결과를 낸다', REAL ? t.length > 120 && !/못했습니다/.test(t) : t.includes('전체적으로 무난합니다'), flat(t).slice(0, 240));
  await ui.shot(join(OUT, 'e1-review.png'));
});

await section('바', async () => {
  await ui.click('출력으로', { within: SCR });
  await ui.waitText('PDF로 저장', 30000);
  await sleep(1500);
  await ui.dialog([PDF_OUT]);
  await ui.click('PDF로 저장', { exact: true, within: SCR });
  // 저장 안 한 고침이 있으면 묻는 창이 뜰 수 있다
  for (let i = 0; i < 120 && !existsSync(PDF_OUT); i++) await sleep(500);
  await sleep(1500);
  const md = existsSync(PDF_OUT) ? await mdOf(PDF_OUT) : '';
  check('바-1 출력 PDF 에 지금 편집기 내용(손으로 친 글)이 있다', md.includes('HANDEDIT'), flat(md).slice(0, 160) || `PDF 없음 | ${flat(await screenText()).slice(-200)}`);
});

await section('사', async () => {
  // 받은 공문 → 회신 쓰기 (AI 켜짐: 받은 공문을 붙여 바로 초안)
  await ui.emitOpen([LETTER], '도민체육대회');
  await sleep(2500);
  const before = await screenText();
  const sum = await page.evaluate((s) => [...document.querySelectorAll(`${s} button`)].filter((b) => b.offsetParent !== null).map((b) => b.textContent.trim()), SCR);
  check('사-0 AI 가 켜지면 머리 단추가 AI 회신("이 공문에 회신 쓰기")', sum.some((t) => t === '이 공문에 회신 쓰기'), sum.filter((t) => /회신|요약|묻기/.test(t)).join(','));
  // 문서 보기 AI 요약
  await ui.click('요약하기', { within: SCR });
  await page.waitForFunction((len, s) => (document.querySelector(s)?.innerText.length ?? 0) > len + 30, { timeout: T }, before.length, SCR).catch(() => {});
  await sleep(REAL ? 20000 : 2500);
  const t = await screenText();
  check('사-1 문서 보기 AI 요약이 나온다', REAL ? t.length > before.length + 40 : t.includes('참가 신청은 10월 23일까지'), flat(t).slice(0, 120));
  // 이 문서에 묻기
  const ask = await page.$(`${SCR} textarea[aria-label="질문"]`);
  if (ask) {
    await ask.type('참가 신청은 언제까지야?');
    await page.keyboard.press('Enter');
    await page.waitForFunction((s) => /10\.\s?23|10월 23일/.test(document.querySelector(s)?.innerText.split('이 문서에 묻기')[1] ?? ''), { timeout: T }, SCR).catch(() => {});
    await sleep(1500);
    const a = (await screenText()).split('이 문서에 묻기')[1] ?? '';
    check('사-2 이 문서에 묻기가 근거와 함께 답한다', /10\.\s?23|10월 23일/.test(a), flat(a).slice(0, 200));
    await ui.shot(join(OUT, 'g1-ask.png'));
  } else check('사-2 이 문서에 묻기 입력칸이 있다', false);
  await ui.click('이 공문에 회신 쓰기', { exact: true, within: SCR });
  await draftReady();
  await sleep(REAL ? 8000 : 2500);
  check('사-3 회신 쓰기가 받은 공문을 붙여 초안을 쓴다', /초안 미리보기 \d+쪽/.test(await screenText()), flat(await screenText()).slice(0, 160));
  await ui.shot(join(OUT, 'g2-reply-draft.png'));
  await ui.click('한글 문서로 만들어 편집하기');
  // 앞 문서(안전교육)에 저장 안 한 고침이 있으니 묻는다 → 버리기
  const asked = await page.waitForFunction(() => [...document.querySelectorAll('[role=dialog]')].some((d) => d.innerText.includes('저장하지 않은 문서')), { timeout: 60000 }).then(() => true, () => false);
  check('사-3b 앞 문서에 저장 안 한 고침이 있으면 새 문서를 열기 전에 묻는다', asked);
  const inst = await page.$eval(`${SCR} textarea[aria-label="AI에게 부탁할 내용"]`, (e) => e.value).catch(() => '?');
  check('사-3c 회신으로 넘어오면 앞 초안의 부탁 글이 남지 않는다', inst === '', inst.slice(0, 60));
  if (asked) await ui.click('버리기', { exact: true, within: '[role=dialog]' });
  await waitEditor();
  await sleep(2500);
  const n = REAL ? await probe('(w) => w.getParagraphCount(0)') : await count('참가 신청서');
  check('사-4 회신 초안이 편집기에 열린다 (앞 문서 대신)', n >= 1 && (REAL || (await count('HANDEDIT')) === 0), `${n}`);
  await ui.dialog([REPLY_SAVED]);
  await ui.click('저장', { exact: true, within: SCR });
  for (let i = 0; i < 60 && !existsSync(REPLY_SAVED); i++) await sleep(500);
  await sleep(1500);
  const md = existsSync(REPLY_SAVED) ? await mdOf(REPLY_SAVED) : '';
  check('사-5 회신을 저장하면 그 내용이 파일에 있고 앞 문서 글은 없다', md.length > 80 && !md.includes('HANDEDIT') && (REAL || md.includes('참가 신청서')), flat(md).slice(0, 180) || '파일 없음');
  const first = await mdOf(SAVED);
  check('사-6 앞 문서 파일은 그대로다', first.includes('HANDEDIT'));
});

await section('아', async () => {
  // AI 대화 → 문서에 묻기 · 글 다듬기
  await page.click('.kd-nav-item[data-screen="chat"]');
  await sleep(1000);
  await ui.click('글 다듬기', { within: SCR });
  await page.waitForSelector(`${SCR} textarea[placeholder*="붙여 넣으세요"]`, { timeout: 15000 });
  await page.type(`${SCR} textarea[placeholder*="붙여 넣으세요"]`, '금번 회의는 금요일에 개최할 예정임');
  await page.evaluate((s) => [...document.querySelectorAll(`${s} button.kd-btn`)].find((b) => b.offsetParent !== null && b.textContent.trim() === '다듬기')?.click(), SCR);
  await page.waitForFunction((s) => [...document.querySelectorAll(`${s} button`)].some((b) => b.offsetParent !== null && b.textContent.includes('새로 쓰기로 보내기')), { timeout: T }, SCR);
  const t = await screenText();
  check('아-1 글 다듬기가 결과를 낸다', REAL ? /새로 쓰기로 보내기/.test(t) : t.includes('이번 회의는 금요일에 엽니다'), flat(t).slice(-200));
  await ui.shot(join(OUT, 'h1-rewrite.png'));
  await page.evaluate((s) => [...document.querySelectorAll(`${s} [role=tab]`)].find((b) => b.textContent.trim() === '묻기')?.click(), SCR);
  await sleep(800);
  await ui.dialog([[LETTER]]);
  await ui.click('문서 붙이기', { within: SCR });
  await sleep(1500);
  await page.type(`${SCR} textarea[placeholder*="질문을 쓰고"]`, '참가 신청은 언제까지야?');
  await page.keyboard.press('Enter');
  await page.waitForFunction((s) => /10\.\s?23|10월 23일/.test(document.querySelector(`${s} .kd-chat`)?.innerText ?? ''), { timeout: T }, SCR).catch(() => {});
  await sleep(2000);
  const c = await page.evaluate((s) => document.querySelector(`${s} .kd-chat`)?.innerText ?? '', SCR);
  check('아-2 문서에 묻기가 답한다', /10\.\s?23|10월 23일/.test(c), flat(c).slice(0, 220));
  const cites = await page.evaluate((s) => document.querySelectorAll(`${s} .kd-cite-ref, ${s} .kd-cite-n`).length, SCR);
  check('아-3 답에 근거 번호가 달린다', cites >= 1, `${cites}개`);
  await ui.shot(join(OUT, 'h2-ask.png'));
});

check('화면 오류 없음', ui.errors.length === 0, ui.errors.slice(0, 4).join(' | '));
await ui.clearDialog().catch(() => {});
await ui.close();
rp.kill();
fake?.close();
const failed = checks.filter((c) => !c.ok).length;
console.log(`${checks.length - failed}/${checks.length} 통과`);
process.exit(failed ? 1 : 0);
