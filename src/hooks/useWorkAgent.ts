/**
 * AI 에게 일 시키기 — 한 대화의 상태와 보내기·멈추기. 홈·문서 카드·물어보기가 같이 쓴다.
 * 도구는 엔진의 작업 에이전트 도구(MCP 와 같은 목록), 모델 루프는 hwp-agent/loop.ts.
 */

import { useCallback, useRef, useState } from "react";
import { errorText, isAbort } from "../lib/rpc";
import { createWorkSkill } from "../lib/work-agent";
import { runAgent, type AgentEvent } from "../lib/hwp-agent/loop";
import type { AgentSkill } from "../lib/hwp-agent/types";

export interface AgentStep { tool: string; summary: string; isError: boolean }

export interface AgentTurn {
  request: string;
  steps: AgentStep[];
  text: string;
  files: string[];
  /** 손으로 하면 걸릴 분 (효과 집계 기준 가정치) */
  saved: number;
  state: "running" | "done" | "stopped" | "error";
  startedAt: number;
  ms?: number;
}

export function useWorkAgent(paths: string[]) {
  const [turns, setTurns] = useState<AgentTurn[]>([]);
  const events = useRef<AgentEvent[]>([]);
  const ctrl = useRef<AbortController | null>(null);
  const skill = useRef<AgentSkill | null>(null);
  const pathsRef = useRef(paths);
  pathsRef.current = paths;
  const busy = turns.some((t) => t.state === "running");

  const patch = (fn: (t: AgentTurn) => AgentTurn) => setTurns((prev) => (prev.length ? [...prev.slice(0, -1), fn(prev[prev.length - 1])] : prev));

  const send = useCallback(async (text: string) => {
    const request = text.trim();
    if (!request || ctrl.current) return;
    const ac = new AbortController();
    ctrl.current = ac;
    const startedAt = Date.now();
    setTurns((prev) => [...prev, { request, steps: [], text: "", files: [], saved: 0, state: "running", startedAt }]);
    try {
      skill.current ??= await createWorkSkill({
        files: () => pathsRef.current,
        onFiles: (f) => patch((t) => ({ ...t, files: [...new Set([...t.files, ...f])] })),
        onSaved: (m) => patch((t) => ({ ...t, saved: t.saved + m })),
      });
      const r = await runAgent({
        skill: skill.current,
        events: events.current,
        request,
        signal: ac.signal,
        hooks: {
          onText: (s) => patch((t) => ({ ...t, text: s })),
          onTool: (s) => patch((t) => ({ ...t, steps: [...t.steps, { tool: s.name, summary: s.summary, isError: s.isError }] })),
        },
      });
      const note = r.redacted ? `\n\n(인터넷 AI 로 보내기 전 개인정보 ${r.redacted}건을 가렸습니다.)` : "";
      patch((t) => ({ ...t, text: (r.text || t.text || "끝났습니다.") + note, state: "done", ms: Date.now() - startedAt }));
    } catch (e) {
      const aborted = isAbort(e);
      patch((t) => ({ ...t, text: aborted ? "멈췄습니다." : errorText(e), state: aborted ? "stopped" : "error", ms: Date.now() - startedAt }));
    } finally {
      ctrl.current = null;
    }
  }, []);

  const stop = useCallback(() => ctrl.current?.abort(), []);
  const reset = useCallback(() => { ctrl.current?.abort(); setTurns([]); events.current = []; }, []);

  return { turns, busy, send, stop, reset };
}
