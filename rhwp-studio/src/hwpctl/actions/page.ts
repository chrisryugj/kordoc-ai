/**
 * Wave 6: 용지/머리말 Action executors
 * PageSetup, HeaderFooter, BreakSection, BreakColDef, PageNumPos
 */
import { registerAction } from '../action-registry';
import type { HwpCtrl } from '../index';
import type { ParameterSet } from '../parameter-set';

/**
 * PageSetup (SecDef ParameterSet)
 * hwpctl Item → rhwp JSON:
 *   PaperWidth → width, PaperHeight → height
 *   TopMargin → marginTop, BottomMargin → marginBottom
 *   LeftMargin → marginLeft, RightMargin → marginRight
 *   HeaderMargin → headerMargin, FooterMargin → footerMargin
 *   Landscape → landscape (0=세로, 1=가로)
 */
function executePageSetup(ctrl: HwpCtrl, set: ParameterSet | null): boolean {
  if (!set) return false;
  const doc = ctrl.getWasmDoc();
  const cursor = ctrl.getCursor();

  const obj: Record<string, any> = {};
  const mapping: [string, string][] = [
    ['PaperWidth', 'width'], ['PaperHeight', 'height'],
    ['TopMargin', 'marginTop'], ['BottomMargin', 'marginBottom'],
    ['LeftMargin', 'marginLeft'], ['RightMargin', 'marginRight'],
    ['HeaderMargin', 'headerMargin'], ['FooterMargin', 'footerMargin'],
  ];

  for (const [hwpKey, rhwpKey] of mapping) {
    const v = set.GetItem(hwpKey);
    if (v !== undefined) obj[rhwpKey] = v;
  }

  const landscape = set.GetItem('Landscape');
  if (landscape !== undefined) obj.landscape = !!landscape;

  try {
    const result = doc.setPageDef(cursor.section, JSON.stringify(obj));
    return JSON.parse(result).ok === true;
  } catch (e) {
    console.error('[hwpctl] PageSetup 실패:', e);
    return false;
  }
}

/**
 * HeaderFooter ParameterSet:
 *   Type: 0=머리말, 1=꼬리말
 *   Apply: 0=양쪽, 1=짝수, 2=홀수
 */
function executeHeaderFooter(ctrl: HwpCtrl, set: ParameterSet | null): boolean {
  const doc = ctrl.getWasmDoc();
  const cursor = ctrl.getCursor();

  const type = set?.GetItem('Type') ?? 0; // 0=머리말, 1=꼬리말
  const apply = set?.GetItem('Apply') ?? 0; // 0=양쪽, 1=짝수, 2=홀수
  const isHeader = type === 0;

  const applyMap: Record<number, string> = { 0: 'Both', 1: 'Even', 2: 'Odd' };
  const applyTo = applyMap[apply] ?? 'Both';

  try {
    const result = doc.createHeaderFooter(
      cursor.section, cursor.para,
      isHeader, applyTo,
    );
    return JSON.parse(result).ok === true;
  } catch (e) {
    console.error('[hwpctl] HeaderFooter 실패:', e);
    return false;
  }
}

function executeBreakSection(ctrl: HwpCtrl, _set: ParameterSet | null): boolean {
  // 구역 나누기: 현재 위치에서 새 구역 삽입
  console.warn('[hwpctl] BreakSection: 구역 나누기 미구현');
  return false;
}

function executeBreakColDef(ctrl: HwpCtrl, _set: ParameterSet | null): boolean {
  console.warn('[hwpctl] BreakColDef: 단 정의 삽입 미구현');
  return false;
}

function executePageNumPos(ctrl: HwpCtrl, set: ParameterSet | null): boolean {
  console.warn('[hwpctl] PageNumPos: 쪽 번호 위치 미구현');
  return false;
}

// Action 등록
registerAction({ id: 'PageSetup', parameterSetId: 'SecDef', description: '편집 용지', executor: executePageSetup });
registerAction({ id: 'HeaderFooter', parameterSetId: 'HeaderFooter', description: '머리말/꼬리말', executor: executeHeaderFooter });
registerAction({ id: 'BreakSection', parameterSetId: null, description: '구역 나누기', executor: executeBreakSection });
registerAction({ id: 'BreakColDef', parameterSetId: null, description: '단 정의', executor: executeBreakColDef });
registerAction({ id: 'PageNumPos', parameterSetId: 'PageNumPos', description: '쪽 번호', executor: executePageNumPos });
