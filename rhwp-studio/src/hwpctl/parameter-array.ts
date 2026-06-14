/**
 * hwpctl ParameterArray 호환 클래스
 *
 * 한컴 웹기안기의 HwpParameterArray와 동일한 인터페이스.
 * CreateItemArray()로 생성되어 인덱스 기반으로 값을 설정/조회한다.
 *
 * 사용 예:
 *   var colset = pset.CreateItemArray("ColWidth", 5);
 *   colset.SetItem(0, 7200);
 *   var w = colset.Item(0);  // 7200
 *   var n = colset.Count;    // 5
 */
export class ParameterArray {
  readonly name: string;
  private items: any[];

  /** IsSet: ParameterArray가 유효한지 여부 */
  get IsSet(): boolean {
    return true;
  }

  /** Count: 배열 길이 */
  get Count(): number {
    return this.items.length;
  }

  constructor(name: string, count: number) {
    this.name = name;
    this.items = new Array(count).fill(0);
  }

  /** 인덱스 기반 값 설정 */
  SetItem(index: number, value: any): void {
    if (index >= 0 && index < this.items.length) {
      this.items[index] = value;
    }
  }

  /** 인덱스 기반 값 조회 */
  Item(index: number): any {
    if (index >= 0 && index < this.items.length) {
      return this.items[index];
    }
    return undefined;
  }

  /** 내부: 전체 배열 반환 */
  toArray(): any[] {
    return [...this.items];
  }
}
