/** 쪽 그림 상한 — 들고 있는 쪽 그림(rhwp SVG Blob·엔진 렌더 PNG data URL)이 이만큼을 넘으면 지금 보는 곳에서 먼 쪽부터 버린다
 *  (다시 보이면 또 그린다). 수백 쪽 스캔 PDF 를 넘겨 보면 그린 쪽이 다 쌓였다 */
export const PAGE_BUDGET = 64 * 1024 * 1024;

/** 버릴 쪽 — want(보이는 쪽, 가까운 순)는 남기고, want[0] 에서 먼 쪽부터 합이 상한 아래가 될 때까지 */
export function pagesToDrop(sizes: Map<number, number>, want: number[], budget = PAGE_BUDGET): number[] {
  let total = 0;
  sizes.forEach((s) => { total += s; });
  if (total <= budget) return [];
  const keep = new Set(want);
  const center = want[0] ?? 1;
  const far = [...sizes.keys()].filter((p) => !keep.has(p)).sort((a, b) => Math.abs(b - center) - Math.abs(a - center));
  const out: number[] = [];
  for (const p of far) {
    if (total <= budget) break;
    total -= sizes.get(p)!;
    out.push(p);
  }
  return out;
}
