/** 브라우저 미리보기용 가짜 내용 (실제 앱에서는 쓰지 않는다) */

import type { CompareResult, GongmunMeta, LintFinding, LlmCatalogItem, TemplateEntry } from "./contract";
import type { PageBlock } from "./mock-pages";

export const DOCS_DIR = "/Users/kim/Documents";

export const SAMPLE_FILES = [
  `${DOCS_DIR}/2026년 하반기 주요업무 추진계획.hwpx`,
  `${DOCS_DIR}/청사 시설 안전점검 결과 보고.hwp`,
  `${DOCS_DIR}/민원 처리 지침(개정).pdf`,
  `${DOCS_DIR}/10월 예산 집행 현황.xlsx`,
  `${DOCS_DIR}/주간 회의록_10월 2주.docx`,
];

export function hashOf(s: string): number {
  let h = 7;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}

/** 문서 이름으로 그럴듯한 공문 본문 블록 */
export function docBlocks(title: string, pages: number): PageBlock[] {
  const blocks: PageBlock[] = [
    { kind: "title", text: title },
    { kind: "meta", text: "2026. 10. 10. 총무과" },
    { kind: "h", text: "1. 추진 배경" },
    { kind: "li", text: "가. 하반기 핵심 과제를 부서별로 나누어 추진 일정과 책임자를 정한다." },
    { kind: "li", text: "나. 상반기 점검 결과 미흡했던 시설 안전, 민원 응대 분야를 우선 보완한다." },
    { kind: "h", text: "2. 추진 개요" },
    { kind: "li", text: "가. 기간: 2026. 10. 12.(월) ~ 12. 31.(목)" },
    { kind: "li", text: "나. 대상: 본청 12개 부서, 사업소 3곳" },
    { kind: "li", text: "다. 방법: 부서별 계획 제출, 월 1회 점검 회의" },
    { kind: "table", rows: [["구분", "과제", "담당 부서", "완료 시기"], ["1", "청사 안전점검", "총무과", "10월"], ["2", "민원 응대 개선", "민원봉사과", "11월"], ["3", "예산 조기 집행", "기획예산과", "12월"]] },
    { kind: "h", text: "3. 행정 사항" },
    { kind: "p", text: "각 부서는 추진 실적을 매월 말까지 총무과로 제출하고, 지연 과제는 사유와 보완 계획을 함께 적는다." },
  ];
  const filler: PageBlock[] = [
    { kind: "h", text: "4. 세부 추진 내용" },
    { kind: "p", text: "부서별 과제는 분기 목표와 월별 실적을 나누어 관리한다. 점검 회의에서는 지연 과제의 원인을 확인하고 필요하면 인력과 예산을 다시 배정한다." },
    { kind: "li", text: "가. 시설 분야: 소방 설비, 승강기, 전기 설비 정기 점검" },
    { kind: "li", text: "나. 민원 분야: 처리 기한 준수율, 친절도 조사 결과 반영" },
    { kind: "table", rows: [["월", "점검 항목", "결과", "비고"], ["10월", "소방 설비", "적합", ""], ["11월", "승강기", "보완", "부품 교체"], ["12월", "전기 설비", "예정", ""]] },
    { kind: "p", text: "점검 결과는 다음 달 첫 주에 공유하고, 보완이 필요한 항목은 담당자를 지정해 기한 안에 조치한다." },
  ];
  for (let i = 1; i < pages; i++) blocks.push(...filler);
  return blocks;
}

export function sampleMarkdown(title: string): string {
  return `# ${title}

**2026. 10. 10. 총무과**

## 1. 추진 배경

- 하반기 핵심 과제를 부서별로 나누어 추진 일정과 책임자를 정한다.
- 상반기 점검 결과 미흡했던 시설 안전, 민원 응대 분야를 우선 보완한다.

## 2. 추진 개요

| 구분 | 과제 | 담당 부서 | 완료 시기 |
|---|---|---|---|
| 1 | 청사 안전점검 | 총무과 | 10월 |
| 2 | 민원 응대 개선 | 민원봉사과 | 11월 |
| 3 | 예산 조기 집행 | 기획예산과 | 12월 |

## 3. 행정 사항

각 부서는 추진 실적을 매월 말까지 총무과로 제출하고, 지연 과제는 사유와 보완 계획을 함께 적는다.
`;
}

export const DRAFT_MD = `# 직원 안전교육 실시 계획

## 1. 목적
- 화재·지진 등 재난 상황에서 직원이 스스로 대피하고 민원인을 안내하도록 실전 교육을 한다.

## 2. 교육 개요
- 가. 일시: 2026. 10. 23.(금) 14:00~16:00
- 나. 장소: 본관 3층 대회의실
- 다. 대상: 전 직원 120명 (부서별 순환 참석)
- 라. 강사: 소방서 안전교육 담당관

## 3. 교육 내용
| 시간 | 내용 | 방법 |
|---|---|---|
| 14:00 | 화재 대피 요령 | 강의 |
| 15:00 | 소화기 사용 실습 | 실습 |

## 4. 행정 사항
- 부서별 참석 명단을 10. 19.(월)까지 총무과로 제출한다.
`;

export const SUMMARY_TEXT = `○ 하반기 주요업무는 시설 안전, 민원 응대, 예산 조기 집행 세 갈래로 추진한다.
○ 기간은 10월 13일부터 12월 31일까지이며, 본청 12개 부서와 사업소 3곳이 대상이다.
○ 부서는 매월 말 실적을 총무과에 내고, 지연 과제는 사유와 보완 계획을 함께 적는다. [1]`;

export const CHAT_ANSWER = `청사 안전점검은 총무과가 맡고 10월 안에 끝내는 것으로 되어 있습니다 [1]. 11월 승강기 점검에서는 부품 교체가 필요하다는 결과가 적혀 있습니다 [2].`;

export const COMPARE_ROWS: CompareResult["rows"] = [
  { type: "unchanged", old: "제1조(목적) 이 지침은 민원 처리 절차를 정한다.", new: "제1조(목적) 이 지침은 민원 처리 절차를 정한다." },
  { type: "modified", old: "제3조(처리 기한) 민원은 접수한 날부터 7일 안에 처리한다.", new: "제3조(처리 기한) 민원은 접수한 날부터 5일 안에 처리한다." },
  { type: "modified", old: "제4조(접수) 민원은 방문 또는 우편으로 접수한다.", new: "제4조(접수) 민원은 방문, 우편 또는 전자 문서로 접수한다." },
  { type: "added", old: "", new: "제4조의2(전자 접수) 전자 문서로 접수한 민원은 접수 즉시 담당자에게 알린다." },
  { type: "unchanged", old: "제5조(이송) 다른 기관 소관 민원은 지체 없이 이송한다.", new: "제5조(이송) 다른 기관 소관 민원은 지체 없이 이송한다." },
  { type: "removed", old: "제6조(보고) 처리 결과는 분기마다 기관장에게 보고한다.", new: "" },
  { type: "modified", old: "제7조(시행) 이 지침은 2025년 1월 1일부터 시행한다.", new: "제7조(시행) 이 지침은 2026년 11월 1일부터 시행한다." },
];

/** 아주 단순한 가짜 표기법 검사 (작성실·편집기 결과 흉내) */
export function fakeLint(text: string): LintFinding[] {
  const out: LintFinding[] = [];
  text.split(/\r?\n/).forEach((line, i) => {
    const date = /\b(20\d\d)\.(\d{1,2})\.(\d{1,2})\b/.exec(line);
    if (date) out.push({ rule: "날짜 표기", severity: "error", message: "날짜는 연·월·일 뒤에 마침표를 찍고 한 칸씩 띄워 씁니다.", line: i + 1, excerpt: date[0], suggestion: `${date[1]}. ${Number(date[2])}. ${Number(date[3])}.` });
    if (/하였음|하였슴/.test(line)) out.push({ rule: "문장 끝맺음", severity: "warning", message: "개조식 끝은 명사형으로 짧게 맺습니다.", line: i + 1, excerpt: "하였음", suggestion: "함" });
    const time = /(\d{1,2})시\s?(\d{1,2})분/.exec(line);
    if (time) out.push({ rule: "시각 표기", severity: "warning", message: "시각은 24시각제로 쌍점을 찍어 씁니다.", line: i + 1, excerpt: time[0], suggestion: `${time[1].padStart(2, "0")}:${time[2].padStart(2, "0")}` });
    if (/및\s*및|등등/.test(line)) out.push({ rule: "중복 표현", severity: "info", message: "같은 뜻의 말이 겹칩니다.", line: i + 1, excerpt: /및\s*및|등등/.exec(line)![0] });
  });
  return out;
}

export const GONGMUN_META: GongmunMeta = {
  kind_presets: { reply: "official", complaint: "official", minutes: "minutes", onepage: "report", press: "press", memo: "report" },
  presets: [
    { id: "official", label: "기안문", description: "대외 시행문·협조문. 법정 항목부호(1. 가. 1))와 끝 표시" },
    { id: "report", label: "보고서", description: "□ ○ - 개조식 보고서. 장 제목 띠와 쪽번호" },
    { id: "plan", label: "계획서", description: "추진 계획·기본계획. 장 제목 띠와 □ ○ - 항목" },
    { id: "notice", label: "통지·안내", description: "공고·알림·안내문. ㅇ 항목부호" },
    { id: "minutes", label: "회의록", description: "회의 결과 정리. 좁은 줄간격" },
    { id: "gaejosik", label: "개조식 보고서", description: "정부 표준 개조식. 표지·목차·로마숫자 장 머리 자동" },
    { id: "press", label: "보도자료", description: "보도시점·담당 표·부제가 있는 보도자료" },
    { id: "ministry", label: "업무보고", description: "중앙부처 업무보고. 장 띠·절 숫자칸·소제목 상자" },
    { id: "bangchim", label: "서울 방침서", description: "서울시 방침서. 제목표·파랑 부제·요약 상자" },
  ],
  agencies: ["공통", "행정안전부", "기획재정부", "교육부", "보건복지부", "서울특별시", "부산광역시", "경기도", "광진구", "성동구", "국민건강보험공단", "한국전력공사"],
  templates: [
    { id: "gian", name: "기안문 (일반)", description: "결재란·수신·제목·본문을 갖춘 표준 기안문", fields: ["수신", "제목", "본문", "붙임"] },
    { id: "gian-simple", name: "기안문 (간이)", description: "내부 결재용 짧은 기안문", fields: ["제목", "본문"] },
  ],
};

export const TEMPLATES: TemplateEntry[] = [
  { id: "gian", name: "기안문 (일반)", category: "기안문", source: "builtin", template: "gian", format: "hwpx", has_fields: true, field_count: 8, description: "행정업무운영 편람의 표준 기안문" },
  { id: "gian-simple", name: "기안문 (간이)", category: "기안문", source: "builtin", template: "gian-simple", format: "hwpx", has_fields: true, field_count: 4, description: "내부 결재용 간이 기안문" },
  { id: "starter-report", name: "보고서", category: "보고서", source: "starter", template: "report", format: "hwpx", has_fields: false, field_count: 0, description: "기관 서식에 맞춘 개조식 보고서" },
  { id: "starter-plan", name: "계획서", category: "보고서", source: "starter", template: "plan", format: "hwpx", has_fields: false, field_count: 0, description: "목적·개요·세부 내용·행정 사항" },
  { id: "starter-press", name: "보도자료", category: "보도자료", source: "starter", template: "press", format: "hwpx", has_fields: false, field_count: 0, description: "제목·부제·본문·문의처" },
  { id: "starter-minutes", name: "회의록", category: "회의록", source: "starter", template: "minutes", format: "hwpx", has_fields: false, field_count: 0, description: "일시·참석자·안건·결정 사항" },
  { id: "user-1", name: "가온시 행사 협조 요청", category: "공문", source: "user", path: `${DOCS_DIR}/서식/행사 협조 요청.hwpx`, format: "hwpx", has_fields: true, field_count: 6, description: "누름틀 6칸", added_at: "2026-10-02" },
  { id: "user-2", name: "출장 신청서", category: "서식", source: "user", path: `${DOCS_DIR}/서식/출장 신청서.hwp`, format: "hwp", has_fields: false, field_count: 0, description: "표 칸 채우기 서식", added_at: "2026-09-21" },
];

export const LLM_CATALOG: LlmCatalogItem[] = [
  { id: "qwen3-4b", name: "Qwen3 4B Instruct", file: "qwen3-4b-instruct-q4_k_m.gguf", size_gb: 2.5, ram_gb: 8, url: "", license: "Apache-2.0", description: "가벼운 PC 에 맞는 기본 모델. 요약·초안·다듬기에 충분합니다.", recommended: true, downloaded: true },
  { id: "gemma3-12b", name: "Gemma 3 12B", file: "gemma-3-12b-it-q4_k_m.gguf", size_gb: 7.3, ram_gb: 16, url: "", license: "Gemma", description: "메모리가 넉넉한 PC 용. 긴 문서 검토가 더 정확합니다.", downloaded: false },
];
