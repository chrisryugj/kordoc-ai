import { Check } from "lucide-react";
import type { PipelineStep } from "../../types/pipeline";

// 클릭으로 이동 가능한 UI 스텝 (OCR·추출은 재실행 필요하므로 제외)
const NAVIGABLE_STEPS = new Set<PipelineStep>(["import", "review", "complete"]);

interface StepperProps {
  currentStep: PipelineStep;
  onStepClick?: (step: PipelineStep) => void;
}

const steps: { id: PipelineStep; label: string; num: number }[] = [
  { id: "import", label: "가져오기", num: 1 },
  { id: "ocr", label: "OCR", num: 2 },
  { id: "review", label: "태깅/검토", num: 3 },
  { id: "extract", label: "추출/분석", num: 4 },
  { id: "complete", label: "결과", num: 5 },
];

const stepOrder: PipelineStep[] = ["idle", "import", "ocr", "tagging", "review", "extract", "analyze", "complete"];

function getStepState(stepId: PipelineStep, current: PipelineStep): "pending" | "active" | "done" {
  const currentIdx = stepOrder.indexOf(current);
  // 각 UI 스텝이 active인 파이프라인 인덱스 범위 [start, end]
  const stepRanges: Record<string, [number, number]> = {
    import: [1, 1],
    ocr: [2, 2],
    review: [3, 4],   // tagging + review
    extract: [5, 6],  // extract + analyze
    complete: [7, 7],
  };
  const [start, end] = stepRanges[stepId] ?? [0, 0];
  if (currentIdx > end) return "done";
  if (currentIdx >= start) return "active";
  return "pending";
}

const isProcessing = (step: PipelineStep) =>
  ["ocr", "tagging", "extract", "analyze"].includes(step);

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
              <div
                className={`step-dot step-dot--${state}${canClick ? " cursor-pointer hover:opacity-70 transition-opacity" : ""}`}
                onClick={canClick ? () => onStepClick(step.id) : undefined}
                title={canClick ? `${step.label}(으)로 돌아가기` : undefined}
              >
                {state === "done" ? <Check size={16} /> : step.num}
              </div>
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
