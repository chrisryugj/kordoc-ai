/**
 * 결재 전 점검 → 편집기에서 AI로 고치기
 *  - 점검 결과에 "편집기에서 AI로 고치기"가 뜨고, 누르면 그 문서가 한글 편집기로 열린다
 *  - 편집기가 다 열린 뒤 편집기 AI 가 지적 목록(원문·바르게 쓸 값)을 첫 요청으로 받아 바로 시작한다 (한 번만)
 *  - 가짜 AI 가 고친 내용(쉬운 말 "금번" → "이번")이 편집기 문서에 들어간다
 *  - 편집기에 다른 문서가 이미 열려 있고 AI 답이 늦어도, 요청은 새 문서를 다 연 뒤 한 번만 간다
 *  - 사실을 확인해야 하는 지적(날짜와 요일·표 합계·개인정보)은 요청에 들어가지 않는다
 *  - 보조 패널을 접었다 펴도 요청이 다시 가지 않는다
 *
 * 사용: node scripts/e2e-ui/k-precheck-agent.mjs --port 7732 --out <스크린샷 폴더>
 *   앞서 필요: node scripts/build-sidecar.mjs, node scripts/build-rhwp-studio.mjs, 화면 서버(vite 5173)
 */
import { execFileSync, spawn } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openUi, ROOT, SAMPLES, sleep } from './ui-lib.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const PORT = Number(arg('--port', '7732'));
const RELAY = `http://127.0.0.1:${PORT}`;
const OUT = arg('--out', join(process.cwd(), 'e2e-out'));
const DATA = process.env.KORDOC_DATA || mkdtempSync(join(tmpdir(), 'kordoc-e2e-precheck-agent-'));
const DOCS = join(OUT, 'docs');
mkdirSync(DOCS, { recursive: true });
execFileSync(process.execPath, [join(ROOT, 'scripts/e2e-ui/make-precheck-sample.mjs'), DOCS], { cwd: ROOT });
const SAMPLE = join(DOCS, '결재전점검_예시.hwpx');
// 먼저 편집기에 열어 둘 다른 문서
const OTHER = join(DOCS, '먼저 연 문서.hwpx');
copyFileSync(join(SAMPLES, '4-보고서_디지털 행정 혁신 추진계획.hwpx'), OTHER);

const checks = [];
const check = (name, ok, detail = '') => { checks.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` : ${detail}` : ''}`); };

// ── 가짜 AI: K팀장 검토엔 빈 지적, 편집기 AI 엔 고치기 한 번 → 끝 ──
const agentRequests = [];
function reply(body) {
  const text = body.messages.map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n');
  if (!text.includes('결재 전 점검에서 나온 표기 지적입니다')) return { summary: '살필 곳이 없습니다.', issues: [] };
  agentRequests.push(text);
  if (agentRequests.length === 1) return { say: '', calls: [{ tool: 'replace_text', args: { find: '금번', replace: '이번', all: true } }] };
  return { say: '쉬운 말로 고쳤습니다. 날짜·금액은 확인이 필요합니다.', calls: [] };
}
const ai = createServer((req, res) => {
  if (req.url?.startsWith('/v1/models')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ object: 'list', data: [{ id: 'test-model', object: 'model' }] })); return; }
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', async () => {
    if (!req.url?.includes('/chat/completions') || !raw) { res.writeHead(404); res.end(); return; }
    const out = reply(JSON.parse(raw));
    // 편집기 AI 답은 늦게 (앞 문서가 열린 채로 요청이 먼저 가면 새 문서를 여는 사이에 끊긴다)
    if (out.calls?.length) await sleep(1500);
    const text = JSON.stringify(out);
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: text } }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`);
    res.end('data: [DONE]\n\n');
  });
});
await new Promise((r) => ai.listen(0, '127.0.0.1', r));
const AI = `http://127.0.0.1:${ai.address().port}/v1`;

const invoke = async (method, params) => (await (await fetch(`${RELAY}/invoke`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cmd: 'sidecar_call', args: { method, params } }) })).json());
// 법령 확인은 인터넷으로 나가지 않게 닫힌 주소로
const rp = spawn(process.execPath, ['scripts/dev-relay.mjs', '--port', String(PORT), '--data', DATA], { cwd: ROOT, stdio: 'ignore', env: { ...process.env, KORDOC_LAW_BASE: 'http://127.0.0.1:9/DRF/' } });
for (let i = 0; i < 60; i++) { await sleep(500); if ((await invoke('ping', {}).catch(() => ({}))).ok) break; }
await invoke('update_settings', { settings: { ai: { provider: 'openai', openai: { base_url: AI, model: 'test-model', api_key: 'test' } }, privacy: { offline: false } } });

const ui = await openUi({ relay: RELAY, width: 1400, height: 900, prefs: { 'kordoc-first-run-done': true, 'kordoc-theme': 'light' } });
const { page } = ui;
const ws = '.kd-docws:not([hidden])';
const editorReady = () => page.waitForFunction(() => { const e = document.querySelector('.kd-edit'); return e && !e.hidden && !document.querySelector('.kd-editor-cover'); }, { timeout: 120000 });
try {
  // 다른 문서를 먼저 한글 편집기로 열어 둔다
  await fetch(`${RELAY}/emit`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ event: 'open-files', payload: [OTHER] }) });
  await ui.waitText('한글 편집기로 열기', 30000);
  await ui.click('한글 편집기로 열기');
  await editorReady();
  await sleep(1500);
  await ui.dialog([[SAMPLE]]);
  await page.click('.kd-nav-item[data-screen="workbench"]');
  await sleep(200);
  await ui.click('문서 열기', { within: '.kd-screen:not([hidden]) .kd-head' });
  await page.waitForFunction((s) => document.querySelector(`${s} .kd-tools`), { timeout: 30000 }, ws);
  await sleep(2500);
  await page.evaluate((s) => [...document.querySelectorAll(`${s} [role=tab]`)].find((t) => t.textContent === '검토')?.click(), ws);
  await sleep(500);
  await ui.click('결재 전 한 번에 점검', { within: `${ws} [data-tool="review"]` });
  await ui.waitText('편집기에서 AI로 고치기', 30000);
  const panel = await page.evaluate((s) => document.querySelector(`${s} [data-tool="review"]`).innerText, ws);
  check('점검 결과에 "편집기에서 AI로 고치기"와 몇 곳인지', /표기 지적 \d+곳을 이 파일 그대로 한글 편집기로/.test(panel), panel.match(/표기 지적 \d+곳/)?.[0] ?? '');
  await ui.shot(join(OUT, 'k-01-precheck.png'));
  await ui.click('편집기에서 AI로 고치기', { within: `${ws} [data-tool="review"]` });
  await sleep(500);
  await editorReady();
  // 편집기 AI 가 스스로 시작해 끝날 때까지
  for (let i = 0; i < 60 && agentRequests.length < 2; i++) await sleep(500);
  await sleep(1500);
  const first = agentRequests[0] ?? '';
  check('편집기 AI 가 지적 목록을 첫 요청으로 받음', first.includes('결재 전 점검에서 나온 표기 지적입니다') && first.includes('원문: "'), first.slice(0, 80));
  check('지적에 쉬운 말(금번)과 바르게 쓸 값이 실림', /금번/.test(first) && /바르게: "/.test(first));
  const listed = first.split('\n').filter((l) => /^\d+\. \[/.test(l));
  check('사실 확인 지적(날짜와 요일·표 합계·개인정보·빈칸)은 요청에 없음', listed.length > 0 && !listed.some((l) => /날짜와 요일|표 합계|개인정보|빈칸 안내/.test(l)), listed.join(' | ').slice(0, 200));
  const chat = await page.evaluate(() => document.querySelector('.kd-assist')?.innerText ?? '');
  check('대화에는 짧은 요청 말과 끝난 말만 (지적 목록 전체는 안 보임)', /결재 전 점검의 표기 지적 \d+곳을 고쳐 주세요/.test(chat) && chat.includes('쉬운 말로 고쳤습니다') && !chat.includes('결재 전 점검에서 나온 표기 지적입니다'), chat.slice(0, 160).replace(/\n/g, ' / '));
  const studio = page.frames().find((f) => f.url().includes('/studio/'));
  const text = await studio.evaluate(() => {
    const a = window.rhwpStudio.automation;
    a.registerCommand({ id: 'ext:e2e-sv', label: 'e2e', execute: (sv) => { window.__sv = sv; } });
    a.execute('ext:e2e-sv');
    const w = window.__sv.wasm; let t = '';
    for (let p = 0; p < w.getParagraphCount(0); p++) t += w.getTextRange(0, p, 0, w.getParagraphLength(0, p)) + '\n';
    return t;
  });
  check('편집기 문서에서 "금번"이 "이번"으로', !text.includes('금번') && text.includes('이번'), text.slice(0, 80).replace(/\n/g, ' / '));
  // 같은 문서를 연 동안 다시 시작하지 않는다: 보조 패널을 접었다 펴도
  await page.click('[aria-label="보조 패널 접기"]');
  await sleep(500);
  await page.click('[aria-label="보조 패널 펼치기"]');
  await sleep(4000);
  check('요청은 한 번만 (도구 한 차례 + 끝 한 차례, 패널을 접었다 펴도)', agentRequests.length === 2, String(agentRequests.length));
  await ui.shot(join(OUT, 'k-02-editor-agent.png'));
} finally {
  await ui.browser.close();
  rp.kill('SIGKILL');
  ai.close();
}
const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} 통과`);
process.exit(failed.length ? 1 : 0);
