/** AI 가 꺼져 있을 때 — 왜 안 되는지 한 줄 + [AI 켜기] (막다른 길을 만들지 않는다) */

import type { ReactNode } from "react";
import { Sparkles } from "lucide-react";
import { useApp } from "../../state/app";
import { Button } from "../ui/Button";

export function AiOffNote({ children, extra }: { children: ReactNode; extra?: ReactNode }) {
  const { openSettings } = useApp();
  return (
    <div className="kd-create-aioff">
      <p className="kd-small kd-muted">{children}</p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => openSettings("set-ai")} data-tip="설정의 AI 연결로 갑니다. 이 PC 안 모델이나 기관 AI 서버를 고를 수 있습니다"><Sparkles size={13} /> AI 켜기</Button>
        {extra}
      </div>
    </div>
  );
}

/** "AI 필요" 표시 */
export function AiNeedBadge() {
  return <span className="kd-badge" data-tone="warn">AI 필요</span>;
}
