import type { ReactNode } from "react";
import { Cloud, Cpu, HardDrive, Server, Sparkles } from "lucide-react";
import { useApp } from "../../state/app";
import { Button } from "../ui/Button";
import { Empty } from "./Status";

/** AI 가 연결돼 있지 않으면 안내만 보여 준다 */
export function AiGate({ children }: { children: ReactNode }) {
  const { ai, openSettings } = useApp();
  if (ai?.configured) return <>{children}</>;
  return (
    <Empty
      icon={<Sparkles size={28} />}
      title="AI가 아직 연결되지 않았습니다"
      action={<Button onClick={() => openSettings("set-ai")}>AI 연결하러 가기</Button>}
    >
      설정의 AI 연결에서 이 PC 안 모델, 이 PC의 로컬 모델 서버, 기관 AI 서버 가운데 하나를 고르세요.
    </Empty>
  );
}

/** 지금 AI 가 어디서 도는지 한 줄 (문서가 어디로 가는지 알려 준다). 모델 이름은 마우스를 올리면 */
export function AiWhere() {
  const { ai, settings } = useApp();
  if (!ai?.configured) return null;
  const tip = ai.model ? `모델: ${ai.model}` : undefined;
  // 이름은 공급자가 아니라 실제로 PC·기관 밖으로 나가는지(is_cloud)로 정한다
  if (!ai.is_cloud) {
    if (ai.provider === "embedded") return <span className="kd-status" title={tip}><Cpu size={13} /> 이 PC 안에서 처리</span>;
    if (ai.provider === "local") return <span className="kd-status" title={tip}><HardDrive size={13} /> 이 PC의 로컬 모델 서버</span>;
    return <span className="kd-status" title={tip}><Server size={13} /> 기관 AI 서버</span>;
  }
  const masked = settings?.ai.redact_before_cloud;
  const name = ai.provider === "claude-code" ? "구독 계정(Claude Code)" : ai.provider === "codex" ? "구독 계정(ChatGPT/Codex)" : "인터넷 AI";
  return (
    <span className="kd-status" data-tone="warn" title={tip}>
      <Cloud size={13} /> {name}{masked ? " · 개인정보는 가려서 보냅니다" : " · 문서 원문이 나갑니다"}
    </span>
  );
}
