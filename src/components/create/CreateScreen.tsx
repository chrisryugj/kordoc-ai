/** 공문서 만들기 — 작성 → 편집(내장 한글 편집기) → 출력 */

import { useEffect, useRef } from "react";
import { Check } from "lucide-react";
import { useApp } from "../../state/app";
import { CreateProvider, useCreate, type Step } from "./session";
import { ComposeStep } from "./ComposeStep";
import { EditStep } from "./EditStep";
import { OutputStep } from "./OutputStep";

const STEPS: Array<{ id: Step; n: string; label: string; desc: string }> = [
  { id: "compose", n: "1", label: "작성", desc: "서식·초안 고르기" },
  { id: "edit", n: "2", label: "편집", desc: "한글 편집기에서 다듬기" },
  { id: "output", n: "3", label: "출력", desc: "저장·PDF·인쇄·도장" },
];

function Stepper() {
  const { step, setStep, session, canSave, saveBlock } = useCreate();
  const at = STEPS.findIndex((s) => s.id === step);
  return (
    <ol className="kd-steps" aria-label="공문서 만들기 단계">
      {STEPS.map((s, i) => {
        const done = i < at;
        // 출력은 저장할 수 있을 때만 (편집기가 열리는 중이면 아직 파일이 없다)
        const enabled = s.id === "compose" || (s.id === "edit" ? !!session : canSave);
        return (
          <li key={s.id} className="kd-step" data-state={i === at ? "now" : done ? "done" : "later"}>
            <button type="button" disabled={!enabled} aria-current={i === at ? "step" : undefined} onClick={() => setStep(s.id)}
              title={done ? `${s.label} 단계로 돌아가기 (쓴 내용은 그대로 있습니다)` : !enabled && s.id === "output" && saveBlock ? saveBlock : undefined}>
              <span className="kd-step-n" aria-hidden="true">{done ? <Check size={13} strokeWidth={2.5} /> : s.n}</span>
              <span className="kd-step-text">
                <span className="kd-step-label">{s.n}. {s.label}</span>
                <span className="kd-step-desc">{s.desc}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function CreateBody({ active }: { active: boolean }) {
  const { createIntent } = useApp();
  const { step, openInEditor, editorState, call } = useCreate();
  const handled = useRef(0);

  // 편집 화면이 안 보이면 편집기 변경 확인을 멈춘다 (숨은 편집기가 CPU 를 쓰지 않게). 돌아오면 바로 한 번 확인
  useEffect(() => {
    if (editorState !== "ready") return;
    void call("watch", { on: active && step === "edit" }).catch(() => undefined);
  }, [active, step, editorState, call]);

  // 작업대 "한글 편집기로 열기" → 그 파일로 바로 편집 단계
  useEffect(() => {
    if (!createIntent || createIntent.nonce === handled.current || !createIntent.value.path) return;
    handled.current = createIntent.nonce;
    void openInEditor(createIntent.value.path);
  }, [createIntent, openInEditor]);

  return (
    <div className="kd-screen" hidden={!active}>
      <header className="kd-head kd-create-head">
        <div className="min-w-0">
          <h1 className="kd-head-title">공문서 만들기</h1>
          <p className="kd-head-sub">서식을 고르면 내 기관 정보로 칸을 채우고 한글 편집기에서 다듬어 내보냅니다.</p>
        </div>
        <Stepper />
      </header>
      <div className="kd-create-body">
        <div className="kd-create-pane" hidden={step !== "compose"}><ComposeStep active={active && step === "compose"} /></div>
        <EditStep visible={step === "edit"} />
        <div className="kd-create-pane" hidden={step !== "output"}><OutputStep active={active && step === "output"} /></div>
      </div>
    </div>
  );
}

export function CreateScreen({ active }: { active: boolean }) {
  return (
    <CreateProvider>
      <CreateBody active={active} />
    </CreateProvider>
  );
}
