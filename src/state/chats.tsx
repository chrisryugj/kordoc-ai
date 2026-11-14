/** 본창의 AI 대화 하나 — 홈 입력창과 AI 대화 화면이 같은 대화 목록·진행을 본다 */

import { createContext, useContext, type ReactNode } from "react";
import { useWorkAgent, type WorkAgent } from "../hooks/useWorkAgent";
import { useApp } from "./app";

const Ctx = createContext<WorkAgent | null>(null);

export function ChatProvider({ children }: { children: ReactNode }) {
  const { toast } = useApp();
  const agent = useWorkAgent({ notify: toast });
  return <Ctx.Provider value={agent}>{children}</Ctx.Provider>;
}

export function useChats(): WorkAgent {
  const v = useContext(Ctx);
  if (!v) throw new Error("ChatProvider 밖에서 useChats 를 불렀습니다");
  return v;
}
