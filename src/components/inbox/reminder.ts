/** 받은 공문 기한 알림 — 탐색 배지(기한이 지났거나 오늘·내일인 할 일 수) + 하루 한 번 시스템 알림.
 *  App 셸에서 한 번 부른다. 받은 공문 화면을 열지 않아도 앱을 켜면 배지가 보인다 */

import { useEffect } from "react";
import { useApp } from "../../state/app";
import { rpc } from "../../lib/rpc";
import { notifySystem } from "../../lib/native";
import { todayIso, urgentCount } from "./dday";

const NOTIFIED_KEY = "kordoc-inbox-notified";
const CHECK_EVERY = 30 * 60_000;

function notifiedOn(): string {
  try { return localStorage.getItem(NOTIFIED_KEY) ?? ""; } catch { return ""; }
}

function markNotified(day: string) {
  try { localStorage.setItem(NOTIFIED_KEY, day); } catch { /* 저장소를 못 쓰면 이번 실행 동안만 */ }
}

export function useInboxReminder(): void {
  const { ready, setBadge } = useApp();

  useEffect(() => {
    if (!ready) return;
    let alive = true;
    const check = async () => {
      let items;
      try { items = (await rpc("inbox_list", {})).items; } catch { return; /* 다음 확인 때 다시 */ }
      if (!alive) return;
      const today = todayIso();
      const n = urgentCount(items, today);
      setBadge("inbox", n ? String(n) : undefined);
      // 창을 보고 있으면 배지로 충분하다. 가려져 있을 때 하루 한 번만 알린다
      if (!n || document.hasFocus() || notifiedOn() === today) return;
      markNotified(today);
      void notifySystem("KorDoc AI: 받은 공문", `기한이 가까운 공문 ${n}건`);
    };
    void check();
    const timer = window.setInterval(() => void check(), CHECK_EVERY);
    return () => { alive = false; window.clearInterval(timer); };
  }, [ready, setBadge]);
}
