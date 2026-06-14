/**
 * E2E 테스트: shift-return.hwp Shift+End 블록 선택
 */
import { runTest, loadHwpFile, screenshot, assert } from './helpers.mjs';

runTest('Shift+End 블록 선택 테스트', async ({ page }) => {
  // 1. 문서 로드
  const { pageCount } = await loadHwpFile(page, 'shift-return.hwp');
  console.log(`  페이지 수: ${pageCount}`);
  await new Promise(r => setTimeout(r, 2000));

  // 2. 첫 번째 문단 시작 위치 클릭
  const canvas = await page.$('#scroll-container canvas');
  const box = await canvas.boundingBox();
  await page.mouse.click(box.x + 160, box.y + 135);
  await new Promise(r => setTimeout(r, 500));

  const cursorPos = await page.evaluate(() => {
    const ih = window.__inputHandler;
    return ih?.getCursorPosition?.() ?? null;
  });
  console.log(`커서 위치 (클릭 후): ${JSON.stringify(cursorPos)}`);

  // 3. cursor API 직접 호출로 Shift+End 시뮬레이션
  console.log('cursor API 직접 호출...');
  const lineInfo = await page.evaluate(() => {
    try { return window.__wasm?.doc.getLineInfo(0, 0, 0); } catch { return null; }
  });
  console.log(`getLineInfo(0,0,0): ${JSON.stringify(lineInfo)}`);

  const shiftEndResult = await page.evaluate(() => {
    const ih = window.__inputHandler;
    if (!ih) return { error: 'no inputHandler' };
    try {
      ih.handleShiftEnd?.();
      return {
        hasSelection: ih.hasSelection?.() ?? false,
        position: ih.getCursorPosition?.(),
      };
    } catch (e) { return { error: e.message }; }
  });
  console.log(`직접 호출 결과: ${JSON.stringify(shiftEndResult)}`);

  // 4. Shift+End 키 입력
  await page.keyboard.down('Shift');
  await page.keyboard.press('End');
  await page.keyboard.up('Shift');
  await new Promise(r => setTimeout(r, 300));

  const selState = await page.evaluate(() => {
    const ih = window.__inputHandler;
    return {
      hasSelection: ih?.hasSelection?.() ?? false,
      position: ih?.getCursorPosition?.(),
    };
  });
  console.log(`선택 상태 (Shift+End 후): ${JSON.stringify(selState)}`);

  const highlights = await page.evaluate(() =>
    document.querySelectorAll('.selection-highlight').length
  );
  console.log(`선택 하이라이트 수: ${highlights}`);
  await screenshot(page, 'shift-end-result');

  assert(selState.hasSelection, 'Shift+End 후 선택 상태여야 함');
  assert(highlights > 0, '선택 하이라이트가 표시되어야 함');
});
