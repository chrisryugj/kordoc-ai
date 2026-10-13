/**
 * 명부로 여러 장 만들기 화면 검증 (구현 B)
 *  - 내 양식을 누르고 파일 고르기를 그만두면 조용히 되돌리지 않고 알린다
 *  - 돌리기 전에 명부 열 ↔ 양식 칸 짝 (기관 정보로 채울 칸, 양식에 없는 열 표시)
 *  - 줄마다 실패 이유, 파일 번호는 1부터, 기관 정보 채움
 *  - 이어서: 한 파일로 합치기 · 합본 PDF · 한꺼번에 인쇄(확인 한 번 더)
 *  - 맞는 열이 하나도 없으면 고칠 것을 알리고 빈 폴더를 만들지 않는다
 *
 * 사용: node scripts/e2e-ui/b-mailmerge.mjs <결과 폴더> [중계기 주소] [설정 출력 폴더]
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openUi, sleep } from './ui-lib.mjs';

const OUT = process.argv[2] ?? join(process.cwd(), 'e2e-out-b');
const RELAY = process.argv[3] ?? 'http://127.0.0.1:7722';
const SETTINGS_OUT = process.argv[4] ?? '';
mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`); };

// 가상의 명부 (마지막 줄은 양식에 들어갈 제목·시행일이 비어 실패해야 한다)
const stamp = Date.now();
const roster = join(OUT, `참가자명부_${stamp}.csv`);
writeFileSync(roster, '﻿제목,시행일,성명,비고\n체육대회 참가 안내,2026-10-20,김가온,1조\n교육 참석 안내,2026-10-21,이나래,2조\n,,박하늘,3조\n');
const bad = join(OUT, `안맞는명부_${stamp}.csv`);
writeFileSync(bad, '﻿이름,연락처\n김가온,01012345678\n');

// 기관 정보가 있어야 '내 기관 정보로 채우는 칸' 묶음이 나온다 (어떤 데이터 폴더에서 돌려도 같게)
await fetch(`${RELAY}/invoke`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cmd: 'sidecar_call', args: { method: 'update_settings', params: { settings: { org: { name: '가온시', dept: '행정지원과', person: '홍길동', phone: '031-000-0000' } } } } }) });
const ui = await openUi({ relay: RELAY, width: 1280, height: 900 });
const { page } = ui;
const mainText = () => page.evaluate(() => document.querySelector('.kd-batch-main')?.innerText ?? '');
try {
  await ui.click('서무 도구', { within: '.kd-nav' });
  await page.waitForFunction(() => [...document.querySelectorAll('.kd-taskitem')].some((b) => b.textContent.includes('명부로 여러 장')), { timeout: 20000 });
  await ui.click('명부로 여러 장 만들기', { within: '.kd-tasklist' });
  await ui.waitText('명부 고르기');

  // 내 양식 → 고르기 그만둠
  await ui.dialog([null]);
  await ui.click('내 양식', { exact: true, within: '.kd-batch-opts' });
  await sleep(600);
  check('내 양식 고르기를 그만두면 알린다', (await mainText()).includes('양식 파일을 고르지 않아 일반 기안문을 그대로 씁니다'));

  // 명부 고르기 → 짝 미리보기
  await ui.dialog([[roster]]);
  await ui.click('명부 고르기', { within: '.kd-batch-opts' });
  await page.waitForFunction(() => document.querySelector('.kd-batch-opts')?.innerText.includes('어느 열이 어느 칸에 들어가나'), { timeout: 30000 });
  const plan = await mainText();
  check('짝: 제목 칸 ← 명부 제목 열', /제목\s+명부 '제목' 열/.test(plan));
  check('짝: 기관 정보로 채우는 칸은 접혀 있음', plan.includes('내 기관 정보로 채우는 칸') && !/행정기관명\s+내 기관 정보/.test(plan));
  await ui.click('내 기관 정보로 채우는 칸', { within: '.kd-batch-opts' });
  check('짝: 펼치면 행정기관명 ← 내 기관 정보', /행정기관명\s+내 기관 정보 \(가온시\)/.test(await mainText()));
  check('짝: 양식에 없는 열 표시 (성명·비고)', plan.includes("쓰지 않는 명부 열: '성명', '비고'"));
  check('짝: 명부 3줄 → 문서 3장', plan.includes('명부 3줄 → 문서 3장'));
  await ui.shot(join(OUT, '21-mailmerge-plan.png'));
  for (const w of [1280, 1024]) {
    await page.setViewport({ width: w, height: 900 });
    await sleep(300);
    const o = await ui.orphans('.kd-batch-opts p, .kd-batch-opts .kd-note');
    check(`명부 옵션 외톨이 줄 0 @${w}`, o.length === 0, JSON.stringify(o));
  }
  await page.setViewport({ width: 1280, height: 900 });

  // 시작
  await page.evaluate(() => [...document.querySelectorAll('.kd-batch-opts button')].find((b) => b.textContent.includes('시작'))?.click());
  await page.waitForFunction(() => document.querySelector('.kd-batch-opts')?.innerText.includes('장을 만들었습니다'), { timeout: 60000 });
  const res = await mainText();
  check('결과: 2장, 1줄 실패', res.includes('2장을 만들었습니다. 1줄은 만들지 못했습니다'));
  check('줄마다 실패 이유', res.includes("명부 4행: 양식에 넣을 값이 비어 있습니다. 명부의 '제목', '시행일' 열에 값을 넣으세요."));
  if (SETTINGS_OUT) {
    const dir = readdirSync(SETTINGS_OUT).filter((d) => d.includes(`참가자명부_${stamp}`)).map((d) => join(SETTINGS_OUT, d))[0];
    const files = dir ? readdirSync(dir).sort() : [];
    check('파일 번호는 1부터', JSON.stringify(files) === JSON.stringify(['일반기안문_1.hwpx', '일반기안문_2.hwpx']), files.join(', '));
  }
  await ui.shot(join(OUT, '22-mailmerge-result.png'));

  // 이어서 할 일
  await ui.click('합본 PDF', { within: '.kd-batch-opts' });
  await page.waitForFunction(() => document.querySelector('.kd-batch-opts')?.innerText.includes('합본 PDF를 만들었습니다'), { timeout: 120000 });
  check('이어서: 합본 PDF', true);
  await ui.click('한 파일로 합치기', { within: '.kd-batch-opts' });
  await page.waitForFunction(() => document.querySelector('.kd-batch-opts')?.innerText.includes('한 파일로 합쳤습니다'), { timeout: 120000 });
  check('이어서: 한 파일로 합치기', true);
  await ui.click('한꺼번에 인쇄', { within: '.kd-batch-opts' });
  await sleep(400);
  const pr = await mainText();
  check('이어서: 한꺼번에 인쇄는 바로 보내지 않고 확인 (또는 프린터 없음 안내)', pr.includes('한 부씩 보냅니다') || pr.includes('연결된 프린터가 없습니다'));
  if (pr.includes('한 부씩 보냅니다')) await ui.click('취소', { exact: true, within: '.kd-batch-opts' });
  await ui.shot(join(OUT, '23-mailmerge-followups.png'));

  // 맞는 열이 하나도 없는 명부
  const before = SETTINGS_OUT ? readdirSync(SETTINGS_OUT).length : 0;
  await ui.dialog([[bad]]);
  await ui.click('명부 고르기', { within: '.kd-batch-opts' });
  await page.waitForFunction(() => document.querySelector('.kd-batch-opts')?.innerText.includes('하나도 맞지 않습니다'), { timeout: 30000 });
  check('안 맞는 명부: 돌리기 전에 짝 미리보기에서 알림', true);
  await page.evaluate(() => [...document.querySelectorAll('.kd-batch-opts button')].find((b) => b.textContent.includes('시작'))?.click());
  await page.waitForFunction(() => /하나도 맞지 않습니다.*고친 뒤 다시 하세요/.test(document.querySelector('.kd-batch-opts')?.innerText ?? ''), { timeout: 30000 });
  check('안 맞는 명부: 실행하면 고칠 것을 알리는 오류', true);
  if (SETTINGS_OUT) check('안 맞는 명부: 빈 폴더를 만들지 않음', readdirSync(SETTINGS_OUT).length === before);
  await ui.shot(join(OUT, '24-mailmerge-nomatch.png'));
} catch (e) {
  check('실행 오류 없음', false, String(e?.stack ?? e));
  await ui.shot(join(OUT, 'zz-mm-error.png')).catch(() => undefined);
} finally {
  await ui.clearDialog().catch(() => undefined);
  const pageErrors = ui.errors.filter((e) => !/favicon|ResizeObserver/.test(e));
  check('화면 오류 없음', pageErrors.length === 0, pageErrors.slice(0, 3).join(' / '));
  await ui.close();
  const fail = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - fail}/${results.length} 통과`);
  process.exitCode = fail ? 1 : 0;
}
