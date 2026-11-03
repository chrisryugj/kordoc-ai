/**
 * AI에게 일 시키기 — 파일·폴더를 붙이고 말로 시키면 AI 가 앱 도구(읽기·공문 작성·서식 채우기·수합·점검·개인정보 가리기·PDF)를 차례로 써서 끝낸다.
 * 도구는 엔진의 작업 에이전트 도구(MCP 로 바깥 AI 에이전트에 내는 것과 같은 목록). 결과는 늘 새 파일이고 원본은 그대로.
 */

import { useEffect, useRef, useState } from "react";
import { FileUp, FolderOpen, FolderUp, MessageSquarePlus, Send, Square, Wrench, X, ExternalLink } from "lucide-react";
import { useApp } from "../../state/app";
import { errorText, isAbort, rpc } from "../../lib/rpc";
import { pickFiles, pickFolder } from "../../lib/native";
import { baseName, formatOf } from "../../lib/format";
import { createWorkSkill } from "../../lib/work-agent";
import { runAgent, type AgentEvent } from "../../lib/hwp-agent/loop";
import type { AgentSkill } from "../../lib/hwp-agent/types";
import { Button } from "../ui/Button";
import { AiWhere } from "../common/AiGate";
import { Empty, ErrorLine } from "../common/Status";
import { FormatBadge } from "../common/FormatBadge";

interface Entry {
  role: "user" | "assistant";
  text: string;
  tools?: Array<{ summary: string; isError: boolean }>;
  files?: string[];
  error?: boolean;
}

const EXAMPLES = [
  "붙인 받은 공문에 회신하는 기안문을 만들어 줘",
  "붙인 폴더의 부서 제출물을 엑셀 한 장으로 모아 줘",
  "결재 올리기 전에 점검하고 고칠 수 있는 건 고쳐 줘",
  "개인정보를 가린 뒤 PDF 로 만들어 줘",
];

export function WorkAgent() {
  const { registerDrop, dragTarget } = useApp();
  const [paths, setPaths] = useState<string[]>([]);
  const [chat, setChat] = useState<Entry[]>([]);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const events = useRef<AgentEvent[]>([]);
  const ctrl = useRef<AbortController | null>(null);
  const skill = useRef<AgentSkill | null>(null);
  const pathsRef = useRef(paths);
  pathsRef.current = paths;
  const listRef = useRef<HTMLDivElement>(null);

  const add = (p: string[]) => setPaths((cur) => [...new Set([...cur, ...p])]);
  useEffect(() => registerDrop("work", add), [registerDrop]);
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight }); }, [chat]);

  const patchLast = (fn: (e: Entry) => Entry) => setChat((prev) => (prev.length ? [...prev.slice(0, -1), fn(prev[prev.length - 1])] : prev));

  const send = async (text: string) => {
    const request = text.trim();
    if (!request || busy) return;
    setError("");
    setPrompt("");
    setBusy(true);
    const ac = new AbortController();
    ctrl.current = ac;
    setChat((prev) => [...prev, { role: "user", text: request }, { role: "assistant", text: "", tools: [], files: [] }]);
    try {
      skill.current ??= await createWorkSkill({
        files: () => pathsRef.current,
        onFiles: (f) => patchLast((e) => ({ ...e, files: [...new Set([...(e.files ?? []), ...f])] })),
      });
      const r = await runAgent({
        skill: skill.current,
        events: events.current,
        request,
        signal: ac.signal,
        hooks: {
          onText: (t) => patchLast((e) => ({ ...e, text: t })),
          onTool: (t) => patchLast((e) => ({ ...e, tools: [...(e.tools ?? []), { summary: t.summary, isError: t.isError }] })),
        },
      });
      const note = r.redacted ? `\n\n(인터넷 AI 로 보내기 전 개인정보 ${r.redacted}건을 가렸습니다.)` : "";
      patchLast((e) => ({ ...e, text: (r.text || e.text || "끝났습니다.") + note }));
    } catch (e) {
      const aborted = isAbort(e);
      patchLast((x) => ({ ...x, text: aborted ? "멈췄습니다." : errorText(e), error: !aborted }));
    } finally {
      setBusy(false);
      ctrl.current = null;
    }
  };

  const reset = () => { setChat([]); events.current = []; setError(""); };
  const openFile = (p: string) => void rpc("open_file", { path: p }).catch((e) => setError(errorText(e)));
  const reveal = (p: string) => void rpc("reveal_file", { path: p }).catch((e) => setError(errorText(e)));

  return (
    <div className="kd-assistant">
      <aside className="kd-attach" data-drop="work" data-over={dragTarget === "work"} aria-label="일에 쓸 파일">
        <div className="kd-block-head">
          <h2 className="kd-h3">붙인 파일 {paths.length}</h2>
          {paths.length > 0 && <button type="button" className="kd-link kd-small" onClick={() => setPaths([])}>모두 빼기</button>}
        </div>
        {paths.length === 0 ? <p className="kd-small kd-muted py-2">일에 쓸 문서나 폴더를 끌어다 놓거나 붙이세요. 원본은 고치지 않고 결과는 늘 새 파일로 저장합니다.</p> : (
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
          <Button variant="secondary" size="sm" onClick={() => void pickFiles().then(add)}><FileUp size={13} /> 파일 붙이기</Button>
          <Button variant="ghost" size="sm" onClick={() => void pickFolder().then((d) => d && add([d]))}><FolderUp size={13} /> 폴더 붙이기</Button>
        </div>
      </aside>

      <section className="kd-chat" aria-label="일 시키기">
        <div className="kd-chat-scroll" ref={listRef}>
          <div className="kd-chat-inner flex flex-col gap-3" aria-live="polite">
            {chat.length === 0 && (
              <Empty icon={<Wrench size={30} />} title="말로 일을 시키세요">
                <span className="block">AI 가 문서를 읽고, 공문을 쓰고, 서식을 채우고, 점검·가리기·PDF 까지 앱 기능을 차례로 씁니다.</span>
                <span className="mt-3 flex flex-wrap justify-center gap-1.5">
                  {EXAMPLES.map((x) => <button key={x} type="button" className="kd-chip" onClick={() => setPrompt(x)}>{x}</button>)}
                </span>
              </Empty>
            )}
            {chat.map((e, i) => (
              <div key={i} className={e.role === "user" ? "kd-inset p-2.5" : "flex flex-col gap-1.5"}>
                {e.tools && e.tools.length > 0 && (
                  <ul className="flex flex-col gap-0.5">
                    {e.tools.map((t, k) => <li key={k} className="kd-small" style={{ color: t.isError ? "var(--color-warning)" : "var(--color-text-muted)" }}>{t.isError ? "· 못 함: " : "· "}{t.summary}</li>)}
                  </ul>
                )}
                {e.text ? <p className="kd-text kd-pre" style={e.error ? { color: "var(--color-error)" } : undefined}>{e.text}</p> : (busy && i === chat.length - 1 ? <p className="kd-small kd-muted">일하는 중…</p> : null)}
                {e.files && e.files.length > 0 && (
                  <ul className="flex flex-col gap-1">
                    {e.files.map((f) => (
                      <li key={f} className="kd-attach-item">
                        <FormatBadge format={formatOf(f)} />
                        <span className="kd-small min-w-0 flex-1 font-semibold" style={{ overflowWrap: "anywhere" }}>{baseName(f)}</span>
                        <Button size="sm" variant="ghost" onClick={() => openFile(f)}><ExternalLink size={12} /> 열기</Button>
                        <Button size="sm" variant="ghost" onClick={() => reveal(f)}><FolderOpen size={12} /> 폴더</Button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </div>
        <form className="kd-composer" onSubmit={(e) => { e.preventDefault(); void send(prompt); }}>
          <div className="flex items-center justify-between gap-2 pb-1.5">
            <AiWhere />
            {!busy && chat.length > 0 && <button type="button" className="kd-link kd-small" onClick={reset}><MessageSquarePlus size={12} className="inline -mt-0.5" /> 새 대화</button>}
          </div>
          <ErrorLine message={error} />
          <div className="flex items-end gap-2">
            <textarea className="kd-textarea" rows={2} value={prompt} disabled={busy} placeholder="무엇을 할까요? (Enter 보내기 · Shift+Enter 줄바꿈)" aria-label="AI 에게 시킬 일"
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !(e.nativeEvent.isComposing || e.keyCode === 229)) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }} />
            {busy
              ? <Button type="button" size="lg" variant="secondary" onClick={() => ctrl.current?.abort()}><Square size={14} /> 멈추기</Button>
              : <Button type="submit" size="lg" disabled={!prompt.trim()}><Send size={15} /> 시키기</Button>}
          </div>
        </form>
      </section>
    </div>
  );
}
