/**
 * hwpctl ParameterSet 호환 클래스
 *
 * 한컴 웹기안기의 HwpParameterSet과 동일한 인터페이스를 제공한다.
 * SetItem/GetItem으로 파라미터를 설정하고, Action.Execute()에 전달한다.
 */
import { ParameterArray } from './parameter-array';

export class ParameterSet {
  readonly name: string;
  private items: Map<string, any> = new Map();

  /** IsSet: ParameterSet이 유효한지 여부 (한컴 호환) */
  get IsSet(): boolean {
    return true;
  }

  constructor(name: string) {
    this.name = name;
  }

  /** 아이템 값 설정 */
  SetItem(key: string, value: any): void {
    this.items.set(key, value);
  }

  /** 아이템 값 조회 */
  GetItem(key: string): any {
    return this.items.get(key);
  }

  /**
   * 배열 아이템 생성 (한컴 호환)
   *
   * 사용 예:
   *   var colset = pset.CreateItemArray("ColWidth", 5);
   *   for (var i = 0; i < colset.Count; i++) {
   *       colset.SetItem(i, 7200);
   *   }
   */
  CreateItemArray(key: string, count: number): ParameterArray {
    const arr = new ParameterArray(key, count);
    this.items.set(key, arr);
    return arr;
  }

  /** 하위 ParameterSet 생성 (예: TableCreation의 TableProperties) */
  CreateItemSet(key: string, subSetName: string): ParameterSet {
    const sub = new ParameterSet(subSetName);
    this.items.set(key, sub);
    return sub;
  }

  /** 내부: 모든 아이템을 plain object로 변환 */
  toObject(): Record<string, any> {
    const obj: Record<string, any> = {};
    this.items.forEach((v, k) => {
      if (v instanceof ParameterSet) {
        obj[k] = v.toObject();
      } else if (v instanceof ParameterArray) {
        obj[k] = v.toArray();
      } else {
        obj[k] = v;
      }
    });
    return obj;
  }

  /** 내부: 아이템 존재 여부 */
  hasItem(key: string): boolean {
    return this.items.has(key);
  }
}
