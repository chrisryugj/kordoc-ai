#!/usr/bin/env node
/**
 * README/데모용 렌더링 스크린샷 생성
 *
 * 사용법:
 *   cd rhwp-studio
 *   npx vite --host 0.0.0.0 --port 7700 &
 *   node e2e/gen-screenshot.mjs [--mode=host]
 *
 * 출력: assets/screenshots/render-example-1.png
 */

import { launchBrowser, closeBrowser, loadApp, loadHwpFile } from './helpers.mjs';
import { mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCREENSHOT_DIR = resolve(__dirname, '..', '..', 'assets', 'screenshots');

async function main() {
  const mode = process.argv.find(a => a.startsWith('--mode='))?.split('=')[1] || 'headless';

  console.log('=== 렌더링 스크린샷 생성 ===');
  console.log(`모드: ${mode}`);

  const browser = await launchBrowser(mode);
  const page = await browser.newPage();

  // 뷰포트 설정 (데스크톱 해상도)
  await page.setViewport({ width: 1200, height: 900 });

  try {
    // 앱 로드
    await loadApp(page);
    console.log('앱 로드 완료');

    // KTX.hwp 로드
    const result = await loadHwpFile(page, 'basic/KTX.hwp');
    console.log(`문서 로드 완료: ${result.pageCount}페이지`);

    // 렌더링 안정화 대기
    await page.evaluate(() => new Promise(r => setTimeout(r, 2000)));

    // 스크린샷 저장
    if (!existsSync(SCREENSHOT_DIR)) {
      mkdirSync(SCREENSHOT_DIR, { recursive: true });
    }

    const path = resolve(SCREENSHOT_DIR, 'render-example-1.png');
    await page.screenshot({ path, fullPage: false });
    console.log(`스크린샷 저장: ${path}`);

  } finally {
    await closeBrowser(browser, mode);
  }

  console.log('=== 완료 ===');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
