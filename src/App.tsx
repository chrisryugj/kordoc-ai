import { useState, useCallback, useEffect, useRef } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { CheckCircle2, XCircle, ChevronRight } from "lucide-react";
import { Sidebar } from "./components/layout/Sidebar";
import { StatusBar } from "./components/layout/StatusBar";
import { PipelineStepper } from "./components/pipeline/PipelineStepper";
import { WelcomeHero } from "./components/pipeline/WelcomeHero";
import { ImportStep } from "./components/pipeline/ImportStep";
import { OcrProgressStep } from "./components/pipeline/OcrProgressStep";
import { TagReviewStep } from "./components/pipeline/TagReviewStep";
import { ResultStep } from "./components/pipeline/ResultStep";
import { ToastContainer } from "./components/ui/Toast";
import { Button } from "./components/ui/Button";
import { Modal } from "./components/ui/Modal";
import { SettingsModal, type SettingsSaveValues, SAVED_API_KEY_SENTINEL } from "./components/settings/SettingsModal";
import { HelpModal } from "./components/help/HelpModal";
import { WebToolsView } from "./components/tools/WebToolsView";
import { OnboardingTour } from "./components/ui/OnboardingTour";
import { useSidecar } from "./hooks/useSidecar";
import { usePipeline } from "./hooks/usePipeline";
import { useToast } from "./hooks/useToast";
import type { ImportedFile, PageTag } from "./types/pipeline";

type NavItem = "pipeline" | "tools" | "settings" | "help";

const PROCESSING_STEPS = ["ocr", "tagging", "extract", "analyze"] as const;


function fileDir(p: string): string {
  const sep = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return sep > 0 ? p.substring(0, sep) : "";
}

function resolvePipelineOutputDir(files: ImportedFile[], customOutputDir: string): string {
  if (customOutputDir) return customOutputDir;
  const firstPath = files[0]?.path ?? "";
  const baseDir = fileDir(firstPath);
  return baseDir ? `${baseDir}\\_output` : "_output";
}

interface ResumeButtonProps {
  title: string;
  subtitle: string;
  icon?: React.ReactNode;
  isRecommended?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

function ResumeButton({
  title,
  subtitle,
  icon,
  isRecommended = false,
  disabled = false,
  onClick,
}: ResumeButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="w-full text-left rounded-lg px-4 py-3 transition-all duration-200"
      style={{
        border: isRecommended ? "2px solid var(--color-accent)" : "1px solid var(--color-border)",
        backgroundColor: isRecommended ? "var(--color-accent-light)" : "var(--color-bg-secondary)",
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
      onMouseEnter={(e) => {
        if (!disabled) {
          e.currentTarget.style.boxShadow = "0 4px 12px rgba(0,0,0,0.1)";
          e.currentTarget.style.backgroundColor = isRecommended
            ? "var(--color-accent-light)"
            : "var(--color-bg-tertiary)";
        }
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = "none";
        e.currentTarget.style.backgroundColor = isRecommended
          ? "var(--color-accent-light)"
          : "var(--color-bg-secondary)";
      }}
    >
      <div className="flex items-start gap-3">
        {icon && (
          <div
            style={{
              color: isRecommended ? "var(--color-accent)" : "var(--color-text-secondary)",
              marginTop: "2px",
              flexShrink: 0,
            }}
          >
            {icon}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div
            className="font-semibold text-sm"
            style={{
              color: isRecommended ? "var(--color-accent)" : "var(--color-text-primary)",
            }}
          >
            {isRecommended && "✨ "}
            {title}
          </div>
          <div
            className="text-xs mt-1 leading-relaxed"
            style={{ color: "var(--color-text-muted)" }}
          >
            {subtitle}
          </div>
        </div>
      </div>
    </button>
  );
}

interface PipelineInspection {
  outputDir: string;
  exists: boolean;
  filesMatch: boolean;
  stateMatched: boolean;
  statePath: string;
  savedTags: PageTag[];
  savedModels: {
    ocrModel: string;
    analysisModel: string;
  };
  available: {
    ocr: boolean;
    tags: boolean;
    extracted: boolean;
    summaries: boolean;
    report: boolean;
  };
}

export default function App() {
  const [nav, setNav] = useState<NavItem>("pipeline");
  const [apiKey, setApiKey] = useState("");
  const [apiKeyMasked, setApiKeyMasked] = useState("");
  const [ocrModel, setOcrModel] = useState("gemini-3-flash-preview");
  const [analysisModel, setAnalysisModel] = useState("gemini-3-flash-preview");
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    try {
      const saved = localStorage.getItem("eduplan-theme");
      return saved === "dark" ? "dark" : "light";
    } catch { return "light"; }
  });
  const [logs, setLogs] = useState<string[]>([]);
  const logUnlistenRef = useRef<UnlistenFn | null>(null);
  const stderrUnlistenRef = useRef<UnlistenFn | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [resumeCandidate, setResumeCandidate] = useState<PipelineInspection | null>(null);
  const [resumeBusy, setResumeBusy] = useState(false);
  const [outputDir, setOutputDir] = useState(() => {
    try { return localStorage.getItem("eduplan-output-dir") || ""; } catch { return ""; }
  });
  const [themes, setThemes] = useState<string[]>([
    "학급수 및 학생수", "각종 면적", "사업 유형", "사업 기간",
    "설계발주방식", "사업비 내역", "스페이스 프로그램", "설문조사 결과", "기타",
  ]);

  const sidecar = useSidecar();
  const pipeline = usePipeline();
  const { toasts, showToast, dismissToast } = useToast();

  // Apply theme to document and persist
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    try { localStorage.setItem("eduplan-theme", theme); } catch {}
  }, [theme]);

  const sidecarReady = sidecar.status === "ready";

  // Load saved settings from sidecar on startup
  useEffect(() => {
    if (sidecarReady && !apiKey) {
      sidecar.call("get_settings", {}).then((resp) => {
        const settings = resp as Record<string, unknown>;
        if (settings?.api_key_set) {
          setApiKey(SAVED_API_KEY_SENTINEL);
          if (typeof settings.api_key_masked === "string" && settings.api_key_masked) {
            setApiKeyMasked(settings.api_key_masked);
          }
        }
        // Load OCR model
        if (typeof settings.ocr_model === "string" && settings.ocr_model) {
          setOcrModel(settings.ocr_model);
        }
        // Load analysis model
        if (typeof settings.analysis_model === "string" && settings.analysis_model) {
          setAnalysisModel(settings.analysis_model);
        }
        const mvp2 = settings?.mvp2 as Record<string, unknown> | undefined;
        if (Array.isArray(mvp2?.themes) && mvp2.themes.length > 0) {
          setThemes(mvp2.themes as string[]);
        }
      }).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only run when sidecar becomes ready
  }, [sidecarReady]);

  // Sync API key to sidecar when changed (skip placeholder, skip while processing)
  const isProcessing = (PROCESSING_STEPS as readonly string[]).includes(pipeline.step);
  useEffect(() => {
    if (sidecarReady && apiKey && apiKey !== SAVED_API_KEY_SENTINEL && !isProcessing) {
      sidecar.call("set_api_key", { api_key: apiKey }).catch(() => {});
    }
  }, [sidecarReady, apiKey, isProcessing, sidecar.call]);

  // Sync model selections to sidecar when changed (skip while processing)
  useEffect(() => {
    if (sidecarReady && !isProcessing) {
      sidecar.call("set_models", { ocr_model: ocrModel, analysis_model: analysisModel }).catch(() => {});
    }
  }, [sidecarReady, ocrModel, analysisModel, isProcessing, sidecar.call]);

  useEffect(() => {
    if (!sidecarReady) return;
    const outputPath = pipeline.result?.outputPath;
    const shouldPersist =
      Boolean(outputPath) &&
      pipeline.files.length > 0 &&
      (pipeline.tags.length > 0 || ["review", "extract", "analyze", "complete"].includes(pipeline.step));
    if (!shouldPersist || !outputPath) return;

    const timer = setTimeout(() => {
      sidecar.call("save_pipeline_state", {
        output_dir: outputPath,
        current_step: pipeline.step,
        ocr_model: ocrModel,
        analysis_model: analysisModel,
        updated_at: new Date().toISOString(),
        files: pipeline.files.map((file) => ({ name: file.name, size: file.size })),
        tags: pipeline.tags,
      }).catch(() => {});
    }, 300);

    return () => clearTimeout(timer);
  }, [
    sidecarReady,
    sidecar.call,
    pipeline.result?.outputPath,
    pipeline.files,
    pipeline.tags,
    pipeline.step,
    ocrModel,
    analysisModel,
  ]);

  // Listen for progress events and feed into logs
  useEffect(() => {
    let mounted = true;
    listen<{ current: number; total: number; message: string }>("pipeline:progress", (event) => {
      if (!mounted) return;
      const { message } = event.payload;
      if (message) {
        setLogs((prev) => [...prev.slice(-200), message]);
      }
    }).then((unlisten) => {
      if (mounted) logUnlistenRef.current = unlisten;
      else unlisten();
    });
    // Listen for sidecar stderr logs (Python logger output)
    listen<string>("sidecar:log", (event) => {
      if (!mounted) return;
      const line = event.payload;
      if (line) {
        setLogs((prev) => [...prev.slice(-200), line]);
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

  // File browser via Tauri dialog
  const handleBrowseFiles = useCallback(async () => {
    try {
      const selected = await open({
        multiple: true,
        filters: [{ name: "문서", extensions: ["hwp", "hwpx", "pdf"] }],
      });
      if (!selected) return;
      const paths = Array.isArray(selected) ? selected : [selected];
      const existingPaths = new Set(pipeline.files.map((f) => f.path));
      const newFiles: ImportedFile[] = paths
        .filter((p) => !existingPaths.has(p))
        .map((p) => {
          const name = p.split(/[/\\]/).pop() ?? p;
          return {
            path: p, name, size: 0,
            type: name.toLowerCase().endsWith(".pdf") ? "pdf" as const
              : name.toLowerCase().match(/\.hwpx?$/) ? "hwp" as const
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

  // Folder browser — 폴더 내 HWP/PDF 파일 일괄 추가
  const handleBrowseFolder = useCallback(async () => {
    try {
      const selected = await open({ directory: true, multiple: false });
      if (!selected) return;
      const folderPath = Array.isArray(selected) ? selected[0] : selected;
      if (!folderPath) return;
      const resp = await sidecar.call("list_files", { folder: folderPath }) as { files: { path: string; name: string; size: number }[] };
      if (!resp.files || resp.files.length === 0) {
        showToast("선택한 폴더에 HWP/PDF 파일이 없습니다", "info");
        return;
      }
      const existingPaths = new Set(pipeline.files.map((f) => f.path));
      const newFiles: ImportedFile[] = resp.files
        .filter((f) => !existingPaths.has(f.path))
        .map((f) => ({
          path: f.path,
          name: f.name,
          size: f.size,
          type: f.name.toLowerCase().endsWith(".pdf") ? "pdf" as const
            : f.name.toLowerCase().match(/\.hwpx?$/) ? "hwp" as const
            : "unknown" as const,
        }));
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

  // Start from hero
  const handleStartFromHero = useCallback(() => {
    pipeline.setStep("import");
  }, [pipeline.setStep]);

  const runFreshPipeline = useCallback(async () => {
    setResumeCandidate(null);
    if (pipeline.files.length === 0) {
      showToast("파일을 먼저 추가하세요", "error");
      return;
    }
    if (!apiKey.trim()) {
      showToast("API 키를 먼저 설정하세요", "error");
      setSettingsOpen(true);
      return;
    }

    setLogs([`OCR 시작: ${pipeline.files.length}개 파일`]);
    try {
      const ocrResult = await pipeline.startOcr(sidecar.call, outputDir ? { outputDir } : undefined);
      if (ocrResult?.taggingError) {
        showToast(ocrResult.taggingError, "error");
      } else {
        showToast("OCR 완료", "success");
      }
    } catch (e) {
      const msg = String(e).replace(/^Error:\s*/, "").replace(/^JSON-RPC error:\s*/, "");
      setLogs((prev) => [...prev, `ERROR: ${msg}`]);
      showToast(msg, "error");
    }
  }, [pipeline.files, pipeline.startOcr, sidecar.call, apiKey, outputDir, showToast]);

  const handleStartOcr = useCallback(async () => {
    if (pipeline.files.length === 0) {
      showToast("파일을 먼저 추가하세요", "error");
      return;
    }
    if (!apiKey.trim()) {
      showToast("API 키를 먼저 설정하세요", "error");
      setSettingsOpen(true);
      return;
    }

    const targetOutputDir = resolvePipelineOutputDir(pipeline.files, outputDir);
    try {
      const inspect = await sidecar.call("inspect_pipeline_output", {
        output_dir: targetOutputDir,
        files: pipeline.files.map((file) => ({ name: file.name, size: file.size })),
      }) as PipelineInspection;
      const hasReusableOutput =
        inspect.filesMatch &&
        (inspect.available.tags || inspect.available.ocr || inspect.available.summaries || inspect.available.report);
      if (hasReusableOutput) {
        setResumeCandidate(inspect);
        return;
      }
    } catch {
      // 검사 실패는 치명적이지 않음 — 바로 새 실행
    }

    await runFreshPipeline();
  }, [pipeline.files, apiKey, outputDir, sidecar.call, showToast, runFreshPipeline]);

  const handleCancel = useCallback(() => {
    const wasExtractOrAnalyze = pipeline.step === "extract" || pipeline.step === "analyze";
    pipeline.cancel(sidecar.call);
    setLogs([]);
    showToast(
      wasExtractOrAnalyze ? "추출/분석 취소 — 태그 검토로 돌아갑니다" : "취소됨",
      "info",
    );
  }, [pipeline.step, pipeline.cancel, sidecar.call, showToast]);

  const handleRetag = useCallback(async () => {
    setLogs([]);
    try {
      const result = await pipeline.retag(sidecar.call);
      if (result?.taggingError) {
        showToast(result.taggingError, "error");
      } else {
        showToast("재태깅 완료", "success");
      }
    } catch (e) {
      const msg = String(e).replace(/^Error:\s*/, "").replace(/^JSON-RPC error:\s*/, "");
      showToast(`재태깅 실패: ${msg}`, "error");
    }
  }, [pipeline.retag, sidecar.call, showToast]);

  const handleConfirmTags = useCallback(async () => {
    try {
      const completed = await pipeline.startExtract(sidecar.call);
      if (completed) {
        showToast("추출 및 분석 완료", "success");
      }
    } catch (e) {
      showToast(`처리 실패: ${e}`, "error");
    }
  }, [pipeline.startExtract, sidecar.call, showToast]);

  const handleResumeReview = useCallback(() => {
    if (!resumeCandidate) return;
    pipeline.resumeReview(resumeCandidate.outputDir, resumeCandidate.savedTags);
    setLogs([`기존 태그 불러오기: ${resumeCandidate.savedTags.length}개`]);
    setResumeCandidate(null);
    showToast("저장된 태그를 불러와 검토 단계로 이동했습니다", "success");
  }, [resumeCandidate, pipeline, showToast]);

  const handleRetagFromExisting = useCallback(async () => {
    if (!resumeCandidate) return;
    setResumeBusy(true);
    setLogs([`기존 OCR 재사용: ${resumeCandidate.outputDir}`]);
    try {
      const result = await pipeline.retagFromExisting(sidecar.call, resumeCandidate.outputDir);
      if (result?.taggingError) {
        showToast(result.taggingError, "error");
      } else {
        showToast("기존 OCR 결과로 재태깅을 완료했습니다", "success");
      }
      setResumeCandidate(null);
    } catch (e) {
      const msg = String(e).replace(/^Error:\s*/, "").replace(/^JSON-RPC error:\s*/, "");
      showToast(`재태깅 실패: ${msg}`, "error");
    } finally {
      setResumeBusy(false);
    }
  }, [resumeCandidate, pipeline, sidecar.call, showToast]);

  const handleAnalyzeFromExisting = useCallback(async (skipSummarize: boolean) => {
    if (!resumeCandidate) return;
    setResumeBusy(true);
    setLogs([
      skipSummarize
        ? "기존 요약 재사용 후 통합분석 시작"
        : "기존 OCR 결과 재사용 후 요약/통합분석 시작",
    ]);
    try {
      const completed = await pipeline.resumeAnalyze(sidecar.call, resumeCandidate.outputDir, { skipSummarize });
      if (completed) {
        showToast(
          skipSummarize ? "기존 요약을 재사용해 통합분석을 완료했습니다" : "기존 OCR 결과로 분석을 완료했습니다",
          "success",
        );
      }
      setResumeCandidate(null);
    } catch (e) {
      const msg = String(e).replace(/^Error:\s*/, "").replace(/^JSON-RPC error:\s*/, "");
      showToast(`분석 재실행 실패: ${msg}`, "error");
    } finally {
      setResumeBusy(false);
    }
  }, [resumeCandidate, pipeline, sidecar.call, showToast]);

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
    if (values.outputDir !== outputDir) {
      setOutputDir(values.outputDir);
      try { localStorage.setItem("eduplan-output-dir", values.outputDir); } catch {}
    }
    setTheme(values.theme);
    if (JSON.stringify(values.themes) !== JSON.stringify(themes)) {
      setThemes(values.themes);
      sidecar.call("update_settings", { section: "mvp2", values: { themes: values.themes } }).catch(() => {});
    }
  }, [apiKey, outputDir, themes, sidecar.call]);

  const handleNavigate = useCallback((item: NavItem) => {
    if (item === "settings") setSettingsOpen(true);
    else if (item === "help") setHelpOpen(true);
    else {
      // 처리 중 탭 전환 시 경고
      const isProcessing = (PROCESSING_STEPS as readonly string[]).includes(pipeline.step);
      if (isProcessing && item !== "pipeline") {
        showToast("처리가 진행 중입니다. 작업은 백그라운드에서 계속됩니다.", "info");
      }
      setNav(item);
    }
  }, [pipeline.step, showToast]);

  const showPipelineSteps = pipeline.step !== "idle";

  return (
    <div className="h-screen flex flex-col">
      <a href="#main-content" className="skip-link">본문으로 이동</a>
      <div className="flex flex-1 overflow-hidden">
        <Sidebar active={nav} onNavigate={handleNavigate} sidecarStatus={sidecar.status} sidecarError={sidecar.errorMessage} apiKeySet={apiKey.trim().length > 0} />

        <main id="main-content" className="flex-1 flex flex-col overflow-hidden" style={{ backgroundColor: "var(--color-bg-primary)" }}>
          {/* 파이프라인 탭 — display:none으로 언마운트 방지 (탭 전환 시 상태 유지) */}
          <div className="flex-1 flex flex-col overflow-hidden" style={{ display: nav === "pipeline" ? "flex" : "none" }}>
            {showPipelineSteps && (
              <>
                <div className="px-8 pt-5 pb-1 flex items-center justify-between">
                  <div>
                    <h2 className="ts-lg font-bold text-display" style={{ color: "var(--color-text-primary)" }}>
                      {pipeline.step === "complete" ? "처리 완료!" :
                       pipeline.step === "ocr" ? "문서를 읽고 있어요" :
                       pipeline.step === "tagging" ? "AI가 페이지를 분류하고 있어요" :
                       pipeline.step === "review" ? "AI가 분류한 태그를 확인하세요" :
                       pipeline.step === "extract" || pipeline.step === "analyze" ? "추출 및 분석 중이에요" :
                       "처리할 문서를 선택하세요"}
                    </h2>
                    <p className="ts-2xs mt-0.5" style={{ color: "var(--color-text-muted)" }}>
                      {pipeline.step === "complete" ? "결과를 확인하고 출력 폴더를 열어보세요" :
                       pipeline.step === "ocr" ? "Gemini Vision AI가 문서의 텍스트와 표를 인식합니다" :
                       pipeline.step === "tagging" ? "페이지 이미지를 분석하여 테마를 자동 분류합니다" :
                       pipeline.step === "review" ? "잘못된 태그가 있으면 수정 후 확인해 주세요" :
                       pipeline.step === "extract" || pipeline.step === "analyze" ? "테마별 PDF 추출과 교육과정 분석을 진행합니다" :
                       "HWP, HWPX, PDF 파일을 드래그하거나 파일 선택 버튼을 클릭하세요"}
                    </p>
                  </div>
                  {pipeline.step !== "idle" && pipeline.step !== "complete" && (
                    <button
                      onClick={async () => {
                        const isProcessing = (PROCESSING_STEPS as readonly string[]).includes(pipeline.step);
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
                <ImportStep
                  files={pipeline.files}
                  onFilesChange={pipeline.setFiles}
                  onStartOcr={handleStartOcr}
                  onBrowse={handleBrowseFiles}
                  onBrowseFolder={handleBrowseFolder}
                  apiKeySet={apiKey.trim().length > 0}
                  onOpenSettings={() => setSettingsOpen(true)}
                />
              )}
              {(pipeline.step === "ocr" || pipeline.step === "tagging") && (
                <OcrProgressStep progress={pipeline.progress} onCancel={handleCancel} logs={logs} step={pipeline.step} />
              )}
              {pipeline.step === "review" && (
                <TagReviewStep
                  tags={pipeline.tags}
                  onTagsChange={pipeline.setTags}
                  onConfirm={handleConfirmTags}
                  onBack={() => pipeline.setStep("import")}
                  onRetag={handleRetag}
                  logs={logs}
                  themes={themes}
                  files={pipeline.files}
                  sidecarCall={sidecar.call}
                />
              )}
              {(pipeline.step === "extract" || pipeline.step === "analyze") && (
                <OcrProgressStep progress={pipeline.progress} onCancel={handleCancel} logs={logs} step={pipeline.step} />
              )}
              {pipeline.step === "complete" && (
                <ResultStep
                  result={pipeline.result}
                  onReset={pipeline.reset}
                  onOpenFolder={handleOpenFolder}
                  onReviewTags={() => pipeline.setStep("review")}
                  sidecarCall={sidecar.call}
                />
              )}
            </div>
          </div>

          {/* WebToolsView — 탭 전환 시 state 유지를 위해 숨김 처리 (언마운트 방지) */}
          <div style={{ display: nav === "tools" ? "contents" : "none" }}>
            <WebToolsView
              sidecarReady={sidecarReady}
              onRunTool={async (tool, params) => {
                const result = await sidecar.call("browser_tool", { tool, params });
                return result as Record<string, unknown>;
              }}
            />
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
        sidecarStatus={sidecar.status}
        sidecarError={sidecar.errorMessage}
        outputDir={outputDir}
        theme={theme}
        themes={themes}
        onThemePreview={setTheme}
        onSave={handleSettingsSave}
      />

      <HelpModal isOpen={helpOpen} onClose={() => setHelpOpen(false)} />
      <Modal
        isOpen={resumeCandidate !== null}
        onClose={resumeBusy ? undefined : () => setResumeCandidate(null)}
        title="기존 산출물을 발견했습니다"
        size="lg"
        closable={!resumeBusy}
        footer={(
          <div className="flex justify-between gap-2 flex-wrap">
            <Button
              variant="ghost"
              onClick={() => setResumeCandidate(null)}
              disabled={resumeBusy}
            >
              취소
            </Button>
            <Button
              variant="secondary"
              onClick={runFreshPipeline}
              isLoading={resumeBusy}
              disabled={resumeBusy}
            >
              처음부터 재분석
            </Button>
          </div>
        )}
      >
        {resumeCandidate && (
          <div className="space-y-4">
            <div
              className="rounded-lg px-3 py-3 ts-xs"
              style={{ backgroundColor: "var(--color-bg-tertiary)", color: "var(--color-text-secondary)" }}
            >
              같은 파일셋으로 보이는 기존 결과가
              <span className="font-semibold" style={{ color: "var(--color-text-primary)" }}> {resumeCandidate.outputDir}</span>
              에 있습니다. 필요한 단계만 다시 실행하면 API 호출을 줄일 수 있습니다.
            </div>

            {/* 진행 상황 시각화 */}
            <div className="rounded-lg px-4 py-3" style={{ backgroundColor: "var(--color-bg-tertiary)" }}>
              <div className="text-xs font-semibold mb-3" style={{ color: "var(--color-text-secondary)" }}>파이프라인 진행 상황</div>
              <div className="flex items-center gap-2 flex-wrap text-sm">
                <div className="flex items-center gap-1">
                  {resumeCandidate.available.ocr ? (
                    <CheckCircle2 size={16} className="text-green-500" />
                  ) : (
                    <XCircle size={16} className="text-gray-400" />
                  )}
                  <span style={{ color: resumeCandidate.available.ocr ? "var(--color-text-primary)" : "var(--color-text-muted)" }}>OCR</span>
                </div>
                <ChevronRight size={14} style={{ color: "var(--color-text-muted)" }} />
                <div className="flex items-center gap-1">
                  {resumeCandidate.available.tags ? (
                    <CheckCircle2 size={16} className="text-green-500" />
                  ) : (
                    <XCircle size={16} className="text-gray-400" />
                  )}
                  <span style={{ color: resumeCandidate.available.tags ? "var(--color-text-primary)" : "var(--color-text-muted)" }}>태그</span>
                </div>
                <ChevronRight size={14} style={{ color: "var(--color-text-muted)" }} />
                <div className="flex items-center gap-1">
                  {resumeCandidate.available.extracted ? (
                    <CheckCircle2 size={16} className="text-green-500" />
                  ) : (
                    <XCircle size={16} className="text-gray-400" />
                  )}
                  <span style={{ color: resumeCandidate.available.extracted ? "var(--color-text-primary)" : "var(--color-text-muted)" }}>추출</span>
                </div>
                <ChevronRight size={14} style={{ color: "var(--color-text-muted)" }} />
                <div className="flex items-center gap-1">
                  {resumeCandidate.available.report ? (
                    <CheckCircle2 size={16} className="text-green-500" />
                  ) : (
                    <XCircle size={16} className="text-gray-400" />
                  )}
                  <span style={{ color: resumeCandidate.available.report ? "var(--color-text-primary)" : "var(--color-text-muted)" }}>보고서</span>
                </div>
              </div>
            </div>

            {/* 재개 옵션 (추천순) */}
            <div className="space-y-2">
              {/* 1순위: 태그 검토부터 재개 */}
              {resumeCandidate.available.tags && resumeCandidate.savedTags.length > 0 && (
                <ResumeButton
                  isRecommended={true}
                  onClick={handleResumeReview}
                  disabled={resumeBusy}
                  title="태그 검토부터 재개"
                  subtitle={`저장된 태그 ${resumeCandidate.savedTags.length}개를 검토하고 필요시 수정합니다. API 비용을 줄일 수 있습니다.`}
                  icon={<CheckCircle2 size={18} />}
                />
              )}

              {/* 2순위: 요약·통합분석만 다시 */}
              {resumeCandidate.available.ocr && !resumeCandidate.available.tags && (
                <ResumeButton
                  onClick={() => handleAnalyzeFromExisting(false)}
                  disabled={resumeBusy}
                  title="요약·통합분석만 다시"
                  subtitle="OCR과 태깅을 건너뛰고 최종 분석 단계만 재실행합니다."
                  icon={<ChevronRight size={18} />}
                />
              )}

              {/* 2순위 대체: OCR 건너뛰고 태깅만 다시 */}
              {resumeCandidate.available.ocr && !resumeCandidate.available.tags && (
                <ResumeButton
                  onClick={handleRetagFromExisting}
                  disabled={resumeBusy}
                  title="OCR 건너뛰고 태깅만 다시"
                  subtitle="기존 OCR을 그대로 사용하고 태깅만 다시 실행합니다."
                  icon={<ChevronRight size={18} />}
                />
              )}

              {/* 3순위: 통합분석만 다시 */}
              {resumeCandidate.available.summaries && (
                <ResumeButton
                  onClick={() => handleAnalyzeFromExisting(true)}
                  disabled={resumeBusy}
                  title="통합분석만 다시"
                  subtitle="기존 요약을 그대로 사용하고 마지막 분석 단계만 재실행합니다."
                  icon={<ChevronRight size={18} />}
                />
              )}
            </div>
          </div>
        )}
      </Modal>
      <OnboardingTour enabled={sidecarReady && pipeline.step === "idle"} />
    </div>
  );
}
