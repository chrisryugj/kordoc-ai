/** AI — 요약(토큰 실시간) + 이 문서에 묻기(근거 [n] 누르면 그 쪽으로) */

import { useEffect, useMemo, useRef, useState } from "react";
import { Copy, Send, Sparkles, Square } from "lucide-react";
import type { ToolProps } from "../ToolPanel";
import type { Citation } from "../../../lib/contract";
import { useApp } from "../../../state/app";
import { rpc } from "../../../lib/rpc";
import { useTask } from "../../../hooks/useTask";
import { useChat } from "../../../hooks/useChat";
import { Button } from "../../ui/Button";
import { Field, Seg } from "../../common/Field";
import { AiGate, AiWhere } from "../../common/AiGate";
import { ChatThread } from "../../common/ChatThread";
import { ErrorLine } from "../../common/Status";
import { FollowUp } from "./FollowUp";

type Style = "standard" | "briefing" | "review" | "action";
type Length = "short" | "medium" | "long";

export function AiTool({ doc, autoSummary, onGoPage }: ToolProps & { autoSummary: number; onGoPage: (page: number) => void }) {
  const { toast, openDocs } = useApp();
  const [style, setStyle] = useState<Style>("standard");
  const [length, setLength] = useState<Length>("medium");
  const [stream, setStream] = useState("");
  const [question, setQuestion] = useState("");
  const summary = useTask<{ summary: string; redacted: number }>();
  const paths = useMemo(() => [doc.path], [doc.path]);
  const chat = useChat(paths);
  const lastAuto = useRef(0);

  const summarize = () => {
    setStream("");
    void summary.run(({ signal }) => rpc("ai_summarize", { path: doc.path, style, length }, { signal, onToken: (t) => setStream((s) => s + t) }));
  };

  useEffect(() => {
    if (autoSummary && autoSummary !== lastAuto.current) { lastAuto.current = autoSummary; summarize(); }
    // 우클릭 "AI 요약" 으로 들어왔을 때 한 번
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSummary]);

  // 문서를 닫으면 돌던 요약·답도 멈춘다 (엔진과 AI 를 계속 붙잡지 않게).
  // 개발 모드(StrictMode)는 붙였다 떼었다 다시 붙이므로, 뗀 뒤 다시 붙지 않았을 때만 멈춘다
  const { cancel } = summary;
  const { stop } = chat;
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      setTimeout(() => { if (!mounted.current) { cancel(); stop(); } }, 0);
    };
  }, [cancel, stop]);

  const onCite = (c: Citation) => (c.path === doc.path ? c.page && onGoPage(c.page) : openDocs([c.path], { page: c.page }));
  const text = summary.result?.summary ?? stream;

  return (
    <AiGate>
      <div className="flex flex-col gap-5">
        <AiWhere />
        <section className="flex flex-col gap-3" aria-labelledby="sum-t">
          <h3 id="sum-t" className="kd-h2">요약</h3>
          <Field label="어떤 요약">
            <Seg label="요약 갈래" value={style} onChange={setStyle} options={[{ value: "standard", label: "핵심" }, { value: "briefing", label: "보고용" }, { value: "review", label: "검토용" }, { value: "action", label: "할 일" }]} />
          </Field>
          <Field label="길이">
            <Seg label="요약 길이" value={length} onChange={setLength} options={[{ value: "short", label: "짧게" }, { value: "medium", label: "보통" }, { value: "long", label: "길게" }]} />
          </Field>
          {summary.busy ? (
            <Button variant="secondary" onClick={summary.cancel}><Square size={13} /> 멈추기</Button>
          ) : (
            <Button onClick={summarize}><Sparkles size={14} /> 요약하기</Button>
          )}
          <ErrorLine message={summary.error} />
          {text && (
            <div className="kd-inset p-3">
              <p className="kd-text kd-pre" aria-live="polite">{text}</p>
              {!summary.busy && (
                <div className="mt-2 flex items-center justify-between gap-2">
                  <span className="kd-small kd-muted">{summary.result?.redacted ? `개인정보 ${summary.result.redacted}건을 가리고 보냈습니다` : ""}</span>
                  <Button variant="ghost" size="sm" onClick={() => void navigator.clipboard.writeText(text).then(() => toast("요약을 복사했습니다", "success"))}><Copy size={13} /> 복사</Button>
                </div>
              )}
            </div>
          )}
        </section>

        <FollowUp doc={doc} />

        <section className="flex flex-col gap-3" aria-labelledby="ask-t">
          <h3 id="ask-t" className="kd-h2">이 문서에 묻기</h3>
          <ChatThread items={chat.items} onCite={onCite}
            empty={<p className="kd-small kd-muted">예: 담당 부서와 기한만 표로 정리해 줘</p>} />
          <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); void chat.send(question); setQuestion(""); }}>
            <textarea className="kd-textarea" rows={2} value={question} placeholder="질문을 쓰고 Enter (줄바꿈은 Shift+Enter)" aria-label="질문"
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !(e.nativeEvent.isComposing || e.keyCode === 229)) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }} />
            {chat.busy ? (
              <Button type="button" variant="secondary" onClick={chat.stop}><Square size={13} /> 멈추기</Button>
            ) : (
              <Button type="submit" disabled={!question.trim()}><Send size={14} /> 묻기</Button>
            )}
          </form>
        </section>
      </div>
    </AiGate>
  );
}
