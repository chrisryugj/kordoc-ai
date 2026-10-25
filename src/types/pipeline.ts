/** 기존 대화상자(합치기·양식 채우기·클릭 편집)가 쓰는 파일·옵션 타입 */

/** 병합 모드 — native: 원본 서식 유지 수합, markdown: 마크다운 변환 후 합치기 */
export type MergeMode = "markdown" | "native";

export interface ImportedFile {
  path: string;
  name: string;
  size: number;
  type: "hwp" | "hwpx" | "pdf" | "txt" | "xlsx" | "docx" | "md" | "png" | "jpg" | "gif" | "webp" | "unknown";
}
