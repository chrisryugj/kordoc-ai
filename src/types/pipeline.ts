export type PipelineStep =
  | "idle"
  | "import"
  | "converting"
  | "complete";

/** 사용자가 선택할 수 있는 액션 */
export type PipelineAction =
  | "convert"        // 문서 → 마크다운 변환 (배치)
  | "ocr"            // 이미지 PDF OCR
  | "summarize"      // AI 요약
  | "diff"           // 문서 비교
  | "extract_tables" // 표 추출
  | "form_extract"   // 양식 필드 추출
  | "generate_hwpx"  // 마크다운 → HWPX
  | "merge_files"    // 문서 병합
  | "scan_receipt";  // 영수증 스캔

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
  /** 액션별 결과 데이터 (summarize → text, diff → html, etc.) */
  data?: unknown;
}
