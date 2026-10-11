/** 받은 공문 기한 셈 — 오늘(이 PC 날짜) 기준 남은 날, 배지, 급한 공문 수, 목록 순서 */

import type { RpcResult } from "../../lib/contract";

export type InboxItem = RpcResult<"inbox_list">["items"][number];

const pad = (n: number) => String(n).padStart(2, "0");

export function todayIso(d = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const dayNo = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
};

/** 기한까지 남은 날 (지났으면 음수) */
export function daysLeft(due: string, today = todayIso()): number {
  return Math.round(dayNo(due) - dayNo(today));
}

/** 기한 배지: 지남·오늘은 빨강, 7일 안이면 주황, 그 밖은 보통 (색만이 아니라 글자로도 남은 날을 적는다) */
export function dueBadge(due: string, today = todayIso()): { label: string; tone?: "err" | "warn" } {
  const n = daysLeft(due, today);
  if (n < 0) return { label: `${-n}일 지남`, tone: "err" };
  if (n === 0) return { label: "오늘", tone: "err" };
  return { label: `D-${n}`, tone: n <= 7 ? "warn" : undefined };
}

/** 2026-10-23 → "10. 23.(금)" (올해가 아니면 연도까지) */
export function dueText(due: string, today = todayIso()): string {
  const [y, m, d] = due.split("-").map(Number);
  const wd = "일월화수목금토"[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${y !== Number(today.slice(0, 4)) ? `${y}. ` : ""}${m}. ${d}.(${wd})`;
}

/** 할 일 가운데 기한이 지났거나 오늘·내일인 것 — 탐색 배지와 알림에 쓴다 */
export function urgentCount(items: InboxItem[], today = todayIso()): number {
  return items.filter((it) => it.status === "todo" && it.due && daysLeft(it.due, today) <= 1).length;
}

/** 뽑은 기한 (요청 기한 중 가장 이른 것). 화면 기한이 이것과 다르면 사람이 고친 것 */
export function autoDue(it: InboxItem): string | undefined {
  return it.requests.map((r) => r.due).filter((d): d is string => Boolean(d)).sort()[0];
}

/** 엔진(inbox_list)과 같은 순서: 할 일 먼저 기한 순(기한 없는 것 뒤), 끝난 것은 아래 */
export function sortItems(items: InboxItem[]): InboxItem[] {
  return [...items].sort((a, b) => {
    if (a.status !== b.status) return a.status === "todo" ? -1 : 1;
    if (a.due !== b.due) return !a.due ? 1 : !b.due ? -1 : a.due.localeCompare(b.due);
    return b.added_at.localeCompare(a.added_at);
  });
}
