/**
 * 작성 단계 아래 고정 줄 — 지금 할 다음 동작(버튼)과 짧은 상태를 늘 보이게.
 * ComposeStep 이 바닥에 자리를 두고, 보이는 시작점만 그 자리에 그린다(숨은 시작점은 null).
 */

import { createContext, useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { StatusLine } from "../common/Status";

/** undefined: 고정 줄 밖(그 자리에 그대로) · null: 숨은 시작점 · 요소: 그 자리로 */
export const ActionBarSlot = createContext<HTMLElement | null | undefined>(undefined);

export function ActionBar({ status, error, busy, children }: { status: ReactNode; error?: string; busy?: ReactNode; children?: ReactNode }) {
  const slot = useContext(ActionBarSlot);
  if (slot === null) return null;
  const body = (
    <>
      <div className="kd-actionbar-status">{error ? <StatusLine tone={error === "멈췄습니다" ? "info" : "err"}>{error}</StatusLine> : status}</div>
      <div className="kd-actionbar-act">{busy || children}</div>
    </>
  );
  return slot ? createPortal(body, slot) : <div className="kd-actionbar kd-actionbar-inline">{body}</div>;
}
