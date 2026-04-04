import { useState, useCallback, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import type {
  PipelineStep,
  ImportedFile,
  PipelineProgress,
  PipelineResult,
} from "../types/pipeline";

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
  startConvert: (
    sidecarCall: (method: string, params?: Record<string, unknown>) => Promise<unknown>,
    options?: { outputDir?: string },
  ) => Promise<void>;
  cancel: (sidecarCall: (method: string, params?: Record<string, unknown>) => Promise<unknown>) => Promise<void>;
  reset: () => void;
}

export function usePipeline(): UsePipelineReturn {
  const [step, setStep] = useState<PipelineStep>("idle");
  const [files, setFiles] = useState<ImportedFile[]>([]);
  const [progress, setProgress] = useState<PipelineProgress>({ current: 0, total: 0, message: "" });
  const [result, setResult] = useState<PipelineResult | null>(null);
  const unlistenRef = useRef<(() => void) | null>(null);
  const cancelledRef = useRef(false);

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

  const startConvert = useCallback(async (
    sidecarCall: (method: string, params?: Record<string, unknown>) => Promise<unknown>,
    options?: { outputDir?: string },
  ): Promise<void> => {
    cancelledRef.current = false;
    const currentFiles = filesRef.current;
    if (currentFiles.length === 0) throw new Error("처리할 파일이 없습니다");

    const dirs = new Set(currentFiles.map((f) => fileDir(f.path)));
    if (dirs.size > 1) {
      throw new Error("여러 폴더의 파일을 동시에 처리할 수 없습니다. 같은 폴더 안의 파일만 선택해 주세요.");
    }

    setStep("converting");
    setProgress({ current: 0, total: currentFiles.length, message: "변환 준비 중..." });
    await listenProgress();

    try {
      const filePaths = currentFiles.map((f) => f.path);
      const batchParams: Record<string, unknown> = { files: filePaths };
      if (options?.outputDir) {
        batchParams.output_dir = options.outputDir;
      }
      const raw = await sidecarCall("convert_batch", batchParams) as {
        total: number; succeeded: number; failed: number;
        results: { success: boolean; output_path: string; error?: string }[];
      };

      if (cancelledRef.current) return;

      // 첫 번째 성공 결과에서 출력 디렉토리 추출
      const firstSuccess = raw.results.find((r) => r.success && r.output_path);
      const outputPath = firstSuccess ? fileDir(firstSuccess.output_path) : "";
      const warnings = raw.results.filter((r) => r.error).map((r) => r.error!);

      const resp: PipelineResult = {
        total: raw.total,
        successCount: raw.succeeded,
        failCount: raw.failed,
        outputPath,
        warnings,
      };
      setResult(resp);

      if (raw.total > 0 && raw.succeeded === 0) {
        throw new Error(`변환 실패: ${raw.total}개 파일 중 성공 0개`);
      }

      setStep("complete");
    } catch (e) {
      if (cancelledRef.current) return;
      setStep("idle");
      throw e;
    } finally {
      if (unlistenRef.current) {
        unlistenRef.current();
        unlistenRef.current = null;
      }
    }
  }, [listenProgress]);

  const cancel = useCallback(async (
    sidecarCall: (method: string, params?: Record<string, unknown>) => Promise<unknown>,
  ) => {
    cancelledRef.current = true;
    setProgress({ current: 0, total: 0, message: "" });
    if (unlistenRef.current) {
      unlistenRef.current();
      unlistenRef.current = null;
    }
    setStep("idle");
    sidecarCall("cancel").catch(() => {});
  }, []);

  const reset = useCallback(() => {
    cancelledRef.current = true;
    setStep("idle");
    setFiles([]);
    setProgress({ current: 0, total: 0, message: "" });
    setResult(null);
    if (unlistenRef.current) {
      unlistenRef.current();
      unlistenRef.current = null;
    }
  }, []);

  return {
    step, files, progress, result,
    setStep, setFiles,
    startConvert, cancel, reset,
  };
}
