import { useState, useCallback, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { withDevLog } from "../utils/devlog";
import type {
  PipelineStep,
  PipelineAction,
  ImportedFile,
  PipelineProgress,
  PipelineResult,
  MergeMode,
  SummarizeOptions,
  FormExtractOptions,
  ConvertOptions,
  PdfUtilsOptions,
} from "../types/pipeline";

type SidecarCall = (method: string, params?: Record<string, unknown>) => Promise<unknown>;

/** 파일 절대 경로에서 부모 디렉토리를 추출 (Windows \ 및 POSIX / 모두 지원) */
function fileDir(p: string): string {
  const sep = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return sep > 0 ? p.substring(0, sep) : "";
}

interface UsePipelineReturn {
  step: PipelineStep;
  files: ImportedFile[];
  progress: PipelineProgress;
  result: PipelineResult | null;
  setStep: (step: PipelineStep) => void;
  setFiles: (files: ImportedFile[]) => void;
  setResult: (result: PipelineResult | null) => void;
  startAction: (
    action: PipelineAction,
    sidecarCall: SidecarCall,
    options?: { outputDir?: string; mergeMode?: MergeMode; orderedFiles?: ImportedFile[]; summarizeOptions?: SummarizeOptions; formExtractOptions?: FormExtractOptions; convertOptions?: ConvertOptions; pdfUtilsOptions?: PdfUtilsOptions },
  ) => Promise<void>;
  cancel: (sidecarCall: SidecarCall) => Promise<void>;
  reset: () => void;
  goBack: () => void;
}

export function usePipeline(): UsePipelineReturn {
  const [step, setStep] = useState<PipelineStep>("idle");
  const [files, setFiles] = useState<ImportedFile[]>([]);
  const [progress, setProgress] = useState<PipelineProgress>({ current: 0, total: 0, message: "" });
  const [result, setResult] = useState<PipelineResult | null>(null);
  const unlistenRef = useRef<(() => void) | null>(null);
  const cancelledRef = useRef(false);
  /** 즉시 플래그 — setState 배치보다 빠르게 중복 실행 차단 */
  const isRunningRef = useRef(false);

  const filesRef = useRef(files);
  filesRef.current = files;

  const listenProgress = useCallback(async () => {
    if (unlistenRef.current) {
      unlistenRef.current();
      unlistenRef.current = null;
    }
    const unlisten = await listen<PipelineProgress>("pipeline:progress", (event) => {
      setProgress(event.payload);
    });
    unlistenRef.current = unlisten;
  }, []);

  const cleanup = useCallback(() => {
    if (unlistenRef.current) {
      unlistenRef.current();
      unlistenRef.current = null;
    }
  }, []);

  // ── 액션별 RPC 디스패처 ──

  async function dispatchConvert(call: SidecarCall, currentFiles: ImportedFile[], outputDir?: string, pages?: string): Promise<PipelineResult> {
    const batchParams: Record<string, unknown> = { files: currentFiles.map((f) => f.path) };
    if (outputDir) batchParams.output_dir = outputDir;
    if (pages) batchParams.pages = pages;

    const raw = await call("convert_batch", batchParams) as {
      total: number; succeeded: number; failed: number;
      results: Record<string, unknown>[];
    };
    const firstSuccess = raw.results.find((r) => r.success && r.output_path);
    return {
      total: raw.total,
      successCount: raw.succeeded,
      failCount: raw.failed,
      outputPath: firstSuccess ? fileDir(firstSuccess.output_path as string) : "",
      warnings: raw.results.filter((r) => r.error).map((r) => String(r.error)),
      data: firstSuccess,
    };
  }



  async function dispatchSingle(method: string, call: SidecarCall, file: ImportedFile, outputDir?: string): Promise<PipelineResult> {
    const params: Record<string, unknown> = { input_path: file.path };
    if (outputDir) params.output_dir = outputDir;
    const raw = await call(method, params) as Record<string, unknown>;
    const success = raw.success !== false;
    const outPath = typeof raw.output_path === "string" && raw.output_path ? fileDir(raw.output_path) : fileDir(file.path);
    return {
      total: 1, successCount: success ? 1 : 0, failCount: success ? 0 : 1,
      outputPath: outPath,
      warnings: raw.error ? [String(raw.error)] : [],
      data: raw,
    };
  }

  async function dispatchDiff(call: SidecarCall, currentFiles: ImportedFile[]): Promise<PipelineResult> {
    const raw = await call("diff", { file_a: currentFiles[0].path, file_b: currentFiles[1].path }) as Record<string, unknown>;
    return {
      total: 2, successCount: 1, failCount: 0,
      outputPath: fileDir(currentFiles[0].path),
      warnings: [],
      data: raw,
    };
  }

  async function dispatchSummarize(call: SidecarCall, file: ImportedFile, summarizeOpts?: SummarizeOptions): Promise<PipelineResult> {
    const params: Record<string, unknown> = { input_path: file.path };
    if (summarizeOpts) {
      params.length = summarizeOpts.length;
      params.style = summarizeOpts.style;
    }
    const raw = await call("summarize", params) as Record<string, unknown>;
    return {
      total: 1, successCount: 1, failCount: 0,
      outputPath: fileDir(file.path),
      warnings: [],
      data: raw,
    };
  }

  async function dispatchMerge(call: SidecarCall, currentFiles: ImportedFile[], outputDir?: string, mergeMode?: MergeMode): Promise<PipelineResult> {
    const dir = outputDir || fileDir(currentFiles[0].path);
    const sep = dir.includes("/") ? "/" : "\\";
    // native 모드: 첫 파일 확장자로 출력 (hwp→hwpx 통일), markdown 모드: .md
    const firstType = currentFiles[0].type;
    const ext = mergeMode === "native" ? `.${firstType === "hwp" ? "hwpx" : firstType}` : ".md";
    const firstName = currentFiles[0].name.replace(/\.[^.]+$/, "");
    const suffix = currentFiles.length > 1 ? `_외${currentFiles.length - 1}건` : "";
    const outputPath = `${dir}${sep}수합_${firstName}${suffix}${ext}`;
    const raw = await call("merge_files", {
      files: currentFiles.map((f) => f.path),
      output_path: outputPath,
      mode: mergeMode ?? "markdown",
    }) as Record<string, unknown>;
    return {
      total: currentFiles.length, successCount: 1, failCount: 0,
      outputPath: dir,
      warnings: [],
      data: raw,
    };
  }

  async function dispatchGenerateHwpx(call: SidecarCall, file: ImportedFile, outputDir?: string): Promise<PipelineResult> {
    const params: Record<string, unknown> = { input_path: file.path };
    if (outputDir) {
      const sep = outputDir.includes("/") ? "/" : "\\";
      const baseName = file.name.replace(/\.[^.]+$/, "");
      params.output_path = `${outputDir}${sep}${baseName}.hwpx`;
    }
    const raw = await call("generate_hwpx", params) as Record<string, unknown>;
    return {
      total: 1, successCount: 1, failCount: 0,
      outputPath: (raw.output_path as string) ? fileDir(raw.output_path as string) : (outputDir || fileDir(file.path)),
      warnings: [],
      data: raw,
    };
  }

  async function dispatchFormExtractBatch(
    call: SidecarCall,
    currentFiles: ImportedFile[],
    formOpts: FormExtractOptions,
    outputDir?: string,
  ): Promise<PipelineResult> {
    const params: Record<string, unknown> = {
      files: currentFiles.map((f) => f.path),
      selected_fields: formOpts.selectedFields,
      use_ai: formOpts.useAi,
    };
    if (outputDir) params.output_dir = outputDir;
    const raw = await call("form_extract_batch", params) as Record<string, unknown>;
    const outputPath = typeof raw.output_path === "string" ? fileDir(raw.output_path) : fileDir(currentFiles[0].path);
    return {
      total: currentFiles.length,
      successCount: Number(raw.succeeded ?? 0),
      failCount: Number(raw.failed ?? 0),
      outputPath,
      warnings: [],
      data: raw,
    };
  }

  async function dispatchPdfUtils(
    call: SidecarCall,
    currentFiles: ImportedFile[],
    opts: PdfUtilsOptions,
    outputDir?: string,
  ): Promise<PipelineResult> {
    const pdfFiles = currentFiles.filter((f) => f.type === "pdf");
    // 다이얼로그에서 지정한 폴더 → 전역 설정 → 원본 위치
    const effectiveDir = opts.outputDir || outputDir;

    if (opts.mode === "merge") {
      // PDF 병합 → merge_files native 모드 재활용
      const dir = effectiveDir || fileDir(pdfFiles[0].path);
      const sep = dir.includes("/") ? "/" : "\\";
      const firstName = pdfFiles[0].name.replace(/\.[^.]+$/, "");
      const suffix = pdfFiles.length > 1 ? `_외${pdfFiles.length - 1}건` : "";
      const outputPath = `${dir}${sep}병합_${firstName}${suffix}.pdf`;
      const raw = await call("merge_files", {
        files: pdfFiles.map((f) => f.path),
        output_path: outputPath,
        mode: "native",
      }) as Record<string, unknown>;
      return {
        total: pdfFiles.length, successCount: 1, failCount: 0,
        outputPath: dir, warnings: [], data: raw,
      };
    }

    const target = opts.targetFile ?? pdfFiles[0];
    const dir = effectiveDir || fileDir(target.path);
    const baseName = target.name.replace(/\.[^.]+$/, "");

    if (opts.mode === "split") {
      const sep = dir.includes("/") ? "/" : "\\";
      const outDir = `${dir}${sep}${baseName}_분할`;
      const raw = await call("split_pdf", {
        file: target.path,
        output_dir: outDir,
        mode: opts.splitMode ?? "each",
        ranges: opts.pages,
      }) as Record<string, unknown>;
      return {
        total: 1, successCount: 1, failCount: 0,
        outputPath: outDir, warnings: [], data: raw,
      };
    }

    if (opts.mode === "extract") {
      const sep = dir.includes("/") ? "/" : "\\";
      const suffix = opts.extractMode === "exclude" ? "제외" : "추출";
      const outputPath = `${dir}${sep}${baseName}_${suffix}.pdf`;
      const raw = await call("pdf_extract_pages", {
        file: target.path,
        output_path: outputPath,
        pages: opts.pages,
        mode: opts.extractMode ?? "include",
      }) as Record<string, unknown>;
      return {
        total: 1, successCount: 1, failCount: 0,
        outputPath: dir, warnings: [], data: raw,
      };
    }

    throw new Error(`알 수 없는 PDF 모드: ${opts.mode}`);
  }

  // ── 메인 액션 실행기 ──

  const startAction = useCallback(async (
    action: PipelineAction,
    sidecarCall: SidecarCall,
    options?: { outputDir?: string; mergeMode?: MergeMode; orderedFiles?: ImportedFile[]; summarizeOptions?: SummarizeOptions; formExtractOptions?: FormExtractOptions; convertOptions?: ConvertOptions; pdfUtilsOptions?: PdfUtilsOptions },
  ): Promise<void> => {
    // 더블클릭/중복 실행 방지 — isRunningRef는 setState 배치보다 빠르게 차단
    if (isRunningRef.current) return;

    // 검증을 isRunningRef 설정 전에 수행 — 실패 시 영구 차단 방지
    const currentFiles = filesRef.current;
    if (currentFiles.length === 0) throw new Error("처리할 파일이 없습니다");
    const minFiles: Partial<Record<PipelineAction, number>> = { diff: 2, merge_files: 2 };
    const required = minFiles[action] ?? 1;
    if (currentFiles.length < required) {
      throw new Error(`"${action}" 액션은 최소 ${required}개 파일이 필요합니다 (현재 ${currentFiles.length}개)`);
    }

    isRunningRef.current = true;
    cancelledRef.current = false;

    setStep("converting");
    setProgress({ current: 0, total: currentFiles.length, message: "처리 준비 중..." });
    await listenProgress();

    // Dev 모드: RPC 호출 자동 로깅 래퍼
    const call: SidecarCall = (method, params) =>
      withDevLog(method, () => sidecarCall(method, params), `${currentFiles.length}개 파일`);

    try {
      let resp: PipelineResult;

      switch (action) {
        case "convert":
          resp = await dispatchConvert(call, currentFiles, options?.outputDir, options?.convertOptions?.pages);
          break;
        case "ocr":
          resp = await dispatchSingle("ocr", call, currentFiles[0]);
          break;
        case "summarize":
          resp = await dispatchSummarize(call, currentFiles[0], options?.summarizeOptions);
          break;
        case "diff":
          resp = await dispatchDiff(call, currentFiles);
          break;
        case "extract_tables":
          resp = await dispatchSingle("extract_tables", call, currentFiles[0], options?.outputDir);
          break;
        case "form_extract":
          if (options?.formExtractOptions) {
            resp = await dispatchFormExtractBatch(call, currentFiles, options.formExtractOptions, options?.outputDir);
          } else {
            resp = await dispatchSingle("form_extract", call, currentFiles[0]);
          }
          break;
        case "generate_hwpx":
          resp = await dispatchGenerateHwpx(call, currentFiles[0], options?.outputDir);
          break;
        case "merge_files":
          resp = await dispatchMerge(call, options?.orderedFiles ?? currentFiles, options?.outputDir, options?.mergeMode);
          break;
        case "pdf_utils":
          if (!options?.pdfUtilsOptions) throw new Error("PDF 도구 옵션이 필요합니다");
          resp = await dispatchPdfUtils(call, currentFiles, options.pdfUtilsOptions, options.outputDir);
          break;
        case "inspect_document":
          resp = await dispatchSingle("inspect_document", call, currentFiles[0]);
          break;
        default:
          throw new Error(`알 수 없는 액션: ${action}`);
      }

      if (cancelledRef.current) return;
      setResult(resp);

      if (resp.total > 0 && resp.successCount === 0) {
        throw new Error(`처리 실패: ${resp.total}개 중 성공 0개`);
      }
      // merge/pdf_utils/generate_hwpx는 모달로 결과 표시 → Workspace 유지
      setStep(action === "merge_files" || action === "pdf_utils" || action === "generate_hwpx" ? "import" : "complete");
    } catch (e) {
      if (cancelledRef.current) return;
      setStep("import");
      throw e;
    } finally {
      isRunningRef.current = false;
      cleanup();
    }
  }, [listenProgress, cleanup]);

  const cancel = useCallback(async (sidecarCall: SidecarCall) => {
    cancelledRef.current = true;
    // sidecar에 cancel 먼저 전송 후 UI 상태 초기화
    try { await sidecarCall("cancel"); } catch { /* fire-and-forget */ }
    setProgress({ current: 0, total: 0, message: "" });
    cleanup();
    setStep("import");
  }, [cleanup]);

  /** 파일 유지한 채 작업 선택 화면으로 복귀 */
  const goBack = useCallback(() => {
    setStep("import");
    setProgress({ current: 0, total: 0, message: "" });
    setResult(null);
    cleanup();
  }, [cleanup]);

  const reset = useCallback(() => {
    cancelledRef.current = true;
    setStep("idle");
    setFiles([]);
    setProgress({ current: 0, total: 0, message: "" });
    setResult(null);
    cleanup();
  }, [cleanup]);

  return {
    step, files, progress, result,
    setStep, setFiles, setResult,
    startAction, cancel, reset, goBack,
  };
}
