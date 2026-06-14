/**
 * hwpctl Action 호환 클래스
 *
 * 한컴 웹기안기의 Action과 동일한 인터페이스를 제공한다.
 * CreateAction(id) → Action.CreateSet() → Action.Execute(set)
 */
import { ParameterSet } from './parameter-set';
import type { HwpCtrl } from './index';

/** Action 실행 함수 타입 */
export type ActionExecutor = (ctrl: HwpCtrl, set: ParameterSet | null) => boolean;

/** Action 정의 */
export interface ActionDef {
  /** Action ID */
  id: string;
  /** 연결된 ParameterSet 이름 (없으면 null) */
  parameterSetId: string | null;
  /** 설명 */
  description: string;
  /** 실행 함수 */
  executor: ActionExecutor | null;
}

export class Action {
  readonly ActID: string;
  readonly SetID: string | null;
  private ctrl: HwpCtrl;
  private def: ActionDef;

  constructor(ctrl: HwpCtrl, def: ActionDef) {
    this.ctrl = ctrl;
    this.def = def;
    this.ActID = def.id;
    this.SetID = def.parameterSetId;
  }

  /** Action에 연결된 ParameterSet 생성 */
  CreateSet(): ParameterSet {
    return new ParameterSet(this.def.parameterSetId || this.def.id);
  }

  /** ParameterSet에 기본값 로드 */
  GetDefault(set: ParameterSet): void {
    // Wave별 구현에서 기본값 설정 추가
  }

  /** Action 실행 (ParameterSet 전달) */
  Execute(set: ParameterSet): boolean {
    if (this.def.executor) {
      return this.def.executor(this.ctrl, set);
    }
    console.warn(`[hwpctl] Action "${this.def.id}" 미구현`);
    return false;
  }

  /** Action 단순 실행 (ParameterSet 없이) */
  Run(): boolean {
    if (this.def.executor) {
      return this.def.executor(this.ctrl, null);
    }
    console.warn(`[hwpctl] Action "${this.def.id}" 미구현`);
    return false;
  }
}
