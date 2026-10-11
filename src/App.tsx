/**
 * KorDoc AI v2 셸 — 왼쪽 탐색 + 화면 7개. 화면은 처음 열 때 만들고 그 뒤로는 숨겨 둔다(상태 유지).
 * 창 전체 끌어다 놓기·우클릭/파일 연결(deep-link·open-files)·붙여 넣기·Ctrl+O 를 여기서 받는다.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { ToastContainer } from "./components/ui/Toast";
import { ErrorBoundary } from "./components/ui/ErrorBoundary";
import { useToast } from "./hooks/useToast";
import { useDeepLink, isLinkAction, type DeepLinkPayload, type LinkAction } from "./hooks/useDeepLink";
import { AppProvider, useApp, type Screen } from "./state/app";
import { NavRail } from "./components/shell/NavRail";
import { FirstRunWizard } from "./components/shell/FirstRunWizard";
import { HomeScreen } from "./components/home/HomeScreen";
import { InboxScreen } from "./components/inbox/InboxScreen";
import { WorkbenchScreen } from "./components/workbench/WorkbenchScreen";
import { CreateScreen } from "./components/create/CreateScreen";
import { BatchScreen } from "./components/batch/BatchScreen";
import { CompareScreen } from "./components/compare/CompareScreen";
import { AssistantScreen } from "./components/assistant/AssistantScreen";
import { SettingsScreen } from "./components/settings/SettingsScreen";
import { ImpactScreen } from "./components/impact/ImpactScreen";
import { rpc, errorText, invokeCmd } from "./lib/rpc";
import { pickFiles, watchFileDrop } from "./lib/native";
import { readPref, writePref } from "./lib/recent";
import { applyZoom, currentZoom, nextZoom, savedZoom, zoomLabel, ZOOM_STEPS } from "./lib/zoom";
import { useInboxReminder } from "./components/inbox/reminder";

const SCREENS: Array<{ id: Screen; render: (active: boolean) => React.ReactNode }> = [
  { id: "home", render: (a) => <HomeScreen active={a} /> },
  { id: "inbox", render: (a) => <InboxScreen active={a} /> },
  { id: "workbench", render: (a) => <WorkbenchScreen active={a} /> },
  { id: "create", render: (a) => <CreateScreen active={a} /> },
  { id: "batch", render: (a) => <BatchScreen active={a} /> },
  { id: "compare", render: (a) => <CompareScreen active={a} /> },
  { id: "assistant", render: (a) => <AssistantScreen active={a} /> },
  { id: "settings", render: (a) => <SettingsScreen active={a} /> },
  { id: "impact", render: (a) => <ImpactScreen active={a} /> },
];

export default function App() {
  const { toasts, showToast, dismissToast } = useToast();
  return (
    <AppProvider toast={showToast}>
      <Shell />
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </AppProvider>
  );
}

function useNavCollapsed() {
  const [pref, setPref] = useState<boolean | null>(() => readPref<boolean | null>("kordoc-nav-collapsed", null));
  // 1366 노트북에서도 문서 칸이 넓게 (접으면 아이콘 + 짧은 이름)
  const [narrow, setNarrow] = useState(() => window.innerWidth < 1440);
  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < 1440);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const collapsed = pref ?? narrow;
  const toggle = () => { setPref(!collapsed); writePref("kordoc-nav-collapsed", !collapsed); };
  return [collapsed, toggle] as const;
}

function Shell() {
  const app = useApp();
  const { screen, openDocs, startBatch, toast, setDragTarget, dropHandler, firstRun, ai } = app;
  const [visited, setVisited] = useState<Set<Screen>>(() => new Set<Screen>(["home"]));
  const [collapsed, toggleNav] = useNavCollapsed();
  useInboxReminder();
  const screenRef = useRef(screen);
  screenRef.current = screen;

  useEffect(() => {
    setVisited((v) => (v.has(screen) ? v : new Set(v).add(screen)));
  }, [screen]);

  // 창 전체 끌어다 놓기 — 손가락 아래 [data-drop] 이 받고, 없으면 지금 화면이 받는다
  useEffect(() => {
    const targetAt = (x: number, y: number) =>
      document.elementFromPoint(x, y)?.closest("[data-drop]")?.getAttribute("data-drop") ?? screenRef.current;
    return watchFileDrop({
      onHover: (x, y) => setDragTarget(targetAt(x, y)),
      onLeave: () => setDragTarget(null),
      onDrop: (paths, x, y) => {
        setDragTarget(null);
        const handler = dropHandler(targetAt(x, y)) ?? dropHandler(screenRef.current);
        if (handler) handler(paths);
        else openDocs(paths);
      },
    });
  }, [setDragTarget, dropHandler, openDocs]);

  // 우클릭 메뉴·파일 연결로 들어온 동작. kordoc:// 주소는 웹·메일 링크로도 올 수 있어서, 문서를 밖으로 보내는 일(인터넷 AI 요약)은
  // 자동으로 하지 않고 문서만 열어 둔다. 사용자가 요약하기를 눌러야 보낸다
  const runAction = useCallback((action: LinkAction, paths: string[]) => {
    if (action === "open") openDocs(paths);
    else if (action === "summarize" && ai?.is_cloud) {
      openDocs(paths, { tool: "ai" });
      toast("인터넷 AI로 보내기 전에 확인하세요. 요약하기를 누르면 보냅니다.", "info");
    } else if (action === "summarize" && !ai) {
      // 꺼진 앱이 이 동작으로 켜지면 AI 설정을 읽기 전에 들어온다. 인터넷 AI 일 수 있으니 자동으로 보내지 않는다
      openDocs(paths, { tool: "ai" });
      toast("AI 설정을 아직 읽지 못해 바로 시작하지 않았습니다. 요약하기를 누르면 시작합니다.", "info");
    } else if (action === "summarize") openDocs(paths, { tool: "ai", run: "summarize" });
    else startBatch({ paths, task: action === "convert" ? "convert" : action, autoRun: true });
  }, [openDocs, startBatch, ai, toast]);

  const onLink = useCallback(async (p: DeepLinkPayload) => {
    if (p.type === "file") { runAction(p.action, [p.path]); return; }
    try {
      const m = await rpc("read_batch_manifest", { path: p.manifestPath });
      runAction(isLinkAction(m.action) ? m.action : "open", m.files);
    } catch (e) {
      toast(`넘겨받은 파일 목록을 읽지 못했습니다: ${errorText(e)}`, "error");
    }
  }, [runAction, toast]);
  useDeepLink(onLink, openDocs);

  // 글·그림 붙여 넣기 (입력칸 밖에서) → 파일로 저장해 작업대에서 연다
  useEffect(() => {
    const onPaste = async (e: ClipboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, [contenteditable='true'], iframe")) return;
      const img = Array.from(e.clipboardData?.items ?? []).find((i) => i.type.startsWith("image/"));
      try {
        if (img) {
          e.preventDefault();
          const blob = img.getAsFile();
          if (!blob) return;
          const b64 = await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1] ?? ""); r.readAsDataURL(blob); });
          openDocs([await invokeCmd<string>("save_clipboard_image", { base64Data: b64, extension: img.type.split("/")[1]?.replace("jpeg", "jpg") ?? "png" })]);
          return;
        }
        const text = e.clipboardData?.getData("text/plain") ?? "";
        if (text.trim().length >= 10) {
          e.preventDefault();
          openDocs([await invokeCmd<string>("save_clipboard_text", { text })]);
        }
      } catch (err) {
        toast(`붙여 넣지 못했습니다: ${errorText(err)}`, "error");
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [openDocs, toast]);

  // Ctrl+O (맥 ⌘O) 문서 열기, Ctrl + − 0 화면 크기
  useEffect(() => {
    if (savedZoom() !== 1) void applyZoom(savedZoom()).catch(() => {});
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "o") {
        e.preventDefault();
        void pickFiles().then((paths) => paths.length && openDocs(paths));
        return;
      }
      const dir = k === "=" || k === "+" ? 1 : k === "-" ? -1 : k === "0" ? 0 : null;
      if (dir === null) return;
      e.preventDefault();
      const z = nextZoom(savedZoom(), dir);
      // 끝 단계거나 창이 좁아 그대로면 같은 알림을 되풀이하지 않고 이유를 알린다
      if (dir !== 0 && z === currentZoom()) {
        toast(dir < 0 ? `가장 작은 화면 크기입니다 (${zoomLabel(z)})`
          : z === ZOOM_STEPS[ZOOM_STEPS.length - 1] ? `가장 큰 화면 크기입니다 (${zoomLabel(z)})`
          : `창이 좁아 더 키우지 않았습니다 (지금 ${zoomLabel(z)}). 창을 넓히면 더 키울 수 있습니다.`, "info");
        return;
      }
      void applyZoom(z).then(() => toast(`화면 크기 ${zoomLabel(z)}${z === 1 ? "" : " (원래대로: Ctrl+0, 맥은 ⌘0)"}`, "info"), () => {});
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openDocs, toast]);

  return (
    <div className="kd-app">
      <a href="#main" className="skip-link">본문으로 이동</a>
      <NavRail collapsed={collapsed} onToggle={toggleNav} />
      <main id="main" className="kd-main">
        {SCREENS.map((s) => visited.has(s.id) && (
          <ErrorBoundary key={s.id}>{s.render(screen === s.id)}</ErrorBoundary>
        ))}
      </main>
      {firstRun && <FirstRunWizard />}
    </div>
  );
}
