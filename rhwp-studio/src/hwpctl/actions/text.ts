/**
 * Wave 1: InsertText, BreakPara, BreakPage, BreakColumn Action executors
 */
import { registerAction } from '../action-registry';
import type { HwpCtrl } from '../index';
import type { ParameterSet } from '../parameter-set';

function executeInsertText(ctrl: HwpCtrl, set: ParameterSet | null): boolean {
  const doc = ctrl.getWasmDoc();
  const cursor = ctrl.getCursor();
  const text = set?.GetItem('Text') ?? '';

  if (!text) return false;

  try {
    const result = doc.insertText(cursor.section, cursor.para, cursor.pos, text);
    const parsed = JSON.parse(result);
    if (parsed.ok) {
      ctrl.SetPos(cursor.section, cursor.para, parsed.charOffset ?? cursor.pos + text.length);
    }
    return parsed.ok === true;
  } catch (e) {
    console.error('[hwpctl] InsertText 실패:', e);
    return false;
  }
}

function executeBreakPara(ctrl: HwpCtrl, _set: ParameterSet | null): boolean {
  const doc = ctrl.getWasmDoc();
  const cursor = ctrl.getCursor();

  try {
    const result = doc.splitParagraph(cursor.section, cursor.para, cursor.pos);
    const parsed = JSON.parse(result);
    if (parsed.ok) {
      ctrl.SetPos(cursor.section, cursor.para + 1, 0);
    }
    return parsed.ok === true;
  } catch (e) {
    console.error('[hwpctl] BreakPara 실패:', e);
    return false;
  }
}

function executeBreakPage(ctrl: HwpCtrl, _set: ParameterSet | null): boolean {
  const doc = ctrl.getWasmDoc();
  const cursor = ctrl.getCursor();

  try {
    const result = doc.insertPageBreak(cursor.section, cursor.para, cursor.pos);
    const parsed = JSON.parse(result);
    if (parsed.ok) {
      ctrl.SetPos(cursor.section, parsed.paraIdx ?? cursor.para + 1, 0);
    }
    return parsed.ok === true;
  } catch (e) {
    console.error('[hwpctl] BreakPage 실패:', e);
    return false;
  }
}

function executeBreakColumn(ctrl: HwpCtrl, _set: ParameterSet | null): boolean {
  const doc = ctrl.getWasmDoc();
  const cursor = ctrl.getCursor();

  try {
    const result = doc.insertColumnBreak(cursor.section, cursor.para, cursor.pos);
    const parsed = JSON.parse(result);
    if (parsed.ok) {
      ctrl.SetPos(cursor.section, parsed.paraIdx ?? cursor.para + 1, 0);
    }
    return parsed.ok === true;
  } catch (e) {
    console.error('[hwpctl] BreakColumn 실패:', e);
    return false;
  }
}

// 기존 stub를 구현으로 교체
registerAction({ id: 'InsertText', parameterSetId: 'InsertText', description: '텍스트 삽입', executor: executeInsertText });
registerAction({ id: 'BreakPara', parameterSetId: null, description: '문단 나누기', executor: executeBreakPara });
registerAction({ id: 'BreakPage', parameterSetId: null, description: '쪽 나누기', executor: executeBreakPage });
registerAction({ id: 'BreakColumn', parameterSetId: null, description: '단 나누기', executor: executeBreakColumn });
