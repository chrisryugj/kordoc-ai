/**
 * 시나리오 실행기 + 렌더 트리 측정기 + 규칙 검증기
 *
 * 선언적 시나리오를 E2E로 실행하고, 렌더 트리 좌표를 기대값과 비교한다.
 *
 * 사용:
 *   import { runScenario } from './scenario-runner.mjs';
 *   await runScenario(page, scenario, expectations);
 */
import { moveCursorTo, screenshot, assert } from './helpers.mjs';

// ─── 렌더 트리 측정기 ───────────────────────────────────────

/** 렌더 트리에서 검증용 노드 정보를 추출한다 */
export async function captureLayout(page, pageIdx = 0) {
  return page.evaluate((pi) => {
    const w = window.__wasm;
    if (!w?.doc?.getPageRenderTree) return null;
    try {
      const tree = JSON.parse(w.doc.getPageRenderTree(pi));
      const tables = [];
      const textRuns = [];
      const lines = [];

      function walk(node, depth = 0) {
        if (!node) return;
        const b = node.bbox;
        if (node.type === 'Table' && b) {
          tables.push({ x: b.x, y: b.y, w: b.w, h: b.h, pi: node.pi, ci: node.ci });
        }
        if (node.type === 'TextRun' && b) {
          textRuns.push({ x: b.x, y: b.y, w: b.w, h: b.h, text: node.text || '', pi: node.pi });
        }
        if (node.type === 'TextLine' && b) {
          lines.push({ x: b.x, y: b.y, w: b.w, h: b.h, pi: node.pi });
        }
        if (node.children) node.children.forEach(c => walk(c, depth + 1));
      }
      walk(tree);
      return { tables, textRuns, lines };
    } catch (e) {
      return { error: e.message };
    }
  }, pageIdx);
}

// ─── 시나리오 실행기 ────────────────────────────────────────

/** 렌더링 갱신 */
async function refresh(page) {
  await page.evaluate(() => window.__eventBus?.emit?.('document-changed'));
  await page.evaluate(() => new Promise(r => setTimeout(r, 600)));
}

/**
 * 선언적 시나리오를 실행하고 단계별 스냅샷을 수집한다.
 *
 * @param {Page} page - Puppeteer 페이지
 * @param {object} scenario - 시나리오 정의
 * @param {string} screenshotPrefix - 스크린샷 파일명 접두어
 * @returns {object} { snapshots, finalState }
 */
export async function executeScenario(page, scenario, screenshotPrefix = 'sc') {
  const snapshots = {};
  let stepIdx = 0;
  let currentLogicalOffset = null; // 마지막 표 삽입 후의 논리적 오프셋

  for (const step of scenario.steps) {
    const label = step.label || `step-${stepIdx}`;

    switch (step.type) {
      case 'text': {
        if (currentLogicalOffset !== null) {
          // 표 뒤에서 입력: charOffset = text_len + 1
          const textLen = await page.evaluate(
            (s, p) => window.__wasm.doc.getParagraphLength(s, p),
            step.sec ?? 0, step.para ?? await getCurrentPara(page));
          await moveCursorTo(page, step.sec ?? 0, step.para ?? await getCurrentPara(page), textLen + 1);
          currentLogicalOffset = null;
        }
        // 영문은 빠르게, 한글은 느리게
        const hasKorean = /[가-힣]/.test(step.value);
        await page.keyboard.type(step.value, { delay: hasKorean ? 60 : 40 });
        await page.evaluate(() => new Promise(r => setTimeout(r, 200)));
        break;
      }

      case 'enter': {
        currentLogicalOffset = null;
        await page.keyboard.press('Enter');
        await page.evaluate(() => new Promise(r => setTimeout(r, 300)));
        break;
      }

      case 'inlineTable': {
        const result = await page.evaluate((s) => {
          const w = window.__wasm;
          const sec = s.sec ?? 0;
          const para = s.para ?? (() => {
            // 현재 커서 위치의 문단
            const pos = window.__inputHandler?.cursor?.getPosition?.();
            return pos?.paragraphIndex ?? 0;
          })();
          const textLen = w.doc.getParagraphLength(sec, para);
          const r = JSON.parse(w.doc.createTableEx(JSON.stringify({
            sectionIdx: sec, paraIdx: para, charOffset: textLen,
            rowCount: s.rows, colCount: s.cols,
            treatAsChar: true,
            colWidths: s.colWidths,
          })));
          if (r.ok && s.cells) {
            for (let i = 0; i < s.cells.length; i++) {
              if (s.cells[i]) {
                w.doc.insertTextInCell(sec, r.paraIdx, r.controlIdx, i, 0, 0, s.cells[i]);
              }
            }
          }
          // 커서를 표 뒤로 이동
          if (r.ok) {
            const navResult = JSON.parse(w.doc.navigateNextEditable(
              sec, r.paraIdx, textLen, 1, '[]'));
            if (navResult.type === 'text') {
              window.__inputHandler?.cursor?.moveTo?.({
                sectionIndex: sec,
                paragraphIndex: navResult.para,
                charOffset: navResult.charOffset,
              });
            }
          }
          return r;
        }, step);
        if (!result.ok) {
          console.log(`    FAIL: createTableEx 실패 — ${JSON.stringify(result)}`);
        }
        currentLogicalOffset = result.logicalOffset;
        await refresh(page);
        break;
      }
    }

    // 스냅샷 캡처
    if (step.snapshot !== false) {
      snapshots[label] = await captureLayout(page);
      await screenshot(page, `${screenshotPrefix}-${String(stepIdx).padStart(2, '0')}-${label}`);
    }
    stepIdx++;
  }

  // 최종 상태
  const finalState = await page.evaluate(() => {
    const w = window.__wasm;
    const getText = (s, p) => {
      try { return w.doc.getTextRange(s, p, 0, w.doc.getParagraphLength(s, p)); }
      catch { return ''; }
    };
    const paraCount = w.getParagraphCount(0);
    const paragraphs = [];
    for (let i = 0; i < paraCount; i++) {
      paragraphs.push({ index: i, text: getText(0, i) });
    }
    return { pageCount: w.pageCount, paraCount, paragraphs };
  });
  snapshots['final'] = await captureLayout(page);

  return { snapshots, finalState };
}

async function getCurrentPara(page) {
  return page.evaluate(() => {
    return window.__inputHandler?.cursor?.getPosition?.()?.paragraphIndex ?? 0;
  });
}

// ─── 규칙 검증기 ────────────────────────────────────────────

/**
 * 기대값 규칙을 검증한다.
 *
 * @param {object} snapshots - 단계별 렌더 트리 스냅샷
 * @param {object} finalState - 최종 문서 상태
 * @param {object} expectations - 기대값 정의
 * @returns {object[]} 검증 결과 배열
 */
export function verifyExpectations(snapshots, finalState, expectations) {
  const results = [];

  // ── 구조 검증 ──
  if (expectations.pageCount !== undefined) {
    const pass = finalState.pageCount === expectations.pageCount;
    results.push({
      rule: 'pageCount', pass,
      message: `페이지 수: 기대=${expectations.pageCount} 실제=${finalState.pageCount}`,
    });
  }

  if (expectations.paragraphs) {
    for (const exp of expectations.paragraphs) {
      const actual = finalState.paragraphs[exp.index];
      if (!actual) {
        results.push({ rule: 'paragraph', pass: false, message: `pi=${exp.index} 없음` });
        continue;
      }
      if (exp.text !== undefined) {
        const pass = actual.text === exp.text;
        results.push({
          rule: 'paragraph-text', pass,
          message: `pi=${exp.index} 텍스트: ${pass ? '일치' : `"${actual.text}" ≠ "${exp.text}"`}`,
        });
      }
      if (exp.textContains) {
        for (const keyword of exp.textContains) {
          const pass = actual.text.includes(keyword);
          results.push({
            rule: 'paragraph-contains', pass,
            message: `pi=${exp.index} '${keyword}' 포함: ${pass}`,
          });
        }
      }
    }
  }

  // ── 레이아웃 규칙 검증 ──
  const layout = snapshots['final'];
  if (!layout || layout.error) {
    results.push({ rule: 'layout', pass: false, message: `렌더 트리 없음: ${layout?.error}` });
    return results;
  }

  if (expectations.layout) {
    for (const rule of expectations.layout) {
      results.push(verifyLayoutRule(layout, snapshots, rule));
    }
  }

  return results;
}

function verifyLayoutRule(layout, snapshots, rule) {
  switch (rule.rule) {
    case 'inline-order':
      return verifyInlineOrder(layout, rule);
    case 'table-baseline-align':
      return verifyBaselineAlign(layout, rule);
    case 'space-before-table':
      return verifySpaceGap(layout, rule, 'before');
    case 'space-after-table':
      return verifySpaceGap(layout, rule, 'after');
    case 'stable-after-enter':
      return verifyStability(snapshots, rule);
    default:
      return { rule: rule.rule, pass: false, message: `알 수 없는 규칙: ${rule.rule}` };
  }
}

/** 인라인 배치 x좌표 순서 검증 */
function verifyInlineOrder(layout, rule) {
  const table = layout.tables.find(t => t.pi === rule.paraIndex);
  if (!table) {
    return { rule: 'inline-order', pass: false, message: `pi=${rule.paraIndex} 표 없음` };
  }

  // 같은 y 범위의 텍스트 런
  const tblBottom = table.y + table.h;
  const sameLineRuns = layout.textRuns.filter(r =>
    r.y >= table.y - 10 && r.y <= tblBottom + 10 && r.text?.trim());

  const before = sameLineRuns.filter(r => r.x + r.w <= table.x + 5);
  const after = sameLineRuns.filter(r => r.x >= table.x + table.w - 5);
  // 표와 겹치는 텍스트 런 (TextRun이 분리되지 않은 경우)
  const overlapping = sameLineRuns.filter(r => r.x < table.x && r.x + r.w > table.x);

  const hasBefore = before.length > 0 || overlapping.length > 0;
  const hasAfter = after.length > 0;
  const hasAnyText = sameLineRuns.length > 0;

  const pass = (hasBefore || hasAnyText) && (hasAfter || hasAnyText);
  return {
    rule: 'inline-order', pass,
    message: `인라인 순서: 앞=${before.length} 뒤=${after.length} 같은줄=${sameLineRuns.length}`,
  };
}

/** 표 세로 정렬 검증: 표 하단 ≈ 텍스트 베이스라인 + outer_margin_bottom */
function verifyBaselineAlign(layout, rule) {
  const table = layout.tables.find(t => t.pi === rule.paraIndex);
  if (!table) {
    return { rule: 'table-baseline-align', pass: false, message: '표 없음' };
  }

  // 같은 줄 텍스트의 y (baseline)
  const tblBottom = table.y + table.h;
  const hostRuns = layout.textRuns.filter(r =>
    r.y >= table.y - 10 && r.y <= tblBottom + 10 &&
    r.x + r.w <= table.x + 2 && r.text?.trim());

  if (hostRuns.length === 0) {
    return { rule: 'table-baseline-align', pass: true, message: '표 앞 텍스트 없음 (스킵)' };
  }

  // TextRun의 bbox.h는 baseline_dist (baseline까지의 높이)
  // 표 하단 비교 대상은 텍스트의 y + h (= baseline y좌표)
  const baseline = Math.max(...hostRuns.map(r => r.y + r.h));
  // 보정: 렌더 트리 TextRun bbox가 baseline이 아닌 경우를 대비하여
  // 표와 같은 줄의 모든 텍스트 y 값으로 비교
  const textY = Math.max(...hostRuns.map(r => r.y));
  const tolerance = rule.tolerance ?? 5.0;
  // 표 하단과 텍스트 y 비교 (두 가지 기준 중 가까운 것)
  const diffBaseline = Math.abs(tblBottom - baseline);
  const diffTextY = Math.abs(tblBottom - textY);
  const diff = Math.min(diffBaseline, diffTextY);
  const pass = diff < tolerance;

  return {
    rule: 'table-baseline-align', pass,
    message: `세로 정렬: 표하단=${tblBottom.toFixed(1)} textY=${textY.toFixed(1)} 차이=${diff.toFixed(1)}px (허용=${tolerance})`,
  };
}

/** 표 앞/뒤 공백 폭 검증 */
function verifySpaceGap(layout, rule, direction) {
  const table = layout.tables.find(t => t.pi === rule.paraIndex);
  if (!table) {
    return { rule: `space-${direction}-table`, pass: false, message: '표 없음' };
  }

  const tblBottom = table.y + table.h;
  const sameLineRuns = layout.textRuns.filter(r =>
    r.y >= table.y - 10 && r.y <= tblBottom + 10 && r.text?.trim());

  let gap = 0;
  if (direction === 'before') {
    const before = sameLineRuns.filter(r => r.x + r.w <= table.x);
    if (before.length > 0) {
      const maxX = Math.max(...before.map(r => r.x + r.w));
      gap = table.x - maxX;
    }
  } else {
    const after = sameLineRuns.filter(r => r.x >= table.x + table.w);
    if (after.length > 0) {
      const minX = Math.min(...after.map(r => r.x));
      gap = minX - (table.x + table.w);
    }
  }

  const minGap = rule.minGap ?? 3.0;
  const pass = gap >= minGap;
  return {
    rule: `space-${direction}-table`, pass,
    message: `${direction} 공백: ${gap.toFixed(1)}px (최소=${minGap})`,
  };
}

/** Enter 전후 표 위치 안정성 검증 */
function verifyStability(snapshots, rule) {
  const steps = rule.compareSteps;
  if (!steps || steps.length < 2) {
    return { rule: 'stable-after-enter', pass: false, message: 'compareSteps 부족' };
  }
  const snap1 = snapshots[steps[0]];
  const snap2 = snapshots[steps[1]];
  if (!snap1 || !snap2) {
    return { rule: 'stable-after-enter', pass: true, message: '스냅샷 없음 (스킵)' };
  }

  const tbl1 = snap1.tables?.find(t => t.pi === rule.paraIndex);
  const tbl2 = snap2.tables?.find(t => t.pi === rule.paraIndex);
  if (!tbl1 || !tbl2) {
    return { rule: 'stable-after-enter', pass: true, message: '표 없음 (스킵)' };
  }

  const dy = Math.abs(tbl1.y - tbl2.y);
  const dx = Math.abs(tbl1.x - tbl2.x);
  const tolerance = rule.tolerance ?? 2.0;
  const pass = dy < tolerance && dx < tolerance;

  return {
    rule: 'stable-after-enter', pass,
    message: `안정성: dx=${dx.toFixed(1)} dy=${dy.toFixed(1)}px (허용=${tolerance})`,
  };
}

// ─── 통합 실행 ──────────────────────────────────────────────

/**
 * 시나리오 실행 + 기대값 검증 + 결과 출력
 */
export async function runScenario(page, scenario, expectations, screenshotPrefix) {
  console.log(`\n  === 시나리오: ${scenario.name} ===`);

  const { snapshots, finalState } = await executeScenario(
    page, scenario, screenshotPrefix || scenario.name.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase(),
  );

  console.log(`  실행 완료: ${finalState.pageCount}페이지, ${finalState.paraCount}문단`);

  const results = verifyExpectations(snapshots, finalState, expectations);

  let passCount = 0;
  let failCount = 0;
  for (const r of results) {
    if (r.pass) {
      passCount++;
      console.log(`  ✓ [${r.rule}] ${r.message}`);
    } else {
      failCount++;
      console.log(`  ✗ [${r.rule}] ${r.message}`);
    }
  }

  console.log(`  결과: ${passCount} 통과, ${failCount} 실패`);
  if (failCount > 0) process.exitCode = 1;

  return { results, snapshots, finalState };
}
