/**
 * E2E 테스트 (Issue #1171): 사각형 글상자(Shape text_box) 안 picture
 *
 * samples/tac-img-02.hwp 의 섹션0 문단25(글상자 안 picture 2개)/문단44(1개) 검증:
 * 1. getPageControlLayout 에 글상자 picture 가 cellPath(sentinel) 로 노출 (Stage 1)
 * 2. findPictureAtClick 이 글상자 picture bbox 중심 클릭에서 picture 반환 (Stage 1+3 hit-test 진입)
 * 3. by_path API round-trip — getCellPicturePropertiesByPath/setCellPicturePropertiesByPath
 *    가 글상자 cellPath 로 속성 read/write (Stage 2 + bridge + insert.ts cellPath 형식, Stage 4)
 */
import { runTest, loadHwpFile, assert } from './helpers.mjs';

runTest('글상자 안 picture cellPath 노출 + 속성 round-trip (#1171)', async ({ page }) => {
  await loadHwpFile(page, 'tac-img-02.hwp');

  const result = await page.evaluate(async () => {
    const wasm = window.__wasm;
    const ih = window.__inputHandler;
    const pageCount = wasm.pageCount;

    // 1) 글상자 picture(paraIdx=25) 를 페이지 레이아웃에서 탐색
    let found = null;
    for (let p = 0; p < pageCount; p++) {
      let layout;
      try { layout = wasm.getPageControlLayout(p); } catch { continue; }
      for (const c of layout.controls || []) {
        if (c.type === 'image' && c.paraIdx === 25 && c.controlIdx === 0 && c.cellPath) {
          found = { page: p, ctrl: c };
          break;
        }
      }
      if (found) break;
    }
    if (!found) return { error: 'paraIdx=25 글상자 picture 를 controls 에서 못 찾음' };

    // 2) findPictureAtClick: bbox 중심 클릭
    const cx = found.ctrl.x + found.ctrl.w / 2;
    const cy = found.ctrl.y + found.ctrl.h / 2;
    const hit = ih.findPictureAtClick(found.page, cx, cy);

    // 3) by_path round-trip (insert.ts 재구성과 동일 cellPath 형식)
    const cellPath = [{ controlIdx: 0, cellIdx: 0, cellParaIdx: 0 }];
    const before = wasm.getCellPicturePropertiesByPath(0, 25, cellPath, 0);
    const w0 = before.width;
    wasm.setCellPicturePropertiesByPath(0, 25, cellPath, 0, { width: w0 + 5000 });
    const after = wasm.getCellPicturePropertiesByPath(0, 25, cellPath, 0);

    return {
      page: found.page,
      cellPath: found.ctrl.cellPath,
      hitType: hit?.type ?? null,
      hitHasCellPath: !!(hit && hit.cellPath),
      w0,
      w1: after.width,
    };
  });

  assert(!result.error, `검증 실패: ${result.error}`);
  console.log('결과:', JSON.stringify(result));

  // Stage 1: cellPath sentinel 노출
  assert(Array.isArray(result.cellPath) && result.cellPath.length === 1,
    `글상자 picture cellPath 비정상: ${JSON.stringify(result.cellPath)}`);
  assert(result.cellPath[0].cellIndex === 0,
    `글상자 sentinel(cellIndex=0) 아님: ${JSON.stringify(result.cellPath)}`);

  // Stage 1+3: findPictureAtClick 이 글상자 picture(cellPath 동반 image) 반환
  assert(result.hitType === 'image', `findPictureAtClick type=${result.hitType} (image 기대)`);
  assert(result.hitHasCellPath, 'findPictureAtClick 결과에 cellPath 부재 (hit-test 진입 실패)');

  // Stage 2+4: by_path 속성 round-trip
  assert(result.w0 > 0, `초기 width 비정상: ${result.w0}`);
  assert(result.w1 === result.w0 + 5000,
    `width 변경 미반영: ${result.w0} → ${result.w1} (기대 ${result.w0 + 5000})`);

  console.log('✅ #1171 글상자 picture: cellPath 노출 + hit-test + 속성 round-trip 통과');
});
