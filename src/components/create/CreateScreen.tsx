/** 공문서 만들기 — 작성 → 편집(내장 한글 편집기) → 출력 */

import { useEffect, useRef } from "react";
import { Check, FilePlus2 } from "lucide-react";
import { useApp } from "../../state/app";
import { CreateProvider, useCreate, type Step } from "./session";
import { ComposeStep } from "./ComposeStep";
import { EditStep } from "./EditStep";
import { OutputStep } from "./OutputStep";
import { Button } from "../ui/Button";
import "./create.css";

const STEPS: Array<{ id: Step; n: string; label: string; desc: string }> = [
  { id: "compose", n: "1", label: "작성", desc: "서식·초안 고르기" },
  { id: "edit", n: "2", label: "편집", desc: "한글 편집기에서 다듬기" },
  { id: "output", n: "3", label: "출력", desc: "저장·PDF·인쇄·도장" },
];

/** 작업대 등에서 연 기존 문서는 작성 단계가 없다 — 편집 · 내보내기 */
const EXISTING_STEPS: typeof STEPS = [
  { id: "edit", n: "1", label: "편집", desc: "한글 편집기에서 고치기" },
  { id: "output", n: "2", label: "출력", desc: "저장·PDF·인쇄·도장" },
];

/** 연 문서를 고치는 중인가 (작성 단계로 돌아가면 새로 쓰기 단계 셋을 다시 보인다) */
const useExisting = () => {
  const { step, session } = useCreate();
  return !!session?.existing && step !== "compose";
};

function Stepper() {
  const { step, setStep, session, canSave, saveBlock } = useCreate();
  const existing = useExisting();
  const steps = existing ? EXISTING_STEPS : STEPS;
  const at = steps.findIndex((s) => s.id === step);
  return (
    <ol className="kd-steps" aria-label="새로 쓰기 단계">
      {steps.map((s, i) => {
        const done = i < at;
        // 출력은 저장할 수 있을 때만 (편집기가 열리는 중이면 아직 파일이 없다)
        const enabled = s.id === "compose" || (s.id === "edit" ? !!session : canSave);
        return (
          <li key={s.id} className="kd-step" data-state={i === at ? "now" : done ? "done" : "later"}>
            <button type="button" disabled={!enabled} aria-current={i === at ? "step" : undefined} onClick={() => setStep(s.id)}
              title={done ? `${s.label} 단계로 돌아가기 (쓴 내용은 그대로 있습니다)` : !enabled ? (s.id === "output" && saveBlock ? saveBlock : "작성 단계에서 시작점을 고르면 열립니다") : undefined}>
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
  const { step, setStep, openInEditor, editorState, call } = useCreate();
  const existing = useExisting();
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
    const rec = createIntent.value.recover;
    // 홈의 "되살리기": 그 경로의 복구 사본으로 연다 (새로 쓰기 초안이었으면 초안 그대로)
    const task = createIntent.value.agentTask;
    void openInEditor(createIntent.value.path, rec ? { recover: true, title: rec.title, ...(rec.working ? { working: true } : { existing: true }) } : { existing: true, ...(task ? { agentTask: task } : {}) });
  }, [createIntent, openInEditor]);

  // 홈·문서 보기·접수함의 "회신 쓰기"·"새로 쓰기"(파일 없이 들어옴) → 작성 단계를 보인다.
  // 앞 문서가 편집·출력 단계에 있으면 초안이 숨은 작성 화면에서 혼자 돌고 화면은 앞 문서의 출력 단계로 남았다. 앞 문서는 편집 단계에 그대로 남는다
  const composed = useRef(0);
  useEffect(() => {
    if (!createIntent || createIntent.value.path || createIntent.nonce === composed.current) return;
    composed.current = createIntent.nonce;
    setStep("compose");
  }, [createIntent, setStep]);

  return (
    <div className="kd-screen" hidden={!active}>
      <header className="kd-head kd-create-head">
        <div className="min-w-0">
          <h1 className="kd-head-title">{existing ? "문서 고치기" : "새로 쓰기"}</h1>
          <p className="kd-head-sub">{existing ? "한글 편집기에서 고치고 PDF·인쇄로 출력" : "서식·초안으로 시작해 한글 편집기에서 다듬고 출력"}</p>
        </div>
        <div className="flex items-center gap-2">
          <Stepper />
          {existing && <Button variant="ghost" size="sm" onClick={() => setStep("compose")} data-tip="작성 단계로 갑니다. 지금 문서는 편집 단계에 그대로 남습니다"><FilePlus2 size={13} /> 새 문서 쓰기</Button>}
        </div>
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
