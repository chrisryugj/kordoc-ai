/**
 * 새로 쓰기 → 출력 화면 검증 (구현 B)
 *  - AI 없을 때 AI 초안은 안내 + 서식함·빈 문서 길만 (직접 쓰기 중복 없음)
 *  - 빈 문서로 시작 → 초안은 앱 작업 사본 폴더에 (문서 폴더에 쌓이지 않음)
 *  - 편집기 상태 줄에 "(123.4ms)" 시간 표시 없음
 *  - 출력: PDF로 저장은 PDF 저장 창 하나만, 빈칸 안내 질문 뒤에 진행 표시 없음, 한글 파일도 저장 권유
 *  - 작업대에서 연 기존 문서는 단계 "1. 편집 · 2. 내보내기"
 *  - 외톨이 줄 (1280·1024)
 *
 * 사용: KORDOC_DATA=<앱 데이터 폴더> node scripts/e2e-ui/b-create-output.mjs <결과 폴더> [중계기 주소]
 *   중계기: node scripts/dev-relay.mjs --port 7722 --data <앱 데이터 폴더>  (데이터 폴더 = 작업 사본이 생기는 곳)
 *   데이터 폴더 settings.json 의 convert.output_dir 를 임시 폴더로 두면 문서 폴더에 아무것도 쓰지 않는다
 */
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { openUi, sleep, SAMPLES } from './ui-lib.mjs';

const OUT = process.argv[2] ?? join(process.cwd(), 'e2e-out-b');
const RELAY = process.argv[3] ?? 'http://127.0.0.1:7722';
mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`); };
const docsBefore = existsSync(join(homedir(), 'Documents')) ? readdirSync(join(homedir(), 'Documents')).sort().join('\n') : '';

const ui = await openUi({ relay: RELAY, width: 1280, height: 860 });
const { page } = ui;
const remaining = async () => (await (await fetch(`${RELAY}/dialog`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"queue":[]}' })).json()).queued;
const spinnerVisible = () => page.evaluate(() => [...document.querySelectorAll('.kd-output .kd-spin, .kd-output [data-tone="busy"]')].some((e) => e.offsetParent !== null));

try {
  await ui.click('새로 쓰기', { within: '.kd-nav' });
  await ui.waitText('서식함에서 고르기');

  // ── AI 초안 (AI 없음) ──
  await ui.click('AI 초안', { within: '.kd-routes' });
  await ui.waitText('AI가 연결되어 있지 않아');
  const ai = await page.evaluate(() => ({ text: document.querySelector('.kd-draft')?.innerText ?? '', textarea: !!document.querySelector('.kd-draft .kd-mdeditor') }));
  check('AI 없음: 안내와 서식함·빈 문서 길', ai.text.includes('서식함에서 고르기') && ai.text.includes('빈 문서로 시작'));
  check('AI 없음: 직접 쓰기 글 상자 없음 (빈 문서로 시작 한 곳)', !ai.textarea && !ai.text.includes('직접 쓰기'));
  check('마크다운 기호 안내 없음', !ai.text.includes('# 제목'));
  await ui.shot(join(OUT, '01-ai-none.png'));
  for (const w of [1280, 1024]) {
    await page.setViewport({ width: w, height: 860 });
    await sleep(300);
    const o = await ui.orphans('.kd-draft p, .kd-route .kd-row-desc');
    check(`AI 초안 외톨이 줄 0 @${w}`, o.length === 0, JSON.stringify(o));
  }
  await page.setViewport({ width: 1280, height: 860 });

  // ── 빈 문서로 시작 → 편집 ──
  await ui.click('빈 문서로 시작', { within: '.kd-draft' });
  await ui.waitText('어떤 문서를 쓸까요?');
  await ui.click('이 서식으로 시작');
  await page.waitForFunction(() => { const e = document.querySelector('.kd-edit'); return e && !e.hidden && !document.querySelector('.kd-editor-cover'); }, { timeout: 120000 });
  await sleep(1500);
  const editStatus = await page.evaluate(() => document.querySelector('.kd-edit-bar')?.innerText ?? '');
  check('편집: 초안은 아직 한글 파일로 저장 안 함 표시', editStatus.includes('한글 파일로는 아직 저장하지 않았습니다'), editStatus.replace(/\n/g, ' / '));
  const work = join(process.env.KORDOC_DATA ?? '', '작업 사본');
  if (process.env.KORDOC_DATA) check('초안이 앱 작업 사본 폴더에 있음', existsSync(work) && readdirSync(work).some((f) => f.endsWith('.hwpx')), readdirSync(work).join(', '));
  // 스튜디오 상태 줄 (앱 iframe → 중계 페이지 → 스튜디오 iframe)
  const studio = page.frames().find((f) => f.url().includes('/studio/'));
  const sb = studio ? await studio.evaluate(() => document.getElementById('sb-message')?.textContent ?? '') : '(스튜디오 없음)';
  check('편집기 상태 줄에 시간(ms) 표시 없음', !/\d\s*ms\)/.test(sb), sb);
  await ui.shot(join(OUT, '02-edit.png'));

  // ── 출력 ──
  const step3 = await page.evaluate(() => { const b = [...document.querySelectorAll('.kd-step button')].find((x) => x.textContent.includes('출력')); return b ? !b.disabled : null; });
  check('3. 출력 단계 누를 수 있음', step3 === true);
  await ui.click('3. 출력', { within: '.kd-steps' });
  await ui.waitText('작업 사본으로 앱 작업 폴더에만 있습니다');
  await ui.shot(join(OUT, '03-output.png'));
  for (const w of [1280, 1024]) {
    await page.setViewport({ width: w, height: 860 });
    await sleep(300);
    const o = await ui.orphans('.kd-output p, .kd-output .kd-row-desc');
    check(`출력 외톨이 줄 0 @${w}`, o.length === 0, JSON.stringify(o));
  }
  await page.setViewport({ width: 1280, height: 860 });

  const pdfPath = join(OUT, `초안 ${Date.now()}.pdf`);
  await ui.dialog([pdfPath]);
  await ui.click('PDF로 저장', { exact: true, within: '.kd-output-main' });
  // 빈칸 안내 질문이 뜨면: 뒤에 진행 표시가 없어야 한다
  const modal = await page.waitForFunction(() => [...document.querySelectorAll('[role=dialog]')].some((d) => d.innerText.includes('빈칸 안내 글자')), { timeout: 5000 }).then(() => true, () => false);
  if (modal) {
    check('빈칸 안내 질문 뒤 진행 표시 없음', !(await spinnerVisible()));
    await ui.shot(join(OUT, '04-guide-modal.png'));
    await ui.click('지우고 계속', { exact: true });
  } else check('빈칸 안내 질문 (빈칸 없는 문서라 묻지 않음)', true);
  await ui.waitText('저장했습니다', 120000);
  await sleep(500);
  const pdfOk = existsSync(pdfPath) && readFileSync(pdfPath).subarray(0, 4).toString() === '%PDF';
  check('PDF로 저장: 고른 경로에 PDF', pdfOk, pdfPath);
  check('PDF로 저장: 저장 창은 PDF 하나만 (남은 응답 0, 한글 저장 창 없음)', (await remaining()) === 0);
  const keep = await page.evaluate(() => document.querySelector('.kd-output-main')?.innerText.includes('한글 파일은 아직 저장하지 않았습니다'));
  check('PDF 뒤 "한글 파일도 저장" 권유', !!keep);
  await ui.shot(join(OUT, '05-pdf-saved.png'));

  // 한글 파일도 저장 → 작업 사본 표시가 사라진다
  const hwpxPath = join(OUT, `초안 ${Date.now()}.hwpx`);
  await ui.dialog([hwpxPath]);
  await ui.click('한글 파일도 저장', { within: '.kd-output-side' });
  await page.waitForFunction(() => !document.querySelector('.kd-output-side')?.innerText.includes('작업 사본으로'), { timeout: 60000 });
  check('한글 파일도 저장: 고른 경로에 HWPX', existsSync(hwpxPath), hwpxPath);
  await ui.shot(join(OUT, '06-hangul-saved.png'));

  // ── 작업대에서 연 기존 문서: 편집 · 내보내기 ──
  await ui.click('문서', { within: '.kd-nav' });
  await sleep(500);
  await ui.dialog([[join(SAMPLES, '4-보고서_디지털 행정 혁신 추진계획.hwpx')]]);
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => x.offsetParent && /파일 (고르기|열기)/.test(x.textContent)); b?.click(); });
  await ui.waitText('한글 편집기로 열기', 30000);
  await ui.click('한글 편집기로 열기');
  await page.waitForFunction(() => { const e = document.querySelector('.kd-edit'); return e && !e.hidden; }, { timeout: 60000 });
  // 앞 문서는 저장했으니 묻지 않는다
  await sleep(800);
  const steps = await page.evaluate(() => [...document.querySelectorAll('.kd-step-label')].map((e) => e.textContent.trim()));
  check('기존 문서: 단계는 편집 · 내보내기만', JSON.stringify(steps) === JSON.stringify(['1. 편집', '2. 내보내기']), steps.join(' | '));
  const title = await page.evaluate(() => document.querySelector('.kd-create-head .kd-head-title')?.textContent);
  check('기존 문서: 제목 "문서 고치기"', title === '문서 고치기', title);
  await ui.shot(join(OUT, '07-existing.png'));

  // ── 서식함 기안문(빈칸 남김) → 출력: 빈칸 안내 질문 뒤에 진행 표시가 없어야 ──
  await ui.click('새 문서 쓰기', { within: '.kd-create-head' });
  await ui.click('서식함에서 고르기', { within: '.kd-routes' });
  await page.waitForFunction(() => [...document.querySelectorAll('.kd-library-list button')].some((b) => b.offsetParent && b.textContent.includes('일반')), { timeout: 30000 });
  await ui.click('일반', { within: '.kd-library-list' });
  await page.waitForSelector('.kd-library-detail input[aria-label="제목"]', { timeout: 30000 });
  await page.type('.kd-library-detail input[aria-label="제목"]', '직원 안전교육 실시 계획');
  await ui.click('채워서 편집기로');
  await page.waitForFunction(() => { const e = document.querySelector('.kd-edit'); return e && !e.hidden && !document.querySelector('.kd-editor-cover') && document.querySelector('.kd-edit-bar')?.innerText.includes('직원'); }, { timeout: 120000 });
  await sleep(1500);
  await ui.click('3. 출력', { within: '.kd-steps' });
  await sleep(500);
  const pdf2 = join(OUT, `기안문 ${Date.now()}.pdf`);
  await ui.dialog([pdf2]);
  await ui.click('PDF로 저장', { exact: true, within: '.kd-output-main' });
  const modal2 = await page.waitForFunction(() => [...document.querySelectorAll('[role=dialog]')].some((d) => d.innerText.includes('빈칸 안내 글자')), { timeout: 8000 }).then(() => true, () => false);
  check('빈칸 남긴 기안문: 안내 글자 질문이 뜬다', modal2);
  check('빈칸 안내 질문 뒤 진행 표시 없음', modal2 && !(await spinnerVisible()));
  check('질문하는 동안 PDF 저장 창은 아직 안 열림 (응답 그대로 1개)', (await remaining()) === 1);
  await ui.shot(join(OUT, '08-guide-modal.png'));
  if (modal2) await ui.click('지우고 계속', { exact: true });
  const stale = await page.evaluate(() => document.querySelector('.kd-output-main')?.innerText.includes('초안 '));
  check('다른 문서를 열면 앞 문서 저장 결과는 지워짐', !stale);
  await page.waitForFunction(() => document.querySelector('.kd-output-main')?.innerText.includes('저장했습니다'), { timeout: 120000 });
  check('빈칸 기안문 PDF 저장', existsSync(pdf2) && readFileSync(pdf2).subarray(0, 4).toString() === '%PDF');
  await ui.shot(join(OUT, '09-guide-pdf.png'));
} catch (e) {
  check('실행 오류 없음', false, String(e?.stack ?? e));
  await ui.shot(join(OUT, 'zz-error.png')).catch(() => undefined);
} finally {
  await ui.clearDialog().catch(() => undefined);
  const docsAfter = existsSync(join(homedir(), 'Documents')) ? readdirSync(join(homedir(), 'Documents')).sort().join('\n') : '';
  check('문서 폴더(~/Documents)에 새 파일 없음', docsBefore === docsAfter);
  // 스튜디오(rhwp) 자체 콘솔 기록은 앱 오류가 아니다
  const pageErrors = ui.errors.filter((e) => !/favicon|ResizeObserver|\[CanvasView\]/.test(e));
  check('화면 오류 없음', pageErrors.length === 0, pageErrors.slice(0, 3).join(' / '));
  await ui.close();
  const fail = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - fail}/${results.length} 통과`);
  process.exitCode = fail ? 1 : 0;
}
