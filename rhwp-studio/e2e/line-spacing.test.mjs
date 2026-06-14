/**
 * E2E 테스트: 줄간격 변경에 따른 페이지 넘김 검증
 */
import {
  runTest, createNewDocument, clickEditArea, typeText,
  screenshot, assert, getPageCount, getParagraphCount,
} from './helpers.mjs';

runTest('줄간격별 페이지 넘김 검증', async ({ page }) => {
  await createNewDocument(page);
  await page.evaluate(() => {
    window.__wasm?.setShowParagraphMarks(true);
    window.__eventBus?.emit('document-changed');
  });
  await page.evaluate(() => new Promise(r => setTimeout(r, 300)));
  await clickEditArea(page);

  // [1] 다양한 줄간격 시각 비교
  console.log('[1] 다양한 줄간격 시각 비교 (160%, 300%, 100%)...');
  const line = 'The quick brown fox jumps over the lazy dog. ';
  for (let i = 0; i < 3; i++) await typeText(page, line);
  await page.keyboard.press('Enter');
  await page.evaluate(() => new Promise(r => setTimeout(r, 100)));
  await typeText(page, 'Second paragraph at 160%.');
  await page.keyboard.press('Enter');
  await page.evaluate(() => new Promise(r => setTimeout(r, 100)));

  // 300% 줄간격 문단
  let pc = await getParagraphCount(page);
  await page.evaluate((pi) => {
    window.__wasm?.applyParaFormat(0, pi, JSON.stringify({ lineSpacing: 300 }));
  }, pc - 1);
  await typeText(page, 'This paragraph has 300% line spacing.');
  await page.keyboard.press('Enter');
  await page.evaluate(() => new Promise(r => setTimeout(r, 100)));

  pc = await getParagraphCount(page);
  await page.evaluate((pi) => {
    window.__wasm?.applyParaFormat(0, pi, JSON.stringify({ lineSpacing: 300 }));
  }, pc - 1);
  await typeText(page, 'Another 300% spacing paragraph.');
  await page.keyboard.press('Enter');
  await page.evaluate(() => new Promise(r => setTimeout(r, 100)));

  // 100% 줄간격 문단
  pc = await getParagraphCount(page);
  await page.evaluate((pi) => {
    window.__wasm?.applyParaFormat(0, pi, JSON.stringify({ lineSpacing: 100 }));
  }, pc - 1);
  await typeText(page, 'Tight spacing at 100%. More text in tight spacing.');
  await page.evaluate(() => window.__eventBus?.emit('document-changed'));
  await page.evaluate(() => new Promise(r => setTimeout(r, 500)));
  await screenshot(page, 'ls-01-mixed-spacing');
  console.log('  160%, 300%, 100% 줄간격 혼합 문서 작성 완료');

  // [2] 300% 줄간격 대량 추가로 페이지 넘김
  console.log('\n[2] 300% 줄간격 대량 추가로 페이지 넘김...');
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press('Enter');
    pc = await getParagraphCount(page);
    await page.evaluate((pi) => {
      window.__wasm?.applyParaFormat(0, pi, JSON.stringify({ lineSpacing: 300 }));
    }, pc - 1);
    await typeText(page, `Wide spacing line ${i + 1}.`);
  }
  await page.evaluate(() => window.__eventBus?.emit('document-changed'));
  await page.evaluate(() => new Promise(r => setTimeout(r, 500)));
  const pageCount1 = await getPageCount(page);
  console.log(`  페이지 수: ${pageCount1}`);
  assert(pageCount1 >= 2, `300% 줄간격 페이지 넘김 (${pageCount1}페이지)`);
  await screenshot(page, 'ls-02-page-overflow');

  // [3] 1페이지 상단 전체 뷰
  console.log('\n[3] 1페이지 상단 전체 뷰...');
  await page.evaluate(() => document.getElementById('scroll-container')?.scrollTo(0, 0));
  await page.evaluate(() => new Promise(r => setTimeout(r, 500)));
  await screenshot(page, 'ls-03-page1-top');

  // [4] 새 문서: 줄간격 10%씩 점진 증가
  console.log('\n[4] 줄간격 10%씩 점진 증가 → 페이지 경계 검증...');
  await createNewDocument(page);
  await page.evaluate(() => {
    window.__wasm?.setShowParagraphMarks(true);
    window.__eventBus?.emit('document-changed');
  });
  await page.evaluate(() => new Promise(r => setTimeout(r, 300)));
  await clickEditArea(page);

  for (let i = 0; i < 25; i++) {
    await typeText(page, `Base line ${i + 1} at 160%.`);
    if (i < 24) {
      await page.keyboard.press('Enter');
      await page.evaluate(() => new Promise(r => setTimeout(r, 30)));
    }
  }
  await page.evaluate(() => window.__eventBus?.emit('document-changed'));
  await page.evaluate(() => new Promise(r => setTimeout(r, 300)));

  const pagesBefore = await getPageCount(page);
  console.log(`  160% 기본 25줄 후 페이지 수: ${pagesBefore}`);
  await screenshot(page, 'ls-04-before-increase');

  console.log('  중간 문단 줄간격 10%씩 증가 적용...');
  for (let i = 0; i < 11; i++) {
    const paraIdx = 10 + i;
    const spacing = 170 + (i * 10);
    await page.evaluate((pi, sp) => {
      window.__wasm?.applyParaFormat(0, pi, JSON.stringify({ lineSpacing: sp }));
    }, paraIdx, spacing);
  }
  await page.evaluate(() => window.__eventBus?.emit('document-changed'));
  await page.evaluate(() => new Promise(r => setTimeout(r, 500)));
  const pagesAfter = await getPageCount(page);
  console.log(`  줄간격 증가 후 페이지 수: ${pagesAfter}`);
  assert(pagesAfter >= pagesBefore, `줄간격 증가 후 페이지 수 증가 (${pagesBefore} → ${pagesAfter})`);
  await page.evaluate(() => document.getElementById('scroll-container')?.scrollTo(0, 0));
  await page.evaluate(() => new Promise(r => setTimeout(r, 500)));
  await screenshot(page, 'ls-05-after-increase');
  assert(await page.evaluate(() => document.querySelectorAll('#scroll-container canvas').length) >= 1, '페이지 0 캔버스 존재');

  // [5] 추가 Enter로 페이지 경계 돌파
  console.log('\n[5] 줄간격 증가 상태에서 Enter로 페이지 경계 테스트...');
  await page.keyboard.down('Control');
  await page.keyboard.press('End');
  await page.keyboard.up('Control');
  await page.evaluate(() => new Promise(r => setTimeout(r, 200)));

  const pagesBeforeEnter = await getPageCount(page);
  for (let i = 0; i < 15; i++) {
    await page.keyboard.press('Enter');
    pc = await getParagraphCount(page);
    await page.evaluate((pi) => {
      window.__wasm?.applyParaFormat(0, pi, JSON.stringify({ lineSpacing: 300 }));
    }, pc - 1);
    await typeText(page, `Extra wide line ${i + 1}.`);
  }
  await page.evaluate(() => window.__eventBus?.emit('document-changed'));
  await page.evaluate(() => new Promise(r => setTimeout(r, 500)));
  const pagesAfterEnter = await getPageCount(page);
  console.log(`  Enter 추가 전: ${pagesBeforeEnter}페이지 → 후: ${pagesAfterEnter}페이지`);
  assert(pagesAfterEnter > pagesBeforeEnter, `추가 Enter 후 페이지 증가 (${pagesBeforeEnter} → ${pagesAfterEnter})`);
  await screenshot(page, 'ls-06-boundary-push');

  console.log('\n=== 줄간격 검증 완료 ===');
});
