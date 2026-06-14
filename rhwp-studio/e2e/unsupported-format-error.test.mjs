/**
 * E2E 테스트: 미지원 문서 오류 알림 후 정상 문서 재로드
 *
 * Issue #1053: HWPML 2.1 같은 미지원 문서를 열 때 기존 사용자 알림
 * UI(상태 표시줄 + 토스트)로 오류를 보여주고, 내부 WASM 문서 상태를
 * 초기화하여 다음 정상 문서를 문제 없이 열 수 있어야 한다.
 */
import { runTest, loadHwpFile, waitForCanvas, screenshot, assert } from './helpers.mjs';

process.env.VITE_URL = process.env.VITE_URL || 'http://localhost:7700';

runTest('미지원 HWPML 오류 알림 후 정상 문서 로드', async ({ page }) => {
  const unsupportedLoadResult = await page.evaluate(async () => {
    const input = document.getElementById('file-input');
    if (!input) return { error: 'file-input not found' };

    const file = new File([
      '<?xml version="1.0" encoding="UTF-8"?>\n<HWPML Version="2.1"></HWPML>',
    ], 'unsupported-hwpml.hwp', { type: 'application/x-hwp' });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.dataset.skipUnsavedGuard = 'true';
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));

    await new Promise(resolve => setTimeout(resolve, 800));

    const statusText = document.getElementById('sb-message')?.textContent || '';
    const toastText = document.getElementById('rhwp-toast-container')?.textContent || '';
    const hasLoadedDocument = window.__wasm?.hasLoadedDocument?.() ?? null;
    return { statusText, toastText, hasLoadedDocument };
  });

  assert(!unsupportedLoadResult.error, unsupportedLoadResult.error || '미지원 파일 입력 이벤트 처리');
  assert(
    unsupportedLoadResult.statusText.includes('파일 로드 실패')
      && unsupportedLoadResult.statusText.includes('UNSUPPORTED_HWPML')
      && unsupportedLoadResult.statusText.includes('HWPML 2.1'),
    `상태 표시줄 오류 알림 (${unsupportedLoadResult.statusText})`,
  );
  assert(
    unsupportedLoadResult.toastText.includes('UNSUPPORTED_HWPML')
      && unsupportedLoadResult.toastText.includes('HWPML 2.1'),
    `토스트 오류 알림 (${unsupportedLoadResult.toastText})`,
  );
  assert(
    unsupportedLoadResult.hasLoadedDocument === false,
    `로드 실패 후 문서 상태 초기화 (${unsupportedLoadResult.hasLoadedDocument})`,
  );

  await screenshot(page, 'unsupported-format-error');

  const loadResult = await loadHwpFile(page, 'field-01.hwp');
  assert(loadResult.pageCount > 0, `오류 후 정상 HWP 로드 (${loadResult.pageCount}쪽)`);
  await waitForCanvas(page);
});
