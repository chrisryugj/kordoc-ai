/** 오른쪽 도구 패널 — 업무 단계 탭 넷(읽기·고치기·검토·내보내기), 탭 안에 도구를 작은 제목 아래 차례로 쌓는다.
 *  doc_info 로 이 형식에서 쓸 수 있는 도구만 켠다. 한 번 연 탭은 숨겨 두고 살려 둔다.
 *  도구 id(ToolId)는 그대로라 다른 화면에서 "검토 열기" 같은 요청이 오면 그 탭을 열고 그 도구 자리로 내려간다 */

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { DocInfo } from "../../lib/contract";
import type { OpenDoc, ToolId } from "../../state/app";
import { isHangul } from "../../lib/format";
import { InfoTool } from "./tools/InfoTool";
import { ExportTool } from "./tools/ExportTool";
import { PrintTool } from "./tools/PrintTool";
import { AiTool } from "./tools/AiTool";
import { ReviewTool } from "./tools/ReviewTool";
import { RedactTool } from "./tools/RedactTool";
import { EditTool } from "./tools/EditTool";
import { TablesTool } from "./tools/TablesTool";
import { SealTool } from "./tools/SealTool";

export interface ToolProps {
  doc: OpenDoc;
  info: DocInfo;
}

/** 엔진의 이 도구들은 아직 문서 암호를 받지 못한다 (암호 문서는 보기·글자 수·글 내보내기만) */
const LOCKED = "암호가 걸린 문서에서는 아직 쓸 수 없습니다. 암호를 푼 사본을 저장해 여세요";
const locked = (i: DocInfo) => i.encrypted && LOCKED;

type GroupId = "read" | "fix" | "review" | "export";
type SectionId = ToolId | "print";
interface SectionDef { id: SectionId; title: string; off?: (i: DocInfo) => string | false }

const GROUPS: Array<{ id: GroupId; label: string; sections: SectionDef[] }> = [
  {
    id: "read", label: "읽기", sections: [
      { id: "info", title: "정보" },
      { id: "ai", title: "AI 요약·묻기", off: locked },
      { id: "tables", title: "표 뽑기", off: (i) => ((i.format === "image" || i.format === "txt") && "표가 없는 형식입니다") || locked(i) },
    ],
  },
  {
    id: "fix", label: "고치기", sections: [
      { id: "edit", title: "채우기·편집", off: (i) => (!isHangul(i.format) && "한글 문서(HWP·HWPX)에서 씁니다") || locked(i) },
      { id: "seal", title: "도장", off: (i) => (i.format !== "hwpx" && "HWPX 문서에서 씁니다") || locked(i) },
    ],
  },
  {
    id: "review", label: "검토", sections: [
      { id: "review", title: "결재 전 점검", off: locked },
      { id: "redact", title: "개인정보 가리기", off: locked },
    ],
  },
  {
    id: "export", label: "내보내기", sections: [
      { id: "export", title: "다른 형식으로 저장" },
      { id: "print", title: "인쇄" },
    ],
  },
];

const groupOf = (t: ToolId): GroupId => GROUPS.find((g) => g.sections.some((s) => s.id === t))!.id;
/** 탭 안 도구가 모두 꺼졌으면 탭도 끈다 (이유는 첫 도구의 것) */
const groupOff = (g: (typeof GROUPS)[number], i: DocInfo) => (g.sections.every((s) => s.off?.(i)) ? g.sections[0].off!(i) : false);

export function ToolPanel({ doc, info, tool, onTool, autoRun, onGoPage }: ToolProps & {
  tool: ToolId; onTool: (t: ToolId) => void; autoRun: { kind: "summarize" | "redact"; nonce: number } | null; onGoPage: (page: number) => void;
}) {
  const asked = GROUPS.find((g) => g.id === groupOf(tool))!;
  const current: GroupId = groupOff(asked, info) ? "read" : asked.id;
  // 한 번 연 탭은 다른 탭에 다녀와도 그대로 (요약·대화·검토 결과와 진행 중인 요청이 남는다)
  const [opened, setOpened] = useState<GroupId[]>([current]);
  if (!opened.includes(current)) setOpened([...opened, current]);
  const bodyRef = useRef<HTMLDivElement>(null);

  // 다른 화면에서 도구를 콕 집어 열면(예: 개인정보 가리기) 탭 안에서 그 도구 자리로
  useEffect(() => {
    if (tool === GROUPS.find((g) => g.id === current)!.sections[0].id) { bodyRef.current?.scrollTo({ top: 0 }); return; }
    const el = bodyRef.current?.querySelector<HTMLElement>(`[data-tool="${tool}"]`);
    if (el && bodyRef.current) bodyRef.current.scrollTo({ top: el.offsetTop - 8, behavior: "smooth" });
  }, [tool, current, autoRun?.nonce]);

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const tabs = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>("[role=tab]:not(:disabled)"));
    const i = tabs.indexOf(document.activeElement as HTMLButtonElement);
    const next = tabs[(i + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length];
    next?.focus();
    next?.click();
  };

  const render = (id: SectionId): ReactNode => {
    switch (id) {
      case "info": return <InfoTool doc={doc} info={info} />;
      case "export": return <ExportTool doc={doc} info={info} />;
      case "print": return <PrintTool doc={doc} info={info} />;
      case "ai": return <AiTool doc={doc} info={info} autoSummary={autoRun?.kind === "summarize" ? autoRun.nonce : 0} onGoPage={onGoPage} />;
      case "review": return <ReviewTool doc={doc} info={info} onGoPage={onGoPage} />;
      case "redact": return <RedactTool doc={doc} info={info} autoPreview={autoRun?.kind === "redact" ? autoRun.nonce : 0} />;
      case "edit": return <EditTool doc={doc} info={info} />;
      case "tables": return <TablesTool doc={doc} info={info} />;
      case "seal": return <SealTool doc={doc} info={info} />;
    }
  };

  return (
    <aside className="kd-tools" aria-label="도구">
      <div className="kd-tabs kd-tooltabs" role="tablist" aria-label="도구 고르기" onKeyDown={onKey}>
        {GROUPS.map((g) => {
          const off = groupOff(g, info);
          return (
            <button key={g.id} type="button" role="tab" className="kd-tab" aria-selected={current === g.id} disabled={!!off} data-group={g.id}
              title={off || undefined} tabIndex={current === g.id ? 0 : -1} onClick={() => onTool(g.sections.find((s) => !s.off?.(info))!.id as ToolId)}>
              {g.label}
            </button>
          );
        })}
      </div>
      <div className="kd-tool-body" role="tabpanel" ref={bodyRef}>
        {GROUPS.filter((g) => opened.includes(g.id) && !groupOff(g, info)).map((g) => (
          <div key={g.id} hidden={g.id !== current}>
            {g.sections.map((s) => {
              const off = s.off?.(info);
              return (
                <section key={s.id} className="kd-tool-sec" data-tool={s.id} aria-label={s.title}>
                  <h3 className="kd-tool-sec-h">{s.title}</h3>
                  {off ? <p className="kd-small kd-muted">{off}</p> : render(s.id)}
                </section>
              );
            })}
          </div>
        ))}
      </div>
    </aside>
  );
}
