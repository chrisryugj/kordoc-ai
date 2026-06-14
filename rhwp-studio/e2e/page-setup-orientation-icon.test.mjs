/**
 * E2E 테스트: 편집 용지 대화창의 용지 방향 아이콘 식별성
 *
 * Issue #1063: 세로/가로 라디오 카드의 SVG 가이드 아이콘이 실제 DOM 렌더
 * 비율에서도 서로 다른 방향으로 보이는지 확인한다.
 */
import { runTest, createNewDocument, clickEditArea, screenshot, assert } from './helpers.mjs';

process.env.VITE_URL = process.env.VITE_URL || 'http://localhost:7700';

runTest('편집 용지 방향 아이콘 비율', async ({ page }) => {
  await createNewDocument(page);
  await clickEditArea(page);

  await page.keyboard.press('F7');
  await page.waitForSelector('.modal-overlay .dialog-wrap .orient-icon-landscape', { timeout: 3000 });
  await screenshot(page, 'page-setup-orientation-icons');

  const paperValue = await page.evaluate(() => {
    const select = document.querySelectorAll('.modal-overlay .dialog-select')[0];
    return select ? select.value : null;
  });
  assert(paperValue === 'A4', `새 빈 문서의 용지 종류는 A4 (${paperValue})`);

  const metrics = await page.evaluate(() => {
    const portrait = document.querySelector('.orient-icon-portrait');
    const landscape = document.querySelector('.orient-icon-landscape');
    const portraitRect = portrait?.getBoundingClientRect();
    const landscapeRect = landscape?.getBoundingClientRect();
    return {
      portrait: portraitRect ? { width: portraitRect.width, height: portraitRect.height } : null,
      landscape: landscapeRect ? { width: landscapeRect.width, height: landscapeRect.height } : null,
    };
  });

  assert(!!metrics.portrait, '세로 방향 아이콘 존재');
  assert(!!metrics.landscape, '가로 방향 아이콘 존재');

  if (!metrics.portrait || !metrics.landscape) return;

  assert(
    metrics.portrait.height > metrics.portrait.width,
    `세로 아이콘은 height > width (${metrics.portrait.width}x${metrics.portrait.height})`,
  );
  assert(
    metrics.landscape.width > metrics.landscape.height,
    `가로 아이콘은 width > height (${metrics.landscape.width}x${metrics.landscape.height})`,
  );
  assert(
    metrics.landscape.width > metrics.portrait.width,
    `가로 아이콘 width가 세로 아이콘보다 큼 (${metrics.landscape.width} > ${metrics.portrait.width})`,
  );
  assert(
    metrics.portrait.height > metrics.landscape.height,
    `세로 아이콘 height가 가로 아이콘보다 큼 (${metrics.portrait.height} > ${metrics.landscape.height})`,
  );
});
