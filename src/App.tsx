import { useState, useCallback, useEffect, useRef } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import { Sidebar } from "./components/layout/Sidebar";
import { StatusBar } from "./components/layout/StatusBar";
import { Workspace } from "./components/pipeline/Workspace";
import { OcrProgressStep } from "./components/pipeline/OcrProgressStep";
import { ResultStep } from "./components/pipeline/ResultStep";
import { ToastContainer } from "./components/ui/Toast";
import { SettingsModal } from "./components/settings/SettingsModal";
import { HelpModal } from "./components/help/HelpModal";
import { ErrorBoundary } from "./components/ui/ErrorBoundary";
import { useSidecar } from "./hooks/useSidecar";
import { usePipeline } from "./hooks/usePipeline";
import { useSettings } from "./hooks/useSettings";
import { useElapsed } from "./hooks/useElapsed";
import { useToast } from "./hooks/useToast";
import type { ImportedFile, PipelineAction } from "./types/pipeline";
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
  const [isSummarizing, setIsSummarizing] = useState(false);

  const sidecar = useSidecar();
  const pipeline = usePipeline();
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

  // Tauri drag-and-drop
  const filesRef = useRef(pipeline.files);
  filesRef.current = pipeline.files;

  useEffect(() => {
    let mounted = true;
    let unlistenFn: (() => void) | null = null;
    getCurrentWindow().onDragDropEvent((event) => {
      if (!mounted) return;
      if (event.payload.type !== "drop") return;
      const paths = (event.payload as { type: "drop"; paths: string[] }).paths;
      if (!paths?.length) return;
      const existingPaths = new Set(filesRef.current.map((f) => f.path));
      const newFiles: ImportedFile[] = paths
        .filter((p) => SUPPORTED_EXT_RE.test(p))
        .filter((p) => !existingPaths.has(p))
        .map((p) => {
          const name = p.split(/[/\\]/).pop() ?? p;
          return { path: p, name, size: 0, type: detectFileType(name) };
        });
      if (newFiles.length > 0) {
        pipeline.setFiles([...filesRef.current, ...newFiles]);
        if (pipeline.step === "idle") pipeline.setStep("import");
      }
    }).then((fn) => {
      if (mounted) unlistenFn = fn;
      else fn();
    });
    return () => { mounted = false; unlistenFn?.(); };
  }, [pipeline.setFiles, pipeline.setStep, pipeline.step]);

  // File browser
  const handleBrowseFiles = useCallback(async () => {
    try {
      const selected = await open({
        multiple: true,
        filters: [{ name: "문서", extensions: ["hwp", "hwpx", "pdf", "xlsx", "docx", "txt", "md"] }],
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

  // Start action
  const handleStartAction = useCallback(async (action: PipelineAction) => {
    if (pipeline.files.length === 0) { showToast("파일을 먼저 추가하세요", "error"); return; }
    logsRef.current = [`${action} 시작: ${pipeline.files.length}개 파일`];
    setLogsVersion((v) => v + 1);
    try {
      await pipeline.startAction(action, sidecar.call, outputDir ? { outputDir } : undefined);
      showToast("처리 완료", "success");
    } catch (e) {
      const msg = String(e).replace(/^Error:\s*/, "").replace(/^JSON-RPC error:\s*/, "");
      logsRef.current = [...logsRef.current, `ERROR: ${msg}`];
      setLogsVersion((v) => v + 1);
      showToast(msg, "error");
    }
  }, [pipeline.files, pipeline.startAction, sidecar.call, outputDir, showToast]);

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

  // AI 요약 from result viewer
  const handleSummarize = useCallback(async (markdown: string) => {
    if (!apiKey.trim()) { showToast("Gemini API 키가 필요합니다", "error"); return; }
    setIsSummarizing(true);
    try {
      const raw = await sidecar.call("summarize", { text: markdown }) as Record<string, unknown>;
      if (typeof raw.summary === "string") {
        showToast("요약 완료", "success");
        // 요약 결과를 클립보드에 복사
        try { await navigator.clipboard.writeText(raw.summary as string); showToast("요약이 클립보드에 복사되었습니다", "success"); } catch { /* ok */ }
      }
    } catch (e) {
      showToast(`요약 실패: ${e}`, "error");
    } finally {
      setIsSummarizing(false);
    }
  }, [apiKey, sidecar.call, showToast]);

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
    <div className="h-screen flex flex-col">
      <a href="#main-content" className="skip-link">본문으로 이동</a>
      <div className="flex flex-1 overflow-hidden">
        <Sidebar active={nav} onNavigate={handleNavigate} sidecarStatus={sidecar.status} sidecarError={sidecar.errorMessage} apiKeySet={apiKey.trim().length > 0} />

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
                  onOpenSettings={() => setSettingsOpen(true)}
                  sidecarReady={sidecarReady}
                  sidecarError={sidecar.status === "error" ? sidecar.errorMessage : undefined}
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
                <div className="flex-1 overflow-y-auto">
                  <ResultStep
                    result={pipeline.result}
                    onReset={pipeline.reset}
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
    </div>
  );
}
