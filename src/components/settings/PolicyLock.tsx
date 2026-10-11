/** 기관 배포 설정으로 고정된 칸 — 칸 이름 옆 작은 "기관에서 정함" 표시와 고정 여부 */

import type { ReactNode } from "react";
import { Lock } from "lucide-react";
import { useApp } from "../../state/app";

/** 칸 이름 옆 작은 표시 */
export function PolicyLock() {
  return (
    <span className="kd-badge" title="기관 배포 설정으로 정해져 이 PC에서 바꿀 수 없습니다"
      style={{ height: 18, padding: "0 6px", marginLeft: 6, fontSize: 11, verticalAlign: "middle" }}>
      <Lock size={10} aria-hidden="true" /> 기관에서 정함
    </span>
  );
}

/** 고정 여부 — "org.name" 은 그 칸, "ai.embedded" 처럼 묶음을 주면 그 아래 한 칸이라도 고정이면 참 */
export function useLocked(): (path: string) => boolean {
  const locked = useApp().settings?.policy?.locked ?? [];
  return (path) => locked.some((p) => p === path || p.startsWith(`${path}.`));
}

/** 입력 부품에 펼쳐 넣는 이름표·잠금: <TextField {...lockProps("기관명", lk("org.name"))} /> */
export function lockProps(label: ReactNode, locked: boolean): { label: ReactNode; disabled: boolean } {
  return { label: locked ? <>{label}<PolicyLock /></> : label, disabled: locked };
}
