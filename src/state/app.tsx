/**
 * 앱 전역 상태 — 화면 이동, 연 문서, 설정·AI 상태, 화면 사이 넘겨주기(intent), 끌어다 놓기 받는 곳.
 * 화면은 한 번 열리면 숨김으로 남아 상태를 지킨다 (App.tsx).
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { AiStatus, DeepPartial, DocFormat, DocInfo, Settings, SystemInfo } from "../lib/contract";
import { rpc, errorText } from "../lib/rpc";
import { baseName, formatOf } from "../lib/format";
import { loadRecent, pushRecent, readPref, saveRecent, writePref, type RecentDoc } from "../lib/recent";
import { useSidecar, type SidecarStatus } from "../hooks/useSidecar";
import type { ToastType } from "../components/ui/Toast";

export type Screen = "home" | "inbox" | "workbench" | "create" | "batch" | "compare" | "assistant" | "settings" | "impact";
export type ToolId = "info" | "export" | "ai" | "review" | "redact" | "edit" | "tables" | "seal" | "shrink";
export type BatchTaskId =
  | "convert" | "hwpx" | "pdf" | "ocr" | "merge" | "bundle" | "pdftools" | "collect" | "extract"
  | "tables" | "images" | "search" | "redact" | "mailmerge" | "watch" | "print" | "compare" | "stylecopy" | "shrink";
export type ThemePref = "light" | "dark" | "system";

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
export interface BatchStart { paths: string[]; task?: BatchTaskId; autoRun?: boolean }
export type DraftKind = "reply" | "complaint" | "minutes" | "onepage" | "press" | "memo";
export interface CreateStart { path?: string; route?: "library" | "blank" | "ai" | "convert"; kind?: DraftKind; markdown?: string; references?: string[]; recover?: { title?: string; working?: boolean } }
export interface AssistantStart { paths: string[]; tab?: "ask" | "rewrite"; text?: string }

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
  createIntent: Intent<CreateStart> | null;
  startCreate: (c: CreateStart) => void;
  recent: RecentDoc[];
  clearRecent: () => void;
  theme: ThemePref;
  setTheme: (t: ThemePref) => void;
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
}

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
  const [createIntent, setCreateIntent] = useState<Intent<CreateStart> | null>(null);
  const [recent, setRecent] = useState<RecentDoc[]>(loadRecent);
  const [theme, setThemeState] = useState<ThemePref>(() => readPref<ThemePref>("kordoc-theme", "system"));
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
    setDocs(next);
    setActivePath((cur) => (cur === path ? next[Math.max(0, idx - 1)]?.path ?? null : cur));
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
    batchIntent, startBatch: (b) => { setBatchIntent(intent(b)); setScreen("batch"); },
    compareIntent, startCompare: (o, n) => { setCompareIntent(intent({ old: o, new: n })); setScreen("compare"); },
    assistantIntent, askAbout: (a) => { setAssistantIntent(intent(a)); setScreen("assistant"); },
    createIntent, startCreate: (c) => { setCreateIntent(intent(c)); setScreen("create"); },
    recent, clearRecent: () => { setRecent([]); saveRecent([]); },
    theme, setTheme: (t) => { setThemeState(t); writePref("kordoc-theme", t); },
    dragTarget, setDragTarget, registerDrop, dropHandler: (name) => drops.current.get(name),
    badges, setBadge, firstRun, setFirstRun,
    settingsIntent, openSettings: (section) => { setSettingsIntent(intent(section)); go("settings"); }, setLeaveGuard,
  }), [screen, go, engine.status, engine.errorMessage, engine.restart, ready, settings, saveSettings, ai, refreshAi, system, toast,
    docs, activePath, openDocs, closeDoc, updateDoc, focus, batchIntent, compareIntent, assistantIntent, createIntent, recent,
    theme, dragTarget, registerDrop, badges, setBadge, firstRun, settingsIntent, setLeaveGuard]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
