/** 설정의 저장 안 한 변경 — 구획마다 표시하고, 설정을 떠날 때 저장할지 묻는다 (SettingsScreen 이 모은다)
 *  고급 접기(Advanced): 기술 용어(토큰·GPU·MCP·버전·파일 이름)는 펼쳐야 보인다 */

import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";

export interface DirtyEntry { title: string; save: () => Promise<boolean>; reset: () => void }

export const DirtyContext = createContext<((id: string, e: DirtyEntry | null) => void) | null>(null);

/** dirty 인 동안 구획을 "저장 안 함"으로 올려 둔다. save·reset 은 매번 새 함수여도 된다 (최신 것을 부른다) */
export function useDirtyMark(id: string, title: string, dirty: boolean, save: () => Promise<boolean>, reset: () => void) {
  const set = useContext(DirtyContext);
  const fns = useRef({ save, reset });
  fns.current = { save, reset };
  useEffect(() => {
    set?.(id, dirty ? { title, save: () => fns.current.save(), reset: () => fns.current.reset() } : null);
  }, [set, id, title, dirty]);
  useEffect(() => () => set?.(id, null), [set, id]);
}

/** 구획 제목 옆 "저장 안 함" 표시 */
export function UnsavedBadge() {
  return <span className="kd-badge" data-tone="warn">저장 안 함</span>;
}

/** 고급: 평소엔 접어 두는 기술 설정·정보 */
export function Advanced({ children, title = "고급" }: { children: ReactNode; title?: string }) {
  return (
    <details className="kd-advanced">
      <summary><ChevronRight size={14} aria-hidden="true" /> {title}</summary>
      <div className="kd-advanced-body">{children}</div>
    </details>
  );
}
