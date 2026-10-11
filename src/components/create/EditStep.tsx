/** 2. 편집 — 내장 한글 편집기(rhwp-studio)가 가운데를 채우고, 오른쪽에 접이식 보조 패널 */

import { useState } from "react";
import { ArrowRight, Loader2, PanelRightClose, PanelRightOpen, Redo2, Save, Undo2, FileWarning } from "lucide-react";
import { useApp } from "../../state/app";
import { useCreate } from "./session";
import { errorText } from "../../lib/rpc";
import { Button } from "../ui/Button";
import { Tooltip } from "../ui/Tooltip";
import { EditorAssist } from "./EditorAssist";

export function EditStep({ visible }: { visible: boolean }) {
  const { toast } = useApp();
  const { session, editorState, editorError, frameRef, frameSrc, busyText, call, setStep, canSave, saveBlock, saveCurrent, saving } = useCreate();
  const [assistOpen, setAssistOpen] = useState(true);
  const ready = editorState === "ready";

  const history = (op: "undo" | "redo") => void call(op, {}).catch((e) => toast(errorText(e), "error"));

  return (
    <div className="kd-edit" hidden={!visible}>
      <div className="kd-edit-bar">
        <div className="min-w-0 flex-1">
          <div className="kd-h3" style={{ overflowWrap: "anywhere" }}>{session?.name ?? "열린 문서 없음"}</div>
          <div className="kd-small kd-muted">
            {!session ? "작성 단계에서 시작점을 고르세요" : saveBlock ? saveBlock : session.dirty ? "고친 내용이 아직 저장되지 않았습니다" : session.savedAt ? `${new Date(session.savedAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}에 저장함` : "불러온 그대로입니다"}
          </div>
        </div>
        <Tooltip content="실행 취소 (Ctrl+Z)"><button type="button" className="kd-icon-btn" disabled={!ready} onClick={() => history("undo")} aria-label="실행 취소"><Undo2 size={16} /></button></Tooltip>
        <Tooltip content="다시 실행 (Ctrl+Y)"><button type="button" className="kd-icon-btn" disabled={!ready} onClick={() => history("redo")} aria-label="다시 실행"><Redo2 size={16} /></button></Tooltip>
        <Button variant="secondary" onClick={() => void saveCurrent()} disabled={!canSave || saving}><Save size={14} /> {saving ? "저장하는 중" : "저장"}</Button>
        <Button onClick={() => setStep("output")} disabled={!canSave}>출력으로 <ArrowRight size={14} /></Button>
        <Tooltip content={assistOpen ? "보조 패널 접기" : "보조 패널 펼치기"}>
          <button type="button" className="kd-icon-btn" onClick={() => setAssistOpen((o) => !o)} aria-label={assistOpen ? "보조 패널 접기" : "보조 패널 펼치기"} aria-pressed={assistOpen}>
            {assistOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
          </button>
        </Tooltip>
      </div>
      <div className="kd-edit-main">
        <div className="kd-editor-frame">
          {/* iframe 은 늘 이 자리에 둔다 — 옮기면 편집 상태가 사라진다 */}
          <iframe ref={frameRef} src={frameSrc || undefined} title="한글 편집기" allow="clipboard-read; clipboard-write" tabIndex={ready ? 0 : -1} />
          {!ready && (
            <div className="kd-editor-cover">
              {editorState === "unavailable" ? (
                <div className="kd-editor-placeholder">
                  <FileWarning size={30} />
                  <p className="kd-empty-title">앱에서 열면 한글 편집기가 뜹니다</p>
                  <p>지금은 화면 미리보기라 편집기를 띄우지 않았습니다. 오른쪽 도구와 출력 단계는 그대로 둘러보세요.</p>
                </div>
              ) : editorState === "error" ? (
                <div className="kd-editor-placeholder">
                  <FileWarning size={30} />
                  <p className="kd-empty-title">한글 편집기를 열지 못했습니다</p>
                  <p>{editorError}</p>
                </div>
              ) : (
                <div className="kd-editor-placeholder"><Loader2 size={24} className="kd-spin" /><p>{busyText || "한글 편집기를 여는 중"}</p></div>
              )}
            </div>
          )}
          {ready && busyText && <div className="kd-editor-busy"><Loader2 size={14} className="kd-spin" /> {busyText}</div>}
        </div>
        {assistOpen && session && <EditorAssist />}
      </div>
    </div>
  );
}
