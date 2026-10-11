/** 기존 대화상자(합치기·PDF 도구·양식 채우기·클릭 편집)가 쓰는 파일·옵션 타입 */

/** 병합 모드 — native: 원본 서식 유지 수합, markdown: 마크다운 변환 후 합치기 */
export type MergeMode = "markdown" | "native";

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
