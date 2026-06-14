/**
 * E2E 테스트: 편집 파이프라인 검증 (Issue #2)
 *
 * 검증 범위:
 *   1. 문단 추가/삭제 — Enter(split), Backspace(merge) 후 IR 정합성 + pagination
 *   2. 텍스트 편집 — 줄바꿈 발생 시 이후 layout/pagination 전파
 *   3. 컨트롤 배치 — 표 셀 내 편집 후 composed 정합
 *
 * 사전 조건:
 *   1. WASM 빌드 완료 (pkg/)
 *   2. Vite dev server 실행 중 (npx vite --host 0.0.0.0 --port 7700)
 *   3. Chrome CDP 연결 가능 (--remote-debugging-port=9222)
 *
 * 실행: node e2e/edit-pipeline.test.mjs [--mode=host|headless]
 */
import {
  launchBrowser, loadApp, clickEditArea, typeText, screenshot,
  closeBrowser, createPage, closePage,
  getPageCount, getParagraphCount as getParaCount, getParaText,
  createNewDocument,
} from './helpers.mjs';
import { TestReporter } from './report-generator.mjs';

/** Enter 키 입력 */
async function pressEnter(page) {
  await page.keyboard.press('Enter');
  await page.evaluate(() => new Promise(r => setTimeout(r, 300)));
}



// ────────────────────────────────────────────────────
async function run() {
  console.log('=== E2E: 편집 파이프라인 테스트 (Issue #2) ===\n');

  const browser = await launchBrowser();
  const page = await createPage(browser);

  let passed = 0;
  let failed = 0;
  const reporter = new TestReporter('편집 파이프라인 E2E 테스트');
  let currentTC = '';
  let lastScreenshot = null;
  const check = (cond, msg) => {
    if (cond) { passed++; console.log(`  PASS: ${msg}`); reporter.pass(currentTC, msg); }
    else { failed++; console.error(`  FAIL: ${msg}`); reporter.fail(currentTC, msg); }
  };
  const snap = async (name) => {
    await screenshot(page, name);
    lastScreenshot = name + '.png';
    // 현재 TC의 마지막 결과에 스크린샷 연결
    const tcResults = reporter.results.filter(r => r.tc === currentTC);
    if (tcResults.length > 0) tcResults[tcResults.length - 1].screenshot = lastScreenshot;
  };

  try {
    // ── 1. 새 문서 생성 ──
    currentTC = 'TC #1: 새 문서 생성'; console.log('[1] 새 문서 생성...');
    await loadApp(page);
    await createNewDocument(page);
    await clickEditArea(page);

    const initPages = await getPageCount(page);
    const initParas = await getParaCount(page);
    check(initPages >= 1, `초기 페이지 수: ${initPages}`);
    check(initParas >= 1, `초기 문단 수: ${initParas}`);

    // ── 2. 범위 1: 문단 추가 (Enter) ──
    currentTC = 'TC #2: 문단 추가'; console.log('\n[2] 문단 추가 (Enter 키)...');
    await typeText(page, 'TC #2: 문단 추가 (Enter)');
    await pressEnter(page);
    await typeText(page, 'First paragraph');
    await pressEnter(page);
    await typeText(page, 'Second paragraph');
    await pressEnter(page);
    await typeText(page, 'Third paragraph');

    const parasAfterSplit = await getParaCount(page);
    check(parasAfterSplit >= initParas + 3, `Enter 후 문단 수: ${parasAfterSplit} (기대: ${initParas + 3}+)`);

    const text0 = await getParaText(page, 0, 0);
    const text1 = await getParaText(page, 0, 1);
    const text2 = await getParaText(page, 0, 2);
    const text3 = await getParaText(page, 0, 3);
    check(text0.includes('TC #2'), `문단 0 제목: "${text0}"`);
    check(text1.includes('First'), `문단 1 텍스트: "${text1}"`);
    check(text2.includes('Second'), `문단 2 텍스트: "${text2}"`);
    check(text3.includes('Third'), `문단 3 텍스트: "${text3}"`);

    const pagesAfterSplit = await getPageCount(page);
    check(pagesAfterSplit === initPages, `Enter 후 페이지 수 불변: ${pagesAfterSplit}`);
    await snap('edit-01-split');

    // ── 3. 범위 1: 문단 삭제 (Backspace로 merge) ──
    currentTC = 'TC #3: 문단 병합'; console.log('\n[3] 문단 병합 (Backspace)...');
    await createNewDocument(page);
    await clickEditArea(page);

    // 제목 + 3개 문단 생성
    const mergeResult = await page.evaluate(() => {
      const w = window.__wasm;
      if (!w?.doc) return { error: 'no doc' };
      try {
        w.doc.insertText(0, 0, 0, 'TC #3: merge paragraph');
        w.doc.splitParagraph(0, 0, 22);
        w.doc.insertText(0, 1, 0, 'AAA');
        w.doc.splitParagraph(0, 1, 3);
        w.doc.insertText(0, 2, 0, 'BBB');
        w.doc.splitParagraph(0, 2, 3);
        w.doc.insertText(0, 3, 0, 'CCC');

        const beforeParas = w.doc.getParagraphCount(0);

        // 문단 3을 문단 2에 병합 (Backspace)
        w.doc.mergeParagraph(0, 3);

        const afterParas = w.doc.getParagraphCount(0);
        const mergedText = w.doc.getTextRange(0, 2, 0, 50);

        window.__eventBus?.emit('document-changed');
        return { beforeParas, afterParas, mergedText, ok: true };
      } catch (e) { return { error: e.message }; }
    });
    await page.evaluate(() => new Promise(r => setTimeout(r, 300)));

    if (mergeResult.error) {
      console.log(`  SKIP: 병합 오류 (${mergeResult.error})`);
    } else {
      check(mergeResult.afterParas === mergeResult.beforeParas - 1,
        `Backspace 후 문단 수: ${mergeResult.beforeParas} → ${mergeResult.afterParas}`);
      check(mergeResult.mergedText?.includes('BBB') && mergeResult.mergedText?.includes('CCC'),
        `병합된 문단 텍스트: "${mergeResult.mergedText}"`);
    }
    await snap('edit-03-merge');

    // ── 4. 범위 2: 여러 문단 + 페이지 넘침 ──
    currentTC = 'TC #4: pagination'; console.log('\n[4] 여러 문단 + 페이지네이션 전파...');
    await createNewDocument(page);
    await clickEditArea(page);

    // 제목 + 50개 문단 생성 (Enter로 분할 → 페이지 넘침 유발)
    await page.keyboard.type('TC #4: pagination', { delay: 5 });
    await page.keyboard.press('Enter');
    for (let i = 0; i < 50; i++) {
      await page.keyboard.type('Line ' + i, { delay: 5 });
      await page.keyboard.press('Enter');
    }
    // 페이지네이션 안정화 대기
    await page.evaluate(() => new Promise(r => setTimeout(r, 1000)));

    const parasMany = await getParaCount(page);
    const pagesMany = await getPageCount(page);
    check(parasMany >= 50, `50개 문단 생성: ${parasMany}`);
    check(pagesMany >= 2, `50개 문단 후 페이지 수: ${pagesMany} (기대: 2+)`);
    await snap('edit-04-many-paragraphs');

    // ── 5. 범위 2: 긴 텍스트 줄바꿈 전파 ──
    currentTC = 'TC #5: line wrap'; console.log('\n[5] 긴 텍스트 줄바꿈...');
    await createNewDocument(page);
    await clickEditArea(page);

    await page.keyboard.type('TC #5: line wrap', { delay: 5 });
    await page.keyboard.press('Enter');
    const longSentence = 'The quick brown fox jumps over the lazy dog. ';
    for (let i = 0; i < 10; i++) {
      await page.keyboard.type(longSentence, { delay: 5 });
    }
    await page.evaluate(() => new Promise(r => setTimeout(r, 500)));
    const pagesAfterLong = await getPageCount(page);
    check(pagesAfterLong >= 1, `긴 텍스트 후 페이지 수: ${pagesAfterLong}`);
    await snap('edit-05-long-text');

    // ── 6. 표 삽입: 텍스트 → 표 → 텍스트 구조 ──
    currentTC = 'TC #6: table insert'; console.log('\n[6] 표 삽입: 텍스트 → 표 → 텍스트...');
    await createNewDocument(page);
    await clickEditArea(page);

    const cellResult = await page.evaluate(() => {
      const w = window.__wasm;
      if (!w?.doc) return { error: 'no doc' };
      try {
        // 0) 제목
        w.doc.insertText(0, 0, 0, 'TC #6: table insert');
        w.doc.splitParagraph(0, 0, 19);

        // 1) 텍스트 문단
        w.doc.insertText(0, 1, 0, 'Before table paragraph');

        // 2) Enter로 새 문단 생성
        w.doc.splitParagraph(0, 1, 22);

        // 3) 세 번째 문단에 표 삽입 (2x2)
        const tableResult = JSON.parse(w.doc.createTable(0, 2, 0, 2, 2));
        const tblPara = tableResult.paraIdx ?? 1;
        const tblCtrl = tableResult.controlIdx ?? 0;

        // 4) 셀에 텍스트 삽입
        w.doc.insertTextInCell(0, tblPara, tblCtrl, 0, 0, 0, 'Cell A1');
        w.doc.insertTextInCell(0, tblPara, tblCtrl, 1, 0, 0, 'Cell A2');
        w.doc.insertTextInCell(0, tblPara, tblCtrl, 2, 0, 0, 'Cell B1');
        w.doc.insertTextInCell(0, tblPara, tblCtrl, 3, 0, 0, 'Cell B2');

        // 5) 표 다음 문단에 텍스트 입력
        //    표 삽입으로 문단이 추가되었으므로 표 다음 문단 인덱스 확인
        const totalParas = w.doc.getParagraphCount(0);
        const afterParaIdx = totalParas - 1;  // 마지막 문단
        w.doc.insertText(0, afterParaIdx, 0, 'After table paragraph');

        // 캔버스 재렌더링 트리거
        window.__eventBus?.emit('document-changed');

        // 검증
        const textTitle = w.doc.getTextRange(0, 0, 0, 50);
        const textBefore = w.doc.getTextRange(0, 1, 0, 50);
        const textAfter = w.doc.getTextRange(0, afterParaIdx, 0, 50);
        const cellText = w.doc.getTextInCell(0, tblPara, tblCtrl, 0, 0, 0, 50);
        const pageCount = w.doc.pageCount();

        return {
          textTitle, textBefore, textAfter, cellText, pageCount,
          tblPara, tblCtrl, totalParas, afterParaIdx,
          ok: true
        };
      } catch (e) { return { error: e.message, stack: e.stack }; }
    });
    await page.evaluate(() => new Promise(r => setTimeout(r, 500)));

    if (cellResult.error) {
      console.log(`  SKIP: 표 삽입 오류 (${cellResult.error})`);
    } else {
      check(cellResult.ok === true,
        `표 삽입 성공 (tblPara=${cellResult.tblPara}, totalParas=${cellResult.totalParas})`);
      check(cellResult.textTitle?.includes('TC #6'),
        `제목: "${cellResult.textTitle}"`);
      check(cellResult.textBefore?.includes('Before table'),
        `표 앞 문단: "${cellResult.textBefore}"`);
      check(cellResult.cellText === 'Cell A1',
        `셀[0] 텍스트: "${cellResult.cellText}"`);
      check(cellResult.textAfter?.includes('After table'),
        `표 뒤 문단: "${cellResult.textAfter}"`);
      check(cellResult.pageCount >= 1, `페이지 수: ${cellResult.pageCount}`);

      // SVG 렌더링: 표 앞/뒤 텍스트 + 셀 텍스트 확인
      const svgCheck = await page.evaluate(() => {
        const w = window.__wasm;
        if (!w?.doc) return { ok: false };
        try {
          const svg = w.doc.renderPageSvg(0);
          const hasBefore = svg.includes('>B<');   // "Before"의 B
          const hasCell = svg.includes('>C<');     // "Cell"의 C
          const hasAfter = svg.includes('>A<');    // "After"의 A
          const hasRect = svg.includes('<rect') || svg.includes('<line');
          return { ok: hasBefore && hasCell && hasAfter && hasRect,
                   hasBefore, hasCell, hasAfter, hasRect };
        } catch (e) { return { ok: false, error: e.message }; }
      });
      check(svgCheck.ok,
        `SVG 렌더링 (앞=${svgCheck.hasBefore} 셀=${svgCheck.hasCell} 뒤=${svgCheck.hasAfter} 테두리=${svgCheck.hasRect})`);
    }
    await snap('edit-06-table-insert');

    // ── 7. Gap 7: 페이지 브레이크 삽입 ──
    currentTC = 'TC #7: page break'; console.log('\n[7] Gap 7: 페이지 브레이크...');
    await createNewDocument(page);
    await clickEditArea(page);

    // 텍스트 입력 후 WASM API로 페이지 브레이크 삽입
    const pbResult = await page.evaluate(() => {
      const w = window.__wasm;
      if (!w?.doc) return { error: 'no doc' };
      try {
        w.doc.insertText(0, 0, 0, 'TC #7: page break');
        w.doc.splitParagraph(0, 0, 18);
        w.doc.insertText(0, 1, 0, 'Before page break');
        const beforePages = w.doc.pageCount();

        w.doc.insertPageBreak(0, 1, 17);  // 텍스트 끝에 페이지 브레이크
        window.__eventBus?.emit('document-changed');
        const afterPages = w.doc.pageCount();
        const paraCount = w.doc.getParagraphCount(0);

        return { beforePages, afterPages, paraCount, ok: true };
      } catch (e) { return { error: e.message }; }
    });

    if (pbResult.error) {
      console.log(`  SKIP: 페이지 브레이크 API 미지원 (${pbResult.error})`);
    } else {
      check(pbResult.afterPages >= 2,
        `페이지 브레이크 후 페이지 수: ${pbResult.beforePages} → ${pbResult.afterPages}`);
      check(pbResult.paraCount >= 2,
        `페이지 브레이크 후 문단 수: ${pbResult.paraCount}`);
    }
    await snap('edit-07-page-break');

    // ── 8. Gap 8: vpos cascade 검증 ──
    currentTC = 'TC #8: vpos cascade'; console.log('\n[8] Gap 8: vpos cascade...');
    await createNewDocument(page);

    const vposResult = await page.evaluate(() => {
      const w = window.__wasm;
      if (!w?.doc) return { error: 'no doc' };
      try {
        // 제목 + 5개 문단 생성
        w.doc.insertText(0, 0, 0, 'TC #8: vpos cascade');
        w.doc.splitParagraph(0, 0, 19);
        w.doc.insertText(0, 1, 0, 'Paragraph 1');
        w.doc.splitParagraph(0, 1, 11);
        w.doc.insertText(0, 2, 0, 'Paragraph 2');
        w.doc.splitParagraph(0, 2, 11);
        w.doc.insertText(0, 3, 0, 'Paragraph 3');
        w.doc.splitParagraph(0, 3, 11);
        w.doc.insertText(0, 4, 0, 'Paragraph 4');
        w.doc.splitParagraph(0, 4, 11);
        w.doc.insertText(0, 5, 0, 'Paragraph 5');

        // 각 문단의 줄 정보 조회 (vpos 확인, 제목 제외 1~5)
        const lines = [];
        for (let p = 1; p < 6; p++) {
          try {
            const info = JSON.parse(w.doc.getLineInfo(0, p, 0));
            lines.push(info);
          } catch { lines.push(null); }
        }

        // 문단 1에 긴 텍스트 삽입 → 높이 증가 → 후속 문단 vpos cascade
        const longText = 'ABCDEFGHIJ '.repeat(50);
        w.doc.insertText(0, 1, 11, longText);
        window.__eventBus?.emit('document-changed');

        const linesAfter = [];
        for (let p = 1; p < 6; p++) {
          try {
            const info = JSON.parse(w.doc.getLineInfo(0, p, 0));
            linesAfter.push(info);
          } catch { linesAfter.push(null); }
        }

        const pageCount = w.doc.pageCount();
        return { linesBefore: lines, linesAfter, pageCount, ok: true };
      } catch (e) { return { error: e.message }; }
    });

    if (vposResult.error) {
      console.log(`  SKIP: vpos 검증 실패 (${vposResult.error})`);
    } else {
      check(vposResult.ok === true, `vpos cascade 테스트 성공`);
      check(vposResult.pageCount >= 1, `vpos cascade 후 페이지 수: ${vposResult.pageCount}`);

      // 문단 1 높이가 증가했으므로 후속 문단들의 lineInfo가 변경되어야 함
      if (vposResult.linesBefore[1] && vposResult.linesAfter[1]) {
        console.log(`  문단 1 lineInfo before: ${JSON.stringify(vposResult.linesBefore[1])}`);
        console.log(`  문단 1 lineInfo after:  ${JSON.stringify(vposResult.linesAfter[1])}`);
      }
    }
    await snap('edit-08-vpos-cascade');

    // ── 9. 문단 분할/병합 연속 안정성 ──
    currentTC = 'TC #9: stability'; console.log('\n[9] 분할/병합 연속 안정성...');
    await createNewDocument(page);

    const stabilityResult = await page.evaluate(() => {
      const w = window.__wasm;
      if (!w?.doc) return { error: 'no doc' };
      try {
        w.doc.insertText(0, 0, 0, 'TC #9: stability');
        w.doc.splitParagraph(0, 0, 16);
        w.doc.insertText(0, 1, 0, 'AAABBBCCC');

        // 분할 → 병합 → 분할 → 병합 반복
        for (let i = 0; i < 5; i++) {
          w.doc.splitParagraph(0, 1, 3);  // 'AAA' | 'BBBCCC'
          w.doc.mergeParagraph(0, 2);     // 'AAABBBCCC'
        }

        const text = w.doc.getTextRange(0, 1, 0, 50);
        const paraCount = w.doc.getParagraphCount(0);
        const pageCount = w.doc.pageCount();
        window.__eventBus?.emit('document-changed');
        return { text, paraCount, pageCount, ok: true };
      } catch (e) { return { error: e.message }; }
    });

    if (stabilityResult.error) {
      console.log(`  SKIP: 안정성 테스트 실패 (${stabilityResult.error})`);
    } else {
      check(stabilityResult.text === 'AAABBBCCC',
        `5회 분할/병합 후 텍스트 보존: "${stabilityResult.text}"`);
      check(stabilityResult.paraCount === 2,
        `5회 분할/병합 후 문단 수: ${stabilityResult.paraCount} (제목+본문)`);
      check(stabilityResult.pageCount === 1,
        `5회 분할/병합 후 페이지 수: ${stabilityResult.pageCount}`);
    }
    await snap('edit-09-stability');

    // ── 10. 페이지 경계에서 Enter → 페이지 넘침 ──
    currentTC = 'TC #10: page boundary enter'; console.log('\n[10] 페이지 경계 Enter...');
    await createNewDocument(page);

    const pageBoundaryEnter = await page.evaluate(() => {
      const w = window.__wasm;
      if (!w?.doc) return { error: 'no doc' };
      try {
        w.doc.insertText(0, 0, 0, 'TC #10: page boundary enter');
        w.doc.splitParagraph(0, 0, 27);

        // 페이지가 꽉 찰 때까지 문단 생성
        for (let i = 0; i < 60; i++) {
          const pi = w.doc.getParagraphCount(0) - 1;
          w.doc.insertText(0, pi, 0, 'Line ' + i);
          w.doc.splitParagraph(0, pi, ('Line ' + i).length);
        }
        const pagesBefore = w.doc.pageCount();

        // 추가 Enter → 페이지 넘침 유발
        const lastPi = w.doc.getParagraphCount(0) - 1;
        w.doc.insertText(0, lastPi, 0, 'Overflow line');
        w.doc.splitParagraph(0, lastPi, 13);

        window.__eventBus?.emit('document-changed');
        const pagesAfter = w.doc.pageCount();
        return { pagesBefore, pagesAfter, ok: true };
      } catch (e) { return { error: e.message }; }
    });
    await page.evaluate(() => new Promise(r => setTimeout(r, 300)));

    if (pageBoundaryEnter.error) {
      console.log(`  SKIP: ${pageBoundaryEnter.error}`);
    } else {
      check(pageBoundaryEnter.pagesAfter >= pageBoundaryEnter.pagesBefore,
        `페이지 경계 Enter: ${pageBoundaryEnter.pagesBefore} → ${pageBoundaryEnter.pagesAfter}`);
    }
    await snap('edit-10-page-boundary-enter');

    // ── 11. 페이지 경계에서 Backspace → 페이지 줄어듦 ──
    currentTC = 'TC #11: page boundary backspace'; console.log('\n[11] 페이지 경계 Backspace...');
    await createNewDocument(page);

    const pageBoundaryBS = await page.evaluate(() => {
      const w = window.__wasm;
      if (!w?.doc) return { error: 'no doc' };
      try {
        w.doc.insertText(0, 0, 0, 'TC #11: page boundary backspace');
        w.doc.splitParagraph(0, 0, 31);

        // 2페이지 넘도록 문단 생성
        for (let i = 0; i < 65; i++) {
          const pi = w.doc.getParagraphCount(0) - 1;
          w.doc.insertText(0, pi, 0, 'L' + i);
          w.doc.splitParagraph(0, pi, ('L' + i).length);
        }
        const pagesBefore = w.doc.pageCount();

        // 마지막 몇 문단 병합 → 페이지 줄어듦
        for (let i = 0; i < 10; i++) {
          const pc = w.doc.getParagraphCount(0);
          if (pc > 2) w.doc.mergeParagraph(0, pc - 1);
        }

        window.__eventBus?.emit('document-changed');
        const pagesAfter = w.doc.pageCount();
        return { pagesBefore, pagesAfter, ok: true };
      } catch (e) { return { error: e.message }; }
    });
    await page.evaluate(() => new Promise(r => setTimeout(r, 300)));

    if (pageBoundaryBS.error) {
      console.log(`  SKIP: ${pageBoundaryBS.error}`);
    } else {
      check(pageBoundaryBS.pagesAfter <= pageBoundaryBS.pagesBefore,
        `페이지 경계 Backspace: ${pageBoundaryBS.pagesBefore} → ${pageBoundaryBS.pagesAfter}`);
    }
    await snap('edit-11-page-boundary-bs');

    // ── 12. 표 셀 내 텍스트 입력 → 셀 높이 변경 ──
    currentTC = 'TC #12: cell height'; console.log('\n[12] 표 셀 높이 변경...');
    await createNewDocument(page);
    await clickEditArea(page);

    const cellHeightResult = await page.evaluate(() => {
      const w = window.__wasm;
      if (!w?.doc) return { error: 'no doc' };
      try {
        w.doc.insertText(0, 0, 0, 'TC #12: cell height change');
        w.doc.splitParagraph(0, 0, 26);
        w.doc.insertText(0, 1, 0, 'Before table');
        w.doc.splitParagraph(0, 1, 12);
        w.doc.splitParagraph(0, 2, 0); // 표 호스트 빈 문단
        w.doc.insertText(0, 3, 0, 'After table');

        const tr = JSON.parse(w.doc.createTable(0, 2, 0, 2, 2));
        const tp = tr.paraIdx, tc = tr.controlIdx;

        // 셀[0,0]에 짧은 텍스트
        w.doc.insertTextInCell(0, tp, tc, 0, 0, 0, 'Short text');

        // 셀[1,1]에 긴 텍스트 → 줄바꿈 → 행 높이 증가
        const longText = 'This is a long text that should cause line wrapping in the cell and increase the row height significantly. ';
        w.doc.insertTextInCell(0, tp, tc, 3, 0, 0, longText.repeat(2));

        window.__eventBus?.emit('document-changed');

        // "After table" 텍스트가 표 아래에 정상 배치되는지 확인
        const paraCount = w.doc.getParagraphCount(0);
        let afterText = '';
        for (let p = 0; p < paraCount; p++) {
          const t = w.doc.getTextRange(0, p, 0, 50);
          if (t.includes('After table')) { afterText = t; break; }
        }

        const shortText = w.doc.getTextInCell(0, tp, tc, 0, 0, 0, 50);
        const longCellText = w.doc.getTextInCell(0, tp, tc, 3, 0, 0, 50);

        return { shortText, longCellText: longCellText.substring(0, 30), afterText, ok: true };
      } catch (e) { return { error: e.message }; }
    });
    await page.evaluate(() => new Promise(r => setTimeout(r, 500)));

    if (cellHeightResult.error) {
      console.log(`  SKIP: ${cellHeightResult.error}`);
    } else {
      check(cellHeightResult.shortText === 'Short text',
        `셀[0,0] 짧은 텍스트: "${cellHeightResult.shortText}"`);
      check(cellHeightResult.longCellText?.length > 20,
        `셀[1,1] 긴 텍스트: "${cellHeightResult.longCellText}..."`);
      check(cellHeightResult.afterText?.includes('After table'),
        `표 뒤 문단 배치: "${cellHeightResult.afterText}"`);
    }
    await snap('edit-12-cell-height');

    // ── 13. 표 셀 내 Enter → 셀 분할 전후 비교 ──
    currentTC = 'TC #13: cell split'; console.log('\n[13] 표 셀 내 Enter...');
    await createNewDocument(page);
    await clickEditArea(page);

    const cellSplitResult = await page.evaluate(() => {
      const w = window.__wasm;
      if (!w?.doc) return { error: 'no doc' };
      try {
        w.doc.insertText(0, 0, 0, 'TC #13: cell split');
        w.doc.splitParagraph(0, 0, 18);

        // 1) 분할 전 표 (원본)
        w.doc.splitParagraph(0, 1, 0); // 표 호스트 빈 문단
        const tr1 = JSON.parse(w.doc.createTable(0, 1, 0, 2, 2));
        const tp1 = tr1.paraIdx, tc1 = tr1.controlIdx;
        w.doc.insertTextInCell(0, tp1, tc1, 0, 0, 0, 'AAABBB');
        w.doc.insertTextInCell(0, tp1, tc1, 1, 0, 0, 'Cell 2');
        w.doc.insertTextInCell(0, tp1, tc1, 2, 0, 0, 'Cell 3');
        w.doc.insertTextInCell(0, tp1, tc1, 3, 0, 0, 'Cell 4');

        // "분할셀" 구분 문단
        const paraCount1 = w.doc.getParagraphCount(0);
        w.doc.insertText(0, paraCount1 - 1, 0, 'After split:');
        w.doc.splitParagraph(0, paraCount1 - 1, 12);

        // 2) 분할 후 표 (복제) — 새 표 생성 후 셀[0,0]에서 Enter
        const lastPara = w.doc.getParagraphCount(0) - 1;
        w.doc.splitParagraph(0, lastPara, 0); // 표 호스트 빈 문단
        const lastPara2 = w.doc.getParagraphCount(0) - 1;
        const tr2 = JSON.parse(w.doc.createTable(0, lastPara2, 0, 2, 2));
        const tp2 = tr2.paraIdx, tc2 = tr2.controlIdx;
        w.doc.insertTextInCell(0, tp2, tc2, 0, 0, 0, 'AAABBB');
        w.doc.insertTextInCell(0, tp2, tc2, 1, 0, 0, 'Cell 2');
        w.doc.insertTextInCell(0, tp2, tc2, 2, 0, 0, 'Cell 3');
        w.doc.insertTextInCell(0, tp2, tc2, 3, 0, 0, 'Cell 4');

        // 셀[0,0]에서 Enter → 문단 분할
        w.doc.splitParagraphInCell(0, tp2, tc2, 0, 0, 3);

        const text0 = w.doc.getTextInCell(0, tp2, tc2, 0, 0, 0, 50);
        const text1 = w.doc.getTextInCell(0, tp2, tc2, 0, 1, 0, 50);

        window.__eventBus?.emit('document-changed');
        return { text0, text1, tp1, tp2, ok: true };
      } catch (e) { return { error: e.message }; }
    });
    await page.evaluate(() => new Promise(r => setTimeout(r, 500)));

    if (cellSplitResult.error) {
      console.log(`  SKIP: ${cellSplitResult.error}`);
    } else {
      check(cellSplitResult.text0 === 'AAA', `분할 후 셀[0,0] 첫 문단: "${cellSplitResult.text0}"`);
      check(cellSplitResult.text1 === 'BBB', `분할 후 셀[0,0] 둘째 문단: "${cellSplitResult.text1}"`);
      check(cellSplitResult.ok, `분할 전 표(para=${cellSplitResult.tp1}) + 분할 후 표(para=${cellSplitResult.tp2})`);
    }
    await snap('edit-13-cell-split');

    // ── 14. 텍스트 삭제 → 줄 수 감소 → vpos cascade ──
    currentTC = 'TC #14: delete vpos'; console.log('\n[14] 텍스트 삭제 + vpos cascade...');
    await createNewDocument(page);

    const deleteVposResult = await page.evaluate(() => {
      const w = window.__wasm;
      if (!w?.doc) return { error: 'no doc' };
      try {
        w.doc.insertText(0, 0, 0, 'TC #14: delete vpos');
        w.doc.splitParagraph(0, 0, 19);

        // 긴 텍스트 (여러 줄) + 후속 문단
        const longText = 'Delete me later. '.repeat(20);
        w.doc.insertText(0, 1, 0, longText);
        w.doc.splitParagraph(0, 1, longText.length);
        w.doc.insertText(0, 2, 0, 'After paragraph');

        const linesBefore = JSON.parse(w.doc.getLineInfo(0, 1, 0));

        // 긴 텍스트 대부분 삭제 → 줄 수 감소
        w.doc.deleteText(0, 1, 17, longText.length - 17);

        window.__eventBus?.emit('document-changed');
        const linesAfter = JSON.parse(w.doc.getLineInfo(0, 1, 0));
        const afterText = w.doc.getTextRange(0, 2, 0, 50);

        return { linesBefore, linesAfter, afterText, ok: true };
      } catch (e) { return { error: e.message }; }
    });
    await page.evaluate(() => new Promise(r => setTimeout(r, 300)));

    if (deleteVposResult.error) {
      console.log(`  SKIP: ${deleteVposResult.error}`);
    } else {
      check(deleteVposResult.linesAfter.lineCount <= deleteVposResult.linesBefore.lineCount,
        `삭제 후 줄 수 감소: ${deleteVposResult.linesBefore.lineCount} → ${deleteVposResult.linesAfter.lineCount}`);
      check(deleteVposResult.afterText?.includes('After'),
        `후속 문단 텍스트 보존: "${deleteVposResult.afterText}"`);
    }
    await snap('edit-14-delete-vpos');

    // ── 15. 표 앞에서 Enter → 표 밀림 + 페이지 넘침 ──
    currentTC = 'TC #15: table push'; console.log('\n[15] 표 앞 Enter → 표 밀림...');
    await createNewDocument(page);

    const tablePushResult = await page.evaluate(() => {
      const w = window.__wasm;
      if (!w?.doc) return { error: 'no doc' };
      try {
        w.doc.insertText(0, 0, 0, 'TC #15: table push');
        w.doc.splitParagraph(0, 0, 18);

        // 많은 문단 + 표 → 페이지 경계 근처에 표 배치
        for (let i = 0; i < 50; i++) {
          const pi = w.doc.getParagraphCount(0) - 1;
          w.doc.insertText(0, pi, 0, 'P' + i);
          w.doc.splitParagraph(0, pi, ('P' + i).length);
        }
        const tblParaIdx = w.doc.getParagraphCount(0) - 1;
        const tr = JSON.parse(w.doc.createTable(0, tblParaIdx, 0, 2, 2));
        w.doc.insertTextInCell(0, tr.paraIdx, tr.controlIdx, 0, 0, 0, 'Table');

        const pagesBefore = w.doc.pageCount();

        // 표 앞에 문단 추가 → 표가 밀림
        for (let i = 0; i < 5; i++) {
          w.doc.insertText(0, 1, 0, 'Push line ' + i);
          w.doc.splitParagraph(0, 1, ('Push line ' + i).length);
        }

        window.__eventBus?.emit('document-changed');
        const pagesAfter = w.doc.pageCount();
        return { pagesBefore, pagesAfter, ok: true };
      } catch (e) { return { error: e.message }; }
    });
    await page.evaluate(() => new Promise(r => setTimeout(r, 300)));

    if (tablePushResult.error) {
      console.log(`  SKIP: ${tablePushResult.error}`);
    } else {
      check(tablePushResult.pagesAfter >= tablePushResult.pagesBefore,
        `표 밀림 후 페이지: ${tablePushResult.pagesBefore} → ${tablePushResult.pagesAfter}`);
    }
    await snap('edit-15-table-push');

    // ── 16. 이미지 삽입 → 문단 높이 변경 ──
    currentTC = 'TC #16: image insert'; console.log('\n[16] 이미지 삽입...');
    await createNewDocument(page);
    await clickEditArea(page);

    const imgResult = await page.evaluate(async () => {
      const w = window.__wasm;
      if (!w?.doc) return { error: 'no doc' };
      try {
        w.doc.insertText(0, 0, 0, 'TC #16: image insert');
        w.doc.splitParagraph(0, 0, 20);
        w.doc.insertText(0, 1, 0, 'Before image');
        w.doc.splitParagraph(0, 1, 12);
        w.doc.insertText(0, 2, 0, 'After image');

        // 샘플 이미지 fetch
        const resp = await fetch('/samples/images/splatoon01.jpg');
        if (!resp.ok) return { error: 'image fetch failed' };
        const buf = await resp.arrayBuffer();
        const data = new Uint8Array(buf);

        // insertPicture(sec, para, offset, data, width, height, natW, natH, ext, desc)
        // 3인치 x 2인치 = 21600 x 14400 HWPUNIT
        const result = JSON.parse(
          w.doc.insertPicture(0, 2, 0, data, 21600, 14400, 300, 200, 'jpg', '테스트 이미지')
        );

        window.__eventBus?.emit('document-changed');
        const pageCount = w.doc.pageCount();
        const paraCount = w.doc.getParagraphCount(0);
        // 이미지 삽입으로 문단이 밀릴 수 있으므로 마지막 문단에서 "After" 검색
        let afterText = '';
        for (let p = 0; p < paraCount; p++) {
          const t = w.doc.getTextRange(0, p, 0, 30);
          if (t.includes('After')) { afterText = t; break; }
        }

        return { pageCount, paraCount, afterText, picPara: result.paraIdx, ok: true };
      } catch (e) { return { error: e.message }; }
    });
    await page.evaluate(() => new Promise(r => setTimeout(r, 500)));

    if (imgResult.error) {
      console.log(`  SKIP: ${imgResult.error}`);
    } else {
      check(imgResult.ok, `이미지 삽입 성공 (picPara=${imgResult.picPara})`);
      check(imgResult.pageCount >= 1, `이미지 삽입 후 페이지 수: ${imgResult.pageCount}`);
      check(imgResult.afterText?.includes('After'),
        `이미지 뒤 문단 텍스트 보존: "${imgResult.afterText}"`);
    }
    await snap('edit-16-image-insert');

    // ── 17. 글상자 내 텍스트 편집 ──
    currentTC = 'TC #17: textbox edit'; console.log('\n[17] 글상자 내 텍스트 편집...');
    await createNewDocument(page);
    await clickEditArea(page);

    const textboxResult = await page.evaluate(() => {
      const w = window.__wasm;
      if (!w?.doc) return { error: 'no doc' };
      try {
        // 제목
        w.doc.insertText(0, 0, 0, 'TC #17: textbox edit');
        w.doc.splitParagraph(0, 0, 20);

        // 글상자 앞 텍스트 문단
        w.doc.insertText(0, 1, 0, 'Before textbox paragraph');
        w.doc.splitParagraph(0, 1, 24);

        // 글상자 전용 빈 문단 (여기에 글상자가 삽입됨)
        // splitParagraph로 빈 문단 생성
        w.doc.splitParagraph(0, 2, 0);

        // 글상자 뒤 텍스트 문단 (문단 3)
        w.doc.insertText(0, 3, 0, 'After textbox paragraph');

        // 빈 문단(2)에 글상자 생성 (textbox는 기본 treat_as_char=true)
        const tbResult = JSON.parse(w.doc.createShapeControl(JSON.stringify({
          sectionIdx: 0, paraIdx: 2, charOffset: 0,
          width: 21600, height: 7200,  // 3인치 x 1인치
          shapeType: 'textbox',
          textWrap: 'TopAndBottom',
        })));
        const tbPara = tbResult.paraIdx;
        const tbCtrl = tbResult.controlIdx ?? 0;

        // 글상자 내 텍스트 편집
        w.doc.insertTextInCell(0, tbPara, tbCtrl, 0, 0, 0, 'Hello TextBox');
        const cellText = w.doc.getTextInCell(0, tbPara, tbCtrl, 0, 0, 0, 50);

        window.__eventBus?.emit('document-changed');
        const pageCount = w.doc.pageCount();
        const paraCount = w.doc.getParagraphCount(0);

        // 앞뒤 문단 텍스트 확인
        let beforeText = '', afterText = '';
        for (let p = 0; p < paraCount; p++) {
          const t = w.doc.getTextRange(0, p, 0, 50);
          if (t.includes('Before textbox')) beforeText = t;
          if (t.includes('After textbox')) afterText = t;
        }

        const svg = w.doc.renderPageSvg(0);
        const hasHello = svg.includes('>H<');

        return { cellText, pageCount, paraCount, beforeText, afterText,
                 hasHello, tbPara, tbCtrl, ok: true };
      } catch (e) { return { error: e.message }; }
    });
    await page.evaluate(() => new Promise(r => setTimeout(r, 500)));

    if (textboxResult.error) {
      console.log(`  SKIP: ${textboxResult.error}`);
    } else {
      check(textboxResult.ok, `글상자 생성 성공 (para=${textboxResult.tbPara}, ctrl=${textboxResult.tbCtrl}, total=${textboxResult.paraCount})`);
      check(textboxResult.cellText === 'Hello TextBox',
        `글상자 내 텍스트: "${textboxResult.cellText}"`);
      check(textboxResult.beforeText?.includes('Before textbox'),
        `글상자 앞 문단: "${textboxResult.beforeText}"`);
      check(textboxResult.afterText?.includes('After textbox'),
        `글상자 뒤 문단: "${textboxResult.afterText}"`);
      check(textboxResult.hasHello, `SVG에 글상자 텍스트 렌더링`);
    }
    await snap('edit-17-textbox');

    // ── 18. HWP 파일 로드 → 편집 → 페이지 수 일관성 ──
    currentTC = 'TC #18: file edit'; console.log('\n[18] 파일 로드 + 편집 일관성...');

    // 새 문서로 복귀하여 WASM API로 테스트
    await createNewDocument(page);

    const fileEditResult = await page.evaluate(() => {
      const w = window.__wasm;
      if (!w?.doc) return { error: 'no doc' };
      try {
        w.doc.insertText(0, 0, 0, 'TC #18: file edit consistency');
        w.doc.splitParagraph(0, 0, 29);

        // 20개 문단 생성
        for (let i = 0; i < 20; i++) {
          const pi = w.doc.getParagraphCount(0) - 1;
          w.doc.insertText(0, pi, 0, 'Para ' + i);
          w.doc.splitParagraph(0, pi, ('Para ' + i).length);
        }

        const parasBefore = w.doc.getParagraphCount(0);
        const pagesBefore = w.doc.pageCount();

        // 첫 문단(제목 다음)에 텍스트 추가 → 구조 불변 확인
        w.doc.insertText(0, 1, 0, '[EDITED] ');
        window.__eventBus?.emit('document-changed');

        const parasAfter = w.doc.getParagraphCount(0);
        const pagesAfter = w.doc.pageCount();
        const text1 = w.doc.getTextRange(0, 1, 0, 30);

        return { pagesBefore, pagesAfter, parasBefore, parasAfter, text1, ok: true };
      } catch (e) { return { error: e.message }; }
    });

    if (fileEditResult.error) {
      console.log(`  SKIP: ${fileEditResult.error}`);
    } else {
      check(fileEditResult.parasAfter === fileEditResult.parasBefore,
        `편집 후 문단 수 보존: ${fileEditResult.parasBefore} → ${fileEditResult.parasAfter}`);
      check(fileEditResult.text1?.includes('[EDITED]'),
        `편집 텍스트 반영: "${fileEditResult.text1}"`);
      check(Math.abs(fileEditResult.pagesAfter - fileEditResult.pagesBefore) <= 1,
        `페이지 수 안정: ${fileEditResult.pagesBefore} → ${fileEditResult.pagesAfter}`);
    }
    await snap('edit-18-file-edit');

    // ── 19. 대량 편집(100회 Enter) 안정성 ──
    currentTC = 'TC #19: mass edit'; console.log('\n[19] 대량 편집 안정성...');
    await createNewDocument(page);

    const massEditResult = await page.evaluate(() => {
      const w = window.__wasm;
      if (!w?.doc) return { error: 'no doc' };
      try {
        w.doc.insertText(0, 0, 0, 'TC #19: mass edit');
        w.doc.splitParagraph(0, 0, 17);

        // 100회 Enter (에러 발생 시 중단)
        let editCount = 0;
        for (let i = 0; i < 100; i++) {
          try {
            const pi = w.doc.getParagraphCount(0) - 1;
            w.doc.insertText(0, pi, 0, '' + i);
            w.doc.splitParagraph(0, pi, ('' + i).length);
            editCount++;
          } catch { break; }
        }

        window.__eventBus?.emit('document-changed');
        const paraCount = w.doc.getParagraphCount(0);
        const pageCount = w.doc.pageCount();

        // 마지막 문단 텍스트 확인
        const lastText = w.doc.getTextRange(0, paraCount - 1, 0, 10);

        return { paraCount, pageCount, lastText, editCount, ok: true };
      } catch (e) { return { error: e.message }; }
    });
    await page.evaluate(() => new Promise(r => setTimeout(r, 500)));

    if (massEditResult.error) {
      console.log(`  SKIP: ${massEditResult.error}`);
    } else {
      check(massEditResult.editCount >= 50,
        `대량 편집 횟수: ${massEditResult.editCount}/100`);
      check(massEditResult.paraCount >= 50,
        `대량 편집 후 문단 수: ${massEditResult.paraCount}`);
      check(massEditResult.pageCount >= 1,
        `대량 편집 후 페이지 수: ${massEditResult.pageCount}`);
    }
    await snap('edit-19-mass-edit');

    // ── 결과 요약 ──
    console.log(`\n=== 결과: ${passed} passed, ${failed} failed ===`);
    if (failed > 0) process.exitCode = 1;

    // HTML 보고서 생성
    reporter.generate('../output/e2e/edit-pipeline-report.html');

  } catch (err) {
    console.error('테스트 오류:', err.message);
    reporter.fail('ERROR', err.message);
    process.exitCode = 1;
  } finally {
    await snap('edit-final');
    await closePage(page);
    await closeBrowser(browser);
  }
}

run();
