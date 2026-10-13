/**
 * 우리 서식으로 맞추기 화면 검증 (구현 E) — 가상의 가온시 견본·내용 문서로
 *  - 새로 쓰기 › 우리 서식으로 맞추기: 견본 문서에서 서식 읽기 → 서식 내용 표 → 미리보기(rhwp) → 이 서식 저장
 *  - 내용 문서 여러 개(마크다운·글·PDF) → 우리 서식으로 만들기 → 결과 목록(원래 이름_우리서식.hwpx, 원본 그대로)
 *  - 결과 PDF로 저장 · 편집기에서 열기
 *  - 서무 도구 › 우리 서식으로 맞추기 (저장한 서식 고르기 → 시작)
 *  - 외톨이 줄·줄표 (1280·1024)
 *
 * 사용: node scripts/e2e-ui/e-style-copy.mjs <결과 폴더> [중계기 주소]
 *   중계기: node scripts/dev-relay.mjs --port 7725 --data <앱 데이터 폴더>
 *   앞서 필요: node-sidecar 빌드(tsc·esbuild). 견본·내용 문서는 결과 폴더 안 fixtures/ 에 만든다
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openUi, ROOT, SAMPLES, sleep } from './ui-lib.mjs';

const OUT = process.argv[2] ?? join(process.cwd(), 'e2e-out-e');
const RELAY = process.argv[3] ?? 'http://127.0.0.1:7725';
const FIX = join(OUT, 'fixtures');
rmSync(FIX, { recursive: true, force: true });
mkdirSync(FIX, { recursive: true });
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`); };

// ── 가상 견본: 가온시 보고서 (기본값이 아닌 서식: 여백 위 18·왼쪽 22, 휴먼명조 14pt, 줄 간격 170%, □ ◦ -, 단계별 글꼴, 쪽 번호) ──
const kordoc = await import(pathToFileURL(createRequire(join(ROOT, 'node-sidecar', 'package.json')).resolve('kordoc')).href);
const sample = join(FIX, '가온시 보고서 견본.hwpx');
writeFileSync(sample, Buffer.from(await kordoc.markdownToHwpx(
  '# 2026년 가온시 시민 정원 조성 계획\n\n- 추진 배경\n  - 도심 녹지 비율이 낮아 시민 쉼터가 모자람\n    - 동네마다 쉼터 1곳 이상 요구\n  - 빈 땅 12곳을 정원으로 바꿀 수 있음\n- 추진 계획\n  - 2026년 6곳, 2027년 6곳 조성\n  - 시민 정원사 40명 모집\n\n| 구분 | 2026년 | 2027년 |\n| --- | --- | --- |\n| 정원 | 6곳 | 6곳 |\n| 정원사 | 20명 | 20명 |\n',
  { gongmun: { preset: 'report', margins: { top: 18, bottom: 15, left: 22, right: 22 }, bodyPt: 14, lineSpacing: 170, bullet2: '◦', pageNumbers: true, fonts: { body: '휴먼명조' },
    levels: { 0: { font: 'HY견고딕', pt: 16, bold: true }, 1: { font: '휴먼명조', pt: 14, bold: false }, 2: { font: '휴먼명조', pt: 13 } } }, warnings: [] },
)));
// ── 내용 문서: 기안문 식 마크다운 · 글 파일 · 예제 PDF(받은 공문) ──
const md = join(FIX, '도서관 운영 개선 알림.md');
writeFileSync(md, '수신 내부결재\n\n제목 가온시립도서관 운영 개선 알림\n\n1. 관련: 가온시 문화과-210(2026. 9. 1.)\n\n2. 시민 의견을 반영하여 도서관 운영을 아래와 같이 바꿉니다.\n\n  가. 주말 운영: 18시까지에서 20시까지로\n\n  나. 어린이 자료실: 2층에서 1층으로 옮김\n\n3. 바뀐 운영은 2026. 11. 1.부터 시행합니다.\n\n붙임 운영 시간표 1부.  끝.\n');
const txt = join(FIX, '체육대회 회의 메모.txt');
writeFileSync(txt, '가온시 체육대회 준비 회의\n\n□ 회의 개요\n\nㅇ 일시: 2026. 10. 5.(월) 14:00\n\nㅇ 장소: 시청 3층 회의실\n\n□ 결정 사항\n\nㅇ 종목은 6개로 정함\n\n- 줄다리기, 계주 등 단체 종목 위주\n');
const pdf = join(FIX, '받은공문_도민체육대회 참가 협조 요청.pdf');
copyFileSync(join(SAMPLES, '1-받은공문_도민체육대회 참가 협조 요청.pdf'), pdf);

const ui = await openUi({ relay: RELAY, width: 1280, height: 860, prefs: { 'kordoc-first-run-done': true, 'kordoc-theme': 'light', 'kordoc-nav-collapsed': false } });
const { page } = ui;
try {
  for (const s of (await ui.call('style_list')).styles) await ui.call('style_delete', { id: s.id });

  await ui.click('새로 쓰기', { within: '.kd-nav' });
  await ui.click('우리 서식으로 맞추기', { within: '.kd-routes' });
  await ui.waitText('1. 맞출 서식 고르기');
  await ui.shot(join(OUT, '01-empty.png'));

  // 견본에서 서식 읽기
  await ui.dialog([[sample]]);
  await ui.click('견본 문서에서 서식 읽기');
  await ui.waitText('에서 읽은 서식', 60000);
  const facts = await page.evaluate(() => document.querySelector('.kd-inset dl')?.innerText ?? '');
  check('서식 내용: 여백 위 18 아래 15 왼쪽 22 오른쪽 22 (머리말 12.7)', /위 18 아래 15 왼쪽 22 오른쪽 22 mm\s+머리말·꼬리말\s+12.7 · 12.7 mm/.test(facts), facts.split('\n').slice(2, 4).join(' '));
  check('서식 내용: 본문 휴먼명조 14pt · 줄 간격 170%', facts.includes('휴먼명조 14pt') && facts.includes('줄 간격 170%'));
  check('서식 내용: 항목 기호 □ ◦ -', /□\s+◦\s+-/.test(facts));
  check('서식 내용: □ 단계 HY견고딕 16pt 굵게', facts.includes('HY견고딕 16pt 굵게'));
  check('서식 내용: 제목 상자 · 쪽 번호 있음', facts.includes('맨 위 제목 상자') && /쪽 번호\s+있음/.test(facts));
  // 미리보기 (rhwp 쪽 그림)
  const drawn = await page.waitForFunction(() => document.querySelector('.kd-draft-right img'), { timeout: 30000 }).then(() => true, () => false);
  check('미리보기 쪽 그림', drawn);
  await sleep(500);
  await ui.shot(join(OUT, '02-sample-read.png'));

  // 이 서식 저장
  const nameBox = await page.$('input[placeholder="예: 우리 과 기안문"]');
  await nameBox.evaluate((el) => el.select());
  await nameBox.type('가온시 보고서');
  await ui.click('이 서식 저장');
  await ui.waitText('서식을 저장했습니다');
  const saved = (await ui.call('style_list')).styles;
  check('저장한 서식 목록에 있음', saved.length === 1 && saved[0].name === '가온시 보고서', saved.map((s) => s.name).join(','));
  check('저장한 서식이 골라져 있음', await page.evaluate(() => document.querySelector('[role=radiogroup][aria-label="저장한 서식"] [aria-checked=true]')?.textContent.includes('가온시 보고서') ?? false));

  // 내용 문서 고르기
  await ui.dialog([[md, txt, pdf]]);
  await ui.click('파일 고르기', { within: '[data-drop="create-style"]' });
  await ui.waitText('체육대회 회의 메모.txt');
  await ui.shot(join(OUT, '03-files.png'));

  for (const w of [1280, 1024]) {
    await page.setViewport({ width: w, height: 860 });
    await sleep(400);
    const o = await ui.orphans('.kd-routes .kd-row-desc, .kd-draft-left p, .kd-draft-left dd, .kd-draft-left .kd-row-desc, .kd-actionbar-status');
    check(`외톨이 줄 0 @${w}`, o.length === 0, JSON.stringify(o));
    if (w === 1024) await ui.shot(join(OUT, '03b-files-1024.png'));
  }
  await page.setViewport({ width: 1280, height: 860 });
  const dash = await page.evaluate(() => /[—–]/.test(document.querySelector('.kd-compose')?.innerText ?? ''));
  check('화면 글에 줄표 없음', !dash);

  // 만들기
  await ui.click('우리 서식으로 만들기');
  await ui.waitText('3. 결과', 120000);
  await page.waitForFunction(() => !document.querySelector('.kd-actionbar [role=progressbar]'), { timeout: 120000 });
  const outs = [md, txt, pdf].map((p) => p.replace(/\.[^.]+$/, '_우리서식.hwpx'));
  check('결과 파일 3개 (원래 이름_우리서식.hwpx)', outs.every((p) => existsSync(p) && readFileSync(p).subarray(0, 2).toString() === 'PK'), outs.filter((p) => !existsSync(p)).join(', '));
  check('원본 그대로', [md, txt, pdf].every(existsSync));
  const back = await ui.call('style_extract', { path: outs[0] });
  check('결과 서식이 견본과 같음 (본문 줄 간격·□ 단계 글꼴)', back.format.body.line_spacing === 170 && back.format.levels[0]?.font === 'HY견고딕', `${back.format.body.line_spacing}% ${back.format.levels[0]?.font}`);
  await ui.shot(join(OUT, '04-results.png'));

  // PDF로 저장
  await ui.click('PDF로 저장', { within: '.kd-draft-left' });
  await ui.waitText('PDF 보기', 120000);
  check('결과 PDF 저장 (결과 옆, 설정 출력 폴더가 없을 때)', existsSync(outs[0].replace(/\.hwpx$/, '.pdf')), outs[0].replace(/\.hwpx$/, '.pdf'));
  await ui.shot(join(OUT, '05-pdf.png'));

  // 편집기에서 열기
  await ui.click('편집기에서 열기', { within: '.kd-draft-left' });
  const opened = await page.waitForFunction(() => document.querySelector('.kd-step[data-state="now"]')?.textContent.includes('편집'), { timeout: 60000 }).then(() => true, () => false);
  check('편집기에서 열기 → 편집 단계', opened);
  await sleep(4000);
  await ui.shot(join(OUT, '06-editor.png'));

  // 서무 도구
  await ui.click('서무 도구', { within: '.kd-nav' });
  await ui.click('우리 서식으로 맞추기', { within: '.kd-tasklist' });
  await ui.waitText('맞출 서식');
  for (const p of outs) rmSync(p, { force: true });
  await ui.dialog([[md, txt, pdf]]);
  await ui.click('파일 추가');
  await ui.waitText('체육대회 회의 메모.txt');
  await ui.shot(join(OUT, '07-batch.png'));
  await ui.click('시작');
  await ui.waitText('3개 완료', 120000);
  check('서무 도구: 3개 완료', outs.every(existsSync));
  for (const w of [1280, 1024]) {
    await page.setViewport({ width: w, height: 860 });
    await sleep(400);
    const o = await ui.orphans('.kd-batch-opts p, .kd-batch-opts dd, .kd-tasklist .kd-row-desc');
    check(`서무 도구 외톨이 줄 0 @${w}`, o.length === 0, JSON.stringify(o));
  }
  await page.setViewport({ width: 1280, height: 860 });
  await ui.shot(join(OUT, '08-batch-done.png'));
  check('화면 오류 없음', ui.errors.length === 0, ui.errors.slice(0, 3).join(' | '));
} finally {
  await ui.clearDialog().catch(() => undefined);
  await ui.close();
}
writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 통과`);
process.exit(failed.length ? 1 : 0);
