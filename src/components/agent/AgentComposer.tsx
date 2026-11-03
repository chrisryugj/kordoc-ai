/**
 * 말로 시키기 입력창 — 붙인 파일 칩, 파일·폴더 붙이기, 추천 문장, 보내기·멈추기.
 * 끌어 놓기는 dropName 으로 앱 공용 끌어 놓기에 등록한다. AI 가 꺼져 있으면 AI 켜기 패널을 함께 보인다.
 */

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { FileUp, FolderUp, Send, Square, X } from "lucide-react";
import { useApp } from "../../state/app";
import { pickFiles, pickFolder } from "../../lib/native";
import { baseName, formatOf } from "../../lib/format";
import { Button } from "../ui/Button";
import { AiWhere } from "../common/AiGate";
import { FormatBadge } from "../common/FormatBadge";
import { AiQuickSetup } from "./AiQuickSetup";
import "./agent.css";

export interface Suggestion { label: string; text: string; files?: string[] }

interface Props {
  paths: string[];
  onPaths: (paths: string[]) => void;
  onSend: (text: string) => void;
  onStop: () => void;
  busy: boolean;
  suggestions?: Suggestion[];
  placeholder?: string;
  dropName?: string;
  autoFocus?: boolean;
  /** 붙인 파일이 있을 때 입력창 아래 줄에 더 놓을 것 (AI 없이 할 수 있는 일) */
  extra?: React.ReactNode;
}

export function AgentComposer({ paths, onPaths, onSend, onStop, busy, suggestions = [], placeholder, dropName, autoFocus, extra }: Props) {
  const { ai, registerDrop, dragTarget } = useApp();
  const [text, setText] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);
  const pathsRef = useRef(paths);
  pathsRef.current = paths;
  const add = (p: string[]) => onPaths([...new Set([...pathsRef.current, ...p])]);

  useEffect(() => (dropName ? registerDrop(dropName, add) : undefined), [dropName, registerDrop]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (autoFocus) box.current?.focus(); }, [autoFocus]);
  // 글 길이에 맞춰 입력창 높이를 늘린다 (다섯 줄까지)
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 150)}px`;
  }, [text]);

  const aiOn = !!ai?.configured;
  const send = (t = text) => {
    if (!t.trim() || busy || !aiOn) return;
    onSend(t);
    setText("");
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  };
  const pick = (s: Suggestion) => {
    if (s.files?.length) add(s.files);
    setText(s.text);
    box.current?.focus();
  };

  return (
    <div className="flex flex-col gap-2.5">
      <div className="kd-ask" data-drop={dropName} data-over={!!dropName && dragTarget === dropName}>
        {paths.length > 0 && (
          <div className="kd-ask-files" aria-label="붙인 파일">
            {paths.map((p) => (
              <span key={p} className="kd-ask-file" title={p}>
                <FormatBadge format={formatOf(p)} />
                <span>{baseName(p)}</span>
                <button type="button" onClick={() => onPaths(paths.filter((x) => x !== p))} aria-label={`${baseName(p)} 빼기`}><X size={13} /></button>
              </span>
            ))}
          </div>
        )}
        <textarea ref={box} className="kd-ask-input" rows={2} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey}
          placeholder={placeholder ?? "무엇을 할까요? 문서를 끌어다 놓고 하고 싶은 일을 적으세요"} aria-label="AI 에게 시킬 일" disabled={busy} />
        <div className="kd-ask-bar">
          <Button size="sm" variant="ghost" onClick={() => void pickFiles().then((p) => p.length && add(p))}><FileUp size={14} /> 파일 붙이기</Button>
          <Button size="sm" variant="ghost" onClick={() => void pickFolder().then((d) => d && add([d]))}><FolderUp size={14} /> 폴더 붙이기</Button>
          {paths.length > 0 && extra}
          <span className="kd-ask-where"><AiWhere /></span>
          {busy
            ? <Button onClick={onStop} variant="secondary"><Square size={14} /> 멈추기</Button>
            : <Button onClick={() => send()} disabled={!text.trim() || !aiOn} title={aiOn ? undefined : "아래에서 AI 를 켜면 보낼 수 있습니다"}><Send size={14} /> 시키기</Button>}
        </div>
      </div>
      {!aiOn && <AiQuickSetup />}
      {suggestions.length > 0 && !busy && (
        <div className="kd-ask-sugs" aria-label="이렇게 시켜 보세요">
          {suggestions.map((s) => <button key={s.label} type="button" className="kd-chip" onClick={() => pick(s)}>{s.label}</button>)}
        </div>
      )}
    </div>
  );
}
