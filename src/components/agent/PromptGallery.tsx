/**
 * 맡길 일 고르기 — 내 프롬프트(저장한 문장)와 갈래별 예시. 누르면 입력창에 넣고, 파일이 필요한 일은 그 표시를 단다.
 * 내 프롬프트는 이름 바꾸기·지우기가 되고 많이 쓴 차례로 선다.
 */

import { useEffect, useRef, useState } from "react";
import { Check, Paperclip, Pencil, Trash2, X } from "lucide-react";
import { PROMPTS } from "./prompts";
import { loadMyPrompts, removeMyPrompt, renameMyPrompt, useMyPrompt as countUse, type MyPrompt } from "../../lib/my-prompts";

function MyRow({ p, onPick, onChange }: { p: MyPrompt; onPick: (text: string) => void; onChange: () => void }) {
  const [edit, setEdit] = useState(false);
  const [draft, setDraft] = useState(p.title);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (edit) input.current?.select(); }, [edit]);
  if (edit) {
    const done = () => { renameMyPrompt(p.id, draft); setEdit(false); onChange(); };
    return (
      <li className="kd-pq-row" data-mode="edit">
        <input ref={input} className="kd-pq-input" value={draft} maxLength={40} aria-label="프롬프트 이름" onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.nativeEvent.isComposing) return; if (e.key === "Enter") done(); if (e.key === "Escape") setEdit(false); }} />
        <button type="button" className="kd-pq-act" onClick={done} aria-label="이름 저장"><Check size={14} /></button>
        <button type="button" className="kd-pq-act" onClick={() => setEdit(false)} aria-label="취소"><X size={14} /></button>
      </li>
    );
  }
  return (
    <li className="kd-pq-row">
      <button type="button" className="kd-pq-pick" onClick={() => { countUse(p.id); onPick(p.text); onChange(); }} data-tip={p.text}>
        <b>{p.title}</b><span>{p.text.replace(/\s+/g, " ")}</span>
      </button>
      {p.uses > 0 && <span className="kd-pq-uses" data-tip="쓴 횟수">{p.uses}</span>}
      <button type="button" className="kd-pq-act" onClick={() => { setDraft(p.title); setEdit(true); }} aria-label={`${p.title} 이름 바꾸기`}><Pencil size={13} /></button>
      <button type="button" className="kd-pq-act" onClick={() => { removeMyPrompt(p.id); onChange(); }} aria-label={`${p.title} 지우기`}><Trash2 size={13} /></button>
    </li>
  );
}

export function PromptGallery({ onPick, version }: { onPick: (text: string) => void; version: number }) {
  const [mine, setMine] = useState<MyPrompt[]>(loadMyPrompts);
  const [tab, setTab] = useState(() => (loadMyPrompts().length ? "mine" : PROMPTS[0].id));
  const reload = () => setMine(loadMyPrompts());
  // 입력창에서 새로 저장하면(version) 내 프롬프트 탭으로
  useEffect(() => { if (version) { reload(); setTab("mine"); } }, [version]);
  useEffect(() => {
    const on = (e: StorageEvent) => { if (e.key === "kordoc-my-prompts") reload(); };
    window.addEventListener("storage", on);
    return () => window.removeEventListener("storage", on);
  }, []);
  const group = PROMPTS.find((g) => g.id === tab);

  return (
    <div className="kd-pq" aria-label="맡길 일 고르기">
      <div className="kd-pq-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "mine"} onClick={() => setTab("mine")}>내 프롬프트{mine.length > 0 && <span className="kd-pq-count">{mine.length}</span>}</button>
        {PROMPTS.map((g) => <button key={g.id} type="button" role="tab" aria-selected={tab === g.id} onClick={() => setTab(g.id)}>{g.label}</button>)}
      </div>
      {tab === "mine" ? (
        mine.length === 0
          ? <p className="kd-pq-none">입력창에 쓴 문장을 저장하면 여기에 모입니다. 저장 단추는 입력창 오른쪽 아래에 있습니다.</p>
          : <ul className="kd-pq-list">{mine.map((p) => <MyRow key={p.id} p={p} onPick={onPick} onChange={reload} />)}</ul>
      ) : group && (
        <ul className="kd-pq-grid">
          {group.items.map((it) => (
            <li key={it.title}>
              <button type="button" className="kd-pq-card" onClick={() => onPick(it.text)}>
                <b>{it.title}{it.files ? <span className="kd-pq-need" data-tip={`파일 ${it.files}개 이상을 붙여야 합니다`}><Paperclip size={12} />{it.files}</span> : null}</b>
                <span>{it.text.replace(/\s+/g, " ")}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
