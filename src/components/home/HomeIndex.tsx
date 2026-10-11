/** "무엇을 할까요?" 일 단위 목차 — 기능 이름보다 하려는 일로 길을 찾는다 */

import { ChevronRight } from "lucide-react";
import type { BatchTaskId, DraftKind, ToolId } from "../../state/app";

interface Props {
  onOpen: (tool?: ToolId, hwpxOnly?: boolean) => void;
  onCreate: (route: "library" | "blank" | "ai" | "convert", kind?: DraftKind) => void;
  onBatch: (task: BatchTaskId) => void;
  onCompare: () => void;
  onAsk: (tab?: "ask" | "rewrite") => void;
  onInbox: () => void;
}

export function HomeIndex({ onOpen, onCreate, onBatch, onCompare, onAsk, onInbox }: Props) {
  const groups: Array<{ n: string; title: string; desc: string; tasks: Array<[string, () => void, string?]> }> = [
    {
      n: "1.", title: "읽기·바꾸기", desc: "열어 보고 다른 형식으로",
      tasks: [
        ["문서 열어 보기", () => onOpen()],
        ["글만 뽑기", () => onOpen("export")],
        ["PDF로 내보내기", () => onOpen("export")],
        ["PDF·워드를 한글로", () => onCreate("convert")],
        ["스캔 문서 글자 읽기(OCR)", () => onBatch("ocr")],
      ],
    },
    {
      n: "2.", title: "만들기", desc: "서식만 고르면 공문서 완성",
      tasks: [
        ["받은 공문 기한 정리", onInbox],
        ["서식함에서 공문서 만들기", () => onCreate("library")],
        ["받은 공문에 회신하기", () => onCreate("ai", "reply")],
        ["메모를 보고서로", () => onCreate("ai", "memo")],
        ["AI로 초안 쓰기", () => onCreate("ai")],
        ["명부로 여러 장 만들기", () => onBatch("mailmerge")],
      ],
    },
    {
      n: "3.", title: "검토·보안", desc: "보내기 전에 확인",
      tasks: [
        ["공문서 표기법 검사", () => onOpen("review")],
        ["K팀장 검토(AI)", () => onOpen("review"), "결재 전 AI가 팀장 눈으로 고칠 곳 짚기"],
        ["개인정보 가리기", () => onOpen("redact")],
        ["도장 찍기", () => onOpen("seal", true)],
      ],
    },
    {
      n: "4.", title: "모으기·비교", desc: "여러 문서를 한 번에",
      tasks: [
        ["신구대조표 만들기", onCompare],
        ["결재용 합본 PDF", () => onBatch("bundle")],
        ["취합해서 엑셀로", () => onBatch("collect")],
        ["여러 문서에서 찾기", () => onBatch("search")],
      ],
    },
    {
      n: "5.", title: "AI에게 묻기", desc: "문서 내용으로 대화",
      tasks: [
        ["문서에 질문하기", () => onAsk("ask")],
        ["요약하기", () => onOpen("ai")],
        ["글 다듬기", () => onAsk("rewrite")],
        ["여러 문서에서 항목 뽑기", () => onBatch("extract")],
      ],
    },
  ];

  return (
    <section className="kd-index" aria-label="하려는 일">
      {groups.map((g) => (
        <div key={g.n} className="kd-index-col">
          <div className="kd-index-head">
            <span className="kd-index-n">{g.n}</span>
            <h2 className="kd-index-title">{g.title}</h2>
          </div>
          <p className="kd-index-desc">{g.desc}</p>
          <ul className="kd-index-links">
            {g.tasks.map(([label, act, hint]) => (
              <li key={label}>
                <button type="button" className="kd-index-link" onClick={act}>
                  <span>{label}{hint && <span className="kd-index-hint">{hint}</span>}</span>
                  <ChevronRight size={14} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
