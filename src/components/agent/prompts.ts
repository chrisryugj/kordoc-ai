/**
 * AI에게 맡길 수 있는 일 — 예시 문장 목록. 작업 에이전트 도구(엔진 core/agent-tools)로 실제 되는 일만 적는다.
 * ○ 는 사용자가 채울 자리(넣으면 첫 ○ 를 골라 둔다). files: 파일을 붙여야 하는 일(최소 개수).
 */

export interface PromptItem { title: string; text: string; files?: number }
export interface PromptGroup { id: string; label: string; items: PromptItem[] }

export const PROMPTS: PromptGroup[] = [
  {
    id: "write", label: "작성",
    items: [
      { title: "회신 기안문", text: "붙인 공문에 회신하는 기안문을 써 줘. 참가 인원은 ○명이야.", files: 1 },
      { title: "메모로 보고서", text: "아래 메모를 개조식 보고서 한글 문서로 써 줘.\n○" },
      { title: "서식 빈칸 채우기", text: "붙인 서식의 빈칸을 채워 줘. 행사명은 ○, 일시는 ○, 장소는 ○이야.", files: 1 },
      { title: "명부로 여러 장", text: "붙인 명부 엑셀로 붙인 양식을 사람마다 한 장씩 만들어 줘.", files: 2 },
    ],
  },
  {
    id: "check", label: "점검",
    items: [
      { title: "결재 전 점검", text: "붙인 문서를 결재 전 점검하고, 고칠 수 있는 건 고쳐 줘.", files: 1 },
      { title: "법령 인용 확인", text: "붙인 문서에 인용한 법령 조문이 현행 법령과 맞는지 확인해 줘.", files: 1 },
      { title: "신구대조표", text: "붙인 두 문서를 비교해서 바뀐 곳을 신구대조표로 만들어 줘.", files: 2 },
      { title: "최종본 찾기", text: "붙인 문서의 최종본을 찾고, 바로 앞 판과 무엇이 바뀌었는지 알려 줘.", files: 1 },
    ],
  },
  {
    id: "convert", label: "변환",
    items: [
      { title: "PDF로 저장", text: "붙인 문서를 PDF로 만들어 줘.", files: 1 },
      { title: "한글 문서로", text: "붙인 PDF를 고칠 수 있는 한글 문서로 바꿔 줘.", files: 1 },
      { title: "결재 합본 PDF", text: "붙인 문서들을 차례대로 결재용 PDF 한 권으로 묶어 줘.", files: 2 },
      { title: "PDF 용량 줄이기", text: "붙인 PDF 용량을 ○MB 안으로 줄여 줘.", files: 1 },
      { title: "개인정보 가리기", text: "붙인 문서의 개인정보를 가린 공개용 사본을 만들어 줘.", files: 1 },
    ],
  },
  {
    id: "gather", label: "취합·찾기",
    items: [
      { title: "제출물 취합", text: "붙인 부서 제출물을 엑셀 한 장으로 모으고, 안 낸 부서가 있으면 독촉 글도 써 줘. 부서 명단은 ○야.", files: 1 },
      { title: "표를 엑셀로", text: "붙인 문서에 있는 표를 엑셀로 뽑아 줘.", files: 1 },
      { title: "문서 찾기", text: "붙인 폴더에서 '○'가 나오는 문서와 쪽을 찾아 줘.", files: 1 },
      { title: "핵심 요약", text: "붙인 문서의 핵심을 세 줄로 요약하고, 일정과 담당 부서를 표로 정리해 줘.", files: 1 },
    ],
  },
];
