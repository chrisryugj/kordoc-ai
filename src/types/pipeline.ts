export type PipelineStep =
  | "idle"
  | "import"
  | "ocr"
  | "tagging"
  | "review"
  | "extract"
  | "analyze"
  | "complete";

export interface ImportedFile {
  path: string;
  name: string;
  size: number;
  type: "hwp" | "hwpx" | "pdf" | "txt" | "unknown";
}

export interface PageTag {
  pageNum: number;
  sourceFile: string;
  theme: string;
  confidence: number;
  confirmed: boolean;
  snippet?: string;
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

