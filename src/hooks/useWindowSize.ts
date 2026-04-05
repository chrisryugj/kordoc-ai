import { useEffect, useRef } from "react";
import { getCurrentWindow, currentMonitor } from "@tauri-apps/api/window";
import { LogicalSize, LogicalPosition } from "@tauri-apps/api/dpi";
import type { PipelineStep } from "../types/pipeline";

/**
 * 스텝별 권장 크기 (logical px).
 * 모니터 크기에 맞게 clamp되므로 안전.
 */
const STEP_SIZES: Record<string, { w: number; h: number }> = {
  idle:       { w: 1100, h: 750 },
  import:     { w: 1100, h: 750 },
  converting: { w: 1000, h: 650 },
  complete:   { w: 1200, h: 850 },
};

const TASKBAR_MARGIN = 60;
const MIN_W = 900;
const MIN_H = 600;
const ANIM_DURATION = 350; // ms
const ANIM_FPS = 60;

/** easeOutCubic — 처음 빠르고 끝에서 부드럽게 감속 */
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/**
 * 현재 크기 → 목표 크기까지 부드럽게 보간.
 * 위치도 함께 보정해서 화면 밖 넘침 방지.
 */
async function animateResize(
  win: Awaited<ReturnType<typeof getCurrentWindow>>,
  fromW: number, fromH: number,
  toW: number, toH: number,
  screenW: number, availH: number,
  cancelRef: { cancelled: boolean },
) {
  const steps = Math.ceil((ANIM_DURATION / 1000) * ANIM_FPS);
  const interval = ANIM_DURATION / steps;

  for (let i = 1; i <= steps; i++) {
    if (cancelRef.cancelled) return;
    const t = easeOutCubic(i / steps);
    const w = Math.round(fromW + (toW - fromW) * t);
    const h = Math.round(fromH + (toH - fromH) * t);

    await win.setSize(new LogicalSize(w, h));

    // 마지막 프레임에서만 위치 보정 (매 프레임은 과함)
    if (i === steps) {
      const pos = await win.outerPosition();
      const scale = (await currentMonitor())?.scaleFactor ?? 1;
      const px = pos.x / scale;
      const py = pos.y / scale;
      if (px + w > screenW || py + h > availH || px < 0 || py < 0) {
        const fixX = Math.max(0, Math.min(px, screenW - w));
        const fixY = Math.max(0, Math.min(py, availH - h));
        await win.setPosition(new LogicalPosition(fixX, fixY));
      }
    }

    await new Promise((r) => setTimeout(r, interval));
  }
}

/**
 * 모니터 경계 내에서 스텝별 동적 리사이즈.
 * - 첫 마운트: 모니터 벗어남 → 자동 교정
 * - 스텝 전환: easeOutCubic 애니메이션으로 부드럽게 전환
 * - 작업표시줄 침범 방지
 */
export function useWindowSize(step: PipelineStep) {
  const prevStep = useRef<PipelineStep>(step);
  const isFirstRun = useRef(true);
  const cancelRef = useRef({ cancelled: false });

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;

    // 이전 애니메이션 취소
    cancelRef.current.cancelled = true;
    const thisCancel = { cancelled: false };
    cancelRef.current = thisCancel;

    const win = getCurrentWindow();

    async function adjustSize() {
      try {
        const monitor = await currentMonitor();
        if (!monitor) return;

        const scale = monitor.scaleFactor;
        const screenW = monitor.size.width / scale;
        const screenH = monitor.size.height / scale;
        const availH = screenH - TASKBAR_MARGIN;

        // 첫 마운트: 모니터 벗어남 교정 (즉시, 애니메이션 없음)
        if (isFirstRun.current) {
          isFirstRun.current = false;
          const outerSize = await win.outerSize();
          const outerPos = await win.outerPosition();
          const curW = outerSize.width / scale;
          const curH = outerSize.height / scale;
          const curX = outerPos.x / scale;
          const curY = outerPos.y / scale;

          let needsFix = false;
          let newW = curW, newH = curH, newX = curX, newY = curY;

          if (curW > screenW) { newW = screenW - 20; needsFix = true; }
          if (curH > availH) { newH = availH; needsFix = true; }
          if (curX < 0) { newX = 0; needsFix = true; }
          if (curY < 0) { newY = 0; needsFix = true; }
          if (curX + newW > screenW) { newX = Math.max(0, screenW - newW); needsFix = true; }
          if (curY + newH > availH) { newY = Math.max(0, availH - newH); needsFix = true; }

          if (needsFix) {
            await win.setSize(new LogicalSize(Math.max(MIN_W, newW), Math.max(MIN_H, newH)));
            await win.setPosition(new LogicalPosition(newX, newY));
          }
          return;
        }

        // 스텝 전환 시 애니메이션 리사이즈
        if (step === prevStep.current) return;
        prevStep.current = step;

        const target = STEP_SIZES[step];
        if (!target) return;

        const curSize = await win.outerSize();
        const curW = curSize.width / scale;
        const curH = curSize.height / scale;

        // 너비: 사용자가 넓힌 건 존중, 높이: 컨텐츠에 맞게
        let newW = Math.max(curW, target.w);
        let newH = target.h;

        // 모니터 clamp
        newW = Math.min(Math.max(newW, MIN_W), screenW - 20);
        newH = Math.min(Math.max(newH, MIN_H), availH);

        // 차이 미미하면 스킵
        if (Math.abs(curW - newW) < 30 && Math.abs(curH - newH) < 30) return;

        await animateResize(win, curW, curH, newW, newH, screenW, availH, thisCancel);
      } catch {
        // 비-Tauri 환경 또는 API 에러
      }
    }

    adjustSize();

    return () => { thisCancel.cancelled = true; };
  }, [step]);
}
