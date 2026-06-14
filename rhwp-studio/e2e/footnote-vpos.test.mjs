/**
 * E2E 테스트: footnote-01.hwp "원료를" 뒤 스페이스 입력 시 문단 위치 이상
 * WASM API 직접 호출로 정확한 재현
 */
import { runTest, loadHwpFile, screenshot, assert, getParaText } from './helpers.mjs';

/** 문단 0~10의 y 위치 수집 */
async function collectPositions(page) {
  return await page.evaluate(() => {
    const w = window.__wasm;
    const result = [];
    for (let pi = 0; pi <= 10; pi++) {
      try {
        const r = JSON.parse(w.doc.getCursorRect(0, pi, 0));
        result.push({ pi, y: r.y, page: r.pageIndex });
      } catch (e) {
        result.push({ pi, err: e.message?.substring(0, 60) });
      }
    }
    return result;
  });
}

function printPositions(positions) {
  for (const p of positions) {
    console.log(`  문단 ${p.pi}: ${p.err ? 'ERR ' + p.err : `y=${p.y?.toFixed(1)} page=${p.page}`}`);
  }
}

runTest('footnote-01 vpos 이상 테스트 (API 직접 호출)', async ({ page }) => {
  // 1. 문서 로드
  await loadHwpFile(page, 'footnote-01.hwp');
  await screenshot(page, 'vpos-01-loaded');

  // 2. 삽입 전 문단 위치
  console.log('[2] 삽입 전 문단 위치...');
  const before = await collectPositions(page);
  printPositions(before);

  const paraText = await getParaText(page, 0, 3, 100);
  console.log(`\n  문단 3 텍스트: "${paraText?.substring(0, 40)}..."`);

  // 3. WASM API로 스페이스 직접 삽입
  console.log('\n[3] WASM API로 스페이스 직접 삽입 (sec=0, para=3, offset=14)...');
  const insertResult = await page.evaluate(() => {
    try {
      const r = window.__wasm?.insertText(0, 3, 14, ' ');
      window.__eventBus?.emit('document-changed');
      return r;
    } catch (e) { return { error: e.message }; }
  });
  console.log(`  insertText 결과: ${JSON.stringify(insertResult)}`);
  await page.evaluate(() => new Promise(r => setTimeout(r, 1000)));
  await screenshot(page, 'vpos-02-after-space');

  // 4. 삽입 후 문단 위치
  console.log('\n[4] 삽입 후 문단 위치...');
  const after = await collectPositions(page);
  printPositions(after);

  // 5. 비교
  console.log('\n[5] 위치 비교...');
  let hasBug = false;
  for (let i = 0; i < Math.min(before.length, after.length); i++) {
    const b = before[i], a = after[i];
    if (b.err || a.err) continue;
    const diff = Math.abs(a.y - b.y);
    if (diff > 1) {
      const status = diff > 30 ? '** ABNORMAL **' : 'ok';
      console.log(`  문단 ${i}: ${b.y.toFixed(1)} → ${a.y.toFixed(1)} (diff=${diff.toFixed(1)}) ${status}`);
    }
    if (diff > 30) hasBug = true;
  }
  assert(!hasBug, '문단 위치 비정상 변경 없음');
  await screenshot(page, 'vpos-final');
});
