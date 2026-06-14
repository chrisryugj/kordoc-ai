/**
 * E2E 테스트: 조판 품질 검증 (문단부호 표시 상태)
 */
import {
  runTest, createNewDocument, clickEditArea, typeText,
  screenshot, assert, getPageCount,
} from './helpers.mjs';

runTest('조판 품질 검증 (문단부호 ON)', async ({ page }) => {
  await createNewDocument(page);

  // 1. 문단부호 켜기
  console.log('[1] 문단부호 켜기...');
  await page.evaluate(() => {
    window.__wasm?.setShowParagraphMarks(true);
    window.__eventBus?.emit('document-changed');
  });
  await page.evaluate(() => new Promise(r => setTimeout(r, 500)));
  await screenshot(page, 'ts-01-paramark-empty');

  await clickEditArea(page);

  // 2. 한 줄 텍스트
  console.log('\n[2] 한 줄 텍스트 + 문단부호...');
  await typeText(page, 'Hello World');
  await screenshot(page, 'ts-02-single-line');

  // 3. 자동 줄바꿈
  console.log('\n[3] 자동 줄바꿈 (긴 텍스트)...');
  const longText = 'The quick brown fox jumps over the lazy dog. ';
  for (let i = 0; i < 5; i++) await typeText(page, longText);
  await screenshot(page, 'ts-03-line-wrap');

  // 4. Enter 문단 분리
  console.log('\n[4] 문단 분리 (Enter 3회)...');
  await page.keyboard.press('Enter');
  await page.evaluate(() => new Promise(r => setTimeout(r, 100)));
  await typeText(page, 'Second paragraph with some text.');
  await page.keyboard.press('Enter');
  await page.evaluate(() => new Promise(r => setTimeout(r, 100)));
  await typeText(page, 'Third paragraph.');
  await screenshot(page, 'ts-04-multi-paragraph');

  // 5. 빈 줄 + 텍스트 교차
  console.log('\n[5] 빈 줄 + 텍스트 교차...');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await typeText(page, 'After two blank lines.');
  await page.keyboard.press('Enter');
  await typeText(page, 'Next line.');
  await screenshot(page, 'ts-05-blank-lines');

  // 6. 페이지 경계
  console.log('\n[6] 줄간격 + 페이지 경계...');
  for (let i = 0; i < 50; i++) await page.keyboard.press('Enter');
  await page.evaluate(() => new Promise(r => setTimeout(r, 500)));
  await typeText(page, 'Text on page 2.');
  const pageCount = await getPageCount(page);
  console.log(`  페이지 수: ${pageCount}`);
  assert(pageCount >= 2, `페이지 넘김 확인 (${pageCount}페이지)`);
  await screenshot(page, 'ts-06-page-boundary');

  // 7. 1페이지 상단 스크롤
  console.log('\n[7] 1페이지 상단 전체 뷰...');
  await page.evaluate(() => document.getElementById('scroll-container')?.scrollTo(0, 0));
  await page.evaluate(() => new Promise(r => setTimeout(r, 500)));
  await screenshot(page, 'ts-07-page1-top');

  // 8. 문단 병합
  console.log('\n[8] 문단 병합 후 조판 확인...');
  await page.keyboard.down('Control');
  await page.keyboard.press('Home');
  await page.keyboard.up('Control');
  await page.evaluate(() => new Promise(r => setTimeout(r, 300)));
  await page.keyboard.press('End');
  await page.keyboard.press('Delete');
  await page.evaluate(() => new Promise(r => setTimeout(r, 300)));
  await screenshot(page, 'ts-08-after-merge');

  console.log('\n=== 조판 검증 완료 ===');
});
