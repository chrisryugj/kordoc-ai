/**
 * 앱 전역 상태 — 화면 이동, 연 문서, 설정·AI 상태, 화면 사이 넘겨주기(intent), 끌어다 놓기 받는 곳.
 * 화면은 한 번 열리면 숨김으로 남아 상태를 지킨다 (App.tsx).
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { AiStatus, DeepPartial, DocFormat, DocInfo, Settings, SystemInfo } from "../lib/contract";
import { rpc, errorText } from "../lib/rpc";
import { baseName, formatOf } from "../lib/format";
import { notifySystem } from "../lib/native";
import { loadRecent, pushRecent, readPref, saveRecent, writePref, type RecentDoc } from "../lib/recent";
import { useSidecar, type SidecarStatus } from "../hooks/useSidecar";
import type { ToastType } from "../components/ui/Toast";

export type Screen = "home" | "chat" | "inbox" | "workbench" | "create" | "pdf" | "batch" | "compare" | "assistant" | "settings" | "impact" | "help";
export type ToolId = "info" | "export" | "ai" | "review" | "redact" | "edit" | "tables" | "seal" | "shrink";
export type BatchTaskId =
  | "convert" | "hwpx" | "pdf" | "ocr" | "merge" | "hwpsplit" | "bundle" | "pdftools" | "collect" | "extract"
  | "tables" | "images" | "search" | "redact" | "mailmerge" | "watch" | "print" | "compare" | "stylecopy" | "shrink" | "join" | "split" | "receipt";
export type ThemePref = "light" | "dark" | "system";
/** 화면 방식: 쉬운 화면(처음 쓰는 사람: 메뉴를 줄이고 세부 설정을 접음) · 전체 화면(모든 기능과 설정) */
export type UiMode = "easy" | "full";

export interface OpenDoc {
  path: string;
  name: string;
  format: DocFormat;
  info?: DocInfo;
  password?: string;
}

export interface Intent<T> {
  value: T;
  nonce: number;
}

/** 다른 화면에서 도구를 열며 바로 돌릴 일 */
export type AutoRunKind = "summarize" | "redact" | "precheck";
export interface WorkbenchFocus { path: string; page?: number; tool?: ToolId; run?: AutoRunKind }
/** fallback: 우클릭 빠른 동작이 실패해 연 것 (사용자가 이 화면을 부른 게 아니다: 고친 표가 있으면 바꾸지 않고 알리기만) */
export interface BatchStart { paths: string[]; task?: BatchTaskId; autoRun?: boolean; fallback?: boolean }
export type DraftKind = "reply" | "complaint" | "minutes" | "onepage" | "press" | "memo";
export interface AgentTask { text: string; label: string }
export interface CreateStart {
  path?: string; route?: "library" | "blank" | "ai" | "convert"; kind?: DraftKind; markdown?: string; references?: string[]; recover?: { title?: string; working?: boolean };
  /** 편집기로 연 뒤 편집기 AI 에 바로 시킬 요청 (결재 전 점검 지적 고치기). label 은 대화창에 보일 짧은 말 */
  agentTask?: AgentTask;
}
export interface AssistantStart { paths: string[]; tab?: "ask" | "rewrite"; text?: string }
/** PDF 작업에 놓을 파일 (책상을 비우고 이것만) */
export interface PdfStart { paths: string[] }

interface AppValue {
  screen: Screen;
  go: (s: Screen) => void;
  engine: { status: SidecarStatus; error: string; restart: () => void };
  ready: boolean;
  settings: Settings | null;
  saveSettings: (patch: DeepPartial<Settings>) => Promise<Settings | null>;
  ai: AiStatus | null;
  refreshAi: () => Promise<void>;
  system: SystemInfo | null;
  toast: (msg: string, type?: ToastType) => void;
  docs: OpenDoc[];
  activePath: string | null;
  setActive: (path: string) => void;
  openDocs: (paths: string[], focus?: Omit<WorkbenchFocus, "path">) => void;
  closeDoc: (path: string) => void;
  updateDoc: (path: string, patch: Partial<OpenDoc>) => void;
  focus: Intent<WorkbenchFocus> | null;
  batchIntent: Intent<BatchStart> | null;
  startBatch: (b: BatchStart) => void;
  compareIntent: Intent<{ old?: string; new?: string }> | null;
  startCompare: (old?: string, next?: string) => void;
  assistantIntent: Intent<AssistantStart> | null;
  askAbout: (a: AssistantStart) => void;
  /** 홈 "무엇을 할까요?" 에 이 파일들을 붙여 두고 간다 (문서 화면의 AI 에게 시키기) */
  workIntent: Intent<{ paths: string[] }> | null;
  askWork: (w: { paths: string[] }) => void;
  createIntent: Intent<CreateStart> | null;
  startCreate: (c: CreateStart) => void;
  pdfIntent: Intent<PdfStart> | null;
  startPdf: (p: PdfStart) => void;
  recent: RecentDoc[];
  clearRecent: () => void;
  /** 최근 문서 목록에서 하나만 뺀다 (파일은 그대로) */
  removeRecent: (path: string) => void;
  theme: ThemePref;
  setTheme: (t: ThemePref) => void;
  uiMode: UiMode;
  setUiMode: (m: UiMode) => void;
  dragTarget: string | null;
  setDragTarget: (t: string | null) => void;
  registerDrop: (name: string, handler: (paths: string[]) => void) => () => void;
  dropHandler: (name: string) => ((paths: string[]) => void) | undefined;
  badges: Partial<Record<Screen, string>>;
  setBadge: (s: Screen, v: string | undefined) => void;
  firstRun: boolean;
  setFirstRun: (open: boolean) => void;
  /** 설정의 한 구획으로 바로 (예: "set-ai") */
  settingsIntent: Intent<string> | null;
  openSettings: (section: string) => void;
  /** 화면을 떠나기 전에 묻는 문지기 (설정의 저장 안 한 변경). false 를 돌려주면 go 가 멈춘다 */
  setLeaveGuard: (guard: ((next: Screen) => boolean) | null) => void;
  /** 폴더 지켜보기 화면이 지금 걸린 목록을 알려 둔다 (엔진이 다시 켜지면 이 목록으로 다시 건다) */
  noteWatches: (list: WatchRef[]) => void;
}

type WatchRef = { dir: string; out_dir: string; format: string };

const AppContext = createContext<AppValue | null>(null);

export function useApp(): AppValue {
  const v = useContext(AppContext);
  if (!v) throw new Error("AppProvider 밖에서 useApp을 불렀습니다");
  return v;
}

let nonceSeq = 0;
const intent = <T,>(value: T): Intent<T> => ({ value, nonce: ++nonceSeq });

export function AppProvider({ toast, children }: { toast: (msg: string, type?: ToastType) => void; children: ReactNode }) {
  const engine = useSidecar();
  const ready = engine.status === "ready";
  const [screen, setScreen] = useState<Screen>("home");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [ai, setAi] = useState<AiStatus | null>(null);
  const [system, setSystem] = useState<SystemInfo | null>(null);
  const [docs, setDocs] = useState<OpenDoc[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [focus, setFocus] = useState<Intent<WorkbenchFocus> | null>(null);
  const [batchIntent, setBatchIntent] = useState<Intent<BatchStart> | null>(null);
  const [compareIntent, setCompareIntent] = useState<Intent<{ old?: string; new?: string }> | null>(null);
  const [assistantIntent, setAssistantIntent] = useState<Intent<AssistantStart> | null>(null);
  const [workIntent, setWorkIntent] = useState<Intent<{ paths: string[] }> | null>(null);
  const [createIntent, setCreateIntent] = useState<Intent<CreateStart> | null>(null);
  const [pdfIntent, setPdfIntent] = useState<Intent<PdfStart> | null>(null);
  const [recent, setRecent] = useState<RecentDoc[]>(loadRecent);
  const [theme, setThemeState] = useState<ThemePref>(() => readPref<ThemePref>("kordoc-theme", "system"));
  const [uiMode, setUiModeState] = useState<UiMode>(() => readPref<UiMode>("kordoc-ui-mode", "easy"));
  useEffect(() => { document.documentElement.dataset.mode = uiMode; }, [uiMode]);
  const [dragTarget, setDragTarget] = useState<string | null>(null);
  const [badges, setBadges] = useState<Partial<Record<Screen, string>>>({});
  const [firstRun, setFirstRun] = useState(false);
  const [settingsIntent, setSettingsIntent] = useState<Intent<string> | null>(null);
  const drops = useRef(new Map<string, (paths: string[]) => void>());
  const leaveGuard = useRef<((next: Screen) => boolean) | null>(null);
  const go = useCallback((next: Screen) => {
    if (leaveGuard.current && !leaveGuard.current(next)) return;
    setScreen(next);
  }, []);
  const setLeaveGuard = useCallback((g: ((next: Screen) => boolean) | null) => { leaveGuard.current = g; }, []);

  // 화면 테마
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => document.documentElement.classList.toggle("dark", theme === "dark" || (theme === "system" && media.matches));
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);

  const refreshAi = useCallback(async () => {
    try { setAi(await rpc("ai_status", {})); } catch { /* 엔진 준비 전 */ }
  }, []);

  // 구독 프로그램(Claude Code·Codex·Antigravity CLI)을 골랐으면 설치·로그인 상태를 한 번 확인한다: 설정만 보고 연결됐다고 하면
  // 로그아웃된 채 첫 요청을 보내고서야 안 된다는 것을 알게 된다. 안 되는 상태로 확인됐으면 창으로 돌아올 때 다시 본다
  // (터미널에서 로그인하고 돌아오면 저절로 켜진다). 엔진은 허용 전·폐쇄망·기관 차단이면 프로그램을 띄우지 않는다
  const subAsked = useRef({ provider: "", at: 0, busy: false });
  const checkSubscription = useCallback(async (provider: "claude-code" | "codex" | "gemini-cli") => {
    const s = subAsked.current;
    if (s.busy) return;
    subAsked.current = { provider, at: Date.now(), busy: true };
    try { await rpc("ai_subscription_status", { provider }); } catch { /* 상태는 설정 화면에서 다시 볼 수 있다 */ }
    subAsked.current.busy = false;
    await refreshAi();
  }, [refreshAi]);
  useEffect(() => {
    if (!ai) return;
    const p = ai.provider;
    if (p !== "claude-code" && p !== "codex" && p !== "gemini-cli") return;
    // 아직 확인한 적이 없으면 한 번
    if (ai.configured && ai.subscription_state === undefined && subAsked.current.provider !== p) void checkSubscription(p);
    const stuck = ai.subscription_state === "signed-out" || ai.subscription_state === "metered" || ai.subscription_state === "not-installed" || ai.subscription_state === "needs-update";
    if (!stuck) return;
    const onFocus = () => { if (Date.now() - subAsked.current.at > 15_000) void checkSubscription(p); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [ai, checkSubscription]);

  // 엔진이 준비되면 설정·상태를 읽는다
  useEffect(() => {
    if (!ready) return;
    void (async () => {
      try {
        const s = await rpc("get_settings", {});
        setSettings(s);
        // 기관 배포 설정이 기관명을 채워 줘도 내 이름·부서·전화는 물어야 하므로 이름이 비어도 연다
        if ((!s.org.name || !s.org.person) && !readPref("kordoc-first-run-done", false)) setFirstRun(true);
      } catch (e) {
        toast(`설정을 읽지 못했습니다: ${errorText(e)}`, "error");
      }
      void refreshAi();
      try { setSystem(await rpc("system_info", {})); } catch { /* 설정 화면에서 다시 시도 */ }
    })();
  }, [ready, refreshAi, toast]);

  // 창마다 상태를 따로 든다(본창·우클릭 카드). 다른 창에서 AI 를 켜거나 설정을 바꿨을 수 있으니 창으로 돌아올 때 다시 읽는다.
  // 안 읽으면 카드에서 AI 를 켠 뒤에도 본창은 앱을 끌 때까지 "AI가 꺼져 있습니다"로 남는다. 달라졌을 때만 바꿔 넣는다
  useEffect(() => {
    if (!ready) return;
    let last = 0;
    const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
    const onFocus = () => {
      if (Date.now() - last < 3000) return;
      last = Date.now();
      void rpc("get_settings", {}).then((s) => setSettings((prev) => (same(prev, s) ? prev : s))).catch(() => undefined);
      void rpc("ai_status", {}).then((a) => setAi((prev) => (same(prev, a) ? prev : a))).catch(() => undefined);
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [ready]);

  // 폴더 지켜보기는 엔진 메모리에만 있다. 엔진이 죽었다 다시 켜지면(화면이 스스로 다시 켠다) 목록이 비는데, 화면은
  // "창을 닫아도 계속 지켜봅니다"라고 안내한다 → 화면이 기억한 목록으로 다시 걸고, 못 걸면 멈췄다고 알린다
  const watches = useRef<WatchRef[]>([]);
  const noteWatches = useCallback((list: WatchRef[]) => { watches.current = list.map((w) => ({ dir: w.dir, out_dir: w.out_dir, format: w.format })); }, []);
  const wasReady = useRef(false);
  const rearming = useRef(false);
  const rearm = useCallback(async () => {
    const want = watches.current;
    if (rearming.current || !want.length) return;
    rearming.current = true;
    try {
      const now = await rpc("watch_list", {}).catch(() => null);
      if (!now) return;
      const gone = want.filter((w) => !now.some((x) => x.dir === w.dir));
      if (!gone.length) return;
      let failed = 0;
      for (const w of gone) {
        try { await rpc("watch_start", { dir: w.dir, out_dir: w.out_dir, format: w.format as "md" | "html" | "txt" }); } catch { failed++; }
      }
      const after = await rpc("watch_list", {}).catch(() => null);
      if (after) noteWatches(after);
      window.dispatchEvent(new Event("kordoc:watches"));
      const msg = failed
        ? `문서 엔진이 다시 켜지면서 폴더 지켜보기 ${failed}곳이 멈췄습니다. 여러 파일 화면의 폴더 지켜보기에서 다시 시작하세요.`
        : `문서 엔진이 다시 켜져 폴더 지켜보기 ${gone.length}곳을 다시 시작했습니다.`;
      toast(msg, failed ? "error" : "info");
      // 창을 닫고 알림 영역에서 돌리는 기능이다: 멈췄다는 것은 창 안 알림만으로는 못 본다
      if (failed) void notifySystem("KorDoc AI: 폴더 지켜보기가 멈췄습니다", msg);
    } finally {
      rearming.current = false;
    }
  }, [toast, noteWatches]);
  useEffect(() => {
    if (!ready) return;
    const again = wasReady.current;
    wasReady.current = true;
    if (again) void rearm();
  }, [ready, rearm]);
  // 읽기 호출이 죽은 엔진을 그 자리에서 다시 켠 경우(lib/rpc): 상태 확인 주기가 "켜는 중"을 못 보고 지나가 위 효과가 돌지 않는다
  useEffect(() => {
    const on = () => void rearm();
    window.addEventListener("kordoc:engine-restarted", on);
    return () => window.removeEventListener("kordoc:engine-restarted", on);
  }, [rearm]);

  const saveSettings = useCallback(async (patch: DeepPartial<Settings>) => {
    try {
      const next = await rpc("update_settings", { settings: patch });
      setSettings(next);
      void refreshAi();
      return next;
    } catch (e) {
      toast(`설정을 저장하지 못했습니다: ${errorText(e)}`, "error");
      return null;
    }
  }, [refreshAi, toast]);

  const openDocs = useCallback((paths: string[], f?: Omit<WorkbenchFocus, "path">) => {
    const given = paths.filter(Boolean);
    // 엔진이 못 읽는 형식(압축 파일·폴더 등)은 작업대에 열지 않고 알린다
    const skipped = given.filter((p) => formatOf(p) === "unknown");
    if (skipped.length) {
      const names = `${baseName(skipped[0])}${skipped.length > 1 ? ` 외 ${skipped.length - 1}개` : ""}`;
      toast(`열 수 없는 형식이라 열지 않았습니다(${names}). 한글·PDF·워드·엑셀·파워포인트·그림·글 파일을 여세요.`, "error");
    }
    const clean = given.filter((p) => formatOf(p) !== "unknown");
    if (!clean.length) return;
    setDocs((prev) => {
      const have = new Set(prev.map((d) => d.path));
      return [...prev, ...clean.filter((p) => !have.has(p)).map((p) => ({ path: p, name: baseName(p), format: formatOf(p) }))];
    });
    setActivePath(clean[0]);
    setRecent((prev) => {
      const next = pushRecent(prev, clean.map((p) => ({ path: p, name: baseName(p), format: formatOf(p), at: Date.now() })));
      saveRecent(next);
      return next;
    });
    if (f && (f.page || f.tool || f.run)) setFocus(intent({ path: clean[0], ...f }));
    setScreen("workbench");
  }, [toast]);

  const docsRef = useRef(docs);
  docsRef.current = docs;
  const closeDoc = useCallback((path: string) => {
    const prev = docsRef.current;
    const idx = prev.findIndex((d) => d.path === path);
    const next = prev.filter((d) => d.path !== path);
    // 한 번에 여러 문서를 닫을 때(다른 문서 모두 닫기) 다음 호출이 방금 닫은 것까지 반영된 목록을 보게
    docsRef.current = next;
    setDocs(next);
    setActivePath((cur) => (cur === path ? next[Math.max(0, idx - 1)]?.path ?? null : cur));
    // 닫은 문서에 걸려 있던 요청(요약 바로 시작 등)은 버린다: 남겨 두면 그 문서를 다시 열 때 또 돈다
    setFocus((cur) => (cur?.value.path === path ? null : cur));
  }, []);

  const updateDoc = useCallback((path: string, patch: Partial<OpenDoc>) => {
    setDocs((prev) => prev.map((d) => (d.path === path ? { ...d, ...patch } : d)));
  }, []);

  const registerDrop = useCallback((name: string, handler: (paths: string[]) => void) => {
    drops.current.set(name, handler);
    return () => { if (drops.current.get(name) === handler) drops.current.delete(name); };
  }, []);

  const setBadge = useCallback((s: Screen, v: string | undefined) => {
    setBadges((prev) => (prev[s] === v ? prev : { ...prev, [s]: v }));
  }, []);

  const value = useMemo<AppValue>(() => ({
    screen, go,
    engine: { status: engine.status, error: engine.errorMessage, restart: engine.restart },
    ready, settings, saveSettings, ai, refreshAi, system, toast,
    docs, activePath, setActive: setActivePath, openDocs, closeDoc, updateDoc, focus,
    batchIntent, startBatch: (b) => {
      // 목록에서 뺀 옛 할 일(옛 주소 호환): 한글 나누기는 나누기로, PDF 쪽 다루기는 PDF 작업 화면으로
      if (b.task === "pdftools") { setPdfIntent(intent({ paths: b.paths })); setScreen("pdf"); return; }
      setBatchIntent(intent(b.task === "hwpsplit" ? { ...b, task: "split" } : b)); setScreen("batch");
    },
    compareIntent, startCompare: (o, n) => { setCompareIntent(intent({ old: o, new: n })); setScreen("compare"); },
    assistantIntent, askAbout: (a) => { setAssistantIntent(intent(a)); setScreen("assistant"); },
    workIntent, askWork: (w) => { setWorkIntent(intent(w)); setScreen("chat"); },
    createIntent, startCreate: (c) => { setCreateIntent(intent(c)); setScreen("create"); },
    pdfIntent, startPdf: (p) => { setPdfIntent(intent(p)); setScreen("pdf"); },
    recent, clearRecent: () => { setRecent([]); saveRecent([]); },
    removeRecent: (path) => setRecent((prev) => { const next = prev.filter((d) => d.path !== path); saveRecent(next); return next; }),
    theme, setTheme: (t) => { setThemeState(t); writePref("kordoc-theme", t); },
    uiMode, setUiMode: (m) => { setUiModeState(m); writePref("kordoc-ui-mode", m); },
    dragTarget, setDragTarget, registerDrop, dropHandler: (name) => drops.current.get(name),
    badges, setBadge, firstRun, setFirstRun,
    settingsIntent, openSettings: (section) => { setSettingsIntent(intent(section)); go("settings"); }, setLeaveGuard, noteWatches,
  }), [screen, go, engine.status, engine.errorMessage, engine.restart, ready, settings, saveSettings, ai, refreshAi, system, toast,
    docs, activePath, openDocs, closeDoc, updateDoc, focus, batchIntent, compareIntent, assistantIntent, workIntent, createIntent, pdfIntent, recent,
    theme, uiMode, dragTarget, registerDrop, badges, setBadge, firstRun, settingsIntent, setLeaveGuard, noteWatches]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
