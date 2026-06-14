/**
 * Wave 5: 클립보드 + 실행취소 Action executors
 * Copy, Cut, Paste, Undo, Redo
 */
import { registerAction } from '../action-registry';
import type { HwpCtrl } from '../index';
import type { ParameterSet } from '../parameter-set';

function executeCopy(ctrl: HwpCtrl, _set: ParameterSet | null): boolean {
  const doc = ctrl.getWasmDoc();
  const cursor = ctrl.getCursor();
  try {
    doc.copySelection(cursor.section, cursor.para, 0, cursor.para, 65535);
    return true;
  } catch (e) {
    console.error('[hwpctl] Copy 실패:', e);
    return false;
  }
}

function executeCut(ctrl: HwpCtrl, _set: ParameterSet | null): boolean {
  const doc = ctrl.getWasmDoc();
  const cursor = ctrl.getCursor();
  try {
    doc.copySelection(cursor.section, cursor.para, 0, cursor.para, 65535);
    doc.deleteText(cursor.section, cursor.para, 0, 65535);
    return true;
  } catch (e) {
    console.error('[hwpctl] Cut 실패:', e);
    return false;
  }
}

function executePaste(ctrl: HwpCtrl, _set: ParameterSet | null): boolean {
  const doc = ctrl.getWasmDoc();
  const cursor = ctrl.getCursor();
  try {
    const result = doc.pasteInternal(cursor.section, cursor.para, cursor.pos);
    const parsed = JSON.parse(result);
    if (parsed.ok && parsed.charOffset !== undefined) {
      ctrl.SetPos(cursor.section, cursor.para, parsed.charOffset);
    }
    return parsed.ok === true;
  } catch (e) {
    console.error('[hwpctl] Paste 실패:', e);
    return false;
  }
}

function executeUndo(_ctrl: HwpCtrl, _set: ParameterSet | null): boolean {
  console.warn('[hwpctl] Undo: 미구현 (향후 Phase 4에서 구현)');
  return false;
}

function executeRedo(_ctrl: HwpCtrl, _set: ParameterSet | null): boolean {
  console.warn('[hwpctl] Redo: 미구현 (향후 Phase 4에서 구현)');
  return false;
}

// Action 등록
registerAction({ id: 'Copy', parameterSetId: null, description: '복사', executor: executeCopy });
registerAction({ id: 'Cut', parameterSetId: null, description: '잘라내기', executor: executeCut });
registerAction({ id: 'Paste', parameterSetId: null, description: '붙여넣기', executor: executePaste });
registerAction({ id: 'Undo', parameterSetId: null, description: '실행취소', executor: executeUndo });
registerAction({ id: 'Redo', parameterSetId: null, description: '다시실행', executor: executeRedo });
