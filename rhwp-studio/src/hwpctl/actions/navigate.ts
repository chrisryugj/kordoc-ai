/**
 * Wave 4: 이동/선택 Action executors
 * MoveLeft, MoveRight, MoveUp, MoveDown, SelectAll
 */
import { registerAction } from '../action-registry';
import type { HwpCtrl } from '../index';
import type { ParameterSet } from '../parameter-set';

function executeMoveLeft(ctrl: HwpCtrl, _set: ParameterSet | null): boolean {
  const cursor = ctrl.getCursor();
  if (cursor.pos > 0) {
    ctrl.SetPos(cursor.section, cursor.para, cursor.pos - 1);
  } else if (cursor.para > 0) {
    // 이전 문단 끝으로
    ctrl.SetPos(cursor.section, cursor.para - 1, 65535);
  }
  return true;
}

function executeMoveRight(ctrl: HwpCtrl, _set: ParameterSet | null): boolean {
  const cursor = ctrl.getCursor();
  ctrl.SetPos(cursor.section, cursor.para, cursor.pos + 1);
  return true;
}

function executeMoveUp(ctrl: HwpCtrl, _set: ParameterSet | null): boolean {
  const doc = ctrl.getWasmDoc();
  const cursor = ctrl.getCursor();
  try {
    const result = doc.moveVertical(cursor.section, cursor.para, cursor.pos, -1);
    const parsed = JSON.parse(result);
    if (parsed.section !== undefined) {
      ctrl.SetPos(parsed.section, parsed.para, parsed.pos);
    }
    return true;
  } catch {
    // fallback: 이전 문단으로
    if (cursor.para > 0) {
      ctrl.SetPos(cursor.section, cursor.para - 1, cursor.pos);
    }
    return true;
  }
}

function executeMoveDown(ctrl: HwpCtrl, _set: ParameterSet | null): boolean {
  const doc = ctrl.getWasmDoc();
  const cursor = ctrl.getCursor();
  try {
    const result = doc.moveVertical(cursor.section, cursor.para, cursor.pos, 1);
    const parsed = JSON.parse(result);
    if (parsed.section !== undefined) {
      ctrl.SetPos(parsed.section, parsed.para, parsed.pos);
    }
    return true;
  } catch {
    // fallback: 다음 문단으로
    ctrl.SetPos(cursor.section, cursor.para + 1, cursor.pos);
    return true;
  }
}

function executeSelectAll(ctrl: HwpCtrl, _set: ParameterSet | null): boolean {
  // 전체 선택: 커서를 문서 시작/끝으로 설정
  ctrl.SetPos(0, 0, 0);
  console.warn('[hwpctl] SelectAll: 커서를 문서 시작으로 이동 (선택 범위는 미구현)');
  return true;
}

// Action 등록
registerAction({ id: 'MoveLeft', parameterSetId: null, description: '커서 좌', executor: executeMoveLeft });
registerAction({ id: 'MoveRight', parameterSetId: null, description: '커서 우', executor: executeMoveRight });
registerAction({ id: 'MoveUp', parameterSetId: null, description: '커서 상', executor: executeMoveUp });
registerAction({ id: 'MoveDown', parameterSetId: null, description: '커서 하', executor: executeMoveDown });
registerAction({ id: 'SelectAll', parameterSetId: null, description: '전체 선택', executor: executeSelectAll });
