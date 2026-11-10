/**
 * KorDoc AI v2 셸 — 왼쪽 탐색 + 화면 7개. 화면은 처음 열 때 만들고 그 뒤로는 숨겨 둔다(상태 유지).
 * 창 전체 끌어다 놓기·우클릭/파일 연결(deep-link·open-files)·붙여 넣기·Ctrl+O 를 여기서 받는다.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { ToastContainer } from "./components/ui/Toast";
import { TipLayer } from "./components/ui/TipLayer";
import { ErrorBoundary } from "./components/ui/ErrorBoundary";
import { useToast } from "./hooks/useToast";
import { useDeepLink, isLinkAction, type DeepLinkPayload, type LinkAction } from "./hooks/useDeepLink";
import { useQuickActions } from "./hooks/useQuickActions";
import { isQuick } from "./lib/quick-actions";
import { installRadioKeys } from "./lib/radio-keys";
import { AppProvider, useApp, type Screen } from "./state/app";
import { NavRail } from "./components/shell/NavRail";
import { FirstRunWizard } from "./components/shell/FirstRunWizard";
import { HomeScreen } from "./components/home/HomeScreen";
import { InboxScreen } from "./components/inbox/InboxScreen";
import { WorkbenchScreen } from "./components/workbench/WorkbenchScreen";
import { CreateScreen } from "./components/create/CreateScreen";
import { BatchScreen } from "./components/batch/BatchScreen";
import { PdfScreen } from "./components/pdf/PdfScreen";
import { CompareScreen } from "./components/compare/CompareScreen";
import { AssistantScreen } from "./components/assistant/AssistantScreen";
import { ChatScreen } from "./components/chat/ChatScreen";
import { HelpScreen } from "./components/help/HelpScreen";
import { ChatProvider } from "./state/chats";
import { SettingsScreen } from "./components/settings/SettingsScreen";
import { ImpactScreen } from "./components/impact/ImpactScreen";
import { rpc, errorText, invokeCmd } from "./lib/rpc";
import { pickFiles, watchFileDrop } from "./lib/native";
import { readPref, writePref } from "./lib/recent";
import { applyZoom, currentZoom, nextZoom, savedZoom, zoomLabel, ZOOM_STEPS } from "./lib/zoom";
import { useInboxReminder } from "./components/inbox/reminder";

const SCREENS: Array<{ id: Screen; render: (active: boolean) => React.ReactNode }> = [
  { id: "home", render: (a) => <HomeScreen active={a} /> },
  { id: "chat", render: (a) => <ChatScreen active={a} /> },
  { id: "inbox", render: (a) => <InboxScreen active={a} /> },
  { id: "workbench", render: (a) => <WorkbenchScreen active={a} /> },
  { id: "create", render: (a) => <CreateScreen active={a} /> },
  { id: "pdf", render: (a) => <PdfScreen active={a} /> },
  { id: "batch", render: (a) => <BatchScreen active={a} /> },
  { id: "compare", render: (a) => <CompareScreen active={a} /> },
  { id: "assistant", render: (a) => <AssistantScreen active={a} /> },
  { id: "settings", render: (a) => <SettingsScreen active={a} /> },
  { id: "impact", render: (a) => <ImpactScreen active={a} /> },
  { id: "help", render: (a) => <HelpScreen active={a} /> },
];

export default function App() {
  const { toasts, showToast, dismissToast } = useToast();
  return (
    <AppProvider toast={showToast}>
      <ChatProvider>
        <Shell />
      </ChatProvider>
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
      <TipLayer />
    </AppProvider>
  );
}

/** 메뉴 접힘은 넓은 창과 좁은 창을 따로 기억한다 (큰 모니터에서 펼친 것이 노트북에서도 펼쳐져 문서 칸이 좁아지지 않게) */
const NAV_KEY = { narrow: "kordoc-nav-collapsed", wide: "kordoc-nav-collapsed-wide" } as const;

function useNavCollapsed() {
  // 1366 노트북에서도 문서 칸이 넓게 (접으면 아이콘 + 짧은 이름)
  const [narrow, setNarrow] = useState(() => window.innerWidth < 1440);
  const range = narrow ? "narrow" : "wide";
  const [prefs, setPrefs] = useState(() => ({
    narrow: readPref<boolean | null>(NAV_KEY.narrow, null),
    wide: readPref<boolean | null>(NAV_KEY.wide, null),
  }));
  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < 1440);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const collapsed = prefs[range] ?? narrow;
  const toggle = () => { setPrefs((p) => ({ ...p, [range]: !collapsed })); writePref(NAV_KEY[range], !collapsed); };
  return [collapsed, toggle] as const;
}

function Shell() {
  const app = useApp();
  const { screen, openDocs, startBatch, startPdf, startCreate, startCompare, toast, setDragTarget, dropHandler, firstRun, ai } = app;
  const quick = useQuickActions();
  const [visited, setVisited] = useState<Set<Screen>>(() => new Set<Screen>(["home"]));
  const [collapsed, toggleNav] = useNavCollapsed();
  useInboxReminder();
  const screenRef = useRef(screen);
  screenRef.current = screen;

  useEffect(() => {
    setVisited((v) => (v.has(screen) ? v : new Set(v).add(screen)));
  }, [screen]);
  // 고르기 묶음의 화살표 키 (앱 전체 한 번)
  useEffect(() => installRadioKeys(), []);

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

  // 우클릭 메뉴·파일 연결로 들어온 동작. 빠른 동작은 창 없이 돌리고 알림만(useQuickActions), 그 밖은 맞는 화면으로.
  // kordoc:// 주소는 웹·메일 링크로도 올 수 있어서, 문서를 밖으로 보내는 일(인터넷 AI 요약)은
  // 자동으로 하지 않고 문서만 열어 둔다. 사용자가 요약하기를 눌러야 보낸다
  const runAction = useCallback(async (action: LinkAction, paths: string[]) => {
    if (isQuick(action)) { quick(action, paths); return; }
    // 문서가 인터넷 AI 로 나갈 수 있는가. 꺼진 앱이 이 동작으로 켜지면 AI 설정을 읽기 전이라 엔진에 물어본다.
    // 그래도 모르면 나갈 수 있다고 보고 바로 시작하지 않는다
    const usesAi = action === "precheck" || action === "collect" || action === "summarize";
    const status = ai ?? (usesAi ? await rpc("ai_status", {}).catch(() => null) : null);
    const outside = !status || status.is_cloud;
    const holdWhy = status ? "외부 AI로 보내기 전에 확인하세요." : "AI 설정을 아직 읽지 못해 바로 시작하지 않았습니다.";
    // ask·versions 는 Rust 가 문서 카드 창으로 연다. 여기 오는 건 카드를 못 띄운 경우 → 문서 화면으로
    if (action === "open" || action === "ask" || action === "versions") openDocs(paths);
    else if (action === "tools") startBatch({ paths });
    else if (action === "edit") {
      startCreate({ path: paths[0] });
      if (paths.length > 1) toast("한글 편집기는 한 번에 한 문서를 엽니다. 첫 문서를 열었습니다.", "info");
    } else if (action === "precheck" && outside) {
      // 점검은 AI 검토까지 이어서 돈다 → 요약과 같은 까닭으로 인터넷 AI 면 바로 시작하지 않는다
      openDocs(paths, { tool: "review" });
      toast(`${holdWhy} 점검 시작을 누르면 시작합니다.`, "info");
    } else if (action === "precheck") openDocs(paths, { tool: "review", run: "precheck" });
    else if (action === "pdfwork") startPdf({ paths });
    else if (action === "compare") {
      // 탐색기는 고른 파일을 제멋대로의 순서로 넘긴다 → 먼저 고친 파일이 고치기 전 문서다
      const order = await rpc("scan_paths", { paths }).then((r) => [...r.files].sort((a, b) => (a.modified ?? 0) - (b.modified ?? 0)).map((f) => f.path), () => paths);
      const [before, after] = order.length >= 2 ? [order[0], order[order.length - 1]] : paths;
      startCompare(before, after);
      if (paths.length > 2) toast(`문서 비교는 두 개씩 합니다. 가장 먼저 고친 것과 가장 나중에 고친 것을 놓았습니다(${paths.length}개 중).`, "info");
      else if (paths.length === 2) toast("먼저 고친 문서를 고치기 전으로 놓았습니다. 반대면 화면에서 서로 바꾸세요.", "info");
    } else if (action === "collect" && outside) {
      startBatch({ paths, task: "collect" });
      toast(`${holdWhy} 시작을 누르면 시작합니다.`, "info");
    } else if (action === "collect") startBatch({ paths, task: "collect", autoRun: true });
    // 영수증은 Rust 가 문서 카드로 연다. 여기 오는 건 카드의 "본창에서 열기"
    else if (action === "receipt") startBatch({ paths, task: "receipt", autoRun: true });
    else if (action === "summarize" && outside) {
      openDocs(paths, { tool: "ai" });
      toast(`${holdWhy} 요약하기를 누르면 ${status ? "보냅니다" : "시작합니다"}.`, "info");
    } else if (action === "summarize") openDocs(paths, { tool: "ai", run: "summarize" });
  }, [openDocs, startBatch, startPdf, startCreate, startCompare, quick, ai, toast]);

  const onLink = useCallback(async (p: DeepLinkPayload) => {
    if (p.type === "file") { void runAction(p.action, [p.path]); return; }
    try {
      const m = await rpc("read_batch_manifest", { path: p.manifestPath });
      void runAction(isLinkAction(m.action) ? m.action : "open", m.files);
    } catch (e) {
      // 창 없이 켜진 앱이면 알림 글이 안 보인다: 창을 연다
      void invokeCmd("shell_show").catch(() => undefined);
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
        // PDF 작업 화면에서는 그 책상에 놓는다
        const put = screenRef.current === "pdf" ? dropHandler("pdf") : undefined;
        void pickFiles().then((paths) => paths.length && (put ? put(paths) : openDocs(paths)));
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
  }, [openDocs, toast, dropHandler]);

  return (
    <div className="kd-app">
      <a href="#main" className="skip-link">본문으로 이동</a>
      <NavRail collapsed={collapsed} onToggle={toggleNav} />
      <main id="main" className="kd-main">
        {SCREENS.map((s) => visited.has(s.id) && (
          <ErrorBoundary key={s.id} hidden={screen !== s.id}>{s.render(screen === s.id)}</ErrorBoundary>
        ))}
      </main>
      {firstRun && <FirstRunWizard />}
    </div>
  );
}
