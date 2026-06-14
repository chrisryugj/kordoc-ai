/**
 * E2E 테스트 — 전역 단축키 (문서 미로드 상태)
 *
 * 검증: 문서가 없는 빈 상태에서 Alt+N → 새 문서 생성
 */
import { runTest, loadApp, screenshot, assert, getPageCount } from './helpers.mjs';

process.env.VITE_URL = process.env.VITE_URL || 'http://localhost:7700';

runTest('전역 단축키 — 빈 상태 Alt+N', async ({ page }) => {
  // 앱 로드만, 문서 생성 없음
  await loadApp(page);
  await page.evaluate(() => new Promise(r => setTimeout(r, 300)));

  // 문서 미로드 상태 확인
  const pageCountBefore = await page.evaluate(() => window.__wasm?.pageCount ?? 0);
  assert(pageCountBefore === 0, `TC1: 초기 상태 문서 없음 (pageCount=${pageCountBefore})`);
  await screenshot(page, 'global-01-empty');

  // Alt+N 입력 (편집 영역 클릭 없이)
  await page.keyboard.down('Alt');
  await page.keyboard.press('n');
  await page.keyboard.up('Alt');
  await page.evaluate(() => new Promise(r => setTimeout(r, 800)));

  // 새 문서 생성 확인
  const pageCountAfter = await page.evaluate(() => window.__wasm?.pageCount ?? 0);
  await screenshot(page, 'global-02-new-doc');
  assert(pageCountAfter >= 1, `TC2: Alt+N으로 새 문서 생성 (pageCount=${pageCountAfter})`);
});
