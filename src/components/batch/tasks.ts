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
  /** 쉬운 화면에서는 목록에 안 보임 (전체 화면에서만) */
  adv?: boolean;
  /** AI 연결이 있어야 하는 일 (꺼져 있으면 "AI 필요" 표시) */
  ai?: boolean;
}

export const TASKS: TaskDef[] = [
  { id: "join", group: "합치기·나누기", title: "하나로 합치기", desc: "한글은 HWPX 한 파일로, 그 밖은 PDF 한 권으로", min: 2 },
  { id: "split", group: "합치기·나누기", title: "나누기", desc: "한글은 구역·쪽 나눔마다, PDF는 쪽마다", min: 1, accepts: ["hwp", "hwpx", "pdf"] },
  { id: "bundle", group: "합치기·나누기", title: "합본 PDF", desc: "결재 첨부용. 모든 형식을 PDF 한 권으로, 쪽 번호·워터마크를 넣어", min: 1 },
  { id: "merge", group: "합치기·나누기", title: "한 문서로 합치기", desc: "차례·방식을 골라 같은 형식 한 파일로, 섞이면 글(.md)로 이어 붙임", min: 2, adv: true },
  // 한글 나누기(hwpsplit)·PDF 쪽 다루기(pdftools)는 나누기와 겹쳐 목록에서 뺐다. 옛 주소는 startBatch 가 나누기·PDF 작업으로 보낸다
  { id: "collect", group: "모으기", title: "문서 수합", desc: "제출물을 엑셀 한 장으로, 미제출 부서·독촉 글까지", min: 1 },
  { id: "extract", group: "모으기", title: "항목 뽑기(AI)", desc: "서식이 제각각인 문서에서 같은 항목을 표로", min: 1, adv: true, ai: true },
  { id: "mailmerge", group: "만들기", title: "명부로 여러 장 만들기", desc: "양식 하나에 명부 한 줄씩", min: 0, adv: true },
  { id: "receipt", group: "만들기", title: "영수증으로 지출조서", desc: "영수증 사진·PDF 여러 장을 읽어 지출조서 한 장으로", min: 1, accepts: ["image", "pdf"] },
  { id: "redact", group: "가리기", title: "개인정보 가리기", desc: "주민번호·전화번호 등을 가린 사본", min: 1 },
  { id: "shrink", group: "줄이기·인쇄하기", title: "PDF 용량 줄이기", desc: "첨부 한도에 맞게, 글자는 그대로", min: 1, skips: ["md", "txt", "csv", "image"] },
  { id: "print", group: "줄이기·인쇄하기", title: "한꺼번에 인쇄", desc: "고른 프린터로 바로", min: 1, adv: true },
  { id: "compare", group: "비교하기", title: "신구대조표 만들기", desc: "고치기 전과 후 문서를 견줘 표로", min: 0 },
  { id: "search", group: "찾기·뽑기", title: "여러 문서에서 찾기", desc: "낱말이 나오는 문서와 쪽", min: 1, adv: true },
  { id: "tables", group: "찾기·뽑기", title: "표 뽑기", desc: "문서 속 표를 엑셀로", min: 1, skips: ["md", "txt", "csv", "image"], adv: true },
  { id: "images", group: "찾기·뽑기", title: "그림만 뽑기", desc: "문서에 든 그림을 폴더로", min: 1, adv: true },
  { id: "pdf", group: "바꾸기", title: "PDF로", desc: "인쇄 모양 그대로 PDF로", min: 1, skips: ["pdf"] },
  { id: "hwpx", group: "바꾸기", title: "한글로", desc: "PDF·워드·엑셀을 고칠 수 있는 한글 문서로", min: 1, skips: ["hwpx"] },
  { id: "stylecopy", group: "바꾸기", title: "우리 서식으로 맞추기", desc: "내용은 두고 저장한 우리 기관 서식으로", min: 1, accepts: ["hwp", "hwpx", "pdf", "docx", "md", "txt"], adv: true },
  { id: "convert", group: "바꾸기", title: "글로", desc: "문서 속 글만 꺼내 글 파일로", min: 1, adv: true },
  { id: "ocr", group: "바꾸기", title: "스캔 읽기", desc: "그림·스캔 PDF 속 글자를 글로", min: 1, accepts: ["pdf", "image"], adv: true },
  { id: "watch", group: "지켜보기", title: "폴더 지켜보기", desc: "새 문서가 들어오면 글로 바꿈", min: 0, adv: true },
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
  /** 한글 나누기: 알아서(구역이 여럿이면 구역마다, 하나면 쪽 나눔마다)·구역마다·쪽 나눔마다 */
  splitMode: "auto" | "section" | "pagebreak";
  /** 나누기(PDF): 쪽마다·몇 쪽씩 */
  pdfSplit: "each" | "every";
  pdfEvery: number;
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
  splitMode: "auto",
  pdfSplit: "each",
  pdfEvery: 2,
};

export function accepts(def: TaskDef, f: DocFormat): boolean {
  return (!def.accepts || def.accepts.includes(f)) && !def.skips?.includes(f);
}

const isHangul = (f: DocFormat) => f === "hwp" || f === "hwpx";
const KIND: Partial<Record<DocFormat, string>> = { hwp: "한글", hwpx: "한글", pdf: "PDF", docx: "워드", xlsx: "엑셀", image: "그림" };

/** 하나로 합치기: 모두 한글이면 HWPX 한 파일, 아니면 PDF 한 권 */
export const joinTo = (formats: DocFormat[]): "hwpx" | "pdf" => (formats.length && formats.every(isHangul) ? "hwpx" : "pdf");

/** 하나로 합치기·나누기의 결과 모양 한 줄 (파일이 없거나 모자라면 빈 글) */
export function resultLine(task: BatchTaskId, formats: DocFormat[], o: Pick<BatchOpts, "pdfSplit" | "pdfEvery">): string {
  if (task === "join") {
    if (formats.length < 2) return "";
    const kinds = [...new Set(formats.map((f) => KIND[f] ?? "문서"))].join("·");
    return joinTo(formats) === "hwpx"
      ? `한글 파일 ${formats.length}개 → HWPX 한 파일로 합칩니다`
      : `${kinds} 파일 ${formats.length}개 → PDF 한 권으로 합칩니다`;
  }
  if (task === "split") {
    const h = formats.filter(isHangul).length;
    const p = formats.filter((f) => f === "pdf").length;
    const parts = [
      h && `한글 파일 ${h}개 → 구역·쪽 나눔마다 HWPX`,
      p && `PDF ${p}개 → ${o.pdfSplit === "each" ? "쪽마다" : `${o.pdfEvery}쪽씩`} PDF`,
    ].filter(Boolean);
    return parts.length ? `${parts.join(", ")} 여러 개로 나눕니다` : "";
  }
  return "";
}
