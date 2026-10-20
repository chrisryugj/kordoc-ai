/**
 * 편집기 AI 대화 — 열린 한글 문서를 말로 고친다: 찾아 바꾸기·문단 넣기·표 칸 채우기·누름틀·서식·각주·차례·칸 합치기 등.
 * 도구는 편집기 안 앱 플러그인이 실행하고(변경 하나 = 실행 취소 한 단계), 바뀐 곳은 쪽 위에 표시된다.
 * 요청 하나가 바꾼 것은 그 요청 뒤에 사용자가 문서를 고치지 않았을 때만 한 번에 되돌린다.
 * 편집기에서 글을 골라 두고 보내면 그 부분에 대한 요청으로 본다.
 */

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Send, Square, Undo2 } from "lucide-react";
import { useApp } from "../../state/app";
import { errorText } from "../../lib/rpc";
import { Button } from "../ui/Button";
import { ErrorLine, Note } from "../common/Status";
import { useCreate } from "./session";
import { createAgentBridge } from "../../lib/hwp-agent/bridge";
import { createHwpSkill } from "../../lib/hwp-agent/skill";
import { label } from "../../lib/hwp-agent/labels";
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
  const { call, editorState, docSeq } = useCreate();
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
    label,
    onChange: (change) => {
      runChanges.current += 1;
      // 바뀐 곳으로 화면을 옮긴다 (문서 아래쪽 변경은 안 보이고 지나간다)
      if (change.place) void bridge.reveal(change.place).catch(() => undefined);
    },
  }), [bridge]);

  // 편집기에 다른 문서를 열면 대화를 새로 시작한다 (앞 문서의 도구 결과·되돌리기가 새 문서로 새지 않게)
  useEffect(() => {
    setChat([]);
    events.current = [];
    setError("");
  }, [docSeq]);
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight }); }, [chat]);

  const patchLast = (fn: (e: Entry) => Entry) => setChat((prev) => (prev.length ? [...prev.slice(0, -1), fn(prev[prev.length - 1])] : prev));

  const send = async (text: string) => {
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
      const sel = await bridge.selection().catch(() => null);
      const scope = sel && sel.ok && !sel.own && sel.segments.length ? sel : null;
      skill.setSelection(scope ? { segments: scope.segments, inTable: scope.inTable, contiguous: scope.contiguous } : null);
      const excerpt = scope ? scope.segments.map((s) => s.text).join(" ").replace(/\s+/g, " ").trim().slice(0, 120) : undefined;
      setChat((prev) => [...prev, { role: "user", text: request, ...(excerpt ? { scope: excerpt } : {}) }, { role: "assistant", text: "", tools: [] }]);
      await bridge.clearMarks().catch(() => undefined);
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
      const aborted = e instanceof DOMException && e.name === "AbortError";
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
            <p className="kd-small kd-muted">열린 문서를 말로 고칩니다. 바꾼 곳은 쪽 위에 노랗게 표시되고, 요청 하나를 통째로 되돌릴 수 있습니다. 편집기에서 글을 골라 두고 보내면 그 부분만 고칩니다.</p>
            <div className="flex flex-wrap gap-1.5">
              {EXAMPLES.map((x) => <button key={x} type="button" className="kd-chip" onClick={() => setPrompt(x)}>{x}</button>)}
            </div>
          </div>
        )}
        {chat.map((e, i) => (
          <div key={i} className={e.role === "user" ? "kd-inset p-2.5" : "flex flex-col gap-1.5"}>
            {e.scope && <p className="kd-small kd-muted">고른 글: "{e.scope}"</p>}
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
      </div>
    </div>
  );
}
