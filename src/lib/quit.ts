/** 완전 종료 전 묻기 — 트레이 "완전 종료"가 오면 등록된 곳마다 저장 안 한 것을 묻고, 모두 괜찮을 때만 앱을 끈다 */

type Guard = () => Promise<boolean>;
const guards = new Set<Guard>();

/** 끄기 전에 물을 곳 등록 (true = 꺼도 됨). 돌려준 함수로 뗀다 */
export function onQuitGuard(g: Guard): () => void {
  guards.add(g);
  return () => { guards.delete(g); };
}

export async function canQuit(): Promise<boolean> {
  for (const g of [...guards]) if (!(await g().catch(() => false))) return false;
  return true;
}
