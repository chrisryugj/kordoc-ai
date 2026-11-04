/** 내 프롬프트 — 자주 쓰는 맡길 일 문장을 이 PC 화면 저장소에 둔다 (본창·카드 창 공용, 많이 쓴 차례) */

export interface MyPrompt { id: string; title: string; text: string; at: number; uses: number }

const KEY = "kordoc-my-prompts";
const MAX = 50;

export function loadMyPrompts(): MyPrompt[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]") as MyPrompt[];
    return Array.isArray(v) ? v.filter((p) => p && typeof p.text === "string").sort((a, b) => b.uses - a.uses || b.at - a.at) : [];
  } catch {
    return [];
  }
}

function save(list: MyPrompt[]) {
  try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX))); } catch { /* 이번 실행 동안만 */ }
}

/** 첫 줄 앞부분을 이름으로 */
export function promptTitle(text: string): string {
  const one = text.split("\n")[0].replace(/\s+/g, " ").trim();
  return one.length > 24 ? `${one.slice(0, 23)}…` : one;
}

/** 같은 글이 이미 있으면 그대로 두고 false */
export function addMyPrompt(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  const list = loadMyPrompts();
  if (list.some((p) => p.text === t)) return false;
  save([{ id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, title: promptTitle(t), text: t, at: Date.now(), uses: 0 }, ...list]);
  return true;
}

export function useMyPrompt(id: string) {
  save(loadMyPrompts().map((p) => (p.id === id ? { ...p, uses: p.uses + 1, at: Date.now() } : p)));
}

export function renameMyPrompt(id: string, title: string) {
  const t = title.replace(/\s+/g, " ").trim();
  if (t) save(loadMyPrompts().map((p) => (p.id === id ? { ...p, title: t } : p)));
}

export function removeMyPrompt(id: string) {
  save(loadMyPrompts().filter((p) => p.id !== id));
}
