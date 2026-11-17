/** 기준 시간 칸 — 집계를 다시 읽을 때(화면에 다시 들어옴·기간 바꿈·기록 지우기) 저장 안 한 칸은 사람이 친 값을 지킨다.
 *  prev: 지금 칸을 채운 앞 집계, next: 새로 읽은 집계, base: 지금 칸 값 */
export function keepEdits(
  prev: Array<{ key: string; baseline_min: number }> | undefined,
  next: Array<{ key: string; baseline_min: number }>,
  base: Record<string, string>,
): Record<string, string> {
  const was = new Map((prev ?? []).map((i) => [i.key, String(i.baseline_min)]));
  return Object.fromEntries(next.map((i) => {
    const typed = base[i.key];
    const edited = typed !== undefined && was.has(i.key) && typed !== was.get(i.key);
    return [i.key, edited ? typed : String(i.baseline_min)];
  }));
}
