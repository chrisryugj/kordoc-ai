/**
 * AI 대화 — 말로 일을 시키는 곳. 왼쪽은 대화 목록(새 대화·이름 바꾸기·지우기, 날짜별 묶음), 오른쪽은 고른 대화와 입력창.
 * 대화는 이 PC 에 저장되어 앱을 다시 켜도 이어 시킬 수 있다(lib/chat-store). 우클릭 문서 카드에서 시킨 대화도 여기 남는다.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { BookOpenText, Check, Loader2, PenLine, MessageSquarePlus, MousePointerClick, Pencil, Trash2, X } from "lucide-react";
import { useApp } from "../../state/app";
import { useChats } from "../../state/chats";
import { rpc } from "../../lib/rpc";
import { groupOf, type ChatMeta } from "../../lib/chat-store";
import { AgentComposer } from "../agent/AgentComposer";
import { AgentRun } from "../agent/AgentRun";
import { sampleSuggestions, type Samples } from "../agent/suggestions";
import { Button } from "../ui/Button";
import "./chat.css";

function ChatItem({ c, active, running, onOpen, onRename, onRemove }: {
  c: ChatMeta; active: boolean; running: boolean;
  onOpen: () => void; onRename: (t: string) => void; onRemove: () => void;
}) {
  const [mode, setMode] = useState<"view" | "edit" | "confirm">("view");
  const [draft, setDraft] = useState(c.title);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (mode === "edit") input.current?.select(); }, [mode]);

  if (mode === "edit") {
    const done = () => { if (draft.trim()) onRename(draft); setMode("view"); };
    return (
      <li className="kd-chatlist-item" data-active={active} data-mode="edit">
        <input ref={input} className="kd-chatlist-input" value={draft} aria-label="대화 이름" maxLength={60}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.nativeEvent.isComposing) return; if (e.key === "Enter") done(); if (e.key === "Escape") setMode("view"); }}
          onBlur={done} />
      </li>
    );
  }
  if (mode === "confirm") {
    return (
      <li className="kd-chatlist-item" data-active={active} data-mode="confirm">
        <span className="kd-chatlist-ask">이 대화를 지울까요?</span>
        <button type="button" className="kd-chatlist-act" data-danger="true" onClick={onRemove} aria-label="지우기"><Check size={15} /></button>
        <button type="button" className="kd-chatlist-act" onClick={() => setMode("view")} aria-label="취소"><X size={15} /></button>
      </li>
    );
  }
  return (
    <li className="kd-chatlist-item" data-active={active}>
      <button type="button" className="kd-chatlist-open" onClick={onOpen} aria-current={active ? "true" : undefined} title={c.title}>
        {running && <Loader2 size={14} className="kd-spin kd-chatlist-run" aria-label="일하는 중" />}
        <span className="kd-chatlist-title">{c.title}</span>
        {c.from === "card" && <span className="kd-chatlist-tag" title="탐색기 우클릭에서 시킨 대화"><MousePointerClick size={12} /></span>}
      </button>
      <span className="kd-chatlist-acts">
        <button type="button" className="kd-chatlist-act" onClick={() => { setDraft(c.title); setMode("edit"); }} aria-label={`${c.title} 이름 바꾸기`}><Pencil size={14} /></button>
        <button type="button" className="kd-chatlist-act" onClick={() => setMode("confirm")} aria-label={`${c.title} 지우기`}><Trash2 size={14} /></button>
      </span>
    </li>
  );
}

export function ChatScreen({ active }: { active: boolean }) {
  const { ready, workIntent, askAbout } = useApp();
  const chat = useChats();
  const [samples, setSamples] = useState<Samples | null>(null);
  const handled = useRef(0);
  const scroll = useRef<HTMLDivElement>(null);
  const mine = chat.runningId === chat.chatId;

  // 문서 화면의 "AI에게 시키기": 그 문서를 붙인 새 대화
  useEffect(() => {
    if (!workIntent || workIntent.nonce === handled.current) return;
    handled.current = workIntent.nonce;
    chat.newChat(workIntent.value.paths);
    requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>(".kd-convo .kd-ask-input")?.focus());
  }, [workIntent, chat]);

  useEffect(() => {
    if (ready && active && !samples) void rpc("samples_list", {}).then(setSamples, () => setSamples(null));
  }, [ready, active, samples]);

  // 새 진행이 붙으면 맨 아래로
  const last = chat.turns[chat.turns.length - 1];
  useEffect(() => {
    const el = scroll.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.chatId, chat.turns.length, last?.steps.length, last?.text, last?.files.length]);

  const groups = useMemo(() => {
    const out: Array<{ label: string; items: ChatMeta[] }> = [];
    for (const c of chat.chats) {
      const g = groupOf(c.updatedAt);
      const tail = out[out.length - 1];
      if (tail?.label === g) tail.items.push(c); else out.push({ label: g, items: [c] });
    }
    return out;
  }, [chat.chats]);

  const empty = chat.turns.length === 0;

  return (
    <div className="kd-screen" hidden={!active}>
      <div className="kd-chatapp" data-list={chat.chats.length > 0}>
        <aside className="kd-chatlist" aria-label="대화 목록">
          <div className="kd-chatlist-top">
            <Button variant="secondary" className="w-full" onClick={() => chat.newChat()}><MessageSquarePlus size={16} /> 새 대화</Button>
          </div>
          <div className="kd-chatlist-scroll">
            {groups.length === 0 && <p className="kd-chatlist-none">시킨 일이 여기에 대화로 남습니다. 앱을 다시 켜도 이어서 시킬 수 있습니다.</p>}
            {groups.map((g) => (
              <section key={g.label} className="kd-chatlist-group" aria-label={g.label}>
                <h2 className="kd-chatlist-label">{g.label}</h2>
                <ul>
                  {g.items.map((c) => (
                    <ChatItem key={c.id} c={c} active={c.id === chat.chatId} running={c.id === chat.runningId}
                      onOpen={() => chat.openChat(c.id)} onRename={(t) => chat.rename(c.id, t)} onRemove={() => chat.remove(c.id)} />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </aside>

        <section className="kd-convo" aria-label={chat.title ?? "새 대화"}>
          <header className="kd-convo-head">
            <h1 className="kd-convo-title">{chat.title ?? "새 대화"}</h1>
            {chat.busy && !mine && <span className="kd-convo-note"><Loader2 size={14} className="kd-spin" /> 다른 대화에서 일하는 중입니다. 끝나면 보낼 수 있습니다.</span>}
          </header>
          <div className="kd-convo-scroll" ref={scroll}>
            <div className="kd-convo-inner" data-empty={empty}>
              {empty ? (
                <div className="kd-convo-hello">
                  <div className="kd-convo-modes">
                    <button type="button" onClick={() => askAbout({ paths: chat.paths, tab: "ask" })} data-tip="여러 문서를 붙여 놓고 물으면 답마다 근거가 있는 쪽 번호를 답니다">
                      <BookOpenText size={18} /><b>문서에 묻기</b><span>답마다 근거 쪽을 달아 줍니다</span>
                    </button>
                    <button type="button" onClick={() => askAbout({ paths: [], tab: "rewrite" })} data-tip="붙여 넣은 글을 공문서 말투·개조식·쉬운 공공언어 등으로 고칩니다">
                      <PenLine size={18} /><b>글 다듬기</b><span>쓴 글을 공문서 말투로 고칩니다</span>
                    </button>
                  </div>
                </div>
              ) : (
                <AgentRun turns={chat.turns} onSend={(t) => void chat.send(t)} busy={chat.busy} />
              )}
            </div>
          </div>
          <div className="kd-convo-foot">
            <AgentComposer
              paths={chat.paths}
              onPaths={chat.setPaths}
              onSend={(t) => void chat.send(t)}
              onStop={chat.stop}
              busy={mine}
              locked={chat.busy && !mine}
              dropName="chat"
              placeholder={empty ? undefined : "이어서 맡길 일 입력"}
              suggestions={empty ? sampleSuggestions(samples) : []}
              gallery={empty}
            />
          </div>
        </section>
      </div>
    </div>
  );
}
