/** 경로·형식·크기·시간 표기 도우미 */

import type { DocFormat } from "./contract";

export function baseName(path: string): string {
  return path.split(/[/\\]/).filter(Boolean).pop() ?? path;
}

export function dirName(path: string): string {
  const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return i > 0 ? path.slice(0, i) : "";
}

/** 폴더 경로가 쓰는 구분자(\ 또는 /)를 따라 붙인다 */
export function joinPath(dir: string, name: string): string {
  if (!dir) return name;
  const sep = dir.includes("\\") && !dir.includes("/") ? "\\" : "/";
  return dir.endsWith(sep) ? dir + name : `${dir}${sep}${name}`;
}

export function stem(name: string): string {
  return baseName(name).replace(/\.[^.]+$/, "");
}

export function extOf(name: string): string {
  const m = /\.([^./\\]+)$/.exec(name);
  return m ? m[1].toLowerCase() : "";
}

const EXT_FORMAT: Record<string, DocFormat> = {
  hwp: "hwp", hwpx: "hwpx", hml: "hwpml", hwpml: "hwpml", pdf: "pdf",
  xls: "xls", xlsx: "xlsx", docx: "docx", pptx: "pptx",
  png: "image", jpg: "image", jpeg: "image", gif: "image", webp: "image", bmp: "image", tif: "image", tiff: "image",
  md: "md", txt: "txt", csv: "csv",
};

export function formatOf(path: string): DocFormat {
  return EXT_FORMAT[extOf(path)] ?? "unknown";
}

export const FORMAT_LABEL: Record<DocFormat, string> = {
  hwp: "HWP", hwp3: "HWP 3", hwpx: "HWPX", hwpml: "HWPML", pdf: "PDF", xls: "XLS", xlsx: "XLSX",
  docx: "DOCX", pptx: "PPTX", image: "그림", md: "MD", txt: "TXT", csv: "CSV", unknown: "기타",
};

/** 쉬운 이름 (형식 이름을 모르는 사람용) */
export const FORMAT_KIND: Record<DocFormat, string> = {
  hwp: "한글 문서", hwp3: "옛 한글 문서", hwpx: "한글 문서", hwpml: "한글 문서", pdf: "PDF 문서",
  xls: "엑셀 표", xlsx: "엑셀 표", docx: "워드 문서", pptx: "파워포인트", image: "그림 파일",
  md: "글 파일", txt: "글 파일", csv: "표 파일", unknown: "파일",
};

export type FormatFamily = "hwp" | "pdf" | "xlsx" | "doc" | "ppt" | "img" | "txt";

export function formatFamily(f: DocFormat): FormatFamily {
  switch (f) {
    case "hwp": case "hwp3": case "hwpx": case "hwpml": return "hwp";
    case "pdf": return "pdf";
    case "xls": case "xlsx": case "csv": return "xlsx";
    case "docx": return "doc";
    case "pptx": return "ppt";
    case "image": return "img";
    default: return "txt";
  }
}

/** 한글 편집기(rhwp)로 열 수 있는 형식 */
export function isHangul(f: DocFormat): boolean {
  return f === "hwp" || f === "hwpx" || f === "hwpml";
}

export function fileSize(bytes: number): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)}GB`;
}

export function num(n: number): string {
  return n.toLocaleString("ko-KR");
}

export function timeAgo(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return "방금";
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  if (s < 172800) return "어제";
  const d = new Date(ms);
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}

/** 공문서 날짜 표기 2026. 10. 10. */
export function gongmunDate(d = new Date()): string {
  return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.`;
}

/** 파일명 규칙 제안: 날짜_부서_제목 */
export function suggestFileName(title: string, dept: string, d = new Date()): string {
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const clean = (s: string) => s.replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim();
  return [ymd, clean(dept), clean(title)].filter(Boolean).join("_");
}

/** 글자 수 통계 (공백 포함·제외, 원고지 200자 매수) */
export function charStats(text: string) {
  const withSpaces = text.replace(/\r?\n/g, "").length;
  const noSpaces = text.replace(/\s/g, "").length;
  return { withSpaces, noSpaces, manuscript: Math.ceil(withSpaces / 200) };
}

/** 쪽 번호 배열 → "1-3,5" */
export function toRanges(pages: number[]): string {
  const s = [...new Set(pages)].sort((a, b) => a - b);
  const out: string[] = [];
  for (let i = 0; i < s.length; i++) {
    let j = i;
    while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++;
    out.push(i === j ? `${s[i]}` : `${s[i]}-${s[j]}`);
    i = j;
  }
  return out.join(",");
}
