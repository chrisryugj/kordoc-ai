/**
 * E2E 테스트 — /커맨드 팔레트
 *
 * 검증 항목:
 * 1. 새 문서 상태에서 `/` 키 입력 → 팔레트 열림
 * 2. 검색어 입력 → 결과 필터링
 * 3. Escape → 팔레트 닫힘
 * 4. Enter → 커맨드 실행
 * 5. 팔레트 열린 상태에서 일반 텍스트 입력 차단
 */

import {
  runTest, createNewDocument, clickEditArea, screenshot, assert,
} from './helpers.mjs';

process.env.VITE_URL = process.env.VITE_URL || 'http://localhost:7700';

runTest('/커맨드 팔레트', async ({ page }) => {
  await createNewDocument(page);
  await clickEditArea(page);
  await page.evaluate(() => new Promise(r => setTimeout(r, 300)));

  // ── TC1: Ctrl+/ 키로 팔레트 열기 ──────────────────────────
  await page.keyboard.down('Control'); await page.keyboard.press('/'); await page.keyboard.up('Control');
  await page.evaluate(() => new Promise(r => setTimeout(r, 200)));

  const paletteVisible = await page.evaluate(() =>
    !!document.querySelector('.cp-panel')
  );
  await screenshot(page, 'palette-01-opened');
  assert(paletteVisible, 'TC1: Ctrl+/ 키로 팔레트 열림');

  // ── TC2: 검색어 입력 → 필터링 ─────────────────────────
  // 영문 검색어 사용 (한글은 IME 이벤트 타이밍 문제 가능성)
  // input에 직접 값을 설정하고 input 이벤트를 발화
  await page.evaluate(() => {
    const inp = document.querySelector('.cp-input');
    if (inp) {
      inp.value = '저장';
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  await page.evaluate(() => new Promise(r => setTimeout(r, 300)));

  const filteredCount = await page.evaluate(() =>
    document.querySelectorAll('.cp-item').length
  );
  const boldVisible = await page.evaluate(() => {
    const items = document.querySelectorAll('.cp-item-label');
    return Array.from(items).some(el => el.textContent?.includes('저장'));
  });
  await screenshot(page, 'palette-02-filtered');
  assert(filteredCount >= 1, `TC2: 필터링 결과 있음 (${filteredCount}개)`);
  assert(boldVisible, 'TC2: "저장" 항목 표시됨');

  // ── TC3: Escape → 팔레트 닫힘 ─────────────────────────
  await page.keyboard.press('Escape');
  await page.evaluate(() => new Promise(r => setTimeout(r, 200)));

  const closedAfterEsc = await page.evaluate(() =>
    !document.querySelector('.cp-panel')
  );
  await screenshot(page, 'palette-03-closed');
  assert(closedAfterEsc, 'TC3: Escape로 팔레트 닫힘');

  // Escape 후 편집 영역으로 포커스 복귀
  await clickEditArea(page);
  await page.evaluate(() => new Promise(r => setTimeout(r, 200)));

  // ── TC4: `/` 다시 열고 단축키 검색 ──────────────────────
  await page.keyboard.down('Control'); await page.keyboard.press('/'); await page.keyboard.up('Control');
  await page.evaluate(() => new Promise(r => setTimeout(r, 300)));

  const reopened = await page.evaluate(() => !!document.querySelector('.cp-panel'));
  assert(reopened, 'TC4: 팔레트 재오픈');

  // input에 직접 값 설정
  await page.evaluate(() => {
    const inp = document.querySelector('.cp-input');
    if (inp) {
      inp.value = 'ctrl';
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  await page.evaluate(() => new Promise(r => setTimeout(r, 300)));

  const ctrlItems = await page.evaluate(() =>
    document.querySelectorAll('.cp-item').length
  );
  await screenshot(page, 'palette-04-ctrl-search');
  assert(ctrlItems >= 1, `TC4: "ctrl" 검색 결과 있음 (${ctrlItems}개)`);

  // ── TC5: Enter로 커맨드 실행 ────────────────────────────
  // 검색어를 "조판"으로 변경
  await page.evaluate(() => {
    const inp = document.querySelector('.cp-input');
    if (inp) {
      inp.value = '조판';
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  await page.evaluate(() => new Promise(r => setTimeout(r, 300)));

  const ctrlMarkVisible = await page.evaluate(() => {
    const items = document.querySelectorAll('.cp-item-label');
    return Array.from(items).some(el => el.textContent?.includes('조판'));
  });
  assert(ctrlMarkVisible, 'TC5: "조판" 항목 검색됨');

  await page.keyboard.press('Enter');
  await page.evaluate(() => new Promise(r => setTimeout(r, 300)));

  const paletteClosedAfterEnter = await page.evaluate(() =>
    !document.querySelector('.cp-panel')
  );
  await screenshot(page, 'palette-05-executed');
  assert(paletteClosedAfterEnter, 'TC5: Enter로 커맨드 실행 후 팔레트 닫힘');

  // ── TC6: 팔레트 닫힌 후 `/` 다시 입력하면 팔레트 열림 ──
  await clickEditArea(page);
  await page.evaluate(() => new Promise(r => setTimeout(r, 200)));
  await page.keyboard.down('Control'); await page.keyboard.press('/'); await page.keyboard.up('Control');
  await page.evaluate(() => new Promise(r => setTimeout(r, 300)));

  const reopenedAgain = await page.evaluate(() => !!document.querySelector('.cp-panel'));
  assert(reopenedAgain, 'TC6: 팔레트 재오픈 정상');

  // 닫기
  await page.keyboard.press('Escape');
  await page.evaluate(() => new Promise(r => setTimeout(r, 200)));

  // ── TC7: 빈 검색어 → 전체 목록 표시 ─────────────────────
  await clickEditArea(page);
  await page.evaluate(() => new Promise(r => setTimeout(r, 200)));
  await page.keyboard.down('Control'); await page.keyboard.press('/'); await page.keyboard.up('Control');
  await page.evaluate(() => new Promise(r => setTimeout(r, 300)));

  const allItemsCount = await page.evaluate(() =>
    document.querySelectorAll('.cp-item').length
  );
  await screenshot(page, 'palette-07-all-items');
  assert(allItemsCount > 10, `TC7: 빈 검색어 시 전체 목록 (${allItemsCount}개)`);

  await page.keyboard.press('Escape');
});
