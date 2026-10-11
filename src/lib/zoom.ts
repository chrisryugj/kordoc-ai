/** 화면 크기 — 웹뷰 전체를 키운다 (작은 글씨가 잘 안 보일 때, 고해상도 화면). Ctrl/⌘ + − 0 과 설정에서 바꾸고 다음 실행에도 남긴다
 *
 * 키운 뒤에도 앱의 가장 좁은 폭(app.css .kd-app min-width 960px)이 창 안에 들어가는 단계까지만 건다 (넘으면 오른쪽이 잘리고 가로 스크롤도 없다).
 * 고른 값은 그대로 남기고, 창을 줄이면 맞는 단계로 낮췄다가 다시 넓히면 고른 값으로 돌린다.
 */

import { getCurrentWebview } from "@tauri-apps/api/webview";
import { isTauri } from "./rpc";
import { readPref, writePref } from "./recent";

export const ZOOM_STEPS = [0.9, 1, 1.1, 1.25, 1.5];
const KEY = "kordoc-zoom";
const MIN_APP_WIDTH = 960;
/** 지금 웹뷰에 걸린 배율 — 창 폭을 배율 1 기준으로 되돌려 재는 데 쓴다 (브라우저 미리보기는 늘 1) */
let applied = 1;

/** 고른 화면 크기 (창 폭 때문에 낮춰 건 것과 다를 수 있다) */
export function savedZoom(): number {
  const z = readPref<number>(KEY, 1);
  return ZOOM_STEPS.includes(z) ? z : 1;
}

/** 이 배율로 키워도 앱이 창 안에 다 들어가는가 (100% 이하는 늘 된다) */
export function zoomFits(z: number): boolean {
  return z <= 1 || (window.innerWidth * applied) / z >= MIN_APP_WIDTH;
}

/** 지금 창 폭에서 고를 수 있는 가장 큰 단계 */
export function maxZoom(): number {
  return [...ZOOM_STEPS].reverse().find(zoomFits) ?? 1;
}

/** 고른 값(pref) 이하에서 지금 창에 맞는 가장 큰 단계 = 실제로 건 화면 크기 */
export function currentZoom(pref = savedZoom()): number {
  return Math.min(pref, maxZoom());
}

/** dir: 1 키우기, -1 줄이기, 0 원래 크기. 키우기는 창에 맞는 단계에서 멈춘다 */
export function nextZoom(cur: number, dir: 1 | -1 | 0): number {
  if (dir === 0) return 1;
  const eff = currentZoom(cur);
  const i = Math.max(0, ZOOM_STEPS.indexOf(eff));
  const next = ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, Math.max(0, i + dir))];
  return zoomFits(next) ? next : eff;
}

async function setWebviewZoom(z: number): Promise<void> {
  if (z === applied) return;
  const prev = applied;
  applied = z; // 배율이 바뀌며 생기는 resize 에서도 창 폭을 바르게 재도록 먼저 바꿔 둔다
  try {
    await getCurrentWebview().setZoom(z);
  } catch (e) {
    applied = prev;
    throw e;
  }
}

let watching = false;
/** 창 크기가 바뀌면 고른 값 안에서 창에 맞는 단계로 다시 건다 */
function watchResize() {
  if (watching) return;
  watching = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  window.addEventListener("resize", () => {
    clearTimeout(timer);
    timer = setTimeout(() => void setWebviewZoom(currentZoom()).catch(() => undefined), 200);
  });
}

export async function applyZoom(z: number): Promise<void> {
  writePref(KEY, z);
  // 브라우저 미리보기에서는 브라우저 확대(Ctrl +)를 쓴다
  if (!isTauri) return;
  watchResize();
  await setWebviewZoom(currentZoom(z));
}

export const zoomLabel = (z: number) => `${Math.round(z * 100)}%`;
