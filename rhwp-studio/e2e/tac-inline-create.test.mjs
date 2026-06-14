/**
 * E2E 테스트: 빈 문서에서 인라인 TAC 표 직접 생성 (Issue #32)
 *
 * 한컴과 동일한 입력 순서:
 *   1. 텍스트 키보드 입력
 *   2. 인라인 표 삽입 (API)
 *   3. 커서가 표 뒤로 이동 → 키보드로 계속 입력
 *
 * 실행: node e2e/tac-inline-create.test.mjs [--mode=host|headless]
 */
import {
  runTest, createNewDocument, clickEditArea, screenshot, assert,
  moveCursorTo,
} from './helpers.mjs';

/** 렌더링 갱신 */
async function refresh(page) {
  await page.evaluate(() => {
    window.__eventBus?.emit?.('document-changed');
  });
  await page.evaluate(() => new Promise(r => setTimeout(r, 600)));
}

runTest('인라인 TAC 표 — 한컴 방식 입력', async ({ page }) => {
  // ── Step 0: 빈 문서 ──
  await createNewDocument(page);
  await clickEditArea(page);
  await screenshot(page, 'tac-build-00-blank');
  console.log('  Step 0: 빈 문서');

  // ── Step 1: 제목 입력 ──
  await page.keyboard.type('TC #20', { delay: 50 });
  await page.evaluate(() => new Promise(r => setTimeout(r, 300)));
  await screenshot(page, 'tac-build-01-title');
  console.log('  Step 1: "TC #20"');

  // ── Step 2: Enter ──
  await page.keyboard.press('Enter');
  await page.evaluate(() => new Promise(r => setTimeout(r, 300)));
  await screenshot(page, 'tac-build-02-enter');
  console.log('  Step 2: Enter');

  // ── Step 3: 표 앞 텍스트 + 공백 3개 ──
  await page.keyboard.type('tacglkj ', { delay: 40 });
  await page.keyboard.type('표 3 배치 시작', { delay: 60 });
  await page.keyboard.type('   ', { delay: 50 }); // 공백 3개
  await page.evaluate(() => new Promise(r => setTimeout(r, 300)));
  await screenshot(page, 'tac-build-03-before');
  console.log('  Step 3: "tacglkj 표 3 배치 시작"');

  // ── Step 4: 인라인 TAC 표 삽입 ──
  const tableResult = await page.evaluate(() => {
    const w = window.__wasm;
    const textLen = w.doc.getParagraphLength(0, 1);
    return JSON.parse(w.doc.createTableEx(JSON.stringify({
      sectionIdx: 0, paraIdx: 1, charOffset: textLen,
      rowCount: 2, colCount: 2,
      treatAsChar: true,
      colWidths: [6777, 6777],
    })));
  });
  assert(tableResult.ok, `createTableEx: ${JSON.stringify(tableResult)}`);
  console.log(`  Step 4: 인라인 표 삽입 (logicalOffset=${tableResult.logicalOffset})`);

  // 표 삽입 후 커서를 표 뒤로 이동
  // navigable_text_len = text_len(17) + 1(표) = 18 → charOffset=18
  {
    const navLen = await page.evaluate(() => {
      // navigateNextEditable를 사용하여 표를 건너뛴 위치 계산
      const w = window.__wasm;
      const textLen = w.doc.getParagraphLength(0, 1);
      // charOffset = textLen 에서 forward → 표를 건너뛴 charOffset 반환
      const navResult = JSON.parse(w.doc.navigateNextEditable(0, 1, textLen, 1, '[]'));
      return navResult;
    });
    console.log(`  커서 이동: navigateNextEditable → ${JSON.stringify(navLen)}`);
    if (navLen.type === 'text') {
      await moveCursorTo(page, 0, navLen.para ?? 1, navLen.charOffset ?? 18);
    }
  }
  await refresh(page);
  await screenshot(page, 'tac-build-04-table');

  // ── Step 5: 셀 텍스트 ──
  await page.evaluate((ci) => {
    const w = window.__wasm;
    w.doc.insertTextInCell(0, 1, ci, 0, 0, 0, '1');
    w.doc.insertTextInCell(0, 1, ci, 1, 0, 0, '2');
    w.doc.insertTextInCell(0, 1, ci, 2, 0, 0, '3 tacglkj');
    w.doc.insertTextInCell(0, 1, ci, 3, 0, 0, '4 tacglkj');
  }, tableResult.controlIdx);
  await refresh(page);
  await screenshot(page, 'tac-build-05-cells');
  console.log('  Step 5: 셀 텍스트');

  // ── Step 6: 표 뒤에서 키보드 입력 ──
  // 커서를 다시 표 뒤로 이동 (셀 입력으로 커서가 바뀌었을 수 있음)
  {
    const textLen = await page.evaluate(() => window.__wasm.doc.getParagraphLength(0, 1));
    // charOffset = textLen + 1 = 표 뒤 (insert_text_at이 컨트롤 뒤 처리)
    await moveCursorTo(page, 0, 1, textLen + 1);
  }
  // 공백 3개 + 텍스트
  await page.keyboard.type('   ', { delay: 50 }); // 공백 3개
  await page.keyboard.type('4 tacglkj ', { delay: 40 });
  await page.keyboard.type('표 다음', { delay: 60 });
  await page.evaluate(() => new Promise(r => setTimeout(r, 300)));
  await screenshot(page, 'tac-build-06-after');
  console.log('  Step 6: "4 tacglkj 표 다음" (표 뒤에서 키보드 입력)');

  // ── Step 7: Enter ──
  await page.keyboard.press('Enter');
  await page.evaluate(() => new Promise(r => setTimeout(r, 300)));
  await screenshot(page, 'tac-build-07-enter2');
  console.log('  Step 7: Enter');

  // ── Step 8: 마지막 줄 ──
  await page.keyboard.type('tacglkj ', { delay: 40 });
  await page.keyboard.type('가나 옮', { delay: 60 });
  await page.evaluate(() => new Promise(r => setTimeout(r, 300)));
  await screenshot(page, 'tac-build-08-done');
  console.log('  Step 8: "tacglkj 가나 옮"');

  // ── 최종 검증 ──
  const final_ = await page.evaluate(() => {
    const w = window.__wasm;
    const getText = (s, p) => {
      try { return w.doc.getTextRange(s, p, 0, w.doc.getParagraphLength(s, p)); }
      catch { return ''; }
    };
    return {
      pageCount: w.pageCount,
      paraCount: w.getParagraphCount(0),
      pi0: getText(0, 0),
      pi1: getText(0, 1),
      pi2: getText(0, 2),
    };
  });

  console.log(`\n  === 최종 결과 ===`);
  console.log(`  ${final_.pageCount}페이지, ${final_.paraCount}문단`);
  console.log(`  pi=0: "${final_.pi0}"`);
  console.log(`  pi=1: "${final_.pi1}"`);
  console.log(`  pi=2: "${final_.pi2}"`);

  assert(final_.pageCount === 1, `1페이지 예상`);
  assert(final_.pi1.includes('배치 시작'), `'배치 시작' 포함`);
  assert(final_.pi1.includes('표 다음'), `'표 다음' 포함`);

  // 텍스트 순서: "배치 시작" 뒤에 "4 tacglkj"
  const i1 = final_.pi1.indexOf('배치 시작');
  const i2 = final_.pi1.indexOf('4 tacglkj');
  assert(i1 >= 0 && i2 >= 0 && i1 < i2,
    `텍스트 순서: '배치 시작'(${i1}) < '4 tacglkj'(${i2})`);

  await screenshot(page, 'tac-build-09-final');
  console.log('\n  한컴 방식 인라인 TAC 표 E2E 완료 ✓');
});
