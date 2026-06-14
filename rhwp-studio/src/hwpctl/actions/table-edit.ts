/**
 * Wave 3: 표 편집 Action executors
 * TableInsertRowColumn, TableDeleteRowColumn, TableSplitCell,
 * CellBorderFill, TablePropertyDialog
 */
import { registerAction } from '../action-registry';
import type { HwpCtrl } from '../index';
import type { ParameterSet } from '../parameter-set';

/**
 * TableInsertLine ParameterSet:
 *   Type: 0=줄(행), 1=칸(열)
 *   (표 내 현재 커서 위치 기준으로 삽입)
 */
function executeTableInsertRowColumn(ctrl: HwpCtrl, set: ParameterSet | null): boolean {
  const doc = ctrl.getWasmDoc();
  const cursor = ctrl.getCursor();
  const type = set?.GetItem('Type') ?? 0; // 0=행, 1=열

  try {
    let result: string;
    if (type === 1) {
      // 열 삽입
      result = doc.insertTableColumn(cursor.section, cursor.para, 0, 0, true);
    } else {
      // 행 삽입
      result = doc.insertTableRow(cursor.section, cursor.para, 0, 0, true);
    }
    return JSON.parse(result).ok === true;
  } catch (e) {
    console.error('[hwpctl] TableInsertRowColumn 실패:', e);
    return false;
  }
}

function executeTableDeleteRowColumn(ctrl: HwpCtrl, set: ParameterSet | null): boolean {
  const doc = ctrl.getWasmDoc();
  const cursor = ctrl.getCursor();
  const type = set?.GetItem('Type') ?? 0; // 0=행, 1=열

  try {
    let result: string;
    if (type === 1) {
      result = doc.deleteTableColumn(cursor.section, cursor.para, 0, 0);
    } else {
      result = doc.deleteTableRow(cursor.section, cursor.para, 0, 0);
    }
    return JSON.parse(result).ok === true;
  } catch (e) {
    console.error('[hwpctl] TableDeleteRowColumn 실패:', e);
    return false;
  }
}

/**
 * TableSplitCell ParameterSet:
 *   Rows: 나눌 행 수
 *   Cols: 나눌 열 수
 */
function executeTableSplitCell(ctrl: HwpCtrl, set: ParameterSet | null): boolean {
  const doc = ctrl.getWasmDoc();
  const cursor = ctrl.getCursor();

  try {
    const result = doc.splitTableCell(cursor.section, cursor.para, 0, 0, 0);
    return JSON.parse(result).ok === true;
  } catch (e) {
    console.error('[hwpctl] TableSplitCell 실패:', e);
    return false;
  }
}

/**
 * CellBorderFill: 셀 테두리/배경 적용
 * ParameterSet에서 BorderFill 속성을 읽어 적용
 */
function executeCellBorderFill(ctrl: HwpCtrl, set: ParameterSet | null): boolean {
  if (!set) return false;
  const doc = ctrl.getWasmDoc();
  const cursor = ctrl.getCursor();

  try {
    // 현재는 기본 스타일(borderFillId=1) 적용
    const styleId = set.GetItem('BorderFillId') ?? 1;
    const result = doc.applyCellStyle(cursor.section, cursor.para, 0, 0, 0, styleId);
    return JSON.parse(result).ok === true;
  } catch (e) {
    console.error('[hwpctl] CellBorderFill 실패:', e);
    return false;
  }
}

/**
 * TablePropertyDialog: 표 속성 대화상자
 * 현재는 stub (대화상자 UI 미구현)
 */
function executeTablePropertyDialog(ctrl: HwpCtrl, set: ParameterSet | null): boolean {
  console.warn('[hwpctl] TablePropertyDialog: 대화상자 미구현 — ParameterSet으로 직접 속성 설정 사용');
  return false;
}

// Action 등록
registerAction({ id: 'TableInsertRowColumn', parameterSetId: 'TableInsertLine', description: '줄/칸 삽입', executor: executeTableInsertRowColumn });
registerAction({ id: 'TableDeleteRowColumn', parameterSetId: 'TableDeleteLine', description: '줄/칸 삭제', executor: executeTableDeleteRowColumn });
registerAction({ id: 'TableSplitCell', parameterSetId: 'TableSplitCell', description: '셀 나누기', executor: executeTableSplitCell });
registerAction({ id: 'CellBorderFill', parameterSetId: 'CellBorderFill', description: '셀 테두리/배경', executor: executeCellBorderFill });
registerAction({ id: 'TablePropertyDialog', parameterSetId: 'ShapeObject', description: '표 고치기', executor: executeTablePropertyDialog });
