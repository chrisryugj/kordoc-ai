import { Check } from "lucide-react";
import type { PipelineStep } from "../../types/pipeline";

const NAVIGABLE_STEPS = new Set<PipelineStep>(["import", "complete"]);

interface StepperProps {
  currentStep: PipelineStep;
  onStepClick?: (step: PipelineStep) => void;
}

const steps: { id: PipelineStep; label: string; num: number }[] = [
  { id: "import", label: "가져오기", num: 1 },
  { id: "converting", label: "변환", num: 2 },
  { id: "complete", label: "결과", num: 3 },
];

const stepOrder: PipelineStep[] = ["idle", "import", "converting", "complete"];

function getStepState(stepId: PipelineStep, current: PipelineStep): "pending" | "active" | "done" {
  const currentIdx = stepOrder.indexOf(current);
  const stepIdx = stepOrder.indexOf(stepId);
  if (currentIdx > stepIdx) return "done";
  if (currentIdx === stepIdx) return "active";
  return "pending";
}

const isProcessing = (step: PipelineStep) => step === "converting";

export function PipelineStepper({ currentStep, onStepClick }: StepperProps) {
  return (
    <div className="flex items-center gap-0 px-8 py-4">
      {steps.map((step, i) => {
        const state = currentStep === "idle" ? "pending" : getStepState(step.id, currentStep);
        const canClick =
          state === "done" &&
          NAVIGABLE_STEPS.has(step.id) &&
          !isProcessing(currentStep) &&
          !!onStepClick;
        return (
          <div key={step.id} className="flex items-center" style={{ flex: i < steps.length - 1 ? 1 : undefined }}>
            <div className="flex flex-col items-center gap-1">
              {canClick ? (
                <button
                  type="button"
                  className={`step-dot step-dot--${state} cursor-pointer hover:opacity-70 transition-opacity`}
                  onClick={() => onStepClick(step.id)}
                  aria-label={`${step.label}(으)로 돌아가기`}
                >
                  {state === "done" ? <Check size={16} /> : step.num}
                </button>
              ) : (
                <div className={`step-dot step-dot--${state}`} aria-current={state === "active" ? "step" : undefined}>
                  {state === "done" ? <Check size={16} /> : step.num}
                </div>
              )}
              <span
                className={`ts-2xs font-medium whitespace-nowrap${canClick ? " cursor-pointer hover:opacity-70 transition-opacity" : ""}`}
                style={{ color: state === "active" ? "var(--color-accent)" : state === "done" ? "var(--color-success)" : "var(--color-text-muted)" }}
                onClick={canClick ? () => onStepClick(step.id) : undefined}
              >
                {step.label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div className={`step-line ${state === "done" ? "step-line--done" : ""}`} style={{ margin: "0 8px", marginBottom: "20px" }} />
            )}
          </div>
        );
      })}
    </div>
  );
}
