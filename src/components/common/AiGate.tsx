import type { ReactNode } from "react";
import { Cloud, Cpu, HardDrive, Server, Sparkles } from "lucide-react";
import { useApp } from "../../state/app";
import type { AiStatus } from "../../lib/contract";
import { Button } from "../ui/Button";
import { Empty } from "./Status";

/** 구독 프로그램을 골랐는데 쓸 수 없는 상태(로그아웃·미설치·구독 아님·버전 낮음)면 그 까닭 — 없으면 null.
 *  "AI가 꺼져 있습니다"로만 알리면 켜 둔 사람은 무엇을 고쳐야 하는지 모른다 */
export function subscriptionProblem(ai: AiStatus | null): string | null {
  const s = ai?.subscription_state;
  return ai && !ai.configured && (s === "signed-out" || s === "metered" || s === "not-installed" || s === "needs-update") ? ai.error ?? null : null;
}

/** AI 가 연결돼 있지 않으면 안내만 보여 준다.
 *  keep: 안내를 보이는 동안에도 자식을 없애지 않고 감춰 둔다. 하던 대화·붙인 문서·다듬던 글이 있는 화면에 쓴다
 *  (대화 중에 구독 로그인이 풀리거나 설정에서 AI 갈래를 바꾸는 순간 그것들이 사라지지 않게) */
export function AiGate({ children, keep }: { children: ReactNode; keep?: boolean }) {
  const { ai, openSettings } = useApp();
  const ok = !!ai?.configured;
  if (ok && !keep) return <>{children}</>;
  const problem = subscriptionProblem(ai);
  const notice = problem ? (
    <Empty icon={<Sparkles size={28} />} title="구독 계정 연결을 쓸 수 없습니다"
      action={<Button onClick={() => openSettings("set-ai")}>AI 연결 열기</Button>}>
      {problem} 고친 뒤 이 창으로 돌아오면 다시 확인합니다.
    </Empty>
  ) : (
    <Empty
      icon={<Sparkles size={28} />}
      title="AI가 아직 연결되지 않았습니다"
      action={<Button onClick={() => openSettings("set-ai")}>AI 켜기</Button>}
    >
      설정 › AI 연결에서 이 PC에서·기관 AI 서버·외부 AI 가운데 하나를 고르세요.
    </Empty>
  );
  if (!keep) return notice;
  // 자식의 자리(둘째)가 바뀌지 않아야 상태가 남는다
  return <>{ok ? null : notice}<div hidden={!ok} style={{ display: ok ? "contents" : "none" }}>{children}</div></>;
}

/** 지금 AI 가 어디서 도는지 한 줄 (문서가 어디로 가는지 알려 준다). 모델 이름은 마우스를 올리면 */
export function AiWhere() {
  const { ai, settings } = useApp();
  if (!ai?.configured) return null;
  const tip = ai.model ? `모델: ${ai.model}` : undefined;
  // 이름은 공급자가 아니라 실제로 PC·기관 밖으로 나가는지(is_cloud)로 정한다
  if (!ai.is_cloud) {
    if (ai.provider === "embedded") return <span className="kd-status" title={tip}><Cpu size={13} /> 이 PC에서 · 내장 AI</span>;
    if (ai.provider === "local") return <span className="kd-status" title={tip}><HardDrive size={13} /> 이 PC에서 · 켜 둔 AI 프로그램</span>;
    return <span className="kd-status" title={tip}><Server size={13} /> 기관 AI 서버</span>;
  }
  const masked = settings?.ai.redact_before_cloud;
  const name = ai.provider === "claude-code" ? "외부 AI · 구독 계정 (Claude Code)" : ai.provider === "codex" ? "외부 AI · 구독 계정 (Codex)" : ai.provider === "gemini-cli" ? "외부 AI · 구독 계정 (Antigravity CLI)" : "외부 AI";
  return (
    <span className="kd-status" data-tone="warn" title={tip}>
      <Cloud size={13} /> {name}{masked ? " · 개인정보는 가려서 보냅니다" : " · 문서 원문이 나갑니다"}
    </span>
  );
}
