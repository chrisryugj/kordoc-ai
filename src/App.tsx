import { useState, useCallback, useEffect, useRef } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { Sidebar } from "./components/layout/Sidebar";
import { StatusBar } from "./components/layout/StatusBar";
import { Workspace } from "./components/pipeline/Workspace";
import { OcrProgressStep } from "./components/pipeline/OcrProgressStep";
import { ResultStep } from "./components/pipeline/ResultStep";
import { ToastContainer } from "./components/ui/Toast";
import { SettingsModal } from "./components/settings/SettingsModal";
import { HelpModal } from "./components/help/HelpModal";
import { MCPSetupDialog } from "./components/mcp/MCPSetupDialog";
import { MergeResultModal } from "./components/pipeline/MergeResultModal";
import { ErrorBoundary } from "./components/ui/ErrorBoundary";
import { useSidecar } from "./hooks/useSidecar";
import { usePipeline } from "./hooks/usePipeline";
import { useSettings } from "./hooks/useSettings";
import { useElapsed } from "./hooks/useElapsed";
import { useToast } from "./hooks/useToast";
import { useWindowSize } from "./hooks/useWindowSize";
import { useDeepLink, type DeepLinkPayload } from "./hooks/useDeepLink";
import type { ImportedFile, PipelineAction, MergeMode, SummarizeOptions, FormExtractOptions, PdfUtilsOptions } from "./types/pipeline";
import type { NavItem } from "./types/nav";
import { detectFileType, SUPPORTED_EXT_RE } from "./utils/fileType";


export default function App() {
  const [nav, setNav] = useState<NavItem>("pipeline");
  const logsRef = useRef<string[]>([]);
  const [, setLogsVersion] = useState(0);
  const logUnlistenRef = useRef<UnlistenFn | null>(null);
  const stderrUnlistenRef = useRef<UnlistenFn | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => window.innerWidth < 1024);
  const [mcpSetupOpen, setMcpSetupOpen] = useState(false);
  const [isSummarizing, setIsSummarizing] = useState(false);

  const sidecar = useSidecar();
  const pipeline = usePipeline();
  useWindowSize(pipeline.step);
  const { toasts, showToast, dismissToast } = useToast();

  const sidecarReady = sidecar.status === "ready";
  const isProcessing = pipeline.step === "converting";
  const settings = useSettings(sidecarReady, sidecar.call, isProcessing);
  const { apiKey, apiKeyMasked, ocrModel, analysisModel, aiMode, outputDir, theme } = settings;
  const elapsed = useElapsed(pipeline.step);

  // Listen for progress events and sidecar logs
  useEffect(() => {
    let mounted = true;
    listen<{ current: number; total: number; message: string }>("pipeline:progress", (event) => {
      if (!mounted) return;
      const { message } = event.payload;
      if (message) {
        logsRef.current = [...logsRef.current.slice(-200), message];
        setLogsVersion((v) => v + 1);
      }
    }).then((unlisten) => {
      if (mounted) logUnlistenRef.current = unlisten;
      else unlisten();
    });
    listen<string>("sidecar:log", (event) => {
      if (!mounted) return;
      const line = event.payload;
      if (line) {
        logsRef.current = [...logsRef.current.slice(-200), line];
        setLogsVersion((v) => v + 1);
      }
    }).then((unlisten) => {
      if (mounted) stderrUnlistenRef.current = unlisten;
      else unlisten();
    });
    return () => {
      mounted = false;
      logUnlistenRef.current?.();
      logUnlistenRef.current = null;
      stderrUnlistenRef.current?.();
      stderrUnlistenRef.current = null;
    };
  }, []);

  // Tauri drag-and-drop (파일 + 폴더 지원)
  const filesRef = useRef(pipeline.files);
  filesRef.current = pipeline.files;
  const sidecarCallRef = useRef(sidecar.call);
  sidecarCallRef.current = sidecar.call;

  useEffect(() => {
    let mounted = true;
    let unlistenFn: (() => void) | null = null;
    getCurrentWindow().onDragDropEvent(async (event) => {
      if (!mounted) return;
      if (event.payload.type !== "drop") return;
      const paths = (event.payload as { type: "drop"; paths: string[] }).paths;
      if (!paths?.length) return;

      const existingPaths = new Set(filesRef.current.map((f) => f.path));
      const collected: ImportedFile[] = [];

      for (const p of paths) {
        if (SUPPORTED_EXT_RE.test(p)) {
          if (existingPaths.has(p)) continue;
          const name = p.split(/[/\\]/).pop() ?? p;
          collected.push({ path: p, name, size: 0, type: detectFileType(name) });
          existingPaths.add(p);
        } else if (!p.includes(".") || p.endsWith("\\") || p.endsWith("/")) {
          // 확장자 없으면 폴더로 간주 → list_files로 내부 스캔
          try {
            const entries = await sidecarCallRef.current("list_files", { path: p }) as { name: string; is_dir: boolean; size: number }[];
            const sep = p.includes("/") ? "/" : "\\";
            for (const e of entries) {
              if (e.is_dir || !SUPPORTED_EXT_RE.test(e.name)) continue;
              const fullPath = `${p}${sep}${e.name}`;
              if (existingPaths.has(fullPath)) continue;
              collected.push({ path: fullPath, name: e.name, size: e.size, type: detectFileType(e.name) });
              existingPaths.add(fullPath);
            }
          } catch { /* 폴더 아니면 무시 */ }
        }
      }

      if (collected.length > 0) {
        pipeline.setFiles([...filesRef.current, ...collected]);
        if (pipeline.step === "idle") pipeline.setStep("import");
      }
    }).then((fn) => {
      if (mounted) unlistenFn = fn;
      else fn();
    });
    return () => { mounted = false; unlistenFn?.(); };
  }, [pipeline.setFiles, pipeline.setStep, pipeline.step]);

  // Clipboard paste — 이미지/텍스트 붙여넣기
  useEffect(() => {
    const addFileFromPath = (savedPath: string, size: number) => {
      const name = savedPath.split(/[/\\]/).pop() ?? "clipboard";
      const existingPaths = new Set(filesRef.current.map((f) => f.path));
      if (existingPaths.has(savedPath)) return;
      pipeline.setFiles([...filesRef.current, {
        path: savedPath, name, size, type: detectFileType(name),
      }]);
      if (pipeline.step === "idle") pipeline.setStep("import");
    };

    const handlePaste = async (e: ClipboardEvent) => {
      // 입력 필드에서는 기본 동작 유지
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;

      const items = e.clipboardData?.items;
      if (!items) return;

      // 이미지 우선
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          e.preventDefault();
          const blob = item.getAsFile();
          if (!blob) continue;
          const ext = item.type.split("/")[1]?.replace("jpeg", "jpg") ?? "png";
          const reader = new FileReader();
          reader.onload = async () => {
            const base64 = (reader.result as string).split(",")[1];
            if (!base64) return;
            try {
              const savedPath = await invoke<string>("save_clipboard_image", {
                base64Data: base64, extension: ext,
              });
              addFileFromPath(savedPath, blob.size);
              showToast("클립보드 이미지 추가됨", "success");
            } catch (err) {
              showToast(`붙여넣기 실패: ${err}`, "error");
            }
          };
          reader.readAsDataURL(blob);
          return;
        }
      }

      // 텍스트 (이미지가 없을 때만)
      const text = e.clipboardData?.getData("text/plain");
      if (text && text.trim().length >= 10) {
        e.preventDefault();
        try {
          const savedPath = await invoke<string>("save_clipboard_text", { text });
          addFileFromPath(savedPath, text.length);
          showToast("클립보드 텍스트 추가됨", "success");
        } catch (err) {
          showToast(`붙여넣기 실패: ${err}`, "error");
        }
      }
    };

    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [pipeline.setFiles, pipeline.setStep, pipeline.step, showToast]);

  // File browser
  const handleBrowseFiles = useCallback(async () => {
    try {
      const selected = await open({
        multiple: true,
        filters: [
          { name: "문서", extensions: ["hwp", "hwpx", "pdf", "xlsx", "docx", "txt", "md"] },
          { name: "이미지", extensions: ["png", "jpg", "jpeg", "gif", "webp"] },
        ],
      });
      if (!selected) return;
      const paths = Array.isArray(selected) ? selected : [selected];
      const existingPaths = new Set(pipeline.files.map((f) => f.path));
      const newFiles: ImportedFile[] = paths
        .filter((p) => !existingPaths.has(p))
        .map((p) => {
          const name = p.split(/[/\\]/).pop() ?? p;
          return { path: p, name, size: 0, type: detectFileType(name) };
        });
      if (newFiles.length > 0) pipeline.setFiles([...pipeline.files, ...newFiles]);
    } catch (e) {
      showToast(`파일 선택 실패: ${e}`, "error");
    }
  }, [pipeline.files, pipeline.setFiles, showToast]);

  // Folder browser
  const handleBrowseFolder = useCallback(async () => {
    try {
      const selected = await open({ directory: true, multiple: false });
      if (!selected) return;
      const folderPath = Array.isArray(selected) ? selected[0] : selected;
      if (!folderPath) return;
      const entries = await sidecar.call("list_files", { path: folderPath }) as { name: string; is_dir: boolean; size: number }[];
      const supported = entries.filter((e) => !e.is_dir && SUPPORTED_EXT_RE.test(e.name));
      if (supported.length === 0) { showToast("선택한 폴더에 지원 파일이 없습니다", "info"); return; }
      const existingPaths = new Set(pipeline.files.map((f) => f.path));
      const sep = folderPath.includes("/") ? "/" : "\\";
      const newFiles: ImportedFile[] = supported
        .map((e) => ({ path: `${folderPath}${sep}${e.name}`, name: e.name, size: e.size }))
        .filter((f) => !existingPaths.has(f.path))
        .map((f) => ({ path: f.path, name: f.name, size: f.size, type: detectFileType(f.name) }));
      if (newFiles.length > 0) {
        pipeline.setFiles([...pipeline.files, ...newFiles]);
        showToast(`${newFiles.length}개 파일 추가됨`, "success");
      } else {
        showToast("추가할 새 파일이 없습니다", "info");
      }
    } catch (e) {
      showToast(`폴더 선택 실패: ${e}`, "error");
    }
  }, [pipeline.files, pipeline.setFiles, sidecar.call, showToast]);

  // 시스템 알림 — 백그라운드/tray 상태에서 변환 완료/실패를 Win11 native toast 로.
  // 권한은 첫 사용 시 1회 요청. 창이 포커스된 경우 in-app Toast 와 중복이라 스킵.
  const notifySystem = useCallback(async (title: string, body: string) => {
    try {
      const focused = await getCurrentWindow().isFocused().catch(() => true);
      if (focused) return;
      if (!(await isPermissionGranted())) return;
      sendNotification({ title, body });
    } catch {
      /* ignore */
    }
  }, []);

  // Start action
  const handleStartAction = useCallback(async (action: PipelineAction, actionOptions?: { outputDir?: string; mergeMode?: MergeMode; orderedFiles?: ImportedFile[]; summarizeOptions?: SummarizeOptions; formExtractOptions?: FormExtractOptions; pdfUtilsOptions?: PdfUtilsOptions }) => {
    if (pipeline.files.length === 0) { showToast("파일을 먼저 추가하세요", "error"); return; }
    logsRef.current = [`${action} 시작: ${pipeline.files.length}개 파일`];
    setLogsVersion((v) => v + 1);
    try {
      await pipeline.startAction(action, sidecar.call, {
        ...(outputDir ? { outputDir } : {}),
        ...actionOptions,
      });
      showToast("처리 완료", "success");
      void notifySystem("KorDoc — 처리 완료", `${action}: ${pipeline.files.length}개 파일`);
    } catch (e) {
      const msg = String(e).replace(/^Error:\s*/, "").replace(/^JSON-RPC error:\s*/, "");
      logsRef.current = [...logsRef.current, `ERROR: ${msg}`];
      setLogsVersion((v) => v + 1);
      showToast(msg, "error");
      void notifySystem("KorDoc — 처리 실패", msg);
    }
  }, [pipeline.files, pipeline.startAction, sidecar.call, outputDir, showToast, notifySystem]);

  const handleCancel = useCallback(() => {
    pipeline.cancel(sidecar.call);
    logsRef.current = [];
    showToast("취소됨", "info");
  }, [pipeline.cancel, sidecar.call, showToast]);

  const handleOpenFolder = useCallback(async () => {
    if (pipeline.result?.outputPath) {
      try { await sidecar.call("open_folder", { path: pipeline.result.outputPath }); }
      catch { showToast(`출력 경로: ${pipeline.result.outputPath}`, "info"); }
    }
  }, [pipeline.result, sidecar.call, showToast]);

  // AI 요약 from result viewer — 오프라인이면 전환 확인
  const pendingSummarizeRef = useRef<string | null>(null);
  const [summarizeConfirm, setSummarizeConfirm] = useState(false);

  const doSummarize = useCallback(async (markdown: string) => {
    setIsSummarizing(true);
    try {
      const raw = await sidecar.call("summarize", { text: markdown, style: "standard", length: "medium" }) as Record<string, unknown>;
      if (typeof raw.summary === "string") {
        // 요약 결과를 pipeline result에 반영 → ResultStep에서 인라인 표시
        pipeline.setResult?.({
          total: 1, successCount: 1, failCount: 0,
          outputPath: pipeline.result?.outputPath ?? "",
          warnings: [],
          data: raw,
        });
        showToast("요약 완료", "success");
        try { await navigator.clipboard.writeText(raw.summary as string); } catch { /* ok */ }
      }
    } catch (e) {
      showToast(`요약 실패: ${e}`, "error");
    } finally {
      setIsSummarizing(false);
    }
  }, [sidecar.call, showToast, pipeline.result, pipeline.setResult]);

  const handleSummarize = useCallback((markdown: string) => {
    if (!apiKey.trim()) { showToast("Gemini API 키가 필요합니다", "error"); return; }
    if (aiMode === "offline") {
      pendingSummarizeRef.current = markdown;
      setSummarizeConfirm(true);
      return;
    }
    doSummarize(markdown);
  }, [apiKey, aiMode, doSummarize, showToast]);

  const handleSummarizeConfirm = useCallback(() => {
    setSummarizeConfirm(false);
    settings.toggleAiMode();
    if (pendingSummarizeRef.current) {
      doSummarize(pendingSummarizeRef.current);
      pendingSummarizeRef.current = null;
    }
  }, [settings, doSummarize]);

  // Deep-link 처리 — 탐색기 우클릭 → kordoc-launcher.exe → kordoc:// → Tauri → 여기.
  // 단일 파일은 즉시 import + Workspace 이동, 사용자가 액션 버튼 클릭.
  // batch 는 sidecar `read_batch_manifest` RPC 로 manifest 읽고 files 일괄 추가.
  const importFiles = useCallback((paths: string[]) => {
    const existing = new Set(filesRef.current.map((f) => f.path));
    const additions = paths
      .filter((p) => p && !existing.has(p))
      .map<ImportedFile>((p) => {
        const n = p.split(/[/\\]/).pop() ?? p;
        return { path: p, name: n, size: 0, type: detectFileType(n) };
      });
    if (additions.length > 0) {
      pipeline.setFiles([...filesRef.current, ...additions]);
    }
    if (pipeline.step === "idle") pipeline.setStep("import");
    setNav("pipeline");
    return additions.length;
  }, [pipeline.setFiles, pipeline.setStep, pipeline.step]);

  const handleDeepLink = useCallback(async (payload: DeepLinkPayload) => {
    if (payload.type === "batch") {
      try {
        const manifest = await sidecar.call("read_batch_manifest", { path: payload.manifestPath }) as {
          action: string; files: string[]; created_at?: string;
        };
        const added = importFiles(manifest.files);
        showToast(`일괄 처리: ${added}개 파일 추가됨 (${manifest.action})`, "info");
      } catch (e) {
        showToast(`batch manifest 읽기 실패: ${e}`, "error");
      }
      return;
    }

    const added = importFiles([payload.path]);
    const name = payload.path.split(/[/\\]/).pop() ?? payload.path;
    const hint =
      payload.type === "convert"
        ? `우클릭 변환 (${payload.action.toUpperCase()}): ${name}${added > 0 ? " — 변환 버튼을 누르세요" : ""}`
        : payload.type === "summarize"
        ? `우클릭 요약: ${name} — 변환 후 결과 화면에서 요약을 누르세요`
        : `KorDoc에서 열기: ${name}`;
    showToast(hint, "info");
  }, [importFiles, sidecar.call, showToast]);

  useDeepLink(handleDeepLink);

  // notification 권한 — 첫 사용 시 1회 요청
  useEffect(() => {
    void (async () => {
      try {
        if (!(await isPermissionGranted())) {
          await requestPermission();
        }
      } catch {
        /* ignore */
      }
    })();
  }, []);

  const handleNavigate = useCallback((item: NavItem) => {
    if (item === "settings") setSettingsOpen(true);
    else if (item === "help") setHelpOpen(true);
    else {
      if (isProcessing && item !== "pipeline") {
        showToast("처리가 진행 중입니다. 작업은 백그라운드에서 계속됩니다.", "info");
      }
      setNav(item);
    }
  }, [isProcessing, showToast]);

  // 현재 화면 결정: workspace (idle/import) | converting | complete
  const isWorkspace = pipeline.step === "idle" || pipeline.step === "import";

  return (
    <div className="h-screen flex flex-col" onContextMenu={(e) => e.preventDefault()}>
      <a href="#main-content" className="skip-link">본문으로 이동</a>
      <div className="flex flex-1 overflow-hidden">
        <Sidebar active={nav} onNavigate={handleNavigate} sidecarStatus={sidecar.status} sidecarError={sidecar.errorMessage} apiKeySet={apiKey.trim().length > 0} aiMode={aiMode} onToggleMode={settings.toggleAiMode} collapsed={sidebarCollapsed} onToggleCollapse={() => setSidebarCollapsed((c) => !c)} />

        <main id="main-content" className="flex-1 flex flex-col overflow-hidden" style={{ backgroundColor: "var(--color-bg-primary)" }}>
          <ErrorBoundary>
            <div className="flex-1 flex flex-col overflow-hidden" style={{ display: nav === "pipeline" ? "flex" : "none" }}>

              {/* Workspace — idle/import 합친 메인 화면 */}
              {isWorkspace && (
                <Workspace
                  files={pipeline.files}
                  onFilesChange={pipeline.setFiles}
                  onAction={handleStartAction}
                  onBrowse={handleBrowseFiles}
                  onBrowseFolder={handleBrowseFolder}
                  apiKeySet={apiKey.trim().length > 0}
                  aiMode={aiMode}
                  onToggleMode={settings.toggleAiMode}
                  onOpenSettings={() => setSettingsOpen(true)}
                  sidecarReady={sidecarReady}
                  sidecarError={sidecar.status === "error" ? sidecar.errorMessage : undefined}
                  sidecarCall={sidecar.call}
                  showToast={showToast}
                  onOpenMcpSetup={() => setMcpSetupOpen(true)}
                  outputDir={outputDir}
                  onOutputDirChange={settings.setOutputDir}
                />
              )}

              {/* Converting */}
              {pipeline.step === "converting" && (
                <div className="flex-1 overflow-y-auto">
                  <OcrProgressStep progress={pipeline.progress} onCancel={handleCancel} logs={logsRef.current} step={pipeline.step} elapsed={elapsed} />
                </div>
              )}

              {/* Result */}
              {pipeline.step === "complete" && (
                <div className="flex-1 flex flex-col overflow-hidden">
                  <ResultStep
                    result={pipeline.result}
                    files={pipeline.files}
                    onReset={pipeline.reset}
                    onBack={pipeline.goBack}
                    onOpenFolder={handleOpenFolder}
                    onSummarize={handleSummarize}
                    isSummarizing={isSummarizing}
                    logs={logsRef.current}
                    elapsed={elapsed}
                  />
                </div>
              )}
            </div>
          </ErrorBoundary>
        </main>
      </div>

      <StatusBar step={pipeline.step} progress={pipeline.progress} elapsed={elapsed} />
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />

      <SettingsModal
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        apiKey={apiKey}
        apiKeyMasked={apiKeyMasked}
        ocrModel={ocrModel}
        analysisModel={analysisModel}
        aiMode={aiMode}
        sidecarStatus={sidecar.status}
        sidecarError={sidecar.errorMessage}
        outputDir={outputDir}
        theme={theme}
        onThemePreview={settings.setTheme}
        onSave={settings.handleSettingsSave}
      />

      <HelpModal isOpen={helpOpen} onClose={() => setHelpOpen(false)} />

      <MCPSetupDialog
        isOpen={mcpSetupOpen}
        onClose={() => setMcpSetupOpen(false)}
        sidecarCall={sidecar.call}
        showToast={showToast}
      />

      {/* 병합 결과 모달 — merge 완료 시 페이지 전환 없이 팝업 */}
      <MergeResultModal
        result={pipeline.step === "import" ? pipeline.result : null}
        onClose={pipeline.goBack}
        onOpenFolder={() => { handleOpenFolder(); pipeline.goBack(); }}
      />

      {/* AI 요약 모드 전환 확인 */}
      {summarizeConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: "var(--color-backdrop)" }}>
          <div className="card p-6 max-w-sm mx-4 animate-fade-in">
            <div className="flex flex-col items-center text-center gap-3">
              <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ backgroundColor: "var(--color-accent-subtle)" }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--color-accent)" }}><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
              </div>
              <div>
                <p className="ts-sm font-bold" style={{ color: "var(--color-text-primary)" }}>온라인 모드 전환</p>
                <p className="ts-2xs mt-1" style={{ color: "var(--color-text-secondary)" }}>
                  AI 요약은 Gemini API가 필요합니다.
                </p>
                <p className="ts-2xs mt-2 px-3 py-1.5 rounded" style={{ backgroundColor: "var(--color-warning-subtle)", color: "var(--color-warning)" }}>
                  문서 내용이 외부 서버로 전송됩니다. 보안에 유의하세요.
                </p>
              </div>
              <div className="flex gap-2 mt-1 w-full">
                <button
                  type="button"
                  onClick={() => { setSummarizeConfirm(false); pendingSummarizeRef.current = null; }}
                  className="flex-1 px-4 py-2 rounded-md ts-xs font-medium hover-bg-tertiary"
                  style={{ color: "var(--color-text-secondary)" }}
                >
                  취소
                </button>
                <button
                  type="button"
                  onClick={handleSummarizeConfirm}
                  className="flex-1 px-4 py-2 rounded-md ts-xs font-medium"
                  style={{ backgroundColor: "var(--color-accent)", color: "white" }}
                >
                  전환 후 요약
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
