/**
 * Wave 2: CharShape, ParagraphShape, CharShapeBold/Italic/Underline Action executors
 */
import { registerAction } from '../action-registry';
import type { HwpCtrl } from '../index';
import type { ParameterSet } from '../parameter-set';

/**
 * hwpctl CharShape ParameterSet → rhwp JSON 변환
 *
 * hwpctl Item 이름 → rhwp JSON 키 매핑:
 *   Bold → bold, Italic → italic, Underline → underline
 *   FontSize → fontSize (hwpctl: pt*100 → rhwp: pt*100 그대로)
 *   FaceName → fontName (별도 처리 필요)
 *   TextColor → textColor
 */
function charShapeSetToJson(set: ParameterSet): string {
  const obj: Record<string, any> = {};

  const bold = set.GetItem('Bold');
  if (bold !== undefined) obj.bold = !!bold;

  const italic = set.GetItem('Italic');
  if (italic !== undefined) obj.italic = !!italic;

  const underline = set.GetItem('Underline');
  if (underline !== undefined) obj.underline = !!underline;

  const fontSize = set.GetItem('FontSize');
  if (fontSize !== undefined) obj.fontSize = fontSize; // pt * 100 → HwpUnit

  const textColor = set.GetItem('TextColor');
  if (textColor !== undefined) obj.textColor = textColor;

  const strikethrough = set.GetItem('Strikeout');
  if (strikethrough !== undefined) obj.strikethrough = !!strikethrough;

  const superscript = set.GetItem('Superscript');
  if (superscript !== undefined) obj.superscript = !!superscript;

  const subscript = set.GetItem('Subscript');
  if (subscript !== undefined) obj.subscript = !!subscript;

  return JSON.stringify(obj);
}

/**
 * hwpctl ParaShape ParameterSet → rhwp JSON 변환
 *
 * hwpctl Item → rhwp JSON:
 *   Align → alignment (0=양쪽,1=왼쪽,2=오른쪽,3=가운데,4=배분,5=나눔)
 *   LineSpacing → lineSpacing
 *   SpaceBefore → spacingBefore
 *   SpaceAfter → spacingAfter
 *   IndentLeft → marginLeft
 *   IndentRight → marginRight
 *   FirstLineIndent → indent
 */
function paraShapeSetToJson(set: ParameterSet): string {
  const obj: Record<string, any> = {};

  const align = set.GetItem('Align');
  if (align !== undefined) {
    const alignMap: Record<number, string> = {
      0: 'Justify', 1: 'Left', 2: 'Right', 3: 'Center', 4: 'Distribute', 5: 'Divide',
    };
    obj.alignment = alignMap[align] ?? 'Justify';
  }

  const lineSpacing = set.GetItem('LineSpacing');
  if (lineSpacing !== undefined) obj.lineSpacing = lineSpacing;

  const spaceBefore = set.GetItem('SpaceBefore');
  if (spaceBefore !== undefined) obj.spacingBefore = spaceBefore;

  const spaceAfter = set.GetItem('SpaceAfter');
  if (spaceAfter !== undefined) obj.spacingAfter = spaceAfter;

  const indentLeft = set.GetItem('IndentLeft');
  if (indentLeft !== undefined) obj.marginLeft = indentLeft;

  const indentRight = set.GetItem('IndentRight');
  if (indentRight !== undefined) obj.marginRight = indentRight;

  const firstLine = set.GetItem('FirstLineIndent');
  if (firstLine !== undefined) obj.indent = firstLine;

  return JSON.stringify(obj);
}

function executeCharShape(ctrl: HwpCtrl, set: ParameterSet | null): boolean {
  if (!set) return false;
  const doc = ctrl.getWasmDoc();
  const cursor = ctrl.getCursor();
  const json = charShapeSetToJson(set);

  try {
    // 현재 문단 전체에 적용 (선택 영역이 없으면)
    const result = doc.applyCharFormat(cursor.section, cursor.para, 0, 65535, json);
    return JSON.parse(result).ok === true;
  } catch (e) {
    console.error('[hwpctl] CharShape 실패:', e);
    return false;
  }
}

function executeParagraphShape(ctrl: HwpCtrl, set: ParameterSet | null): boolean {
  if (!set) return false;
  const doc = ctrl.getWasmDoc();
  const cursor = ctrl.getCursor();
  const json = paraShapeSetToJson(set);

  try {
    const result = doc.applyParaFormat(cursor.section, cursor.para, json);
    return JSON.parse(result).ok === true;
  } catch (e) {
    console.error('[hwpctl] ParagraphShape 실패:', e);
    return false;
  }
}

function executeCharShapeToggle(prop: string) {
  return (ctrl: HwpCtrl, _set: ParameterSet | null): boolean => {
    const doc = ctrl.getWasmDoc();
    const cursor = ctrl.getCursor();

    try {
      // 현재 상태를 반전 (toggle)
      const json = JSON.stringify({ [prop]: true });
      const result = doc.applyCharFormat(cursor.section, cursor.para, 0, 65535, json);
      return JSON.parse(result).ok === true;
    } catch (e) {
      console.error(`[hwpctl] CharShape${prop} 실패:`, e);
      return false;
    }
  };
}

// Action 등록
registerAction({ id: 'CharShape', parameterSetId: 'CharShape', description: '글자 모양', executor: executeCharShape });
registerAction({ id: 'ParagraphShape', parameterSetId: 'ParaShape', description: '문단 모양', executor: executeParagraphShape });
registerAction({ id: 'CharShapeBold', parameterSetId: null, description: '진하게', executor: executeCharShapeToggle('bold') });
registerAction({ id: 'CharShapeItalic', parameterSetId: null, description: '이탤릭', executor: executeCharShapeToggle('italic') });
registerAction({ id: 'CharShapeUnderline', parameterSetId: null, description: '밑줄', executor: executeCharShapeToggle('underline') });
