/**
 * 편집기 AI 대화 화면 검증 — 가짜 OpenAI 호환 서버가 정해진 차례로 답한다
 *  1차: read_document → 2차: replace_text(모두)·insert_table·create_style·apply_style → 3차: 끝
 *  - 활동 줄에 도구 요약, 편집기 문서에 실제로 반영(찾기·표·스타일), 되돌리기 한 번에 요청 전으로
 *
 * 사용: node scripts/e2e-ui/i-agent.mjs --port 7729 --out <스크린샷 폴더>
 *   앞서 필요: node scripts/build-sidecar.mjs, node scripts/build-rhwp-studio.mjs, 화면 서버(vite 5173)
 */
import { spawn } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openUi, ROOT, SAMPLES, sleep } from './ui-lib.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const PORT = Number(arg('--port', '7729'));
const RELAY = `http://127.0.0.1:${PORT}`;
const OUT = arg('--out', join(process.cwd(), 'e2e-out'));
const DATA = process.env.KORDOC_DATA || mkdtempSync(join(tmpdir(), 'kordoc-e2e-agent-'));
mkdirSync(join(OUT, 'fixtures'), { recursive: true });
const DOC = join(OUT, 'fixtures', '보고서.hwpx');
copyFileSync(join(SAMPLES, '4-보고서_디지털 행정 혁신 추진계획.hwpx'), DOC);

const checks = [];
const check = (name, ok, detail = '') => { checks.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` : ${detail}` : ''}`); };

// ── 가짜 AI ──
let turn = 0;
let target = '';
function reply(body) {
  const last = body.messages.filter((m) => m.role === 'user').at(-1)?.content ?? '';
  const n = turn++;
  if (n === 0) return { say: '문서를 먼저 읽겠습니다.', calls: [{ tool: 'read_document', args: {} }] };
  if (n === 1) {
    target = /\[(\d+\.\d+)\][^\n]*반복 문서 업무/.exec(last)?.[1] ?? '';
    return {
      say: '',
      calls: [
        { tool: 'replace_text', args: { find: '가온시', replace: '나온시', all: true } },
        { tool: 'insert_table', args: { after: target, rows: [['항목', '목표'], ['처리 시간', '삼십 퍼센트 줄임']] } },
        { tool: 'create_style', args: { name: '강조 문단', based_on: '바탕글', bold: true } },
        { tool: 'apply_style', args: { ids: [target], style: '강조 문단' } },
      ],
    };
  }
  return { say: '기관명을 바꾸고 목표 표를 넣었습니다.', calls: [] };
}
const ai = createServer((req, res) => {
  if (req.url?.startsWith('/v1/models')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ object: 'list', data: [{ id: 'test-model', object: 'model' }] })); return; }
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    // 채팅 요청만 차례로 센다 (상태 확인 같은 다른 요청은 빈 답)
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
await invoke('update_settings', { settings: { ai: { provider: 'openai', openai: { base_url: AI, model: 'test-model', api_key: 'test' } }, privacy: { offline: false } } });

const ui = await openUi({ relay: RELAY, width: 1400, height: 900, prefs: { 'kordoc-first-run-done': true } });
const { page } = ui;
try {
  await fetch(`${RELAY}/emit`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ event: 'open-files', payload: [DOC] }) });
  await ui.waitText('한글 편집기로 열기', 30000);
  await ui.click('한글 편집기로 열기');
  await page.waitForFunction(() => { const e = document.querySelector('.kd-edit'); return e && !e.hidden && !document.querySelector('.kd-editor-cover'); }, { timeout: 120000 });
  await sleep(1500);
  const studio = page.frames().find((f) => f.url().includes('/studio/'));
  const probe = (fn) => studio.evaluate((src) => {
    const a = window.rhwpStudio.automation;
    if (!window.__kdSvc) { a.registerCommand({ id: 'ext:e2e-services', label: 'e2e', execute: (sv) => { window.__kdSvc = sv; } }); a.execute('ext:e2e-services'); }
    return new Function('w', `return (${src})(w)`)(window.__kdSvc.wasm);
  }, fn.toString());
  // 스튜디오의 엔진 다리는 JSON 을 풀어서 돌려주기도 한다
  const count = (q) => probe(`(w) => { const r = w.searchAllText(${JSON.stringify(q)}, false, true); return (typeof r === 'string' ? JSON.parse(r) : r).length; }`);
  const before = { old: await count('가온시'), paras: await probe('(w) => w.getParagraphCount(0)') };

  await ui.click('AI 대화', { exact: true });
  await page.waitForSelector('textarea[aria-label="편집기 AI 에게 요청"]');
  await page.type('textarea[aria-label="편집기 AI 에게 요청"]', '기관명을 나온시로 바꾸고 목표 표를 넣어 줘');
  await page.keyboard.press('Enter');
  await ui.waitText('기관명을 바꾸고 목표 표를 넣었습니다', 60000);
  await sleep(800);
  await ui.shot(join(OUT, '01-agent.png'));
  const activity = await page.evaluate(() => document.body.innerText);
  check('활동 줄: 문서 읽음·찾아 바꾸기·표 넣음·스타일', ['문서 읽음', '"가온시" → "나온시"', '표 넣음 · 2줄 2칸', '스타일 "강조 문단" 만듦'].every((s) => activity.includes(s)));
  check('찾을 자리를 모델이 문서 읽기 결과에서 골랐다', /^\d+\.\d+$/.test(target), target);
  check('기관명이 모두 바뀜', (await count('가온시')) === 0 && (await count('나온시')) >= before.old, `${before.old} → ${await count('나온시')}`);
  check('표가 들어감', (await count('삼십 퍼센트 줄임')) >= 1);
  const styleAt = await probe(`(w) => { const r = w.getStyleAt(0, ${Number(target.split('.')[1])}); return (typeof r === 'string' ? JSON.parse(r) : r).name; }`);
  check('스타일을 만들어 걸었다', styleAt === '강조 문단', styleAt);

  // 되돌리기 한 번에 요청 전으로
  await ui.click('되돌리기');
  await sleep(1500);
  const after = { old: await count('가온시'), table: await count('삼십 퍼센트 줄임'), paras: await probe('(w) => w.getParagraphCount(0)') };
  check('되돌리면 요청 전으로', after.old === before.old && after.table === 0 && after.paras === before.paras, JSON.stringify({ before, after }));
  await ui.shot(join(OUT, '02-reverted.png'));
  const o = await ui.orphans();
  check('외톨이 줄 없음', o.length === 0, JSON.stringify(o));
  check('화면 오류 없음', ui.errors.length === 0, ui.errors.slice(0, 3).join(' | '));
} finally {
  await ui.browser.close();
  rp.kill();
  ai.close();
}
const failed = checks.filter((c) => !c.ok).length;
console.log(`${checks.length - failed}/${checks.length} 통과`);
process.exit(failed ? 1 : 0);
