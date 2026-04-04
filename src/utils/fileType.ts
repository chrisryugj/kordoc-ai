import type { ImportedFile } from "../types/pipeline";

/** 파일명에서 ImportedFile.type을 결정 */
export function detectFileType(filename: string): ImportedFile["type"] {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".pdf")) return "pdf";
  if (lower.endsWith(".hwpx")) return "hwpx";
  if (lower.endsWith(".hwp")) return "hwp";
  if (lower.endsWith(".xlsx")) return "xlsx";
  if (lower.endsWith(".txt")) return "txt";
  return "unknown";
}

/** 지원 확장자 정규식 */
export const SUPPORTED_EXT_RE = /\.(hwp|hwpx|pdf|xlsx)$/i;
