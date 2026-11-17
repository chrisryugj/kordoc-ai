/** 이 PC의 작업 흔적 지우기 (설정 › 보안) — 화면 저장소의 대화·최근 문서, 엔진의 복구·작업 사본·임시 파일, 편집기 저장소.
 * 설정·서식·문체·내 지시문·받은 공문 목록·저장한 결과 파일은 남긴다. */

import { invokeCmd, isTauri, rpc } from "./rpc";

/** 화면 저장소에서 지울 키: 대화 목록·본문, 최근 문서 */
export function traceKeys(keys: string[]): string[] {
  return keys.filter((k) => k === "kordoc-chats" || k.startsWith("kordoc-chat:") || k === "kordoc-recent");
}

export async function wipeTraces(): Promise<{ removed: number; skipped: number }> {
  const r = await rpc("wipe_traces", {});
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i) ?? "");
    for (const k of traceKeys(keys)) localStorage.removeItem(k);
  } catch { /* 저장소를 못 쓰면 지울 것도 없다 */ }
  // 내장 편집기가 남긴 자동 저장(IndexedDB)·캐시 (Windows 웹뷰)
  if (isTauri) await invokeCmd("wipe_web_storage").catch(() => undefined);
  return r;
}
