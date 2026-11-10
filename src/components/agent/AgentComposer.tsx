/**
 * AI에게 맡길 일 입력창 — 첨부 파일 칩, 파일·폴더 첨부, 예시·내 프롬프트 고르기, 지금 문장 저장, 보내기·멈추기.
 * 끌어 놓기는 dropName 으로 앱 공용 끌어 놓기에 등록한다. AI 가 꺼져 있으면 한 줄 안내와 AI 켜기.
 * 예시를 고르면 입력창에 넣고 채울 자리(○)를 골라 둔다.
 */

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { BookmarkPlus, FileUp, FolderUp, LayoutList, Send, Square, X, Sparkles } from "lucide-react";
import { useApp } from "../../state/app";
import { pickFiles, pickFolder } from "../../lib/native";
import { baseName, formatOf } from "../../lib/format";
import { Button } from "../ui/Button";
import { AiWhere, subscriptionProblem } from "../common/AiGate";
import { FormatBadge } from "../common/FormatBadge";
import { useFileMenu } from "../common/file-menu";
import { AiQuickSetup } from "./AiQuickSetup";
import { PromptGallery } from "./PromptGallery";
import { addMyPrompt } from "../../lib/my-prompts";
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
  /** AI 꺼짐 안내 뒤에 붙일 한 문장 (홈: AI 없이 되는 일 안내) */
  offHint?: string;
  /** 다른 대화에서 일하는 중이라 보낼 수 없음 (글은 써 둘 수 있다) */
  locked?: boolean;
  /** 예시·내 프롬프트 목록을 처음부터 펼침 */
  gallery?: boolean;
}

export function AgentComposer({ paths, onPaths, onSend, onStop, busy, suggestions = [], placeholder, dropName, autoFocus, extra, locked = false, offHint, gallery = false }: Props) {
  const { ai, registerDrop, dragTarget, toast, openSettings } = useApp();
  const problem = subscriptionProblem(ai);
  const [text, setText] = useState("");
  const [galleryOpen, setGalleryOpen] = useState(gallery);
  // 대화 중에 "새 대화"를 누르면(gallery 가 다시 참) 목록을 다시 펼친다
  useEffect(() => { setGalleryOpen(gallery); }, [gallery]);
  const [saved, setSaved] = useState(0);
  const [setupOpen, setSetupOpen] = useState(false);
  const menu = useFileMenu();
  const box = useRef<HTMLTextAreaElement>(null);
  const pathsRef = useRef(paths);
  pathsRef.current = paths;
  // 끌어다 놓기 받는 함수는 한 번만 등록된다 → 붙일 곳(onPaths)도 그때그때 최신 것을 봐야 한다.
  // 안 그러면 대화를 바꾼 뒤 놓은 파일이 처음 열려 있던 대화에 붙는다
  const onPathsRef = useRef(onPaths);
  onPathsRef.current = onPaths;
  const add = (p: string[]) => onPathsRef.current([...new Set([...pathsRef.current, ...p])]);

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
    if (!t.trim() || busy || locked || !aiOn) return;
    onSend(t);
    setText("");
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  };
  /** 문장을 넣고 첫 채울 자리(○)를 골라 둔다 */
  const fill = (t: string) => {
    setText(t);
    requestAnimationFrame(() => {
      const el = box.current;
      if (!el) return;
      el.focus();
      const i = t.indexOf("○");
      if (i >= 0) el.setSelectionRange(i, i + 1); else el.setSelectionRange(t.length, t.length);
    });
  };
  const pick = (s: Suggestion) => {
    if (s.files?.length) add(s.files);
    fill(s.text);
  };
  const saveText = () => {
    if (addMyPrompt(text)) { toast("내 프롬프트에 저장했습니다", "success"); setSaved((n) => n + 1); setGalleryOpen(true); }
    else toast("이미 저장한 문장입니다", "info");
  };

  return (
    <div className="flex flex-col gap-2.5">
      <div className="kd-ask" data-drop={dropName} data-over={!!dropName && dragTarget === dropName}>
        {paths.length > 0 && (
          <div className="kd-ask-files" aria-label="붙인 파일">
            {paths.map((p) => (
              <span key={p} className="kd-ask-file" title={p}
                onContextMenu={(e) => menu.open(e, p, { after: [{ label: "붙인 파일에서 빼기", icon: <X size={14} />, onClick: () => onPaths(paths.filter((x) => x !== p)) }] })}>
                <FormatBadge format={formatOf(p)} />
                <span>{baseName(p)}</span>
                <button type="button" onClick={() => onPaths(paths.filter((x) => x !== p))} aria-label={`${baseName(p)} 빼기`}><X size={13} /></button>
              </span>
            ))}
          </div>
        )}
        <textarea ref={box} className="kd-ask-input" rows={2} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey}
          placeholder={placeholder ?? "AI에게 맡길 일 입력 · 문서는 끌어다 놓기"} aria-label="AI에게 맡길 일"
          // 일하는 동안 못 쓰게만 한다(disabled 가 아니라 readOnly): disabled 면 초점이 빠져, 붙여 넣기가 "글을 문서로 열기"로 넘어가 화면이 바뀐다
          readOnly={busy} aria-busy={busy} />
        <div className="kd-ask-bar">
          <Button size="sm" variant="ghost" onClick={() => void pickFiles().then((p) => p.length && add(p))} data-tip="한글·PDF·워드·엑셀·그림 파일을 고릅니다. 끌어다 놓아도 됩니다"><FileUp size={14} /> 파일 첨부</Button>
          <Button size="sm" variant="ghost" onClick={() => void pickFolder().then((d) => d && add([d]))} data-tip="폴더 안 문서를 모두 넘깁니다 (제출물 취합 등)"><FolderUp size={14} /> 폴더 첨부</Button>
          <Button size="sm" variant="ghost" aria-pressed={galleryOpen} onClick={() => setGalleryOpen((o) => !o)} data-tip="AI에게 맡길 수 있는 일과 저장해 둔 내 프롬프트"><LayoutList size={14} /> 예시·내 프롬프트</Button>
          {paths.length > 0 && extra}
          <span className="kd-ask-where"><AiWhere /></span>
          {text.trim() && !busy && <button type="button" className="kd-icon-btn" onClick={saveText} aria-label="이 문장을 내 프롬프트에 저장"><BookmarkPlus size={16} /></button>}
          {busy
            ? <Button onClick={onStop} variant="secondary"><Square size={14} /> 멈추기</Button>
            : <Button onClick={() => send()} disabled={!text.trim() || !aiOn || locked} data-tip={aiOn ? "Enter로도 보냅니다 (줄바꿈은 Shift+Enter)" : "AI를 켜면 보낼 수 있습니다"}><Send size={14} /> 보내기</Button>}
        </div>
      </div>
      {!aiOn && (problem ? (
        // 구독 계정을 켜 뒀는데 못 쓰는 상태: 무엇을 고칠지 알리고 설정으로
        <div className="kd-aioff" role="status">
          <Sparkles size={15} />
          <span>{problem}</span>
          <Button size="sm" variant="secondary" onClick={() => openSettings("set-ai")}>AI 연결 열기</Button>
        </div>
      ) : setupOpen ? <AiQuickSetup /> : (
        <div className="kd-aioff">
          <Sparkles size={15} />
          <span>AI가 꺼져 있습니다.{offHint ? ` ${offHint}` : ""}</span>
          <Button size="sm" variant="secondary" onClick={() => setSetupOpen(true)}>AI 켜기</Button>
        </div>
      ))}
      {galleryOpen && !busy && <PromptGallery onPick={fill} version={saved} />}
      {suggestions.length > 0 && !busy && aiOn && !galleryOpen && (
        <div className="kd-ask-sugs" aria-label="예시">
          {suggestions.map((s) => <button key={s.label} type="button" className="kd-chip" onClick={() => pick(s)}>{s.label}</button>)}
        </div>
      )}
    </div>
  );
}
