/**
 * E2E 테스트: 도형 인라인 컨트롤 — 커서 이동 및 텍스트 삽입
 *
 * 시나리오:
 * 1. 빈 문서에서 도형 3개(선, 사각형, 타원) 생성
 * 2. 커서 이동: 도형 사이를 좌/우 방향키로 이동
 * 3. 텍스트 삽입: 도형 사이에 스페이스 입력
 */
import { runTest, createNewDocument, screenshot } from './helpers.mjs';

runTest('도형 인라인 커서 이동 및 텍스트 삽입', async ({ page }) => {
  await createNewDocument(page);

  const getCursorPos = () => page.evaluate(() => {
    const ih = window.__inputHandler;
    if (!ih) return null;
    const pos = ih.getCursorPosition();
    return { sec: pos.sectionIndex, para: pos.paragraphIndex, offset: pos.charOffset };
  });

  const pos0 = await getCursorPos();
  console.log('초기 커서:', pos0);

  // 도형 3개 생성 (선, 사각형, 타원)
  for (const type of ['line', 'rectangle', 'ellipse']) {
    await page.evaluate((shapeType) => {
      const wasm = window.__wasm;
      if (!wasm) return;
      wasm.createShapeControl({
        sectionIdx: 0, paraIdx: 0, charOffset: 0,
        width: 7200, height: 3600,
        shapeType, textWrap: 'Inline',
      });
      window.__eventBus?.emit('document-changed');
    }, type);
    await page.evaluate(() => new Promise(r => setTimeout(r, 300)));
  }
  await screenshot(page, 'shape-inline-01-created');

  // Home 키로 문단 시작으로 이동
  await page.keyboard.press('Home');
  await page.evaluate(() => new Promise(r => setTimeout(r, 200)));
  const posHome = await getCursorPos();
  console.log('문단 시작 커서:', posHome);

  // ArrowRight 8번 → 도형 사이 이동 확인
  for (let i = 1; i <= 8; i++) {
    await page.keyboard.press('ArrowRight');
    await page.evaluate(() => new Promise(r => setTimeout(r, 100)));
    const p = await getCursorPos();
    console.log(`ArrowRight ${i}:`, p);
  }
  await screenshot(page, 'shape-inline-02-navigation');

  // Home → 스페이스 입력 (도형 앞에 텍스트 삽입)
  await page.keyboard.press('Home');
  await page.evaluate(() => new Promise(r => setTimeout(r, 200)));
  await page.keyboard.press('Space');
  await page.evaluate(() => new Promise(r => setTimeout(r, 300)));
  const posAfterSpace = await getCursorPos();
  console.log('스페이스 입력 후:', posAfterSpace);
  await screenshot(page, 'shape-inline-03-space');
});
