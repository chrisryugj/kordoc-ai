/** 내장 AI 모델 받기(수 GB) — 받는 중인 것과 진행을 화면 밖에 둔다.
 *  설정에서 다른 갈래를 골랐다 돌아오거나 홈 AI 켜기 판과 설정을 오가면 진행 표시가 사라지고, "받기"를 또 누르면 엔진이 "이미 받는 중"으로
 *  거절했다. 엔진에는 받는 중인지 묻는 호출이 없어 이 창에서 시작한 받기만 안다 (다른 창·앱을 다시 켜기 전 것은 모른다) */

import { useSyncExternalStore } from "react";
import { rpc, type Progress } from "./rpc";

export interface ModelDownload { id: string; p: Progress | null }

let cur: (ModelDownload & { ctrl: AbortController; done: Promise<{ path: string }> }) | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

/** 받기 — 같은 모델을 이미 받는 중이면 그 받기를 기다린다. 한 번에 하나만 */
export function downloadModel(id: string): Promise<{ path: string }> {
  if (cur?.id === id) return cur.done;
  if (cur) return Promise.reject(new Error("다른 모델을 받는 중입니다. 그 받기가 끝나거나 멈춘 뒤 다시 하세요."));
  const ctrl = new AbortController();
  const mine = () => cur?.ctrl === ctrl;
  const done = rpc("llm_download", { id }, { signal: ctrl.signal, onProgress: (p) => { if (mine()) { cur = { ...cur!, p }; emit(); } } })
    .finally(() => { if (mine()) { cur = null; emit(); } });
  cur = { id, p: null, ctrl, done };
  emit();
  return done;
}

/** 멈추기 — 엔진은 받은 조각(.part)을 남겨 두어 다음 받기가 거기서 이어 받는다 */
export function stopModelDownload(): void {
  cur?.ctrl.abort();
}

export function useModelDownload(): ModelDownload | null {
  return useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => cur);
}
