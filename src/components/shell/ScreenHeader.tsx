import type { ReactNode } from "react";

/** 화면 머리 — 제목 + 한 줄 설명 + 오른쪽 동작 */
export function ScreenHeader({ title, sub, actions, children }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  return (
    <header className="kd-head">
      <div className="min-w-0 flex-1">
        {/* 긴 파일 이름은 한 줄로 자르고 전체는 마우스를 올려 본다 (머리가 두세 줄로 늘어 도구가 밀리지 않게) */}
        <h1 className="kd-head-title" title={typeof title === "string" ? title : undefined}>{title}</h1>
        {sub && <p className="kd-head-sub">{sub}</p>}
      </div>
      {children}
      {actions && <div className="kd-head-actions">{actions}</div>}
    </header>
  );
}
