import { useState, useEffect, useCallback, useRef } from "react";
import { X, ChevronRight, ChevronLeft } from "lucide-react";
import { Button } from "./Button";

interface TourStep {
  target: string;
  title: string;
  content: string;
  position: "top" | "bottom" | "left" | "right";
}

const TOUR_STEPS: TourStep[] = [
  {
    target: "[aria-label='주 메뉴']",
    title: "사이드바",
    content: "문서 처리와 자료 수집 도구를 선택할 수 있습니다. 설정과 도움말도 여기서 접근하세요.",
    position: "right",
  },
  {
    target: "[aria-label='상태 표시줄']",
    title: "상태 표시줄",
    content: "API 키 연결 상태와 작업 진행 상황을 실시간으로 확인할 수 있습니다.",
    position: "top",
  },
];

const TOUR_STORAGE_KEY = "eduplan-tour-completed";

interface OnboardingTourProps {
  enabled: boolean;
}

export function OnboardingTour({ enabled }: OnboardingTourProps) {
  const [currentStep, setCurrentStep] = useState(-1);
  const [tooltipStyle, setTooltipStyle] = useState<React.CSSProperties>({});
  const tooltipRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!enabled) return;
    try {
      if (localStorage.getItem(TOUR_STORAGE_KEY)) return;
    } catch { /* proceed */ }
    // 앱 로드 후 잠시 대기
    const timer = setTimeout(() => {
      previousFocusRef.current = document.activeElement as HTMLElement;
      setCurrentStep(0);
    }, 1500);
    return () => clearTimeout(timer);
  }, [enabled]);

  const positionTooltip = useCallback(() => {
    if (currentStep < 0 || currentStep >= TOUR_STEPS.length) return;

    const step = TOUR_STEPS[currentStep];
    const el = document.querySelector(step.target);
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const style: React.CSSProperties = { position: "fixed", zIndex: 9999 };
    const GAP = 12;

    switch (step.position) {
      case "right":
        style.left = rect.right + GAP;
        style.top = rect.top + rect.height / 2;
        style.transform = "translateY(-50%)";
        break;
      case "left":
        style.right = window.innerWidth - rect.left + GAP;
        style.top = rect.top + rect.height / 2;
        style.transform = "translateY(-50%)";
        break;
      case "top":
        style.left = rect.left + rect.width / 2;
        style.bottom = window.innerHeight - rect.top + GAP;
        style.transform = "translateX(-50%)";
        break;
      case "bottom":
        style.left = rect.left + rect.width / 2;
        style.top = rect.bottom + GAP;
        style.transform = "translateX(-50%)";
        break;
    }

    setTooltipStyle(style);
  }, [currentStep]);

  const finish = useCallback(() => {
    setCurrentStep(-1);
    try { localStorage.setItem(TOUR_STORAGE_KEY, "true"); } catch { /* ok */ }
    // 포커스 복원
    previousFocusRef.current?.focus();
  }, []);

  useEffect(() => {
    positionTooltip();
    window.addEventListener("resize", positionTooltip);
    return () => window.removeEventListener("resize", positionTooltip);
  }, [positionTooltip]);

  // ESC 키로 투어 닫기 + 포커스 트랩
  useEffect(() => {
    if (currentStep < 0) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        finish();
      }
      // 포커스 트랩: Tab 키가 툴팁 내부에 머물도록
      if (e.key === "Tab" && tooltipRef.current) {
        const focusable = tooltipRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [currentStep, finish]);

  // 툴팁이 열릴 때 자동 포커스
  useEffect(() => {
    if (currentStep >= 0 && tooltipRef.current) {
      const firstBtn = tooltipRef.current.querySelector<HTMLElement>("button");
      firstBtn?.focus();
    }
  }, [currentStep]);

  const next = () => {
    if (currentStep < TOUR_STEPS.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      finish();
    }
  };

  const prev = () => {
    if (currentStep > 0) setCurrentStep(currentStep - 1);
  };

  if (currentStep < 0 || currentStep >= TOUR_STEPS.length) return null;

  const step = TOUR_STEPS[currentStep];
  const isLast = currentStep === TOUR_STEPS.length - 1;

  // 타겟 요소 하이라이트
  const targetEl = document.querySelector(step.target);
  const targetRect = targetEl?.getBoundingClientRect();

  return (
    <>
      {/* 오버레이 (타겟 부분만 투명) */}
      <div
        className="fixed inset-0 z-[9998]"
        style={{ backgroundColor: "rgba(0,0,0,0.4)" }}
        onClick={finish}
        aria-hidden="true"
      />
      {targetRect && (
        <div
          className="fixed z-[9998] rounded-lg"
          style={{
            top: targetRect.top - 4,
            left: targetRect.left - 4,
            width: targetRect.width + 8,
            height: targetRect.height + 8,
            boxShadow: "0 0 0 9999px rgba(0,0,0,0.4)",
            pointerEvents: "none",
          }}
          aria-hidden="true"
        />
      )}

      {/* 툴팁 */}
      <div
        ref={tooltipRef}
        role="dialog"
        aria-modal="true"
        aria-label={`온보딩 가이드: ${step.title}`}
        className="rounded-xl p-4 max-w-[280px] animate-scale-in"
        style={{
          ...tooltipStyle,
          backgroundColor: "var(--color-bg-secondary)",
          border: "1px solid var(--color-border-hover)",
          boxShadow: "var(--shadow-xl)",
        }}
      >
        <div className="flex items-start justify-between mb-2">
          <h4 className="ts-sm font-bold" style={{ color: "var(--color-text-primary)" }}>
            {step.title}
          </h4>
          <button onClick={finish} className="p-0.5 rounded hover-bg-tertiary" aria-label="투어 닫기">
            <X size={14} style={{ color: "var(--color-text-muted)" }} />
          </button>
        </div>
        <p className="ts-2xs leading-relaxed mb-3" style={{ color: "var(--color-text-secondary)" }}>
          {step.content}
        </p>
        <div className="flex items-center justify-between">
          <span className="ts-2xs" style={{ color: "var(--color-text-muted)" }}>
            {currentStep + 1} / {TOUR_STEPS.length}
          </span>
          <div className="flex gap-1.5">
            {currentStep > 0 && (
              <Button variant="ghost" size="sm" onClick={prev} aria-label="이전 단계">
                <ChevronLeft size={14} />
              </Button>
            )}
            <Button size="sm" onClick={next} aria-label={isLast ? "투어 완료" : "다음 단계"}>
              {isLast ? "완료" : <>다음<ChevronRight size={14} /></>}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
