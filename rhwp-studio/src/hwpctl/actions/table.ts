/**
 * Wave 1: TableCreate Action executor
 *
 * 한컴 hwpctl 호환 ParameterSet 지원:
 *   Rows: 행 수 (기본 5)
 *   Cols: 열 수 (기본 5)
 *   WidthType: 너비 유형 (0=종이에따라, 2=절대값) — 기본 2(절대값)
 *   HeightType: 높이 유형 — 기본 1
 *   ColWidth: ParameterArray — 열별 너비 (HWPUNIT)
 *   RowHeight: ParameterArray — 행별 높이 (HWPUNIT)
 *
 * 미지정 시 기본값: 편집 영역 균등 분배 + Absolute 모드
 */
import { registerAction } from '../action-registry';
import { ParameterArray } from '../parameter-array';
import type { HwpCtrl } from '../index';
import type { ParameterSet } from '../parameter-set';

function executeTableCreate(ctrl: HwpCtrl, set: ParameterSet | null): boolean {
  const doc = ctrl.getWasmDoc();
  const cursor = ctrl.getCursor();

  const rows = set?.GetItem('Rows') ?? 5;
  const cols = set?.GetItem('Cols') ?? 5;

  try {
    // 1. 표 생성 (기본 균등 분배)
    const result = doc.createTable(cursor.section, cursor.para, cursor.pos, rows, cols);
    const parsed = JSON.parse(result);
    if (!parsed.ok) return false;

    const tableParaIdx = parsed.paraIdx;

    // 2. ColWidth/RowHeight — 향후 지원 예정 (현재 로그만 출력)
    const colWidthArr = set?.GetItem('ColWidth');
    if (colWidthArr instanceof ParameterArray && colWidthArr.Count > 0) {
      console.info('[hwpctl] ColWidth 지정됨 (향후 지원 예정, 현재 균등 분배)');
    }

    const rowHeightArr = set?.GetItem('RowHeight');
    if (rowHeightArr instanceof ParameterArray && rowHeightArr.Count > 0) {
      console.info('[hwpctl] RowHeight 지정됨 (향후 지원 예정, 현재 기본값)');
    }

    // 커서를 표 다음 문단으로 이동
    ctrl.SetPos(cursor.section, tableParaIdx + 1, 0);
    return true;
  } catch (e) {
    console.error('[hwpctl] TableCreate 실패:', e);
    return false;
  }
}

// Action 등록
registerAction({
  id: 'TableCreate',
  parameterSetId: 'TableCreation',
  description: '표 만들기',
  executor: executeTableCreate,
});
