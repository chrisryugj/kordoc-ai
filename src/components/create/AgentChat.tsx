/**
 * 편집기 AI 대화 — 열린 한글 문서를 말로 고친다: 찾아 바꾸기·문단 넣기·표 칸 채우기·줄 넣기·누름틀·서식·스타일.
 * 도구는 편집기 안 AI 플러그인이 실행하고(변경 하나 = 실행 취소 한 단계), 바뀐 곳으로 커서가 간다.
 * 요청 하나가 바꾼 것은 그 요청 뒤에 사용자가 문서를 고치지 않았을 때만 한 번에 되돌린다.
 * 편집기에서 글을 골라 두고 보내면 그 부분에 대한 요청으로 본다.
 */

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { MessageSquarePlus, Send, Square, Undo2 } from "lucide-react";
import { useApp } from "../../state/app";
import { errorText, isAbort } from "../../lib/rpc";
import { Button } from "../ui/Button";
import { ErrorLine, Note } from "../common/Status";
import { useCreate } from "./session";
import { createAgentBridge } from "../../lib/hwp-agent/bridge";
import { createHwpSkill } from "../../lib/hwp-agent/tools";
import { runAgent, type AgentEvent } from "../../lib/hwp-agent/loop";

interface Entry {
  role: "user" | "assistant";
  text: string;
  /** 사용자가 골라 두고 보낸 글 (한 줄 발췌) */
  scope?: string;
  tools?: Array<{ summary: string; isError: boolean }>;
  /** 이 요청이 바꾼 것 — foreign: 요청 전 편집기의 남 변경 수 (되돌리기 확인용) */
  changes?: { count: number; foreign: number; state: "applied" | "reverted" | "refused" };
  error?: boolean;
}

const EXAMPLES = [
  "빈칸을 참고해 표를 채워 줘",
  "제목을 더 짧게 고쳐 줘",
  "고른 문단을 개조식으로 바꿔 줘",
  "추진일정 표에 행을 하나 더 넣어 줘",
];

export function AgentChat() {
  const { ai } = useApp();
  const { call, editorState, docSeq, session, agentTask, takeAgentTask } = useCreate();
  const [chat, setChat] = useState<Entry[]>([]);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [reverting, setReverting] = useState(false);
  const [error, setError] = useState("");
  const events = useRef<AgentEvent[]>([]);
  const ctrl = useRef<AbortController | null>(null);
  const runChanges = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);

  const bridge = useMemo(() => createAgentBridge(call), [call]);
  const skill = useMemo(() => createHwpSkill({
    bridge,
    onChange: (change) => {
      runChanges.current += 1;
      // 바뀐 곳으로 화면을 옮긴다 (문서 아래쪽 변경은 안 보이고 지나간다)
      if (change.place) void bridge.reveal(change.place).catch(() => undefined);
    },
  }), [bridge]);

  // 편집기에 다른 문서를 열기 시작하면 바로 멈춘다 (docSeq 는 다 연 뒤에 올라 그 사이 도구 호출이 새 문서로 갈 수 있다)
  useEffect(() => { ctrl.current?.abort(); }, [session?.path]);

  // 편집기에 다른 문서를 열면 대화를 새로 시작한다 (앞 문서의 도구 결과·되돌리기가 새 문서로 새지 않게)
  useEffect(() => {
    // 돌던 요청도 멈춘다 — 남은 도구 호출이 새 문서에 적용되지 않게
    ctrl.current?.abort();
    setChat([]);
    events.current = [];
    setError("");
  }, [docSeq]);
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight }); }, [chat]);

  // 결재 전 점검에서 "편집기에서 AI로 고치기"로 열었으면 문서가 다 열린 뒤 그 요청을 한 번 보낸다
  // 요청은 편집 세션이 갖고 있다가(그 문서를 다 연 번호와 함께) 여기서 꺼내면 지워진다: 패널을 접었다 펴도 다시 가지 않는다
  useEffect(() => {
    if (!agentTask || agentTask.seq !== docSeq || !ai?.configured || editorState !== "ready" || busy) return;
    const t = takeAgentTask(docSeq);
    if (t) void send(t.text, t.label);
    // send 는 매번 새로 만들어진다: 요청·문서 번호·준비 상태에만 반응한다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentTask, docSeq, ai?.configured, editorState, busy, takeAgentTask]);

  const patchLast = (fn: (e: Entry) => Entry) => setChat((prev) => (prev.length ? [...prev.slice(0, -1), fn(prev[prev.length - 1])] : prev));

  /** label: 대화창에 보일 말 (모델에는 text 전체를 보낸다) */
  const send = async (text: string, label?: string) => {
    const request = text.trim();
    if (!request || busy || editorState !== "ready") return;
    setError("");
    setPrompt("");
    setBusy(true);
    const ac = new AbortController();
    ctrl.current = ac;
    runChanges.current = 0;
    let foreign = -1;
    try {
      // 편집기에서 글을 골라 두고 보냈으면 그 커서가 있는 본문 문단 (스튜디오 선택 정보에는 범위가 없다)
      const sel = await call("selection_text", {}).catch(() => null);
      const scope = sel && !sel.collapsed && sel.text.trim() ? sel : null;
      skill.setSelection(scope ? { text: scope.text, ...(scope.target ? { at: `${scope.target.section}.${scope.target.paragraph}` } : {}) } : null);
      const excerpt = scope ? scope.text.replace(/\s+/g, " ").trim().slice(0, 120) : undefined;
      setChat((prev) => [...prev, { role: "user", text: label ?? request, ...(excerpt ? { scope: excerpt } : {}) }, { role: "assistant", text: "", tools: [] }]);
      const [f] = await Promise.all([bridge.foreignChanges().catch(() => -1), skill.refreshContext()]);
      foreign = f;
      const r = await runAgent({
        skill: skill.skill,
        events: events.current,
        request,
        signal: ac.signal,
        hooks: {
          onText: (t) => patchLast((e) => ({ ...e, text: t })),
          onTool: (t) => patchLast((e) => ({ ...e, tools: [...(e.tools ?? []), { summary: t.summary, isError: t.isError }] })),
        },
      });
      const note = r.redacted ? `\n\n(인터넷 AI 로 보내기 전 개인정보 ${r.redacted}건을 가렸습니다. 가린 글은 찾아 바꾸지 못할 수 있습니다.)` : "";
      patchLast((e) => ({ ...e, text: (r.text || e.text || "끝났습니다.") + note }));
    } catch (e) {
      // rpc 는 이름만 AbortError 인 Error 를 던진다 (DOMException 만 보면 멈추기가 빨간 오류로 보였다)
      const aborted = isAbort(e);
      patchLast((x) => ({ ...x, text: aborted ? "멈췄습니다." : errorText(e), error: !aborted }));
    } finally {
      const count = runChanges.current;
      if (count) patchLast((e) => ({ ...e, changes: { count, foreign, state: foreign < 0 ? "refused" : "applied" } }));
      setBusy(false);
      ctrl.current = null;
    }
  };

  // 되돌리기는 가장 최근 요청만 (편집기 실행 취소 기록이 한 줄이라서)
  const lastIdx = chat.reduce((n, e, i) => (e.changes ? i : n), -1);
  const revert = (i: number) => {
    const c = chat[i]?.changes;
    if (!c || c.state !== "applied" || i !== lastIdx || busy || reverting) return;
    setReverting(true);
    void bridge.undo(c.count, c.foreign).then(
      (r) => {
        setChat((prev) => prev.map((e, k) => (k === i && e.changes ? { ...e, changes: { ...e.changes, state: r.ok ? "reverted" : "refused" } } : e)));
        if (r.ok) events.current.push({ role: "user", text: "(사용자가 바로 앞 요청의 변경을 모두 되돌렸습니다. 문서는 그 요청 전 상태입니다.)" });
      },
      (e) => setError(errorText(e)),
    ).finally(() => setReverting(false));
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(prompt); }
  };

  if (!ai?.configured) return <Note tone="info">AI 연결이 필요합니다. 설정의 AI 연결에서 고르세요.</Note>;
  if (editorState !== "ready") return <Note tone="info">편집기에 문서가 열리면 말로 고칠 수 있습니다.</Note>;

  return (
    <div className="flex flex-col gap-3">
      <div ref={listRef} className="flex flex-col gap-2.5" style={{ maxHeight: "52vh", overflowY: "auto" }} aria-live="polite">
        {chat.length === 0 && (
          <div className="flex flex-col gap-1.5">
            <p className="kd-small kd-muted">열린 문서를 말로 고칩니다. 바꾼 곳으로 커서가 가고, 요청 하나를 통째로 되돌릴 수 있습니다. 고칠 문단에 커서를 두고 보내면 그 문단에 대한 요청으로 봅니다.</p>
            <div className="flex flex-wrap gap-1.5">
              {EXAMPLES.map((x) => <button key={x} type="button" className="kd-chip" onClick={() => setPrompt(x)}>{x}</button>)}
            </div>
          </div>
        )}
        {chat.map((e, i) => (
          <div key={i} className={e.role === "user" ? "kd-inset p-2.5" : "flex flex-col gap-1.5"}>
            {e.scope && <p className="kd-small kd-muted">고른 곳이 든 문단: "{e.scope}"</p>}
            {e.tools && e.tools.length > 0 && (
              <ul className="flex flex-col gap-0.5">
                {e.tools.map((t, k) => <li key={k} className="kd-small" style={{ color: t.isError ? "var(--color-warning)" : "var(--color-text-muted)" }}>{t.isError ? "· 못 함: " : "· "}{t.summary}</li>)}
              </ul>
            )}
            {e.text ? <p className="kd-text kd-pre" style={e.error ? { color: "var(--color-error)" } : undefined}>{e.text}</p> : (busy && i === chat.length - 1 ? <p className="kd-small kd-muted">생각하는 중…</p> : null)}
            {e.changes && (
              <div className="flex items-center gap-2">
                <span className="kd-small kd-muted">바꾼 곳 {e.changes.count}개{e.changes.state === "reverted" ? " · 되돌림" : e.changes.state === "refused" ? " · 되돌릴 수 없음(그 뒤 문서를 고쳤거나 시작점을 모름)" : ""}</span>
                {e.changes.state === "applied" && i === lastIdx && (
                  <Button size="sm" variant="ghost" disabled={busy || reverting} onClick={() => revert(i)}><Undo2 size={12} /> 이 요청 되돌리기</Button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
      <ErrorLine message={error} />
      <textarea className="kd-textarea" rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} onKeyDown={onKey}
        placeholder="무엇을 고칠까요? (Enter 보내기 · Shift+Enter 줄바꿈)" aria-label="편집기 AI 에게 요청" disabled={busy} />
      <div className="flex gap-2">
        {busy
          ? <Button variant="secondary" size="sm" onClick={() => ctrl.current?.abort()}><Square size={12} /> 멈추기</Button>
          : <Button size="sm" disabled={!prompt.trim()} onClick={() => void send(prompt)}><Send size={12} /> 보내기</Button>}
        {!busy && chat.length > 0 && (
          <Button size="sm" variant="ghost" onClick={() => { setChat([]); events.current = []; setError(""); }}><MessageSquarePlus size={12} /> 새 대화</Button>
        )}
      </div>
    </div>
  );
}
