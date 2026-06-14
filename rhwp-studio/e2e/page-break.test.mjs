/**
 * E2E 테스트: biz_plan.hwp 강제 쪽 나누기
 * "5. 사업추진조직" 문단 앞에 쪽 나누기 삽입 후 페이지 재배치 확인
 */
import { runTest, loadHwpFile, screenshot, assert, getParaText } from './helpers.mjs';

runTest('강제 쪽 나누기 테스트', async ({ page }) => {
  // 1. 문서 로드
  console.log('[1] biz_plan.hwp 로드...');
  const { pageCount: beforePages } = await loadHwpFile(page, 'biz_plan.hwp');
  console.log(`  페이지 수: ${beforePages}`);
  assert(beforePages >= 3, `문서 로드 성공 (${beforePages}페이지)`);
  await screenshot(page, 'pb-01-loaded');

  // "5. 사업추진조직" = 문단 68 확인
  const paraText = await getParaText(page, 0, 68, 20);
  console.log(`  문단 68 텍스트: "${paraText}"`);
  assert(paraText?.includes('사업추진조직'), '문단 68 = "5. 사업추진조직"');

  const beforeRect = await page.evaluate(() => {
    try { return JSON.parse(window.__wasm?.doc.getCursorRect(0, 68, 0)); } catch { return null; }
  });
  console.log(`  삽입 전 문단 68 위치: page=${beforeRect?.pageIndex}, y=${beforeRect?.y?.toFixed(1)}`);

  // 2. 강제 쪽 나누기 삽입
  console.log('\n[2] 강제 쪽 나누기 삽입 (sec=0, para=68, offset=0)...');
  const breakResult = await page.evaluate(() => {
    try {
      const r = JSON.parse(window.__wasm?.doc.insertPageBreak(0, 68, 0));
      window.__eventBus?.emit('document-changed');
      return r;
    } catch (e) { return { error: e.message }; }
  });
  console.log(`  결과: ${JSON.stringify(breakResult)}`);
  await page.evaluate(() => new Promise(r => setTimeout(r, 1000)));
  await screenshot(page, 'pb-02-after-break');

  // 3. 페이지 수 확인
  const afterPages = await page.evaluate(() => window.__wasm?.pageCount ?? 0);
  console.log(`\n[3] 삽입 후 페이지 수: ${afterPages} (이전: ${beforePages})`);
  assert(afterPages > beforePages, `페이지 증가: ${beforePages} → ${afterPages}`);

  // "5. 사업추진조직"이 새 페이지로 이동했는지 확인 (문단 69로 밀림)
  const afterRect = await page.evaluate(() => {
    try { return JSON.parse(window.__wasm?.doc.getCursorRect(0, 69, 0)); } catch { return null; }
  });
  console.log(`  삽입 후 "5. 사업추진조직" (문단 69): page=${afterRect?.pageIndex}, y=${afterRect?.y?.toFixed(1)}`);
  if (beforeRect && afterRect) {
    assert(afterRect.pageIndex > beforeRect.pageIndex,
      `"사업추진조직"이 다음 페이지로 이동 (page ${beforeRect.pageIndex} → ${afterRect.pageIndex})`);
  }

  // 4. 후속 문단 위치 확인
  console.log('\n[4] 후속 문단 위치 확인...');
  const postPositions = await page.evaluate(() => {
    const results = [];
    for (let pi = 69; pi <= 75; pi++) {
      try {
        const r = JSON.parse(window.__wasm?.doc.getCursorRect(0, pi, 0));
        results.push({ pi, page: r.pageIndex, y: r.y.toFixed(1) });
      } catch (e) { results.push({ pi, err: e.message?.substring(0, 40) }); }
    }
    return results;
  });
  for (const p of postPositions) {
    console.log(`  문단 ${p.pi}: ${p.err ? 'ERR' : `page=${p.page} y=${p.y}`}`);
  }
  let prevPage = -1, orderOk = true;
  for (const p of postPositions) {
    if (p.err) continue;
    if (p.page < prevPage) { orderOk = false; break; }
    prevPage = p.page;
  }
  assert(orderOk, '후속 문단 페이지 순서 정상');
  await screenshot(page, 'pb-final');
});
