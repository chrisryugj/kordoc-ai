import { useState, useCallback, useRef } from "react";

/** 파일 절대 경로에서 부모 디렉토리를 추출 (Windows \ 및 POSIX / 모두 지원) */
function fileDir(p: string): string {
  const sep = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return sep > 0 ? p.substring(0, sep) : "";
}
import { listen } from "@tauri-apps/api/event";
import type {
  PipelineStep,
  ImportedFile,
  PipelineProgress,
  PipelineResult,
  PageTag,
} from "../types/pipeline";

interface UsePipelineReturn {
  step: PipelineStep;
  files: ImportedFile[];
  progress: PipelineProgress;
  result: PipelineResult | null;
  tags: PageTag[];
  setStep: (step: PipelineStep) => void;
  setFiles: (files: ImportedFile[]) => void;
  setTags: (tags: PageTag[]) => void;
  startOcr: (sidecarCall: (method: string, params?: Record<string, unknown>) => Promise<unknown>, options?: { outputDir?: string }) => Promise<{ taggingError?: string }>;
  retag: (sidecarCall: (method: string, params?: Record<string, unknown>) => Promise<unknown>) => Promise<{ taggingError?: string }>;
  retagFromExisting: (sidecarCall: (method: string, params?: Record<string, unknown>) => Promise<unknown>, ocrDir: string) => Promise<{ taggingError?: string }>;
  startExtract: (sidecarCall: (method: string, params?: Record<string, unknown>) => Promise<unknown>) => Promise<boolean>;
  resumeReview: (outputPath: string, tags: PageTag[]) => void;
  resumeAnalyze: (
    sidecarCall: (method: string, params?: Record<string, unknown>) => Promise<unknown>,
    inputDir: string,
    options?: { skipSummarize?: boolean }
  ) => Promise<boolean>;
  cancel: (sidecarCall: (method: string, params?: Record<string, unknown>) => Promise<unknown>) => Promise<void>;
  reset: () => void;
}

export function usePipeline(): UsePipelineReturn {
  const [step, setStep] = useState<PipelineStep>("idle");
  const [files, setFiles] = useState<ImportedFile[]>([]);
  const [progress, setProgress] = useState<PipelineProgress>({ current: 0, total: 0, message: "" });
  const [result, setResult] = useState<PipelineResult | null>(null);
  const [tags, setTags] = useState<PageTag[]>([]);
  const unlistenRef = useRef<(() => void) | null>(null);
  const cancelledRef = useRef(false);

  // Refs to avoid stale closures in async callbacks
  const stepRef = useRef(step);
  stepRef.current = step;
  const filesRef = useRef(files);
  filesRef.current = files;
  const tagsRef = useRef(tags);
  tagsRef.current = tags;
  const resultRef = useRef(result);
  resultRef.current = result;

  const listenProgress = useCallback(async () => {
    // Clean up previous listener before creating new one
    if (unlistenRef.current) {
      unlistenRef.current();
      unlistenRef.current = null;
    }
    const unlisten = await listen<PipelineProgress>("pipeline:progress", (event) => {
      setProgress(event.payload);
    });
    unlistenRef.current = unlisten;
  }, []);

  const setExistingResult = useCallback((outputPath: string) => {
    setResult((prev) => ({
      total: prev?.total ?? 0,
      successCount: prev?.successCount ?? 0,
      failCount: prev?.failCount ?? 0,
      warnings: prev?.warnings ?? [],
      outputPath,
    }));
  }, []);

  const startOcr = useCallback(async (
    sidecarCall: (method: string, params?: Record<string, unknown>) => Promise<unknown>,
    options?: { outputDir?: string },
  ): Promise<{ taggingError?: string }> => {
    cancelledRef.current = false;
    const currentFiles = filesRef.current;
    if (currentFiles.length === 0) throw new Error("처리할 파일이 없습니다");

    // 모든 파일이 같은 디렉토리에 있어야 함 (OCR/extract_pages가 단일 source_dir 사용)
    const dirs = new Set(currentFiles.map((f) => fileDir(f.path)));
    if (dirs.size > 1) {
      throw new Error(
        "여러 폴더의 파일을 동시에 처리할 수 없습니다. 같은 폴더 안의 파일만 선택해 주세요."
      );
    }

    setStep("ocr");
    setProgress({ current: 0, total: currentFiles.length, message: "OCR 준비 중..." });
    await listenProgress();

    try {
      const filePaths = currentFiles.map((f) => f.path);
      const targetDir = fileDir(filePaths[0] ?? "");
      // OCR 시작
      const ocrParams: Record<string, unknown> = {
        files: filePaths,
        target_dir: targetDir,
      };
      if (options?.outputDir) {
        ocrParams.config = { output_dir: options.outputDir };
      }
      const resp = await sidecarCall("ocr_files", ocrParams) as PipelineResult;

      // 취소된 경우 후속 단계 진행 중단
      if (cancelledRef.current) {
        return {};
      }

      setResult(resp);

      // OCR 결과 검증: 성공한 파일이 없으면 에러
      if (!resp.outputPath || (resp.total > 0 && resp.successCount === 0)) {
        throw new Error(`OCR 처리 실패: ${resp.total}개 파일 중 성공 0개`);
      }

      // 모든 파일에 대해 태깅 (PDF=Vision, 텍스트=Text 기반)
      setStep("tagging");
      setProgress({ current: 0, total: 0, message: "AI 태깅 준비 중..." });

      if (cancelledRef.current) return {};

      try {
        const tagResp = await sidecarCall("tag_pages", {
          ocr_dir: resp.outputPath,
          files: filePaths,
        }) as { tags: PageTag[] };

        if (cancelledRef.current) return {};
        setTags(tagResp.tags ?? []);
        setStep("review");
        return {};
      } catch (tagErr) {
        if (cancelledRef.current) return {};
        // 태깅 실패 시에도 review로 진행하되, 에러를 호출자에게 반환
        // 태깅 실패는 errMsg로 호출자에게 전달 — 별도 로깅 불필요
        const errMsg = `AI 태깅 실패: ${tagErr instanceof Error ? tagErr.message : String(tagErr)}`;
        setStep("review");
        return { taggingError: errMsg };
      }
    } catch (e) {
      if (cancelledRef.current) return {};
      setStep("idle");
      throw e;
    } finally {
      // 모든 처리 끝난 후에만 progress listener 해제
      if (unlistenRef.current) {
        unlistenRef.current();
        unlistenRef.current = null;
      }
    }
  }, [listenProgress]);

  const retag = useCallback(async (
    sidecarCall: (method: string, params?: Record<string, unknown>) => Promise<unknown>,
  ): Promise<{ taggingError?: string }> => {
    cancelledRef.current = false;
    const ocrOutputPath = resultRef.current?.outputPath ?? "";
    const filePaths = filesRef.current.map((f) => f.path);
    if (!ocrOutputPath) {
      return { taggingError: "OCR 결과 경로가 없습니다. 먼저 OCR을 실행해 주세요." };
    }

    setStep("tagging");
    setProgress({ current: 0, total: 0, message: "AI 태깅 준비 중..." });
    await listenProgress();

    try {
      const tagResp = await sidecarCall("tag_pages", {
        ocr_dir: ocrOutputPath,
        files: filePaths,
      }) as { tags: PageTag[] };

      if (cancelledRef.current) return {};
      setTags(tagResp.tags ?? []);
      setStep("review");
      return {};
    } catch (tagErr) {
      if (cancelledRef.current) return {};
      const errMsg = `AI 태깅 실패: ${tagErr instanceof Error ? tagErr.message : String(tagErr)}`;
      setStep("review");
      return { taggingError: errMsg };
    } finally {
      if (unlistenRef.current) {
        unlistenRef.current();
        unlistenRef.current = null;
      }
    }
  }, [listenProgress]);

  const retagFromExisting = useCallback(async (
    sidecarCall: (method: string, params?: Record<string, unknown>) => Promise<unknown>,
    ocrDir: string,
  ): Promise<{ taggingError?: string }> => {
    cancelledRef.current = false;
    const filePaths = filesRef.current.map((f) => f.path);
    if (!ocrDir) {
      return { taggingError: "기존 OCR 결과 경로가 없습니다." };
    }

    setExistingResult(ocrDir);
    setStep("tagging");
    setProgress({ current: 0, total: 0, message: "기존 OCR 결과로 AI 태깅 준비 중..." });
    await listenProgress();

    try {
      const tagResp = await sidecarCall("tag_pages", {
        ocr_dir: ocrDir,
        files: filePaths,
      }) as { tags: PageTag[] };

      if (cancelledRef.current) return {};
      setTags(tagResp.tags ?? []);
      setStep("review");
      return {};
    } catch (tagErr) {
      if (cancelledRef.current) return {};
      const errMsg = `AI 태깅 실패: ${tagErr instanceof Error ? tagErr.message : String(tagErr)}`;
      setStep("review");
      return { taggingError: errMsg };
    } finally {
      if (unlistenRef.current) {
        unlistenRef.current();
        unlistenRef.current = null;
      }
    }
  }, [listenProgress, setExistingResult]);

  const startExtract = useCallback(async (
    sidecarCall: (method: string, params?: Record<string, unknown>) => Promise<unknown>
  ): Promise<boolean> => {
    cancelledRef.current = false;
    setStep("extract");
    setProgress({ current: 0, total: 0, message: "추출 시작..." });

    try {
      await listenProgress();
      const pipelineDir = resultRef.current?.outputPath ?? "";
      if (!pipelineDir) {
        throw new Error("OCR 결과 경로를 찾을 수 없습니다. 먼저 OCR을 실행해 주세요.");
      }

      // PDF가 있으면 페이지 추출, 없으면 건너뜀 (텍스트 파일은 이미 분리돼 있음)
      const hasPdf = filesRef.current.some((f) => f.name.toLowerCase().endsWith(".pdf"));
      if (hasPdf) {
        // source_dir: 원본 파일 경로에서 직접 계산 (커스텀 outputDir 시 pipelineDir 역산 불가)
        const originalDir = fileDir(filesRef.current[0]?.path ?? "");
        await sidecarCall("extract_pages", {
          tags: tagsRef.current,
          source_dir: originalDir,
          output_dir: pipelineDir,
        });
      }

      if (cancelledRef.current) return false;

      setStep("analyze");
      setProgress({ current: 0, total: 0, message: "분석 시작..." });

      if (cancelledRef.current) return false;

      // OCR 출력 디렉토리를 summarize/integrate에 전달 (YAML 기본값 대신 실제 경로 사용)
      const analyzeResp = await sidecarCall("summarize", {
        input_dir: pipelineDir,
      }) as PipelineResult;

      if (cancelledRef.current) return false;

      const integrateResp = await sidecarCall("integrate", {
        input_dir: pipelineDir,
      }) as PipelineResult;

      if (cancelledRef.current) return false;

      // integrate 결과에 output_path가 있으면 우선, 없으면 summarize 결과 사용
      const base = integrateResp?.outputPath ? integrateResp : analyzeResp;
      const finalResult = { ...base, outputPath: pipelineDir };
      setResult(finalResult);
      setStep("complete");
      return true;
    } catch (e) {
      if (cancelledRef.current) return false;
      setStep("review");
      throw e;
    } finally {
      if (unlistenRef.current) {
        unlistenRef.current();
        unlistenRef.current = null;
      }
    }
  }, [listenProgress]);

  const resumeReview = useCallback((outputPath: string, savedTags: PageTag[]) => {
    cancelledRef.current = false;
    setExistingResult(outputPath);
    setTags(savedTags);
    setProgress({ current: 0, total: 0, message: "" });
    setStep("review");
  }, [setExistingResult]);

  const resumeAnalyze = useCallback(async (
    sidecarCall: (method: string, params?: Record<string, unknown>) => Promise<unknown>,
    inputDir: string,
    options?: { skipSummarize?: boolean },
  ): Promise<boolean> => {
    cancelledRef.current = false;
    setExistingResult(inputDir);
    setStep("analyze");
    setProgress({ current: 0, total: 0, message: "기존 산출물 검증 중..." });

    try {
      await listenProgress();
      let analyzeResp: PipelineResult | null = null;
      if (!options?.skipSummarize) {
        analyzeResp = await sidecarCall("summarize", {
          input_dir: inputDir,
        }) as PipelineResult;
        if (cancelledRef.current) return false;
      }

      const integrateResp = await sidecarCall("integrate", {
        input_dir: inputDir,
      }) as PipelineResult;

      if (cancelledRef.current) return false;

      const base = integrateResp?.outputPath ? integrateResp : (analyzeResp ?? {
        total: 0,
        successCount: 0,
        failCount: 0,
        warnings: [],
        outputPath: inputDir,
      });
      setResult({ ...base, outputPath: inputDir });
      setStep("complete");
      return true;
    } catch (e) {
      if (cancelledRef.current) return false;
      setStep(tagsRef.current.length > 0 ? "review" : "import");
      throw e;
    } finally {
      if (unlistenRef.current) {
        unlistenRef.current();
        unlistenRef.current = null;
      }
    }
  }, [listenProgress, setExistingResult]);

  const cancel = useCallback(async (
    sidecarCall: (method: string, params?: Record<string, unknown>) => Promise<unknown>
  ) => {
    const currentStep = stepRef.current;
    cancelledRef.current = true;
    setProgress({ current: 0, total: 0, message: "" });
    // Clean up progress listener
    if (unlistenRef.current) {
      unlistenRef.current();
      unlistenRef.current = null;
    }
    // 추출/분석 중 취소 → review로 복귀 (태그 데이터 보존)
    // OCR/태깅 중 취소 → idle (아직 태그 없음)
    if (currentStep === "extract" || currentStep === "analyze") {
      setStep("review");
    } else {
      setStep("idle");
    }
    // RPC는 fire-and-forget (UI 블로킹 방지)
    sidecarCall("cancel").catch(() => {});
  }, []);

  const reset = useCallback(() => {
    cancelledRef.current = true;  // 진행 중인 async flow 중단
    setStep("idle");
    setFiles([]);
    setProgress({ current: 0, total: 0, message: "" });
    setResult(null);
    setTags([]);
    if (unlistenRef.current) {
      unlistenRef.current();
      unlistenRef.current = null;
    }
  }, []);

  return {
    step, files, progress, result, tags,
    setStep, setFiles, setTags,
    startOcr, retag, retagFromExisting, startExtract, resumeReview, resumeAnalyze, cancel, reset,
  };
}
