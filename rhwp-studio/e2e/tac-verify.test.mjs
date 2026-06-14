/**
 * E2E 자동 검증: 인라인 TAC 표 조판 (Issue #33)
 *
 * 선언적 시나리오 → 자동 실행 → 규칙 기반 검증
 *
 * 실행: node e2e/tac-verify.test.mjs [--mode=host|headless]
 */
import { runTest, createNewDocument, clickEditArea } from './helpers.mjs';
import { runScenario } from './scenario-runner.mjs';

// ─── 시나리오 1: 인라인 TAC 표 기본 ────────────────────────

const scenario1 = {
  name: 'TC-V01: 인라인 TAC 표 기본',
  steps: [
    { type: 'text', value: 'TC #20', label: 'title' },
    { type: 'enter', label: 'enter1' },
    { type: 'text', value: 'tacglkj 표 3 배치 시작   ', label: 'before-text' },
    { type: 'inlineTable', rows: 2, cols: 2, colWidths: [6777, 6777],
      cells: ['1', '2', '3 tacglkj', '4 tacglkj'], label: 'table' },
    { type: 'text', value: '   4 tacglkj 표 다음', label: 'after-text' },
    { type: 'enter', label: 'enter2' },
    { type: 'text', value: 'tacglkj 가나 옮', label: 'last-line' },
  ],
};

const expectations1 = {
  pageCount: 1,
  paragraphs: [
    { index: 0, textContains: ['TC #20'] },
    { index: 1, textContains: ['배치 시작', '표 다음'] },
    { index: 2, textContains: ['가나 옮'] },
  ],
  layout: [
    { rule: 'inline-order', paraIndex: 1 },
    { rule: 'table-baseline-align', paraIndex: 1, controlIndex: 0, tolerance: 10.0 },
  ],
};

// ─── 시나리오 2: 표 앞뒤 공백 검증 ─────────────────────────

const scenario2 = {
  name: 'TC-V02: 표 앞뒤 공백',
  steps: [
    { type: 'text', value: '앞텍스트     ', label: 'before' },
    { type: 'inlineTable', rows: 1, cols: 2, colWidths: [5000, 5000],
      cells: ['A', 'B'], label: 'table' },
    { type: 'text', value: '     뒤텍스트', label: 'after' },
  ],
};

const expectations2 = {
  pageCount: 1,
  paragraphs: [
    { index: 0, textContains: ['앞텍스트', '뒤텍스트'] },
  ],
  layout: [
    { rule: 'inline-order', paraIndex: 0 },
  ],
};

// ─── 시나리오 3: Enter 후 표 위치 안정성 ────────────────────

const scenario3 = {
  name: 'TC-V03: Enter 후 표 안정성',
  steps: [
    { type: 'text', value: '제목줄', label: 'title' },
    { type: 'enter', label: 'enter1' },
    { type: 'text', value: '텍스트   ', label: 'before' },
    { type: 'inlineTable', rows: 2, cols: 2, colWidths: [6000, 6000],
      cells: ['가', '나', '다', '라'], label: 'after-table' },
    { type: 'text', value: '   마바사', label: 'after-text' },
    { type: 'enter', label: 'after-enter' },
    { type: 'text', value: '다음 줄', label: 'next-line' },
  ],
};

const expectations3 = {
  pageCount: 1,
  paragraphs: [
    { index: 0, textContains: ['제목줄'] },
    { index: 1, textContains: ['텍스트', '마바사'] },
    { index: 2, textContains: ['다음 줄'] },
  ],
  layout: [
    { rule: 'inline-order', paraIndex: 1 },
    { rule: 'stable-after-enter', paraIndex: 1,
      compareSteps: ['after-table', 'after-enter'], tolerance: 3.0 },
  ],
};

// ─── 실행 ───────────────────────────────────────────────────

runTest('인라인 TAC 표 자동 검증', async ({ page }) => {
  // 시나리오 1
  await createNewDocument(page);
  await clickEditArea(page);
  await runScenario(page, scenario1, expectations1, 'v01');

  // 시나리오 2
  await createNewDocument(page);
  await clickEditArea(page);
  await runScenario(page, scenario2, expectations2, 'v02');

  // 시나리오 3
  await createNewDocument(page);
  await clickEditArea(page);
  await runScenario(page, scenario3, expectations3, 'v03');
});
