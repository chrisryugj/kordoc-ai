/** 한꺼번에 — 할 일 목록과 옵션 기본값 */

import type { DocFormat, RedactRule } from "../../lib/contract";
import type { BatchTaskId } from "../../state/app";
import { RULES } from "../workbench/tools/RedactTool";

export interface TaskDef {
  id: BatchTaskId;
  group: string;
  title: string;
  desc: string;
  /** 필요한 최소 파일 수 (0 = 파일 없이도 됨) */
  min: number;
  /** 받는 형식 (없으면 전부) */
  accepts?: DocFormat[];
  /** 이미 그 형식이라 할 일이 없는 형식 (목록에서 "이 일에는 쓰지 않는 형식"으로) */
  skips?: DocFormat[];
}

export const TASKS: TaskDef[] = [
  { id: "pdf", group: "바꾸기", title: "PDF로 내보내기", desc: "인쇄 모양 그대로 PDF로", min: 1, skips: ["pdf"] },
  { id: "hwpx", group: "바꾸기", title: "한글로 바꾸기", desc: "PDF·워드·엑셀을 고칠 수 있는 HWPX로, 옛 HWP는 서식 그대로", min: 1, skips: ["hwpx"] },
  { id: "convert", group: "바꾸기", title: "글로 바꾸기", desc: "마크다운·HTML·글만으로 한 번에", min: 1 },
  { id: "ocr", group: "바꾸기", title: "스캔 읽기(OCR)", desc: "그림·스캔 PDF 속 글자를 글로", min: 1, accepts: ["pdf", "image"] },
  { id: "merge", group: "모으기·나누기", title: "합치기", desc: "여러 문서를 하나로, 서식 유지 또는 글로", min: 2 },
  { id: "bundle", group: "모으기·나누기", title: "결재·공개용 합본 PDF", desc: "순서를 정해 PDF 한 권으로 묶기", min: 1 },
  { id: "pdftools", group: "모으기·나누기", title: "PDF 나누기·쪽 뽑기", desc: "쪽 단위로 나누거나 골라 새 PDF로", min: 1, accepts: ["pdf"] },
  { id: "collect", group: "모으기·나누기", title: "취합해서 엑셀로", desc: "같은 서식으로 받은 문서의 칸을 한 줄씩", min: 2 },
  { id: "extract", group: "모으기·나누기", title: "항목 뽑기(AI)", desc: "여러 문서에서 같은 항목을 표로", min: 1 },
  { id: "tables", group: "뽑기·찾기", title: "표 뽑기", desc: "문서 속 표를 엑셀로", min: 1, skips: ["md", "txt", "csv", "image"] },
  { id: "images", group: "뽑기·찾기", title: "그림만 뽑기", desc: "문서에 든 그림을 폴더로", min: 1 },
  { id: "search", group: "뽑기·찾기", title: "여러 문서에서 찾기", desc: "낱말이 나오는 문서와 쪽", min: 1 },
  { id: "redact", group: "보안·채우기", title: "개인정보 가리기", desc: "주민번호·전화번호 등을 가린 사본", min: 1 },
  { id: "mailmerge", group: "보안·채우기", title: "명부로 여러 장 만들기", desc: "양식 하나에 명부 한 줄씩", min: 0 },
  { id: "watch", group: "자동으로", title: "폴더 지켜보기", desc: "새 문서가 들어오면 글로 바꿈", min: 0 },
];

export const GROUPS = [...new Set(TASKS.map((t) => t.group))];

export interface BatchOpts {
  outDir: string;
  convertFormat: "md" | "html" | "txt";
  rules: RedactRule[];
  tablesFormat: "xlsx" | "csv" | "md";
  watermark: string;
  pageNumbers: boolean;
  columns: string;
  query: string;
  template: string;
  templatePath: string;
  dataPath: string;
  nameColumn: string;
  collectFields: string[];
}

export const DEFAULT_OPTS: BatchOpts = {
  outDir: "",
  convertFormat: "md",
  rules: RULES.filter((r) => r.on).map((r) => r.id),
  tablesFormat: "xlsx",
  watermark: "",
  pageNumbers: true,
  columns: "",
  query: "",
  template: "gian",
  templatePath: "",
  dataPath: "",
  nameColumn: "",
  collectFields: [],
};

export function accepts(def: TaskDef, f: DocFormat): boolean {
  return (!def.accepts || def.accepts.includes(f)) && !def.skips?.includes(f);
}
