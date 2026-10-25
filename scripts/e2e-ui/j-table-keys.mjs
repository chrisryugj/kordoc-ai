/**
 * 한글 편집기 표 단축키 (한컴 도움말 "단축키 일람"의 표 내부·셀 블록·표 선택 상태)
 *  - 칸 안: 마지막 칸 Tab 줄 추가 · Ctrl+Enter 줄 추가(표 밖 쪽 나누기 아님) · Ctrl+Backspace 줄 지우기 · Alt+Insert · Ctrl+Tab 탭
 *  - 쉬운 계산식: Ctrl+Shift+H 가로 합계 · Ctrl+Shift+V 세로 합계 (값과 실행 취소)
 *  - 셀 블록: F7 칸 전체 · F8 줄 전체 · M 합치기 · W 너비 같게(실행 취소 한 단계) · H 는 글자가 들어가지 않음
 *    Enter 는 편집 상태로(문단을 나누지 않음) · Ctrl+E 셀 내용 지우기 · P 표/셀 속성 · Shift+Esc 표 빠져나가기
 *  - 표 선택(Esc): P 개체 속성
 *  - 표 키를 쓰면 안 되는 자리: 머리말 편집 중(본문 커서가 칸에 남아 있음) · 중첩 표 안(스튜디오 명령이 바깥 표를 바꿈)
 *    중첩 표 문서는 rhwp 저장소 samples/inner-table-01.hwp (MIT)
 *
 * 사용: node scripts/e2e-ui/j-table-keys.mjs --port 7730 --out <스크린샷 폴더>
 *   앞서 필요: node scripts/build-sidecar.mjs, node scripts/build-rhwp-studio.mjs, 화면 서버(vite 5173)
 */
import { spawn } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { openUi, ROOT, sleep } from './ui-lib.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const PORT = Number(arg('--port', '7730'));
const RELAY = `http://127.0.0.1:${PORT}`;
const OUT = arg('--out', join(process.cwd(), 'e2e-out'));
const DATA = process.env.KORDOC_DATA || mkdtempSync(join(tmpdir(), 'kordoc-e2e-table-'));
mkdirSync(OUT, { recursive: true });

// 시험 문서: 문단 · 3×3 숫자 표 · 문단
const require = createRequire(join(ROOT, 'node-sidecar', 'package.json'));
const core = await import(require.resolve('@rhwp/core'));
await core.default({ module_or_path: readFileSync(join(dirname(require.resolve('@rhwp/core')), 'rhwp_bg.wasm')) });
const DOC = join(OUT, '표.hwpx');
{
  const d = core.HwpDocument.createEmpty();
  d.createBlankDocument();
  d.insertText(0, 0, 0, '표 앞 문단');
  d.splitParagraph(0, 0, d.getParagraphLength(0, 0));
  d.createTableEx(JSON.stringify({ sectionIdx: 0, paraIdx: 1, charOffset: 0, rowCount: 3, colCount: 3, treatAsChar: false }));
  ['10', '20', '30', '1', '2', '', '', '', ''].forEach((t, i) => { if (t) d.insertTextInCell(0, 1, 0, i, 0, 0, t); });
  writeFileSync(DOC, d.exportHwpx());
  d.free();
}

const checks = [];
const check = (name, ok, detail = '') => { checks.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` : ${detail}` : ''}`); };

const rp = spawn(process.execPath, ['scripts/dev-relay.mjs', '--port', String(PORT), '--data', DATA], { cwd: ROOT, stdio: 'ignore' });
for (let i = 0; i < 60; i++) {
  await sleep(500);
  const ok = await fetch(`${RELAY}/invoke`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cmd: 'sidecar_call', args: { method: 'ping', params: {} } }), signal: AbortSignal.timeout(3000) })
    .then((r) => r.json()).then((r) => r.ok, () => false);
  if (ok) break;
}
await sleep(1500);
const ui = await openUi({ relay: RELAY, width: 1280, height: 900, prefs: { 'kordoc-first-run-done': true } });
const { page } = ui;
try {
  await fetch(`${RELAY}/emit`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ event: 'open-files', payload: [DOC] }) });
  await ui.waitText('한글 편집기로 열기', 30000);
  await ui.click('한글 편집기로 열기');
  await page.waitForFunction(() => { const e = document.querySelector('.kd-edit'); return e && !e.hidden && !document.querySelector('.kd-editor-cover'); }, { timeout: 120000 });
  await sleep(2500);
  const studio = page.frames().find((f) => f.url().includes('/studio/'));
  // 시험용으로 편집기 서비스를 받아 둔다 (자동화 명령이 받는 것)
  await studio.evaluate(() => { const a = window.rhwpStudio.automation; a.registerCommand({ id: 'ext:e2e-sv', label: 'e2e', execute: (sv) => { window.__sv = sv; } }); a.execute('ext:e2e-sv'); });
  const box = await studio.evaluate(() => { const r = document.querySelector('#scroll-content canvas').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + 60 }; });
  const inner = await page.frames().find((f) => f.url().includes('host.html')).$('iframe');
  const ib = await inner.boundingBox();
  await page.mouse.click(ib.x + box.x, ib.y + box.y);
  await sleep(300);

  const state = () => studio.evaluate(() => {
    const sv = window.__sv; const w = sv.wasm; const ih = sv.getInputHandler();
    const P = (v) => (typeof v === 'string' ? JSON.parse(v) : v);
    const d = P(w.getTableDimensions(0, 1, 0));
    const texts = []; const widths = [];
    for (let i = 0; i < d.cellCount; i++) { texts.push(w.getTextInCell(0, 1, 0, i, 0, 0, 50)); widths.push(P(w.getCellProperties(0, 1, 0, i)).width); }
    const r = ih.cursor?.getSelectedCellRange?.();
    const p = ih.getCursorPosition();
    const dialogs = [...document.querySelectorAll('.dialog-title, .modal-title')].filter((e) => e.offsetParent).map((e) => e.textContent.trim());
    return {
      rows: d.rowCount, cells: d.cellCount, texts, widths, paras: w.getParagraphCount(0),
      cellParas: p.cellIndex !== undefined ? w.getCellParagraphCount(0, 1, 0, p.cellIndex) : -1,
      block: ih.isInCellSelectionMode(), object: !!ih.cursor?.isInTableObjectSelection?.(),
      range: r ? `${r.startRow},${r.startCol}-${r.endRow},${r.endCol}` : '', inCell: p.cellIndex !== undefined, cell: p.cellIndex, dialogs,
    };
  });
  /** 셀 블록·표 선택을 풀고 그 칸 글 맨 앞으로 */
  const toCell = (cell) => studio.evaluate((cell) => {
    const ih = window.__sv.getInputHandler();
    if (ih.isInCellSelectionMode()) ih.cursor.exitCellSelectionMode();
    if (ih.cursor.isInTableObjectSelection?.()) ih.cursor.exitTableObjectSelection();
    ih.moveCursorTo({ sectionIndex: 0, paragraphIndex: 1, charOffset: 0, parentParaIndex: 1, controlIndex: 0, cellIndex: cell, cellParaIndex: 0 });
  }, cell);
  const press = async (combo) => {
    for (const part of combo.split(' ')) {
      const keys = part.split('+');
      const main = keys.pop();
      for (const k of keys) await page.keyboard.down(k);
      await page.keyboard.press(main);
      for (const k of keys.reverse()) await page.keyboard.up(k);
      await sleep(200);
    }
    await sleep(300);
  };
  const undo = () => press('Control+KeyZ');
  const closeDialogs = () => studio.evaluate(() => { for (const b of document.querySelectorAll('.dialog-close, .modal-close, button[aria-label="닫기"]')) if (b.offsetParent) b.click(); });
  const base = await state();

  // ── 칸 안 ──
  await toCell(8); await press('Tab');
  let s = await state();
  check('마지막 칸에서 Tab 은 줄 추가', s.rows === 4, `${base.rows} → ${s.rows}`);
  await undo();
  await toCell(4); await press('Control+Enter');
  s = await state();
  check('칸 안 Ctrl+Enter 는 줄 추가 (쪽 나누기·문단 추가 아님)', s.rows === 4 && s.paras === base.paras, `줄 ${s.rows}, 문단 ${base.paras} → ${s.paras}`);
  await undo();
  await toCell(4); await press('Control+Backspace');
  s = await state();
  check('칸 안 Ctrl+Backspace 는 줄 지우기', s.rows === 2 && s.texts.join('|') === '10|20|30|||', s.texts.join('|'));
  await undo();
  s = await state();
  check('실행 취소로 표가 돌아옴', s.rows === 3 && s.texts.join('|') === base.texts.join('|'), s.texts.join('|'));
  await toCell(4); await press('Alt+Insert');
  s = await state();
  check('Alt+Insert 는 줄/칸 추가하기 창', s.dialogs.some((t) => t.includes('줄/칸 추가')), s.dialogs.join(','));
  await closeDialogs(); await press('Escape');
  await toCell(7); await press('Control+Tab');
  s = await state();
  check('칸 안 Ctrl+Tab 은 탭 글자', s.texts[7].includes('\t'), JSON.stringify(s.texts[7]));
  await undo();

  // ── 쉬운 계산식 ──
  await toCell(5); await press('Control+Shift+KeyH');
  s = await state();
  check('Ctrl+Shift+H 가로 합계: 맨 왼쪽~바로 앞 칸 (1+2)', s.texts[5] === '3', JSON.stringify(s.texts[5]));
  await toCell(6); await press('Control+Shift+KeyV');
  s = await state();
  check('Ctrl+Shift+V 세로 합계: 맨 위~바로 위 칸 (10+1)', s.texts[6] === '11', JSON.stringify(s.texts[6]));
  await undo(); await undo();
  s = await state();
  check('계산식도 실행 취소 한 단계씩', s.texts[5] === '' && s.texts[6] === '', `${JSON.stringify(s.texts[5])}, ${JSON.stringify(s.texts[6])}`);

  // ── 셀 블록 ──
  await toCell(4); await press('F5 F7');
  s = await state();
  check('셀 블록 F7 은 칸(열) 전체', s.block && s.range === '0,1-2,1', s.range);
  await press('Escape'); await toCell(4); await press('F5 F8');
  s = await state();
  check('셀 블록 F8 은 줄 전체', s.block && s.range === '1,0-1,2', s.range);
  await press('KeyH');
  s = await state();
  check('셀 블록 H 는 글자로 들어가지 않음 (블록 유지)', s.block && !s.texts.some((t) => /h/i.test(t)), s.texts.join('|'));
  await press('KeyM');
  s = await state();
  check('셀 블록 M 은 셀 합치기', s.cells === 7, `${base.cells} → ${s.cells}`);
  await undo();
  // 칸 너비를 다르게 만든 뒤 W
  await press('Escape Escape'); await toCell(4); await press('F5 Control+ArrowRight Control+ArrowRight Control+ArrowRight Escape');
  await toCell(4); await press('F5 F8');
  const uneven = await state();
  await press('KeyW');
  s = await state();
  const row1 = (st) => st.widths.slice(3, 6);
  check('셀 블록 W 는 줄 전체 칸 너비를 같게', new Set(row1(uneven)).size > 1 && new Set(row1(s)).size === 1, `${row1(uneven)} → ${row1(s)}`);
  await undo();
  s = await state();
  check('W 는 실행 취소 한 단계', row1(s).join() === row1(uneven).join(), `${row1(s)}`);
  await press('Escape');
  await toCell(1); await press('F5 Enter');
  s = await state();
  check('셀 블록 Enter 는 편집 상태로 (칸 문단을 나누지 않음)', !s.block && s.inCell && s.cellParas === 1, `블록 ${s.block}, 칸 문단 ${s.cellParas}`);
  await toCell(1); await press('F5 Control+KeyE');
  s = await state();
  check('셀 블록 Ctrl+E 는 셀 내용 지우기', s.texts[1] === '', JSON.stringify(s.texts[1]));
  await undo(); await press('Escape');
  await toCell(1); await press('F5 KeyP');
  s = await state();
  check('셀 블록 P 는 표/셀 속성 창', s.dialogs.some((t) => t.includes('표/셀 속성')), s.dialogs.join(','));
  await closeDialogs(); await press('Escape Escape');
  await toCell(1); await press('F5 Shift+Escape');
  s = await state();
  check('셀 블록 Shift+Esc 는 표 빠져나가기', !s.block && !s.inCell, `블록 ${s.block}, 칸 ${s.cell}`);
  await page.keyboard.type('Z'); await sleep(300);
  const after = await studio.evaluate(() => window.__sv.wasm.getTextRange(0, 1, 0, window.__sv.wasm.getParagraphLength(0, 1)));
  check('표를 빠져나온 자리는 표 바로 뒤 (치는 글이 표 문단에 들어감)', after === 'Z', JSON.stringify(after));
  await undo();
  await toCell(1); await press('F5 KeyC');
  const bg = await studio.evaluate(() => !!document.querySelector('.dialog-tab-panel[data-tab="background"]')?.offsetParent);
  check('셀 블록 C 는 셀 테두리/배경 창의 배경 탭', bg);
  await closeDialogs(); await press('Escape Escape');
  // 머리말 편집 중에는 본문 커서가 칸에 남아 있어도 표 키가 아니다
  await toCell(4);
  await studio.evaluate(() => window.rhwpStudio.automation.execute('page:header-create', undefined, { allowDialog: true }));
  await sleep(500);
  const inHeader = await studio.evaluate(() => !!window.__sv.getInputHandler().cursor.isInHeaderFooter?.());
  await press('Control+Enter');
  s = await state();
  check('머리말 편집 중 Ctrl+Enter 는 본문 표를 바꾸지 않음', inHeader && s.rows === 3, `머리말 ${inHeader}, 줄 ${s.rows}`);
  await studio.evaluate(() => window.rhwpStudio.automation.execute('page:headerfooter-close'));
  await sleep(300);

  // ── 표 선택 ──
  await toCell(1); await press('Escape');
  s = await state();
  check('칸 안 Esc 는 표 선택', s.object, String(s.object));
  await press('KeyP');
  s = await state();
  check('표 선택 P 는 개체 속성 창', s.dialogs.length > 0 && !s.texts.some((t) => /p/i.test(t)), s.dialogs.join(','));
  await closeDialogs();
  await ui.shot(join(OUT, '01-table-keys.png'));
} finally {
  await ui.browser.close();
}

// ── 중첩 표: 안쪽 칸에서 표 키를 써도 바깥 표가 바뀌지 않는다 ──
const NESTED = join(OUT, '중첩표.hwp');
copyFileSync(join(ROOT, 'scripts', 'e2e-ui', 'fixtures', 'inner-table-01.hwp'), NESTED);
const ui2 = await openUi({ relay: RELAY, width: 1280, height: 900, prefs: { 'kordoc-first-run-done': true } });
try {
  const page2 = ui2.page;
  await fetch(`${RELAY}/emit`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ event: 'open-files', payload: [NESTED] }) });
  await ui2.waitText('한글 편집기로 열기', 30000);
  await ui2.click('한글 편집기로 열기');
  await page2.waitForFunction(() => { const e = document.querySelector('.kd-edit'); return e && !e.hidden && !document.querySelector('.kd-editor-cover'); }, { timeout: 120000 });
  await sleep(2500);
  const st2 = page2.frames().find((f) => f.url().includes('/studio/'));
  await st2.evaluate(() => { const a = window.rhwpStudio.automation; a.registerCommand({ id: 'ext:e2e-sv', label: 'e2e', execute: (sv) => { window.__sv = sv; } }); a.execute('ext:e2e-sv'); });
  const box2 = await st2.evaluate(() => { const r = document.querySelector('#scroll-content canvas').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + 60 }; });
  const ib2 = await (await page2.frames().find((f) => f.url().includes('host.html')).$('iframe')).boundingBox();
  await page2.mouse.click(ib2.x + box2.x, ib2.y + box2.y);
  // 화면을 훑어 안쪽 표 칸 자리를 찾는다
  const hit = await st2.evaluate(() => {
    const w = window.__sv.wasm;
    for (let pg = 0; pg < Math.min(2, w.pageCount); pg++) {
      for (let y = 40; y < 1100; y += 12) for (let x = 40; x < 780; x += 12) {
        try { const h = w.hitTest(pg, x, y); if ((h.cellPath?.length ?? 0) >= 2) return h; } catch { /* 칸 아님 */ }
      }
    }
    return null;
  });
  check("중첩 표 문서에서 안쪽 칸을 찾음", !!hit, JSON.stringify(hit));
  if (hit) {
    const outer = () => st2.evaluate((h) => {
      // 바깥 표 = 본문 문단 parentParaIndex 의 cellPath[0] 컨트롤
      const ci = h.cellPath[0].controlIndex;
      const w = window.__sv.wasm;
      try {
        const d = w.getTableDimensions(0, h.parentParaIndex, ci);
        const ws = []; for (let i = 0; i < d.cellCount; i++) ws.push(w.getCellProperties(0, h.parentParaIndex, ci, i).width);
        return `${d.rowCount}x${d.colCount} ${ws.join(',')}`;
      } catch (e) { return `ERR ${e.message ?? e} ppi=${h.parentParaIndex} ci=${ci} paras=${w.getParagraphCount(0)}`; }
    }, hit);
    const go = () => st2.evaluate((h) => { const ih = window.__sv.getInputHandler(); if (ih.isInCellSelectionMode()) ih.cursor.exitCellSelectionMode(); ih.moveCursorTo(h); }, hit);
    const key = async (combo) => { for (const part of combo.split(' ')) { const ks = part.split('+'); const m = ks.pop(); for (const k of ks) await page2.keyboard.down(k); await page2.keyboard.press(m); for (const k of ks.reverse()) await page2.keyboard.up(k); await sleep(250); } await sleep(300); };
    const before = await outer();
    await go(); await key('Control+Enter');
    check('안쪽 칸 Ctrl+Enter 가 바깥 표 줄을 늘리지 않음', (await outer()) === before, `${before} → ${await outer()}`);
    await key('Control+KeyZ');
    await go(); await key('F5 F8 KeyW');
    check('안쪽 표 셀 블록 W 가 바깥 표 너비를 바꾸지 않음', (await outer()) === before, `${before} → ${await outer()}`);
  }
} finally {
  await ui2.browser.close();
  rp.kill('SIGKILL');
}
const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} 통과`);
process.exit(failed.length ? 1 : 0);
