/**
 * 우클릭 빠른 동작 차례대로 돌리기 — 엔진이 켜질 때까지 기다렸다가 창 없이 돌리고 알림만.
 * 1.5초 넘게 걸리면 시작 알림을 한 번 더. 실패하면 창을 열어 서무 도구·PDF 작업에 그 파일을 놓고 까닭을 알린다.
 * 다 끝나면 shell_quick_done: 꺼진 앱이 빠른 동작으로 켜졌고 그 사이 창을 열지 않았으면 Rust 가 앱을 끈다.
 */

import { useCallback, useRef } from "react";
import { useApp } from "../state/app";
import { errorText, invokeCmd, isAbort } from "../lib/rpc";
import { notifyQuick } from "../lib/native";
import { baseName } from "../lib/format";
import { QUICK_FALLBACK, QUICK_LABEL, runQuick, type QuickAction } from "../lib/quick-actions";
import { keepFromSettings } from "../components/workbench/tools/ReviewTool";

export function useQuickActions() {
  const app = useApp();
  const appRef = useRef(app);
  appRef.current = app;
  const queue = useRef<Array<{ action: QuickAction; paths: string[] }>>([]);
  const running = useRef(false);

  // 엔진과 설정까지 (꺼진 앱이 켜질 때 설정을 읽기 전에 돌면 남길 연락처·저장 폴더가 빠진다)
  const waitReady = async () => {
    const ok = () => appRef.current.ready && !!appRef.current.settings;
    for (let i = 0; i < 450 && !ok(); i++) await new Promise((r) => setTimeout(r, 200));
    if (!ok()) throw new Error("문서 엔진이 켜지지 않았습니다. 앱을 다시 켜 보세요.");
  };

  const pump = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    try {
      while (queue.current.length) {
        const { action, paths } = queue.current.shift()!;
        const label = QUICK_LABEL[action];
        const back = QUICK_FALLBACK[action];
        const openInApp = async (why: string) => {
          await invokeCmd("shell_show").catch(() => undefined);
          const { startPdf, startBatch, toast } = appRef.current;
          if (back.screen === "pdf") startPdf({ paths });
          else startBatch({ paths, task: back.task });
          if (why) toast(why, "error");
        };
        const slow = setTimeout(() => void notifyQuick(`KorDoc AI: ${label}`, `${paths.length > 1 ? `${paths.length}개를 ` : ""}처리하는 중입니다. 끝나면 다시 알립니다.`), 1500);
        try {
          await waitReady();
          const { settings } = appRef.current;
          const r = await runQuick(action, paths, { signal: new AbortController().signal, keep: keepFromSettings(settings?.org), outDir: settings?.convert.output_dir ?? "" });
          clearTimeout(slow);
          if (r.open === "pdf") { await openInApp(""); continue; }
          if (r.failed.length) {
            const first = r.failed[0];
            await openInApp(`${label}: ${r.ok ? `${r.ok}개는 했고 ` : ""}${r.failed.length}개는 못 했습니다. ${baseName(first.path)}: ${first.error}`);
            continue;
          }
          if (!(await notifyQuick(`KorDoc AI: ${label} 끝`, r.message))) {
            await invokeCmd("shell_show").catch(() => undefined);
            appRef.current.toast(`${label} 끝: ${r.message}`, "success");
          }
        } catch (e) {
          clearTimeout(slow);
          if (!isAbort(e)) await openInApp(`${label}: ${errorText(e)}`);
        }
      }
    } finally {
      running.current = false;
      void invokeCmd("shell_quick_done").catch(() => undefined);
    }
  }, []);

  return useCallback((action: QuickAction, paths: string[]) => {
    queue.current.push({ action, paths });
    void pump();
  }, [pump]);
}
