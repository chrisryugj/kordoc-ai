/**
 * hwpctl Action 레지스트리
 *
 * 312개 Action의 등록 테이블. Wave별로 executor가 추가된다.
 * 미구현 Action은 executor=null로 등록되어 console.warn만 출력.
 */
import type { ActionDef } from './action';

const registry: Map<string, ActionDef> = new Map();

/** Action 정의 등록 */
export function registerAction(def: ActionDef): void {
  registry.set(def.id, def);
}

/** Action 정의 조회 */
export function getActionDef(id: string): ActionDef | undefined {
  return registry.get(id);
}

/** 등록된 전체 Action 수 */
export function getRegisteredCount(): number {
  return registry.size;
}

/** 구현된 Action 수 (executor가 있는 것) */
export function getImplementedCount(): number {
  let count = 0;
  registry.forEach(def => { if (def.executor) count++; });
  return count;
}

/** 전체 Action 목록 반환 (진행률 추적용) */
export function getAllActions(): ActionDef[] {
  const result: ActionDef[] = [];
  registry.forEach(def => result.push(def));
  return result;
}

// ── 기본 Action 등록 (stub — executor 없음) ──
// Wave 구현 시 registerAction()으로 executor 추가

const STUB_ACTIONS: [string, string | null, string][] = [
  // Wave 1: 표/텍스트
  ['TableCreate', 'TableCreation', '표 만들기'],
  ['InsertText', 'InsertText', '텍스트 삽입'],
  ['BreakPara', null, '문단 나누기'],
  ['BreakPage', null, '쪽 나누기'],
  ['BreakColumn', null, '단 나누기'],
  // Wave 2: 서식
  ['CharShape', 'CharShape', '글자 모양'],
  ['ParagraphShape', 'ParaShape', '문단 모양'],
  ['CharShapeBold', null, '진하게'],
  ['CharShapeItalic', null, '이탤릭'],
  ['CharShapeUnderline', null, '밑줄'],
  // Wave 3: 표 편집
  ['TableInsertRowColumn', 'TableInsertLine', '줄/칸 삽입'],
  ['TableDeleteRowColumn', 'TableDeleteLine', '줄/칸 삭제'],
  ['TableSplitCell', 'TableSplitCell', '셀 나누기'],
  ['CellBorderFill', 'CellBorderFill', '셀 테두리/배경'],
  ['TablePropertyDialog', 'ShapeObject', '표 고치기'],
  // Wave 4: 이동/선택
  ['MoveLeft', null, '커서 좌'], ['MoveRight', null, '커서 우'],
  ['MoveUp', null, '커서 상'], ['MoveDown', null, '커서 하'],
  ['SelectAll', null, '전체 선택'],
  // Wave 5: 클립보드
  ['Copy', null, '복사'], ['Cut', null, '잘라내기'],
  ['Paste', null, '붙여넣기'], ['Undo', null, '실행취소'], ['Redo', null, '다시실행'],
  // Wave 6: 용지/머리말
  ['PageSetup', 'SecDef', '편집 용지'], ['HeaderFooter', 'HeaderFooter', '머리말/꼬리말'],
  ['BreakSection', null, '구역 나누기'], ['BreakColDef', null, '단 정의'],
  ['PageNumPos', 'PageNumPos', '쪽 번호'],
];

for (const [id, setId, desc] of STUB_ACTIONS) {
  registerAction({ id, parameterSetId: setId, description: desc, executor: null });
}
