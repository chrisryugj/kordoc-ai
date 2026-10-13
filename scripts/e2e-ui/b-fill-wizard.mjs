/**
 * 양식 채우기 도우미(FillWizard) 화면 검증 (구현 B)
 *  - 표 머리 행 "항목 | 내용" 은 칸 목록에 없음
 *  - 머리 문구 "원본 모양은 그대로 두고 값만 넣습니다"
 *  - 값을 고치면 저절로 미리보기 반영 (미리보기 반영 단추 없음)
 *  - 넣은 곳(1번 표 3행 2열 칸) 표시, 누르면 미리보기에 상자로 짚음
 *  - HWPX 저장은 저장 창으로 (서식함 폴더에 몰래 쓰지 않음)
 *  들어가는 길: 작업대(문서)에서 예제 양식을 열고 고치기 › 양식 칸 채우기 도우미
 *
 * 사용: node scripts/e2e-ui/b-fill-wizard.mjs <결과 폴더> [중계기 주소]
 */
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { openUi, sleep, SAMPLES } from './ui-lib.mjs';

const OUT = process.argv[2] ?? join(process.cwd(), 'e2e-out-b');
const RELAY = process.argv[3] ?? 'http://127.0.0.1:7722';
mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`); };

const ui = await openUi({ relay: RELAY, width: 1280, height: 860 });
const { page } = ui;
try {
  // 작업대에서 예제 양식(표 칸 서식)을 열고 고치기 › 양식 칸 채우기 도우미
  await ui.click('문서', { within: '.kd-nav' });
  await sleep(500);
  await ui.dialog([[join(SAMPLES, '취합', '교육수요조사서_총무과.hwpx')]]);
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => x.offsetParent && /파일 (고르기|열기)/.test(x.textContent)); b?.click(); });
  await page.waitForFunction(() => [...document.querySelectorAll('button, [role=tab]')].some((b) => b.offsetParent && b.textContent.trim() === '고치기'), { timeout: 30000 });
  await ui.click('고치기', { exact: true });
  await ui.waitText('양식 칸 채우기 도우미', 30000);
  await ui.click('양식 칸 채우기 도우미');
  await page.waitForSelector('[data-kd-field="담당자"]', { timeout: 60000 });
  await page.waitForFunction(() => !!document.querySelector('.kd-preview svg'), { timeout: 60000 });

  const head = await page.evaluate(() => document.querySelector('[role=dialog] h2')?.parentElement?.innerText ?? '');
  check('머리 문구: 원본 모양은 그대로 두고 값만 넣습니다', head.includes('원본 모양은 그대로 두고 값만 넣습니다') && !head.includes('1바이트'), head.replace(/\n/g, ' / '));
  const fields = await page.evaluate(() => [...document.querySelectorAll('[data-kd-field]')].map((e) => e.getAttribute('data-kd-field')));
  check('표 머리 행 "항목" 은 칸 목록에 없음', !fields.includes('항목') && fields.includes('담당자'), fields.join(', '));
  const noButton = await page.evaluate(() => ![...document.querySelectorAll('[role=dialog] button')].some((b) => b.textContent.includes('미리보기 반영')));
  check('미리보기 반영 단추 없음 (저절로 반영)', noButton);

  // 값 고치기 → 0.7초 뒤 저절로 미리보기
  await page.click('[data-kd-field="담당자"]', { clickCount: 3 });
  await page.type('[data-kd-field="담당자"]', '홍길순');
  await page.waitForFunction(() => document.querySelector('[role=dialog]')?.innerText.includes('넣은 곳'), { timeout: 20000 });
  const place = await page.evaluate(() => [...document.querySelectorAll('[role=dialog] button')].find((b) => b.textContent.includes('넣은 곳'))?.textContent ?? '');
  check('넣은 곳 표시 (표 칸 좌표)', place.includes('1번 표 3행 2열 칸'), place);
  await page.waitForFunction(() => [...document.querySelectorAll('.kd-preview text')].some((t) => t.textContent === '순'), { timeout: 20000 });
  check('미리보기에 고친 값이 저절로 보임', true);

  await ui.click('넣은 곳', { within: '[role=dialog]' });
  await sleep(600);
  const hl = await page.evaluate(() => { const r = document.querySelector('.kd-preview [data-kd-hl]'); return r ? { w: +r.getAttribute('width'), h: +r.getAttribute('height') } : null; });
  check('넣은 곳을 누르면 미리보기에 상자로 짚음', !!hl && hl.w > 10 && hl.h > 5, JSON.stringify(hl));
  await ui.shot(join(OUT, '11-fill-wizard.png'));

  // 저장은 저장 창으로
  const target = join(OUT, `교육수요조사서_채움_${Date.now()}.hwpx`);
  await ui.dialog([target]);
  await ui.click('HWPX 저장', { within: '[role=dialog]' });
  await page.waitForFunction(() => document.querySelector('[role=dialog]')?.innerText.includes('저장 위치 열기'), { timeout: 30000 });
  check('HWPX 저장: 저장 창에서 고른 곳에', existsSync(target), target);
  await ui.shot(join(OUT, '12-fill-saved.png'));
  for (const w of [1280, 1024]) {
    await page.setViewport({ width: w, height: 860 });
    await sleep(300);
    const o = await ui.orphans('[role=dialog] p');
    check(`도우미 외톨이 줄 0 @${w}`, o.length === 0, JSON.stringify(o));
  }
} catch (e) {
  check('실행 오류 없음', false, String(e?.stack ?? e));
  await ui.shot(join(OUT, 'zz-fill-error.png')).catch(() => undefined);
} finally {
  await ui.clearDialog().catch(() => undefined);
  const pageErrors = ui.errors.filter((e) => !/favicon|ResizeObserver|\[CanvasView\]/.test(e));
  check('화면 오류 없음', pageErrors.length === 0, pageErrors.slice(0, 3).join(' / '));
  await ui.close();
  const fail = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - fail}/${results.length} 통과`);
  process.exitCode = fail ? 1 : 0;
}
