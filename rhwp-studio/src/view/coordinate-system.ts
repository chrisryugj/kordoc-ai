import { VirtualScroll } from './virtual-scroll';

export class CoordinateSystem {
  constructor(private virtualScroll: VirtualScroll) {}

  /** 뷰포트 좌표 → 문서 좌표 */
  viewportToDocument(
    vx: number,
    vy: number,
    scrollX: number,
    scrollY: number,
  ): { x: number; y: number } {
    return { x: vx + scrollX, y: vy + scrollY };
  }

  /** 문서 좌표 → 페이지 좌표 + 페이지 인덱스 */
  documentToPage(dx: number, dy: number): { pageIdx: number; x: number; y: number } {
    const pageIdx = this.virtualScroll.getPageAtY(dy);
    return {
      pageIdx,
      x: dx,
      y: dy - this.virtualScroll.getPageOffset(pageIdx),
    };
  }

  /** 페이지 좌표 → 문서 좌표 */
  pageToDocument(pageIdx: number, px: number, py: number): { x: number; y: number } {
    return {
      x: px,
      y: py + this.virtualScroll.getPageOffset(pageIdx),
    };
  }

  /** 페이지 좌표 → 뷰포트 좌표 */
  pageToViewport(
    pageIdx: number,
    px: number,
    py: number,
    scrollX: number,
    scrollY: number,
  ): { x: number; y: number } {
    const doc = this.pageToDocument(pageIdx, px, py);
    return {
      x: doc.x - scrollX,
      y: doc.y - scrollY,
    };
  }
}
