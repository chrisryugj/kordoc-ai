import type { ImportedFile } from "../types/pipeline";

/** 파일명에서 ImportedFile.type을 결정 */
export function detectFileType(filename: string): ImportedFile["type"] {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".pdf")) return "pdf";
  if (lower.endsWith(".hwpx")) return "hwpx";
  if (lower.endsWith(".hwp")) return "hwp";
  if (lower.endsWith(".xlsx")) return "xlsx";
  if (lower.endsWith(".docx")) return "docx";
  if (lower.endsWith(".txt")) return "txt";
  if (lower.endsWith(".md")) return "md";
  if (lower.endsWith(".png")) return "png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "jpg";
  if (lower.endsWith(".gif")) return "gif";
  if (lower.endsWith(".webp")) return "webp";
  return "unknown";
}

