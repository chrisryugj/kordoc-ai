/** 오늘 날짜 (YYYY-MM-DD) — 자정이 지나면 바뀐다. 앱을 켜 둔 채 밤을 넘겨도 기한 배지(D-day)가 하루 밀려 보이지 않게 */

import { useEffect, useState } from "react";
import { todayIso } from "./dday";

export function useToday(): string {
  const [today, setToday] = useState(() => todayIso());
  useEffect(() => {
    const check = () => setToday(todayIso());
    const midnight = new Date();
    midnight.setHours(24, 0, 1, 0);
    const timer = window.setTimeout(check, midnight.getTime() - Date.now());
    // 절전에서 깨어나면 타이머가 늦게 온다 → 창으로 돌아올 때도 본다
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [today]);
  return today;
}
