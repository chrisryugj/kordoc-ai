/** 받은 공문 회신 — AI 가 켜져 있으면 공문을 읽고 초안을 쓰고, 꺼져 있으면 서식함의 표준 기안문으로 (막다른 길을 만들지 않는다).
 *  문서 화면 머리·정보 칸과 접수함이 같이 쓴다 */

import { useApp } from "../../state/app";

export function useReply() {
  const { ai, startCreate } = useApp();
  const aiOn = !!ai?.configured;
  return {
    aiOn,
    start: (path: string) => (aiOn ? startCreate({ route: "ai", kind: "reply", references: [path] }) : startCreate({ route: "library" })),
    tip: aiOn
      ? "AI가 이 공문을 읽고 회신 기안문 초안을 씁니다. 받은 공문은 그대로 둡니다."
      : "AI가 꺼져 있어 서식함의 표준 기안문으로 직접 씁니다. AI를 켜면 초안까지 씁니다.",
  };
}
