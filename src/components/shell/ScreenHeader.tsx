import type { ReactNode } from "react";

/** 화면 머리 — 제목 + 한 줄 설명 + 오른쪽 동작 */
export function ScreenHeader({ title, sub, actions, children }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  return (
    <header className="kd-head">
      <div className="min-w-0 flex-1">
        <h1 className="kd-head-title">{title}</h1>
        {sub && <p className="kd-head-sub">{sub}</p>}
      </div>
      {children}
      {actions && <div className="kd-head-actions">{actions}</div>}
    </header>
  );
}
