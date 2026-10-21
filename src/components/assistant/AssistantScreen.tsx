/** AI 비서 — 문서 여러 개를 대화에 붙이고 묻기(근거 [n] 누르면 작업대 그 쪽) + 글 다듬기 */

import { useEffect, useRef, useState } from "react";
import { BookOpenText, Copy, FilePen, FileUp, MessageSquareText, Send, Sparkles, Square, Trash2, X } from "lucide-react";
import type { Citation } from "../../lib/contract";
import { useApp } from "../../state/app";
import { rpc } from "../../lib/rpc";
import { pickFiles } from "../../lib/native";
import { baseName, formatOf } from "../../lib/format";
import { useChat } from "../../hooks/useChat";
import { useTask } from "../../hooks/useTask";
import { ScreenHeader } from "../shell/ScreenHeader";
import { Button } from "../ui/Button";
import { Field, SelectField } from "../common/Field";
import { AiGate, AiWhere } from "../common/AiGate";
import { ChatThread } from "../common/ChatThread";
import { Empty, ErrorLine } from "../common/Status";
import { FormatBadge } from "../common/FormatBadge";

type Mode = "polish" | "concise" | "formal" | "plain" | "gaejosik" | "narrative" | "public" | "press" | "expand" | "english" | "custom";
const MODES: Array<{ value: Mode; label: string }> = [
  { value: "polish", label: "매끄럽게 다듬기" }, { value: "concise", label: "간결하게" }, { value: "formal", label: "공문체로" },
  { value: "gaejosik", label: "개조식으로" }, { value: "narrative", label: "서술문으로" }, { value: "public", label: "쉬운 공공언어로" },
  { value: "plain", label: "쉬운 말로" }, { value: "press", label: "보도자료 문체로" }, { value: "expand", label: "늘려 쓰기" },
  { value: "english", label: "영어로" }, { value: "custom", label: "직접 지시" },
];
const SUGGEST = ["이 문서들의 핵심을 세 줄로", "일정과 담당 부서를 표로 정리해 줘", "예산이 나오는 곳만 찾아 줘", "두 문서에서 서로 다른 내용은?"];

function Ask() {
  const { docs, openDocs, assistantIntent, registerDrop, dragTarget } = useApp();
  const [paths, setPaths] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const chat = useChat(paths);
  const handled = useRef(0);

  useEffect(() => {
    if (!assistantIntent || assistantIntent.nonce === handled.current) return;
    handled.current = assistantIntent.nonce;
    if (assistantIntent.value.paths.length) setPaths((p) => [...new Set([...p, ...assistantIntent.value.paths])]);
  }, [assistantIntent]);
  useEffect(() => registerDrop("assistant", (p) => setPaths((cur) => [...new Set([...cur, ...p])])), [registerDrop]);

  const onCite = (c: Citation) => openDocs([c.path], { page: c.page });
  const send = (text: string) => { if (!chat.busy && text.trim()) { void chat.send(text); setQ(""); } };

  return (
    <div className="kd-assistant">
      <aside className="kd-attach" data-drop="assistant" data-over={dragTarget === "assistant"} aria-label="대화에 붙인 문서">
        <div className="kd-block-head">
          <h2 className="kd-h3">붙인 문서 {paths.length}</h2>
          {paths.length > 0 && <button type="button" className="kd-link kd-small" onClick={() => { setPaths([]); chat.reset(); }}>모두 빼기</button>}
        </div>
        {paths.length === 0 ? <p className="kd-small kd-muted py-2">물어볼 문서를 끌어다 놓거나 붙이세요. 여러 문서에 함께 물어도 됩니다.</p> : (
          <ul className="flex flex-col gap-1 py-2">
            {paths.map((p) => (
              <li key={p} className="kd-attach-item">
                <FormatBadge format={formatOf(p)} />
                <span className="kd-small min-w-0 flex-1 font-semibold" style={{ overflowWrap: "anywhere" }}>{baseName(p)}</span>
                <button type="button" className="kd-icon-btn" style={{ width: 26, height: 26 }} onClick={() => setPaths(paths.filter((x) => x !== p))} aria-label={`${baseName(p)} 빼기`}><X size={13} /></button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-col gap-1.5">
          <Button variant="secondary" size="sm" onClick={() => void pickFiles().then((p) => setPaths((cur) => [...new Set([...cur, ...p])]))}><FileUp size={13} /> 문서 붙이기</Button>
          {docs.length > 0 && <Button variant="ghost" size="sm" onClick={() => setPaths((cur) => [...new Set([...cur, ...docs.map((d) => d.path)])])}><BookOpenText size={13} /> 연 문서 {docs.length}개 가져오기</Button>}
        </div>
      </aside>

      <section className="kd-chat" aria-label="대화">
        <div className="kd-chat-scroll">
          <div className="kd-chat-inner">
            <ChatThread items={chat.items} onCite={onCite} empty={(
              <Empty icon={<MessageSquareText size={30} />} title={paths.length ? "붙인 문서에 물어보세요" : "먼저 문서를 붙이세요"}>
                <span className="block">답에 붙은 번호를 누르면 근거가 있는 쪽을 문서 화면에서 엽니다.</span>
                {paths.length > 0 && (
                  <span className="mt-3 flex flex-wrap justify-center gap-1.5">
                    {SUGGEST.map((s) => <button key={s} type="button" className="kd-chip" onClick={() => send(s)}>{s}</button>)}
                  </span>
                )}
              </Empty>
            )} />
          </div>
        </div>
        <form className="kd-composer" onSubmit={(e) => { e.preventDefault(); send(q); }}>
          <div className="flex items-center justify-between gap-2 pb-1.5">
            <AiWhere />
            {chat.items.length > 0 && <button type="button" className="kd-link kd-small" onClick={chat.reset}><Trash2 size={12} className="inline -mt-0.5" /> 대화 지우기</button>}
          </div>
          <div className="flex items-end gap-2">
            <textarea className="kd-textarea" rows={2} value={q} disabled={!paths.length} placeholder={paths.length ? "질문을 쓰고 Enter (줄바꿈은 Shift+Enter)" : "왼쪽에 문서를 먼저 붙이세요"} aria-label="질문"
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !(e.nativeEvent.isComposing || e.keyCode === 229)) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }} />
            {chat.busy
              ? <Button type="button" size="lg" variant="secondary" onClick={chat.stop}><Square size={14} /> 멈추기</Button>
              : <Button type="submit" size="lg" disabled={!q.trim() || !paths.length}><Send size={15} /> 묻기</Button>}
          </div>
        </form>
      </section>
    </div>
  );
}

function Rewrite() {
  const { toast, startCreate, assistantIntent } = useApp();
  const [text, setText] = useState("");
  const [mode, setMode] = useState<Mode>("polish");
  const [instruction, setInstruction] = useState("");
  const [out, setOut] = useState("");
  const task = useTask<{ text: string; redacted: number }>();
  const handled = useRef(0);

  useEffect(() => {
    if (!assistantIntent || assistantIntent.nonce === handled.current || !assistantIntent.value.text) return;
    handled.current = assistantIntent.nonce;
    setText(assistantIntent.value.text);
  }, [assistantIntent]);

  const run = () => {
    setOut("");
    void task.run(({ signal }) => rpc("ai_rewrite", { text, mode, ...(mode === "custom" ? { instruction } : {}) }, { signal, onToken: (t) => setOut((o) => o + t) }));
  };
  const result = task.result?.text ?? out;

  return (
    <div className="kd-rewrite">
      <section className="flex min-h-0 flex-col gap-3">
        <h2 className="kd-h3">다듬을 글</h2>
        <textarea className="kd-textarea flex-1" value={text} onChange={(e) => setText(e.target.value)} placeholder="보고서 문단, 민원 답변, 안내문을 붙여 넣으세요" aria-label="다듬을 글" />
        <div className="flex flex-wrap items-end gap-3">
          <div style={{ minWidth: 190 }}><SelectField label="어떻게" value={mode} onChange={setMode} options={MODES} /></div>
          {mode === "custom" && <div className="min-w-0 flex-1"><Field label="지시"><input className="kd-input" value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder="예: 어르신이 읽기 쉽게, 한 문장은 짧게" aria-label="다듬기 지시" /></Field></div>}
          {task.busy
            ? <Button size="lg" variant="secondary" onClick={task.cancel}><Square size={14} /> 멈추기</Button>
            : <Button size="lg" disabled={!text.trim() || (mode === "custom" && !instruction.trim())} onClick={run}><Sparkles size={15} /> 다듬기</Button>}
        </div>
        <ErrorLine message={task.error} />
      </section>
      <section className="flex min-h-0 flex-col gap-3">
        <div className="flex items-center justify-between gap-2"><h2 className="kd-h3">다듬은 글</h2><AiWhere /></div>
        <div className="kd-inset kd-rewrite-out" aria-live="polite">
          {result ? <p className="kd-text kd-pre">{result}</p> : <p className="kd-small kd-muted">다듬은 글이 여기에 나옵니다.</p>}
        </div>
        {result && !task.busy && (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => void navigator.clipboard.writeText(result).then(() => toast("복사했습니다", "success"))}><Copy size={14} /> 복사</Button>
            <Button variant="secondary" onClick={() => startCreate({ route: "ai", markdown: result })}><FilePen size={14} /> 새로 쓰기로 보내기</Button>
            {!!task.result?.redacted && <span className="kd-small kd-muted self-center">개인정보 {task.result.redacted}건을 가리고 보냈습니다</span>}
          </div>
        )}
      </section>
    </div>
  );
}

export function AssistantScreen({ active }: { active: boolean }) {
  const { assistantIntent } = useApp();
  const [tab, setTab] = useState<"ask" | "rewrite">("ask");
  useEffect(() => { if (assistantIntent?.value.tab) setTab(assistantIntent.value.tab); }, [assistantIntent]);

  return (
    <div className="kd-screen" hidden={!active}>
      <ScreenHeader title="물어보기" sub="문서를 붙여 놓고 묻거나, 쓴 글을 공문서답게 다듬습니다.">
        <div className="kd-tabs kd-head-tabs" role="tablist" aria-label="물어보기">
          <button type="button" role="tab" className="kd-tab" aria-selected={tab === "ask"} onClick={() => setTab("ask")}>묻기</button>
          <button type="button" role="tab" className="kd-tab" aria-selected={tab === "rewrite"} onClick={() => setTab("rewrite")}>다듬기</button>
        </div>
      </ScreenHeader>
      <div className="kd-body kd-body-fixed">
        <AiGate>
          <div hidden={tab !== "ask"} className="h-full"><Ask /></div>
          <div hidden={tab !== "rewrite"} className="h-full"><Rewrite /></div>
        </AiGate>
      </div>
    </div>
  );
}
