/**
 * E2E 테스트: footnote-01.hwp 각주 삽입 시 문단 위치 이상 확인
 *
 * 재현: footnote-01.hwp 로드 → "원료를" 뒤 커서 → 스페이스 입력 → 문단 y 위치 비교
 */
import { runTest, loadHwpFile, screenshot, assert } from './helpers.mjs';

/** 문단 0~6의 y 위치 수집 */
async function collectPositions(page) {
  return await page.evaluate(() => {
    const w = window.__wasm;
    if (!w) return null;
    const results = [];
    for (let pi = 0; pi <= 6; pi++) {
      try {
        const rect = JSON.parse(w.doc.getCursorRect(0, pi, 0));
        results.push({ para: pi, y: rect.y, pageIndex: rect.pageIndex });
      } catch (e) {
        results.push({ para: pi, error: e.message });
      }
    }
    return results;
  });
}

function printPositions(label, positions) {
  console.log(`  ${label} 문단 y 위치:`);
  for (const p of (positions || [])) {
    if (p.error) console.log(`    문단 ${p.para}: ERROR ${p.error}`);
    else console.log(`    문단 ${p.para}: y=${p.y.toFixed(1)}, page=${p.pageIndex}`);
  }
}

runTest('footnote-01.hwp 스페이스 입력 시 문단 위치 이상 확인', async ({ page }) => {
  // 1. 문서 로드
  console.log('[1] footnote-01.hwp 파일 로드...');
  const { pageCount } = await loadHwpFile(page, 'footnote-01.hwp');
  console.log(`  페이지 수: ${pageCount}`);
  assert(pageCount >= 1, '문서 로드 성공');
  await screenshot(page, 'fn-01-loaded');

  // 2. 삽입 전 문단 위치 수집
  console.log('\n[2] 삽입 전 문단 위치 수집...');
  const beforePositions = await collectPositions(page);
  printPositions('삽입 전', beforePositions);

  // 3. "원료를" 뒤에 커서 위치 (문단 3, charOffset=14)
  console.log('\n[3] "원료를" 뒤에 커서 위치...');
  const clickResult = await page.evaluate(() => {
    try {
      const rect = JSON.parse(window.__wasm.doc.getCursorRect(0, 3, 14));
      return { ...rect, charOffset: 14, paraIdx: 3 };
    } catch (e) { return { error: e.message }; }
  });
  console.log(`  커서 위치: ${JSON.stringify(clickResult)}`);

  if (clickResult && !clickResult.error) {
    const canvasBox = await (await page.$('#scroll-container canvas')).boundingBox();
    const zoom = await page.evaluate(() => window.__canvasView?.getZoom?.() ?? 1.0);
    const scrollY = await page.evaluate(() =>
      document.querySelector('#scroll-container')?.scrollTop ?? 0);
    const pageOffset = await page.evaluate((pi) =>
      window.__canvasView?.virtualScroll?.getPageOffset?.(pi) ?? 0, clickResult.pageIndex);
    const clickX = canvasBox.x + clickResult.x * zoom;
    const clickY = canvasBox.y + (pageOffset + clickResult.y) * zoom - scrollY;
    console.log(`  클릭 좌표: (${clickX.toFixed(1)}, ${clickY.toFixed(1)})`);
    await page.mouse.click(clickX, clickY);
    await page.evaluate(() => new Promise(r => setTimeout(r, 300)));
  }

  // 4. 스페이스 입력
  console.log('\n[4] 스페이스 입력...');
  await page.keyboard.press('Space');
  await page.evaluate(() => new Promise(r => setTimeout(r, 500)));
  await screenshot(page, 'fn-02-after-space');

  // 5. 삽입 후 문단 위치 수집 + 비교
  console.log('\n[5] 삽입 후 문단 위치 수집...');
  const afterPositions = await collectPositions(page);
  printPositions('삽입 후', afterPositions);

  console.log('\n[6] 위치 비교...');
  if (beforePositions && afterPositions) {
    for (let i = 0; i < Math.min(beforePositions.length, afterPositions.length); i++) {
      const b = beforePositions[i], a = afterPositions[i];
      if (b.error || a.error) continue;
      const diff = Math.abs(a.y - b.y);
      const status = diff > 50 ? 'ABNORMAL' : 'ok';
      console.log(`    문단 ${i}: before=${b.y.toFixed(1)} after=${a.y.toFixed(1)} diff=${diff.toFixed(1)} ${status}`);
      if (diff > 50) assert(false, `문단 ${i}의 y 위치가 비정상 변경 (${diff.toFixed(1)}px)`);
    }
  }
});
