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
  | "form_extract"   // 양식 필드 추���
  | "form_fill"      // 양식 채우기 작업대 (FillWizard — KorDoc Studio)
  | "generate_hwpx"  // 마크다운 → HWPX
  | "merge_files"        // 문서 병합
  | "pdf_utils"          // PDF 도구 (병합/분할/추출)
  | "inspect_document";  // K팀장 — 문서 정합성 검사

/** 병합 모드 — native: 원본 서식 유지 수합, markdown: 마크다운 변환 후 합치기 */
export type MergeMode = "markdown" | "native";

/** 요약 분량 */
export type SummarizeLength = "short" | "medium" | "long";
/** 요약 스타일 */
export type SummarizeStyle = "standard" | "briefing" | "review" | "action";

export interface SummarizeOptions {
  length: SummarizeLength;
  style: SummarizeStyle;
}

export interface ConvertOptions {
  /** 페이지 범위 (예: "1-3", "1,5,7") — 생략 시 전체 */
  pages?: string;
}

/** 양식 추출 옵션 */
export interface FormExtractOptions {
  selectedFields: string[];
  useAi: boolean;
}

/** 필드 후보 (form_extract_candidates 응답) */
export interface FieldCandidate {
  label: string;
  source: 'table' | 'inline';
  count: number;
}

/** PDF 도구 옵션 */
export type PdfUtilMode = 'merge' | 'split' | 'extract';
export type PdfExtractMode = 'include' | 'exclude';
export type PdfSplitMode = 'each' | 'range';

export interface PdfUtilsOptions {
  mode: PdfUtilMode;
  /** split/extract 시 대상 파일 (1개) */
  targetFile?: ImportedFile;
  /** split 모드 */
  splitMode?: PdfSplitMode;
  /** extract 모드 */
  extractMode?: PdfExtractMode;
  /** 페이지 범위/번호 (split range, extract) — "1,3,5-7" 형식 */
  pages?: string;
  /** 내보내기 폴더 (지정 시 전역 설정 대신 사용) */
  outputDir?: string;
}

export interface ImportedFile {
  path: string;
  name: string;
  size: number;
  type: "hwp" | "hwpx" | "pdf" | "txt" | "xlsx" | "docx" | "md" | "png" | "jpg" | "gif" | "webp" | "unknown";
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
