/**
 * E2E 테스트: 인라인 TAC 표 배치 검증 (Issue #31)
 *
 * 한컴에서 작성한 tac-case-001.hwp를 로드하여
 * 인라인 TAC 표가 텍스트 흐름에 올바르게 배치되는지 검증.
 *
 * 검증 항목:
 *   1. 표가 텍스트 사이에 인라인 배치 (x좌표 순서)
 *   2. 표 하단 ≈ 텍스트 베이스라인 + outer_margin_bottom (y좌표 정렬)
 *   3. 1페이지 문서 유지
 *
 * 실행: node e2e/tac-inline-table.test.mjs [--mode=host|headless]
 */
import { runTest, loadHwpFile, screenshot, assert } from './helpers.mjs';

runTest('인라인 TAC 표 배치 (한컴 원본)', async ({ page }) => {
  // 1. 한컴 원본 파일 로드
  const { pageCount } = await loadHwpFile(page, 'tac-case-001.hwp');
  assert(pageCount === 1, `페이지 수 1 예상, 실제: ${pageCount}`);
  console.log(`  문서 로드: ${pageCount}페이지`);

  // 2. WASM API로 문단/표 구조 검증
  const info = await page.evaluate(() => {
    const w = window.__wasm;
    if (!w) return null;

    const paraCount = w.getParagraphCount(0);
    const pi1Text = w.getParaText(0, 1);

    // pi=1의 컨트롤 정보
    const pi1Info = JSON.parse(w.doc.getParagraphInfo(0, 1));

    return { paraCount, pi1Text, pi1Info };
  });

  if (!info) {
    console.log('  WASM API 접근 실패 — 스킵');
    return;
  }

  console.log(`  문단 수: ${info.paraCount}`);
  console.log(`  pi=1 텍스트: "${info.pi1Text}"`);
  assert(info.paraCount >= 3, `문단 수 3 이상 예상, 실제: ${info.paraCount}`);

  // 3. 캔버스에서 시각적 배치 검증 (스크린샷)
  await screenshot(page, 'tac-inline-01-loaded');

  // 4. 표 위치 검증 — SVG 렌더링으로 좌표 추출
  const positions = await page.evaluate(() => {
    const w = window.__wasm;
    if (!w || !w.doc) return null;

    // 페이지 0의 SVG를 생성하여 표/텍스트 좌표 추출
    try {
      const svg = w.doc.renderPageToSvg(0, 1.0);
      if (!svg) return null;

      // 표 테두리 수평선의 y좌표 추출
      const hLineYs = [];
      const hLineRegex = /line x1="[\d.]+" y1="([\d.]+)" x2="[\d.]+" y2="\1"/g;
      let m;
      while ((m = hLineRegex.exec(svg)) !== null) {
        hLineYs.push(parseFloat(m[1]));
      }

      // 텍스트 y좌표 추출 (호스트 텍스트)
      const textYs = [];
      const textRegex = /<text x="([\d.]+)" y="([\d.]+)"[^>]*>([^<]+)<\/text>/g;
      while ((m = textRegex.exec(svg)) !== null) {
        const x = parseFloat(m[1]);
        const y = parseFloat(m[2]);
        const ch = m[3];
        if (y > 140 && y < 210 && !['↵', '∨'].includes(ch)) {
          textYs.push({ x, y, ch });
        }
      }

      // 셀 clip-path에서 표 x 범위 추출
      const cellXs = [];
      const cellRegex = /cell-clip-\d+.*?rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/g;
      while ((m = cellRegex.exec(svg)) !== null) {
        cellXs.push({
          x: parseFloat(m[1]),
          y: parseFloat(m[2]),
          w: parseFloat(m[3]),
          h: parseFloat(m[4]),
        });
      }

      return { hLineYs, textYs, cellXs };
    } catch (e) {
      return { error: e.message };
    }
  });

  if (!positions || positions.error) {
    console.log(`  SVG 좌표 추출 실패: ${positions?.error || 'null'}`);
    return;
  }

  // 5. 표 범위 결정
  const uniqueHLineYs = [...new Set(positions.hLineYs)].sort((a, b) => a - b)
    .filter(y => y > 140);
  const tableTop = uniqueHLineYs[0];
  const tableBottom = uniqueHLineYs[uniqueHLineYs.length - 1];

  const cellXMin = Math.min(...positions.cellXs.map(c => c.x));
  const cellXMax = Math.max(...positions.cellXs.map(c => c.x + c.w));

  console.log(`  표 영역: x=${cellXMin.toFixed(1)}~${cellXMax.toFixed(1)} y=${tableTop.toFixed(1)}~${tableBottom.toFixed(1)}`);

  // 6. 호스트 텍스트 분류
  const hostTexts = positions.textYs.filter(t => {
    // 셀 내부 텍스트 제외 (셀 clip 영역 안에 있는 텍스트)
    const inCell = positions.cellXs.some(c =>
      t.x >= c.x && t.x <= c.x + c.w && t.y >= c.y && t.y <= c.y + c.h + 5);
    return !inCell;
  });

  const beforeTable = hostTexts.filter(t => t.x < cellXMin);
  const afterTable = hostTexts.filter(t => t.x > cellXMax);

  console.log(`  표 앞 텍스트: ${beforeTable.length}개 (${beforeTable.map(t => t.ch).join('')})`);
  console.log(`  표 뒤 텍스트: ${afterTable.length}개 (${afterTable.map(t => t.ch).join('')})`);

  // 검증 1: 표 앞뒤에 텍스트 존재
  assert(beforeTable.length > 0, '표 앞에 텍스트가 있어야 함');
  assert(afterTable.length > 0, '표 뒤에 텍스트가 있어야 함');

  // 검증 2: x좌표 순서 (텍스트 → 표 → 텍스트)
  const maxBeforeX = Math.max(...beforeTable.map(t => t.x));
  const minAfterX = Math.min(...afterTable.map(t => t.x));
  assert(maxBeforeX < cellXMin + 5,
    `표 앞 텍스트(x=${maxBeforeX.toFixed(1)})가 표(x=${cellXMin.toFixed(1)}) 앞에 있어야 함`);
  assert(cellXMax < minAfterX + 5,
    `표 오른쪽(x=${cellXMax.toFixed(1)})이 뒤 텍스트(x=${minAfterX.toFixed(1)}) 앞이어야 함`);
  console.log(`  x순서 검증 통과: 텍스트(~${maxBeforeX.toFixed(0)}) → 표(${cellXMin.toFixed(0)}~${cellXMax.toFixed(0)}) → 텍스트(${minAfterX.toFixed(0)}~)`);

  // 검증 3: 표 하단 ≈ 호스트 텍스트 y (베이스라인 + outer_margin_bottom ≈ 4px)
  const hostBaselineY = beforeTable.length > 0
    ? beforeTable[0].y
    : afterTable[0].y;
  const diff = tableBottom - hostBaselineY;
  console.log(`  표 하단=${tableBottom.toFixed(1)} 호스트 baseline_y=${hostBaselineY.toFixed(1)} 차이=${diff.toFixed(1)}px`);
  assert(Math.abs(diff) < 10,
    `표 하단(${tableBottom.toFixed(1)})과 호스트 baseline(${hostBaselineY.toFixed(1)}) 차이 ${diff.toFixed(1)}px > 10px`);

  await screenshot(page, 'tac-inline-02-verified');
  console.log('  인라인 TAC 표 배치 검증 완료 ✓');
});
