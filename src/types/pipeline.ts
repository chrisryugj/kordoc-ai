export type PipelineStep =
  | "idle"
  | "import"
  | "converting"
  | "complete";

export interface ImportedFile {
  path: string;
  name: string;
  size: number;
  type: "hwp" | "hwpx" | "pdf" | "txt" | "xlsx" | "unknown";
}

export interface PipelineProgress {
  current: number;
  total: number;
  message: string;
}

export interface PipelineResult {
  total: number;
  successCount: number;
  failCount: number;
  outputPath: string;
  warnings: string[];
}
