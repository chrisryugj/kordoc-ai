/**
 * C 영역 화면 검증 — 결재 전 한 번에 점검(목록·쪽으로 가기·모두 고치기 → 고친 사본 다시 점검 → 고칠 것 0)·개인정보 가리기(정보공개 기본·남길 것·PDF 결과).
 *   node scripts/e2e-ui/c-precheck.mjs --relay http://127.0.0.1:7723 --out <스크린샷 폴더>
 * 틀린 곳을 심은 예시 문서는 make-precheck-sample.mjs 로 --out/docs 에 만든다. 저장은 --out/out 으로 (samples 에 쓰지 않는다).
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { openUi, ROOT, SAMPLES, sleep } from './ui-lib.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const RELAY = arg('--relay', 'http://127.0.0.1:7723');
const OUT = arg('--out', join(process.cwd(), 'e2e-out'));
const SAVE = join(OUT, 'out');
const DOCS = join(OUT, 'docs');
mkdirSync(SAVE, { recursive: true });
execFileSync(process.execPath, [join(ROOT, 'scripts/e2e-ui/make-precheck-sample.mjs'), DOCS], { cwd: ROOT });
const SAMPLE = join(DOCS, '결재전점검_예시.hwpx');
const LETTER_PDF = join(SAMPLES, '1-받은공문_도민체육대회 참가 협조 요청.pdf');

const checks = [];
const check = (name, ok, detail = '') => { checks.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` : ${detail}` : ''}`); };
const CODE = /\b[A-Z]{2,}_[A-Z_]{2,}\b/;

async function run(width, height) {
  const tag = String(width);
  // 기관 대표번호·담당 이름을 설정에 (남길 것으로 미리 채워진다). AI 는 연결 안 함 (없을 때도 쓸모 있는지)
  await fetch(`${RELAY}/invoke`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cmd: 'sidecar_call', args: { method: 'update_settings', params: { settings: { org: { name: '가온시', person: '홍길동', phone: '031-123-4567' }, convert: { output_dir: SAVE }, ai: { provider: 'none' } } } } }) }).catch(() => undefined);
  const ui = await openUi({ relay: RELAY, width, height, prefs: { 'kordoc-first-run-done': true, 'kordoc-nav-collapsed': width < 1200, 'kordoc-theme': 'light' } });
  const { page } = ui;
  const ws = '.kd-docws:not([hidden])';
  const openDoc = async (path) => {
    await ui.dialog([[path]]);
    await page.click('.kd-nav-item[data-screen="workbench"]');
    await sleep(200);
    await ui.click('문서 열기', { within: '.kd-screen:not([hidden]) .kd-head' });
    await page.waitForFunction((s) => document.querySelector(`${s} .kd-tools`), { timeout: 30000 }, ws);
    await sleep(2500);
  };
  const tab = async (label) => { await page.evaluate((l, s) => [...document.querySelectorAll(`${s} [role=tab]`)].find((t) => t.textContent === l)?.click(), label, ws); await sleep(500); };
  const viewerPage = () => page.evaluate((s) => document.querySelector(`${s} .kd-toolbar .kd-num`)?.textContent ?? '', ws);
  try {
    await openDoc(SAMPLE);
    await tab('검토');
    const t0 = Date.now();
    await ui.click('결재 전 한 번에 점검', { within: `${ws} [data-tool="review"]` });
    await ui.waitText('점검 결과', 30000);
    const fastMs = Date.now() - t0;
    await sleep(1500); // 법령 근거(뒤에서)까지
    const list = await page.evaluate((s) => [...document.querySelectorAll(`${s} [data-tool="review"] .kd-finding`)].map((e) => e.innerText), ws);
    const panel = await page.evaluate((s) => document.querySelector(`${s} [data-tool="review"]`).innerText, ws);
    check(`[${tag}] 빠른 검사 결과가 금방 (${fastMs}ms)`, fastMs < 8000, `${fastMs}ms`);
    for (const c of ['날짜와 요일', '표 합계', '날짜 표기', '금액 표기', '개인정보', '빈칸 안내 글자', '붙임·끝 표시']) check(`[${tag}] 목록에 ${c}`, list.some((x) => x.includes(c)));
    check(`[${tag}] 규칙 코드가 보이지 않음`, !CODE.test(panel), panel.match(CODE)?.[0] ?? '');
    check(`[${tag}] 고칠 것 먼저 (심각도 순)`, list.findIndex((x) => x.startsWith('살필 것')) > list.findIndex((x) => x.startsWith('고칠 것')) && list.findLastIndex((x) => x.startsWith('고칠 것')) < list.findIndex((x) => x.startsWith('살필 것')));
    check(`[${tag}] 금액 고칠 값에 천 단위 쉼표`, panel.includes('금1,500,000원(금일백오십만원)'));
    check(`[${tag}] 낱말 단위 발췌 (련 : 아님)`, panel.includes('관련 :') && !/(^|\s)련 :/.test(panel));
    check(`[${tag}] 남길 것(대표번호·내 이름)은 짚지 않음`, !panel.includes('031-●●●-4567') && !panel.includes('홍●●'));
    check(`[${tag}] AI 없을 때: AI 연결 시 함께 봅니다`, panel.includes('AI 연결 시 함께 봅니다'));
    check(`[${tag}] 쪽 표시 (1쪽·2쪽)`, list.some((x) => /\b1쪽/.test(x)) && list.some((x) => /\b2쪽/.test(x)));
    await ui.shot(join(OUT, `c-${tag}-01-precheck.png`));
    const orph1 = await ui.orphans(`${ws} [data-tool="review"] p, ${ws} [data-tool="review"] .kd-small, ${ws} [data-tool="review"] .kd-note, ${ws} [data-tool="review"] .kd-text`);
    check(`[${tag}] 점검 화면 외톨이 줄 없음`, orph1.length === 0, JSON.stringify(orph1));

    // 누르면 그 쪽으로 (2쪽 지적)
    const before = await viewerPage();
    await page.evaluate((s) => [...document.querySelectorAll(`${s} [data-tool="review"] button.kd-finding`)].find((b) => /\b2쪽/.test(b.innerText))?.click(), ws);
    await sleep(1500);
    const after = await viewerPage();
    check(`[${tag}] 지적을 누르면 그 쪽으로`, /^2 \//.test(after), `${before} → ${after}`);
    await ui.shot(join(OUT, `c-${tag}-02-jump.png`));

    // 고칠 수 있는 것 모두 고치기 → 고친 사본을 다시 점검 → 고칠 것 0
    await ui.click('고칠 수 있는 것 모두 고치기', { within: `${ws} [data-tool="review"]` });
    await ui.waitText('고친 사본을 저장하고 다시 점검했습니다', 30000);
    await ui.waitText('점검 결과: 고칠 것 0', 10000);
    await sleep(1000);
    const panel2 = await page.evaluate((s) => document.querySelector(`${s} [data-tool="review"]`).innerText, ws);
    check(`[${tag}] 모두 고친 뒤 고친 사본 기준 고칠 것 0`, panel2.includes('점검 결과: 고칠 것 0') && panel2.includes('_수정'), panel2.slice(0, 200).replace(/\n/g, '⏎'));
    await page.evaluate((s) => document.querySelector(`${s} [data-tool="review"]`).scrollIntoView(), ws);
    await ui.shot(join(OUT, `c-${tag}-03-fixed.png`));
    const orph2 = await ui.orphans(`${ws} [data-tool="review"] p, ${ws} [data-tool="review"] .kd-small, ${ws} [data-tool="review"] .kd-note`);
    check(`[${tag}] 고친 뒤 화면 외톨이 줄 없음`, orph2.length === 0, JSON.stringify(orph2));

    // 개인정보 가리기 — 정보공개 기본, 남길 것 미리 채움, 저장하면 가린 사본을 작업대에
    await page.evaluate((s) => document.querySelector(`${s} [data-tool="redact"]`).scrollIntoView(), ws);
    const redact0 = await page.evaluate((s) => {
      const r = document.querySelector(`${s} [data-tool="redact"]`);
      return { pressed: [...r.querySelectorAll('.kd-chip[aria-pressed="true"]')].map((b) => b.textContent), keep: r.querySelector('input[aria-label="남길 것"]')?.value };
    }, ws);
    check(`[${tag}] 가리기: 정보공개 공개본이 기본`, redact0.pressed.some((t) => t.startsWith('정보공개 공개본')), JSON.stringify(redact0));
    check(`[${tag}] 가리기: 남길 것에 설정의 대표번호·내 이름`, redact0.keep?.includes('031-123-4567') && redact0.keep?.includes('홍길동'), redact0.keep);
    await ui.click('미리 찾아보기', { within: `${ws} [data-tool="redact"]` });
    await ui.waitText('찾은 개인정보', 30000);
    const prev = await page.evaluate((s) => document.querySelector(`${s} [data-tool="redact"]`).innerText, ws);
    check(`[${tag}] 미리 찾아보기: 이름·주소까지, 남길 것은 뺌`, /사람 이름/.test(prev) && /주소/.test(prev) && prev.includes('남길 것'), prev.slice(prev.indexOf('찾은 개인정보'), prev.indexOf('찾은 개인정보') + 160).replace(/\n/g, '⏎'));
    await ui.shot(join(OUT, `c-${tag}-04-redact-preview.png`));
    const orph3 = await ui.orphans(`${ws} [data-tool="redact"] p, ${ws} [data-tool="redact"] .kd-small, ${ws} [data-tool="redact"] .kd-note, ${ws} [data-tool="redact"] .kd-field-hint`);
    check(`[${tag}] 가리기 화면 외톨이 줄 없음`, orph3.length === 0, JSON.stringify(orph3));
    await ui.click('가린 사본 저장', { within: `${ws} [data-tool="redact"]` });
    await page.waitForFunction(() => [...document.querySelectorAll('.kd-docitem[aria-current="true"], [aria-current="true"]')].some((e) => e.textContent.includes('_가림')), { timeout: 30000 }).catch(() => undefined);
    await sleep(2500);
    const opened = await page.evaluate(() => document.querySelector('.kd-screen:not([hidden]) .kd-head')?.innerText ?? '');
    check(`[${tag}] 저장하면 가린 사본을 작업대에 연다`, opened.includes('_가림'), opened.slice(0, 120).replace(/\n/g, '⏎'));
    await ui.shot(join(OUT, `c-${tag}-05-redacted-open.png`));
    // 원본 탭으로 돌아가 저장 결과(남은 곳 없음 + 안 본 항목)
    await page.evaluate(() => [...document.querySelectorAll('.kd-docitem')].find((e) => e.textContent.includes('결재전점검_예시') && !e.textContent.includes('가림') && !e.textContent.includes('수정'))?.querySelector('.kd-docitem-main')?.click());
    await sleep(800);
    await tab('검토');
    const saved = await page.evaluate((s) => document.querySelector(`${s} [data-tool="redact"] .kd-redact-saved`)?.innerText ?? '', ws);
    check(`[${tag}] 저장 결과: 남은 곳 없음 문장 + 남길 것 수`, /남은 곳이 없습니다/.test(saved) && /남길 것 \d+곳/.test(saved), saved.replace(/\n/g, '⏎').slice(0, 200));
    await page.evaluate((s) => document.querySelector(`${s} [data-tool="redact"] .kd-redact-saved`)?.scrollIntoView({ block: 'center' }), ws);
    await ui.shot(join(OUT, `c-${tag}-05b-redact-saved.png`));
    const orph4 = await ui.orphans(`${ws} [data-tool="redact"] .kd-redact-saved .kd-note, ${ws} [data-tool="redact"] .kd-redact-saved p`);
    check(`[${tag}] 저장 결과 외톨이 줄 없음`, orph4.length === 0, JSON.stringify(orph4));

    // PDF — 결과도 PDF (검은 상자, 글자층 없음)
    if (width === 1280) {
      await openDoc(LETTER_PDF);
      await tab('검토');
      await page.evaluate((s) => document.querySelector(`${s} [data-tool="redact"]`).scrollIntoView(), ws);
      const pdfNote = await page.evaluate((s) => document.querySelector(`${s} [data-tool="redact"] p`)?.textContent ?? '', ws);
      check('[pdf] 가리기 안내: 검게 칠한 PDF', pdfNote.includes('검게 칠한 PDF'), pdfNote);
      await ui.click('미리 찾아보기', { within: `${ws} [data-tool="redact"]` });
      await ui.waitText('찾은 개인정보', 30000);
      await ui.click('가린 사본 저장', { within: `${ws} [data-tool="redact"]` });
      await page.waitForFunction(() => /_가림( \(\d+\))?\.pdf/.test(document.querySelector('.kd-screen:not([hidden]) .kd-head')?.innerText ?? ''), { timeout: 60000 }).catch(() => undefined);
      await sleep(3000);
      const head = await page.evaluate(() => document.querySelector('.kd-screen:not([hidden]) .kd-head')?.innerText ?? '');
      check('[pdf] 결과는 _가림.pdf, 작업대에 열림', /_가림( \(\d+\))?\.pdf/.test(head), head.slice(0, 120).replace(/\n/g, '⏎'));
      const file = head.match(/\S+_가림( \(\d+\))?\.pdf/)?.[0] && (await ui.call('list_files', { path: SAVE })).map((f) => f.name).find((n) => head.includes(n));
      if (file) {
        const req = createRequire(join(ROOT, 'node-sidecar', 'package.json'));
        const { PDFiumLibrary } = await import(req.resolve('@hyzyla/pdfium'));
        const lib = await PDFiumLibrary.init();
        const doc = await lib.loadDocument(readFileSync(join(SAVE, file)));
        const texts = [...Array(doc.getPageCount())].map((_, i) => doc.getPage(i).getText().trim());
        check('[pdf] 가린 PDF 에서 글을 뽑을 수 없음 (글자층 없음)', texts.every((t) => t === ''), JSON.stringify(texts).slice(0, 80));
        doc.destroy();
      } else check('[pdf] 가린 PDF 파일', false, 'not found');
      await ui.shot(join(OUT, `c-${tag}-06-pdf-redacted.png`));
    }
    if (ui.errors.length) console.log('page errors:', ui.errors.slice(0, 5));
  } finally {
    await ui.clearDialog();
    await ui.close();
  }
}

await run(1280, 800);
await run(1024, 768);
const fail = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - fail.length}/${checks.length} 통과`);
process.exit(fail.length ? 1 : 0);
