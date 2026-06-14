/**
 * E2E 테스트: 반응형 레이아웃 검증
 *
 * 데스크톱 / 태블릿 / 모바일 뷰포트에서 레이아웃을 확인한다.
 */
import { launchBrowser, loadApp, screenshot, closeBrowser, closePage, createPage, createNewDocument } from './helpers.mjs';
import { TestReporter } from './report-generator.mjs';

const VIEWPORTS = [
  { name: 'desktop', width: 1280, height: 900 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'mobile', width: 375, height: 812 },
  { name: 'mobile-landscape', width: 812, height: 375 },
];

async function run() {
  console.log('=== E2E: 반응형 레이아웃 테스트 ===\n');

  const browser = await launchBrowser();
  const reporter = new TestReporter('반응형 레이아웃 테스트');
  let passed = 0, failed = 0;

  const check = (tc, cond, msg) => {
    if (cond) { passed++; console.log(`  PASS: ${msg}`); reporter.pass(tc, msg); }
    else { failed++; console.error(`  FAIL: ${msg}`); reporter.fail(tc, msg); }
  };

  for (const vp of VIEWPORTS) {
    const tc = `${vp.name} (${vp.width}x${vp.height})`;
    console.log(`\n[${vp.name}] ${vp.width}x${vp.height}...`);

    const page = await createPage(browser, vp.width, vp.height);

    try {
      await loadApp(page);
      await page.evaluate(() => window.__eventBus?.emit('create-new-document'));
      await page.evaluate(() => new Promise(r => setTimeout(r, 1000)));

      // 기본 렌더링 확인
      const result = await page.evaluate((vpName) => {
        const canvas = document.querySelector('canvas');
        const menuBar = document.getElementById('menu-bar');
        const toolbar = document.getElementById('icon-toolbar');
        const styleBar = document.getElementById('style-bar');
        const statusBar = document.getElementById('status-bar');
        const editor = document.getElementById('editor-area');

        const isVisible = (el) => {
          if (!el) return false;
          const style = getComputedStyle(el);
          return style.display !== 'none' && style.visibility !== 'hidden' && el.offsetHeight > 0;
        };

        return {
          hasCanvas: !!canvas,
          canvasWidth: canvas?.offsetWidth ?? 0,
          canvasHeight: canvas?.offsetHeight ?? 0,
          menuBarVisible: isVisible(menuBar),
          menuBarHeight: menuBar?.offsetHeight ?? 0,
          toolbarVisible: isVisible(toolbar),
          toolbarHeight: toolbar?.offsetHeight ?? 0,
          styleBarVisible: isVisible(styleBar),
          styleBarHeight: styleBar?.offsetHeight ?? 0,
          statusBarVisible: isVisible(statusBar),
          editorVisible: isVisible(editor),
          pageCount: window.__wasm?.pageCount ?? 0,
        };
      }, vp.name);

      check(tc, result.hasCanvas, `캔버스 존재`);
      check(tc, result.editorVisible, `편집 영역 표시`);
      check(tc, result.pageCount >= 1, `페이지 수: ${result.pageCount}`);

      if (vp.name === 'desktop') {
        check(tc, result.menuBarVisible, `메뉴바 표시`);
        check(tc, result.toolbarVisible, `도구 상자 표시`);
        check(tc, result.styleBarVisible, `서식 도구 표시`);
        check(tc, result.statusBarVisible, `상태 표시줄 표시`);
      } else if (vp.name === 'tablet') {
        check(tc, result.menuBarVisible, `메뉴바 표시`);
        check(tc, result.toolbarHeight <= 44,
          `도구 상자 축소 또는 숨김 (h=${result.toolbarHeight})`);
        check(tc, result.styleBarVisible, `서식 도구 표시 (스크롤)`);
      } else if (vp.name === 'mobile') {
        check(tc, result.menuBarVisible, `메뉴바 표시`);
        check(tc, !result.toolbarVisible, `도구 상자 숨김`);
        check(tc, result.styleBarVisible, `서식 도구 표시 (터치)`);
        check(tc, result.statusBarVisible, `상태 표시줄 표시`);
      }

      console.log(`  Layout: menu=${result.menuBarHeight}px toolbar=${result.toolbarHeight}px style=${result.styleBarHeight}px`);

      await screenshot(page, `responsive-${vp.name}`);
      // reporter에 스크린샷 연결
      const tcResults = reporter.results.filter(r => r.tc === tc);
      if (tcResults.length > 0) tcResults[tcResults.length - 1].screenshot = `responsive-${vp.name}.png`;

    } catch (err) {
      console.error(`  ERROR: ${err.message}`);
      reporter.fail(tc, err.message);
      failed++;
    } finally {
      await closePage(page);
    }
  }

  console.log(`\n=== 결과: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exitCode = 1;

  reporter.generate('../output/e2e/responsive-report.html');
  await closeBrowser(browser);
}

run();
