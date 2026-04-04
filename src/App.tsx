import { useState, useCallback, useEffect, useRef } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import { Sidebar } from "./components/layout/Sidebar";
import { StatusBar } from "./components/layout/StatusBar";
import { PipelineStepper } from "./components/pipeline/PipelineStepper";
import { WelcomeHero } from "./components/pipeline/WelcomeHero";
import { ImportStep } from "./components/pipeline/ImportStep";
import { ActionSelector } from "./components/pipeline/ActionSelector";
import { OcrProgressStep } from "./components/pipeline/OcrProgressStep";
import { ResultStep } from "./components/pipeline/ResultStep";
import { ToastContainer } from "./components/ui/Toast";
import { SettingsModal, type SettingsSaveValues, SAVED_API_KEY_SENTINEL } from "./components/settings/SettingsModal";
import { HelpModal } from "./components/help/HelpModal";
import { OnboardingTour } from "./components/ui/OnboardingTour";
import { useSidecar } from "./hooks/useSidecar";
import { usePipeline } from "./hooks/usePipeline";
import { useToast } from "./hooks/useToast";
import type { ImportedFile, PipelineAction } from "./types/pipeline";

type NavItem = "pipeline" | "settings" | "help";


export default function App() {
  const [nav, setNav] = useState<NavItem>("pipeline");
  const [apiKey, setApiKey] = useState("");
  const [apiKeyMasked, setApiKeyMasked] = useState("");
  const [ocrModel, setOcrModel] = useState("gemini-3-flash-preview");
  const [analysisModel, setAnalysisModel] = useState("gemini-3-flash-preview");
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    try {
      const saved = localStorage.getItem("kordoc-theme");
      return saved === "dark" ? "dark" : "light";
    } catch { return "light"; }
  });
  const [logs, setLogs] = useState<string[]>([]);
  const logUnlistenRef = useRef<UnlistenFn | null>(null);
  const stderrUnlistenRef = useRef<UnlistenFn | null>(null);
  const [aiMode, setAiMode] = useState<"online" | "offline">("online");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [outputDir, setOutputDir] = useState(() => {
    try { return localStorage.getItem("kordoc-output-dir") || ""; } catch { return ""; }
  });

  const sidecar = useSidecar();
  const pipeline = usePipeline();
  const { toasts, showToast, dismissToast } = useToast();

  // Apply theme to document and persist
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    try { localStorage.setItem("kordoc-theme", theme); } catch {}
  }, [theme]);

  const sidecarReady = sidecar.status === "ready";

  // Load saved settings from sidecar on startup
  useEffect(() => {
    if (sidecarReady && !apiKey) {
      sidecar.call("get_settings", {}).then((resp) => {
        const s = resp as { gemini?: { api_key?: string; model?: string; lite_model?: string; mode?: string } };
        const g = s?.gemini;
        if (g?.api_key) {
          setApiKey(SAVED_API_KEY_SENTINEL);
          // 마스킹: 앞 4자 + ****
          setApiKeyMasked(g.api_key.length > 4 ? g.api_key.slice(0, 4) + "****" : "****");
        }
        if (g?.model) setOcrModel(g.model);
        if (g?.lite_model) setAnalysisModel(g.lite_model);
        if (g?.mode === "offline" || g?.mode === "online") setAiMode(g.mode);
      }).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only run when sidecar becomes ready
  }, [sidecarReady]);

  // Sync API key to sidecar when changed
  const isProcessing = pipeline.step === "converting";
  useEffect(() => {
    if (sidecarReady && apiKey && apiKey !== SAVED_API_KEY_SENTINEL && !isProcessing) {
      sidecar.call("update_settings", { settings: { gemini: { api_key: apiKey } } }).catch(() => {});
    }
  }, [sidecarReady, apiKey, isProcessing, sidecar.call]);

  // Sync model selections and mode to sidecar when changed
  useEffect(() => {
    if (sidecarReady && !isProcessing) {
      sidecar.call("update_settings", { settings: { gemini: { model: ocrModel, lite_model: analysisModel, mode: aiMode } } }).catch(() => {});
    }
  }, [sidecarReady, ocrModel, analysisModel, aiMode, isProcessing, sidecar.call]);

  // Listen for progress events and sidecar logs
  useEffect(() => {
    let mounted = true;
    listen<{ current: number; total: number; message: string }>("pipeline:progress", (event) => {
      if (!mounted) return;
      const { message } = event.payload;
      if (message) setLogs((prev) => [...prev.slice(-200), message]);
    }).then((unlisten) => {
      if (mounted) logUnlistenRef.current = unlisten;
      else unlisten();
    });
    listen<string>("sidecar:log", (event) => {
      if (!mounted) return;
      const line = event.payload;
      if (line) setLogs((prev) => [...prev.slice(-200), line]);
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

  // Tauri drag-and-drop (window-level — HTML5 dataTransfer doesn't include paths)
  useEffect(() => {
    const unlisten = getCurrentWindow().onDragDropEvent((event) => {
      if (event.payload.type !== "drop") return;
      const paths = (event.payload as { type: "drop"; paths: string[] }).paths;
      if (!paths?.length) return;

      const existingPaths = new Set(pipeline.files.map((f) => f.path));
      const newFiles: ImportedFile[] = paths
        .filter((p) => /\.(hwp|hwpx|pdf|xlsx)$/i.test(p))
        .filter((p) => !existingPaths.has(p))
        .map((p) => {
          const name = p.split(/[/\\]/).pop() ?? p;
          const lower = name.toLowerCase();
          return {
            path: p, name, size: 0,
            type: lower.endsWith(".pdf") ? "pdf" as const
              : lower.endsWith(".hwpx") ? "hwpx" as const
              : lower.endsWith(".hwp") ? "hwp" as const
              : lower.endsWith(".xlsx") ? "xlsx" as const
              : "unknown" as const,
          };
        });
      if (newFiles.length > 0) {
        pipeline.setFiles([...pipeline.files, ...newFiles]);
        pipeline.setStep("import");
      }
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [pipeline.files, pipeline.setFiles, pipeline.setStep]);

  // File browser via Tauri dialog
  const handleBrowseFiles = useCallback(async () => {
    try {
      const selected = await open({
        multiple: true,
        filters: [{ name: "문서", extensions: ["hwp", "hwpx", "pdf", "xlsx"] }],
      });
      if (!selected) return;
      const paths = Array.isArray(selected) ? selected : [selected];
      const existingPaths = new Set(pipeline.files.map((f) => f.path));
      const newFiles: ImportedFile[] = paths
        .filter((p) => !existingPaths.has(p))
        .map((p) => {
          const name = p.split(/[/\\]/).pop() ?? p;
          const lower = name.toLowerCase();
          return {
            path: p, name, size: 0,
            type: lower.endsWith(".pdf") ? "pdf" as const
              : lower.endsWith(".hwpx") ? "hwpx" as const
              : lower.endsWith(".hwp") ? "hwp" as const
              : lower.endsWith(".xlsx") ? "xlsx" as const
              : "unknown" as const,
          };
        });
      if (newFiles.length > 0) {
        pipeline.setFiles([...pipeline.files, ...newFiles]);
      }
      pipeline.setStep("import");
    } catch (e) {
      showToast(`파일 선택 실패: ${e}`, "error");
    }
  }, [pipeline.files, pipeline.setFiles, pipeline.setStep, showToast]);

  // Folder browser
  const handleBrowseFolder = useCallback(async () => {
    try {
      const selected = await open({ directory: true, multiple: false });
      if (!selected) return;
      const folderPath = Array.isArray(selected) ? selected[0] : selected;
      if (!folderPath) return;
      const entries = await sidecar.call("list_files", { path: folderPath }) as { name: string; is_dir: boolean; size: number }[];
      // 지원 확장자만 필터
      const supported = entries.filter((e) => !e.is_dir && /\.(hwp|hwpx|pdf|xlsx)$/i.test(e.name));
      if (supported.length === 0) {
        showToast("선택한 폴더에 지원 파일이 없습니다", "info");
        return;
      }
      const existingPaths = new Set(pipeline.files.map((f) => f.path));
      const newFiles: ImportedFile[] = supported
        .map((e) => ({ path: `${folderPath}/${e.name}`.replace(/\//g, "\\"), name: e.name, size: e.size }))
        .filter((f) => !existingPaths.has(f.path))
        .map((f) => {
          const lower = f.name.toLowerCase();
          return {
            path: f.path, name: f.name, size: f.size,
            type: lower.endsWith(".pdf") ? "pdf" as const
              : lower.endsWith(".hwpx") ? "hwpx" as const
              : lower.endsWith(".hwp") ? "hwp" as const
              : lower.endsWith(".xlsx") ? "xlsx" as const
              : "unknown" as const,
          };
        });
      if (newFiles.length > 0) {
        pipeline.setFiles([...pipeline.files, ...newFiles]);
        showToast(`${newFiles.length}개 파일 추가됨`, "success");
      } else {
        showToast("추가할 새 파일이 없습니다", "info");
      }
      pipeline.setStep("import");
    } catch (e) {
      showToast(`폴더 선택 실패: ${e}`, "error");
    }
  }, [pipeline.files, pipeline.setFiles, pipeline.setStep, sidecar.call, showToast]);

  const handleStartFromHero = useCallback(() => {
    pipeline.setStep("import");
  }, [pipeline.setStep]);

  const handleStartAction = useCallback(async (action: PipelineAction) => {
    if (pipeline.files.length === 0) {
      showToast("파일을 먼저 추가하세요", "error");
      return;
    }

    setLogs([`${action} 시작: ${pipeline.files.length}개 파일`]);
    try {
      await pipeline.startAction(action, sidecar.call, outputDir ? { outputDir } : undefined);
      showToast("처리 완료", "success");
    } catch (e) {
      const msg = String(e).replace(/^Error:\s*/, "").replace(/^JSON-RPC error:\s*/, "");
      setLogs((prev) => [...prev, `ERROR: ${msg}`]);
      showToast(msg, "error");
    }
  }, [pipeline.files, pipeline.startAction, sidecar.call, outputDir, showToast]);

  const handleCancel = useCallback(() => {
    pipeline.cancel(sidecar.call);
    setLogs([]);
    showToast("취소됨", "info");
  }, [pipeline.cancel, sidecar.call, showToast]);

  const handleOpenFolder = useCallback(async () => {
    if (pipeline.result?.outputPath) {
      try {
        await sidecar.call("open_folder", { path: pipeline.result.outputPath });
      } catch {
        showToast(`출력 경로: ${pipeline.result.outputPath}`, "info");
      }
    }
  }, [pipeline.result, sidecar.call, showToast]);

  const handleSettingsSave = useCallback((values: SettingsSaveValues) => {
    if (values.apiKey !== apiKey) {
      setApiKey(values.apiKey);
      if (values.apiKey !== SAVED_API_KEY_SENTINEL) setApiKeyMasked("");
    }
    setOcrModel(values.ocrModel);
    setAnalysisModel(values.analysisModel);
    setAiMode(values.aiMode);
    if (values.outputDir !== outputDir) {
      setOutputDir(values.outputDir);
      try { localStorage.setItem("kordoc-output-dir", values.outputDir); } catch {}
    }
    setTheme(values.theme);
  }, [apiKey, outputDir]);

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

  const showPipelineSteps = pipeline.step !== "idle";

  return (
    <div className="h-screen flex flex-col">
      <a href="#main-content" className="skip-link">본문으로 이동</a>
      <div className="flex flex-1 overflow-hidden">
        <Sidebar active={nav} onNavigate={handleNavigate} sidecarStatus={sidecar.status} sidecarError={sidecar.errorMessage} apiKeySet={apiKey.trim().length > 0} />

        <main id="main-content" className="flex-1 flex flex-col overflow-hidden" style={{ backgroundColor: "var(--color-bg-primary)" }}>
          <div className="flex-1 flex flex-col overflow-hidden" style={{ display: nav === "pipeline" ? "flex" : "none" }}>
            {showPipelineSteps && (
              <>
                <div className="px-8 pt-5 pb-1 flex items-center justify-between">
                  <div>
                    <h2 className="ts-lg font-bold text-display" style={{ color: "var(--color-text-primary)" }}>
                      {pipeline.step === "complete" ? "변환 완료!" :
                       pipeline.step === "converting" ? "문서를 변환하고 있어요" :
                       "변환할 문서를 선택하세요"}
                    </h2>
                    <p className="ts-2xs mt-0.5" style={{ color: "var(--color-text-muted)" }}>
                      {pipeline.step === "complete" ? "결과를 확인하고 출력 폴더를 열어보세요" :
                       pipeline.step === "converting" ? "HWP, HWPX, PDF 문서를 마크다운으로 변환합니다" :
                       "HWP, HWPX, PDF 파일을 드래그하거나 파일 선택 버튼을 클릭하세요"}
                    </p>
                  </div>
                  {pipeline.step !== "idle" && pipeline.step !== "complete" && (
                    <button
                      onClick={async () => {
                        if (isProcessing) {
                          try { await pipeline.cancel(sidecar.call); } catch {}
                        }
                        pipeline.reset();
                      }}
                      className="ts-2xs px-2 py-1 rounded-md transition-colors"
                      style={{ color: "var(--color-text-muted)", backgroundColor: "var(--color-bg-tertiary)" }}
                    >
                      처음으로
                    </button>
                  )}
                </div>
                <PipelineStepper
                  currentStep={pipeline.step}
                  onStepClick={(step) => pipeline.setStep(step)}
                />
              </>
            )}

            <div className="flex-1 overflow-y-auto">
              {pipeline.step === "idle" && (
                <WelcomeHero
                  sidecarReady={sidecarReady}
                  sidecarError={sidecar.status === "error" ? sidecar.errorMessage : undefined}
                  apiKeySet={apiKey.trim().length > 0}
                  onStart={handleStartFromHero}
                  onHelp={() => setHelpOpen(true)}
                  onSettings={() => setSettingsOpen(true)}
                />
              )}
              {pipeline.step === "import" && (
                <>
                  <ImportStep
                    files={pipeline.files}
                    onFilesChange={pipeline.setFiles}
                    onStartOcr={() => handleStartAction("convert")}
                    onBrowse={handleBrowseFiles}
                    onBrowseFolder={handleBrowseFolder}
                    apiKeySet={apiKey.trim().length > 0}
                    onOpenSettings={() => setSettingsOpen(true)}
                  />
                  {pipeline.files.length > 0 && (
                    <ActionSelector
                      files={pipeline.files}
                      onSelect={handleStartAction}
                      apiKeySet={apiKey.trim().length > 0}
                    />
                  )}
                </>
              )}
              {pipeline.step === "converting" && (
                <OcrProgressStep progress={pipeline.progress} onCancel={handleCancel} logs={logs} step={pipeline.step} />
              )}
              {pipeline.step === "complete" && (
                <ResultStep
                  result={pipeline.result}
                  onReset={pipeline.reset}
                  onOpenFolder={handleOpenFolder}
                  sidecarCall={sidecar.call}
                />
              )}
            </div>
          </div>
        </main>
      </div>

      <StatusBar step={pipeline.step} progress={pipeline.progress} apiKeySet={apiKey.trim().length > 0} />
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
        onThemePreview={setTheme}
        onSave={handleSettingsSave}
      />

      <HelpModal isOpen={helpOpen} onClose={() => setHelpOpen(false)} />
      <OnboardingTour enabled={sidecarReady && pipeline.step === "idle"} />
    </div>
  );
}
