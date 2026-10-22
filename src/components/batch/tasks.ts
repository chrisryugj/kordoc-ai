/** 서무 도구 — 업무별 할 일 목록과 옵션 기본값 (GROUPS 는 TASKS 의 group 순서) */

import type { DocFormat, RedactRule } from "../../lib/contract";
import type { BatchTaskId } from "../../state/app";
import { DISCLOSURE_RULES } from "../workbench/tools/RedactTool";
import { DEFAULT_SHRINK, type ShrinkChoice } from "../workbench/tools/ShrinkTool";

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
  { id: "collect", group: "문서 수합", title: "문서 수합", desc: "부서 제출물을 엑셀 한 장으로, 미제출 부서와 독촉 글까지", min: 1 },
  { id: "extract", group: "문서 수합", title: "항목 뽑기(AI)", desc: "서식이 제각각인 문서에서 같은 항목을 표로", min: 1 },
  { id: "mailmerge", group: "명부로 여러 장", title: "명부로 여러 장 만들기", desc: "양식 하나에 명부 한 줄씩", min: 0 },
  { id: "redact", group: "정보공개 공개본", title: "개인정보 가리기", desc: "주민번호·전화번호 등을 가린 사본", min: 1 },
  { id: "bundle", group: "결재 합본", title: "합본 PDF", desc: "본문과 붙임까지 PDF 한 권으로", min: 1 },
  { id: "shrink", group: "결재 합본", title: "PDF 용량 줄이기", desc: "첨부 한도에 맞게 그림을 줄여 용량을 낮춥니다. 글자는 그대로", min: 1, skips: ["md", "txt", "csv", "image"] },
  { id: "merge", group: "결재 합본", title: "한 문서로 합치기", desc: "한글·워드 문서를 하나로 이어 붙이기", min: 2 },
  { id: "pdftools", group: "결재 합본", title: "PDF 나누기·쪽 뽑기", desc: "쪽 단위로 나누거나 골라 새 PDF로", min: 1, accepts: ["pdf"] },
  { id: "print", group: "결재 합본", title: "한꺼번에 인쇄", desc: "고른 프린터로 바로 보냅니다", min: 1 },
  { id: "compare", group: "신구대조표", title: "신구대조표 만들기", desc: "고치기 전과 후 문서를 견줘 표로", min: 0 },
  { id: "search", group: "문서 찾기", title: "여러 문서에서 찾기", desc: "낱말이 나오는 문서와 쪽", min: 1 },
  { id: "tables", group: "문서 찾기", title: "표 뽑기", desc: "문서 속 표를 엑셀로", min: 1, skips: ["md", "txt", "csv", "image"] },
  { id: "images", group: "문서 찾기", title: "그림만 뽑기", desc: "문서에 든 그림을 폴더로", min: 1 },
  { id: "pdf", group: "형식 바꾸기", title: "PDF로", desc: "인쇄 모양 그대로 PDF로", min: 1, skips: ["pdf"] },
  { id: "hwpx", group: "형식 바꾸기", title: "한글로", desc: "PDF·워드·엑셀을 고칠 수 있는 한글 문서로", min: 1, skips: ["hwpx"] },
  { id: "stylecopy", group: "형식 바꾸기", title: "우리 서식으로 맞추기", desc: "내용은 두고 저장한 우리 기관 서식으로", min: 1, accepts: ["hwp", "hwpx", "pdf", "docx", "md", "txt"] },
  { id: "convert", group: "형식 바꾸기", title: "글로", desc: "문서 속 글만 꺼내 글 파일로", min: 1 },
  { id: "ocr", group: "형식 바꾸기", title: "스캔 읽기", desc: "그림·스캔 PDF 속 글자를 글로", min: 1, accepts: ["pdf", "image"] },
  { id: "watch", group: "폴더 지켜보기", title: "폴더 지켜보기", desc: "새 문서가 들어오면 글로 바꿈", min: 0 },
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
  /** 문서 수합: 부서 명단 (한 줄에 하나) */
  roster: string;
  /** 문서 수합: 독촉 글에 넣을 제출 기한 */
  deadline: string;
  /** 문서 수합: 서식이 다른 문서를 AI 로 뽑기 */
  gatherAi: boolean;
  printer: string;
  /** 우리 서식으로 맞추기: 저장한 서식 id */
  styleId: string;
  /** PDF 용량 줄이기: 첨부 한도·정도·쪽을 그림으로 */
  shrink: ShrinkChoice;
}

export const DEFAULT_OPTS: BatchOpts = {
  outDir: "",
  convertFormat: "md",
  // 정보공개 공개본: 작업대 가리기와 같은 기준(이름·주소까지)
  rules: DISCLOSURE_RULES,
  tablesFormat: "xlsx",
  watermark: "",
  pageNumbers: true,
  columns: "",
  query: "",
  template: "gian",
  templatePath: "",
  dataPath: "",
  nameColumn: "",
  roster: "",
  deadline: "",
  gatherAi: true,
  printer: "",
  styleId: "",
  shrink: DEFAULT_SHRINK,
};

export function accepts(def: TaskDef, f: DocFormat): boolean {
  return (!def.accepts || def.accepts.includes(f)) && !def.skips?.includes(f);
}
