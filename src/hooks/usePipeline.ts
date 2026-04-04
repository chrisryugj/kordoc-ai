import { useState, useCallback, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import type {
  PipelineStep,
  PipelineAction,
  ImportedFile,
  PipelineProgress,
  PipelineResult,
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
  startAction: (
    action: PipelineAction,
    sidecarCall: SidecarCall,
    options?: { outputDir?: string },
  ) => Promise<void>;
  cancel: (sidecarCall: SidecarCall) => Promise<void>;
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

  const cleanup = useCallback(() => {
    if (unlistenRef.current) {
      unlistenRef.current();
      unlistenRef.current = null;
    }
  }, []);

  // ── 액션별 RPC 디스패처 ──

  async function dispatchConvert(call: SidecarCall, currentFiles: ImportedFile[], outputDir?: string): Promise<PipelineResult> {
    const batchParams: Record<string, unknown> = { files: currentFiles.map((f) => f.path) };
    if (outputDir) batchParams.output_dir = outputDir;

    const raw = await call("convert_batch", batchParams) as {
      total: number; succeeded: number; failed: number;
      results: { success: boolean; output_path: string; error?: string }[];
    };
    const firstSuccess = raw.results.find((r) => r.success && r.output_path);
    return {
      total: raw.total,
      successCount: raw.succeeded,
      failCount: raw.failed,
      outputPath: firstSuccess ? fileDir(firstSuccess.output_path) : "",
      warnings: raw.results.filter((r) => r.error).map((r) => r.error!),
    };
  }

  async function dispatchSingle(method: string, call: SidecarCall, file: ImportedFile): Promise<PipelineResult> {
    const raw = await call(method, { input_path: file.path }) as Record<string, unknown>;
    return {
      total: 1, successCount: 1, failCount: 0,
      outputPath: (raw.output_path as string) || fileDir(file.path),
      warnings: [],
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

  async function dispatchSummarize(call: SidecarCall, file: ImportedFile): Promise<PipelineResult> {
    const raw = await call("summarize", { input_path: file.path }) as Record<string, unknown>;
    return {
      total: 1, successCount: 1, failCount: 0,
      outputPath: fileDir(file.path),
      warnings: [],
      data: raw,
    };
  }

  async function dispatchMerge(call: SidecarCall, currentFiles: ImportedFile[], outputDir?: string): Promise<PipelineResult> {
    const dir = outputDir || fileDir(currentFiles[0].path);
    const outputPath = `${dir}${dir.includes('/') ? '/' : '\\'}merged.md`;
    const raw = await call("merge_files", { files: currentFiles.map((f) => f.path), output_path: outputPath }) as Record<string, unknown>;
    return {
      total: currentFiles.length, successCount: 1, failCount: 0,
      outputPath: dir,
      warnings: [],
      data: raw,
    };
  }

  async function dispatchGenerateHwpx(call: SidecarCall, file: ImportedFile): Promise<PipelineResult> {
    const raw = await call("generate_hwpx", { input_path: file.path }) as Record<string, unknown>;
    return {
      total: 1, successCount: 1, failCount: 0,
      outputPath: (raw.output_path as string) || fileDir(file.path),
      warnings: [],
      data: raw,
    };
  }

  // ── 메인 액션 실행기 ──

  const startAction = useCallback(async (
    action: PipelineAction,
    sidecarCall: SidecarCall,
    options?: { outputDir?: string },
  ): Promise<void> => {
    cancelledRef.current = false;
    const currentFiles = filesRef.current;
    if (currentFiles.length === 0) throw new Error("처리할 파일이 없습니다");

    // 액션별 최소 파일 수 검증
    const minFiles: Partial<Record<PipelineAction, number>> = { diff: 2, merge_files: 2 };
    const required = minFiles[action] ?? 1;
    if (currentFiles.length < required) {
      throw new Error(`"${action}" 액션은 최소 ${required}개 파일이 필요합니다 (현재 ${currentFiles.length}개)`);
    }

    setStep("converting");
    setProgress({ current: 0, total: currentFiles.length, message: "처리 준비 중..." });
    await listenProgress();

    try {
      let resp: PipelineResult;

      switch (action) {
        case "convert":
          resp = await dispatchConvert(sidecarCall, currentFiles, options?.outputDir);
          break;
        case "ocr":
          resp = await dispatchSingle("ocr", sidecarCall, currentFiles[0]);
          break;
        case "summarize":
          resp = await dispatchSummarize(sidecarCall, currentFiles[0]);
          break;
        case "diff":
          resp = await dispatchDiff(sidecarCall, currentFiles);
          break;
        case "extract_tables":
          resp = await dispatchSingle("extract_tables", sidecarCall, currentFiles[0]);
          break;
        case "form_extract":
          resp = await dispatchSingle("form_extract", sidecarCall, currentFiles[0]);
          break;
        case "generate_hwpx":
          resp = await dispatchGenerateHwpx(sidecarCall, currentFiles[0]);
          break;
        case "merge_files":
          resp = await dispatchMerge(sidecarCall, currentFiles, options?.outputDir);
          break;
        case "scan_receipt":
          resp = await dispatchSingle("scan_receipt", sidecarCall, currentFiles[0]);
          break;
        default:
          throw new Error(`알 수 없는 액션: ${action}`);
      }

      if (cancelledRef.current) return;
      setResult(resp);

      if (resp.total > 0 && resp.successCount === 0) {
        throw new Error(`처리 실패: ${resp.total}개 중 성공 0개`);
      }
      setStep("complete");
    } catch (e) {
      if (cancelledRef.current) return;
      setStep("idle");
      throw e;
    } finally {
      cleanup();
    }
  }, [listenProgress, cleanup]);

  const cancel = useCallback(async (sidecarCall: SidecarCall) => {
    cancelledRef.current = true;
    setProgress({ current: 0, total: 0, message: "" });
    cleanup();
    setStep("idle");
    sidecarCall("cancel").catch(() => {});
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
    setStep, setFiles,
    startAction, cancel, reset,
  };
}
