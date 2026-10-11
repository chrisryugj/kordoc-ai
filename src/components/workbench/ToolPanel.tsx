/** 오른쪽 도구 패널 — doc_info 로 이 형식에서 쓸 수 있는 도구만 켠다. 한 번 연 도구는 숨겨 두고 살려 둔다 */

import { useState, type KeyboardEvent, type ReactNode } from "react";
import type { DocInfo } from "../../lib/contract";
import type { OpenDoc, ToolId } from "../../state/app";
import { isHangul } from "../../lib/format";
import { InfoTool } from "./tools/InfoTool";
import { ExportTool } from "./tools/ExportTool";
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

const TOOLS: Array<{ id: ToolId; label: string; off?: (i: DocInfo) => string | false }> = [
  { id: "info", label: "정보" },
  { id: "export", label: "내보내기" },
  { id: "ai", label: "AI", off: locked },
  { id: "review", label: "검토", off: locked },
  { id: "redact", label: "개인정보", off: locked },
  { id: "edit", label: "채우기·편집", off: (i) => (!isHangul(i.format) && "한글 문서(HWP·HWPX)에서 씁니다") || locked(i) },
  { id: "tables", label: "표", off: (i) => ((i.format === "image" || i.format === "txt") && "표가 없는 형식입니다") || locked(i) },
  { id: "seal", label: "도장", off: (i) => (i.format !== "hwpx" && "HWPX 문서에서 씁니다") || locked(i) },
];

export function ToolPanel({ doc, info, tool, onTool, autoRun, onGoPage }: ToolProps & {
  tool: ToolId; onTool: (t: ToolId) => void; autoRun: { kind: "summarize" | "redact"; nonce: number } | null; onGoPage: (page: number) => void;
}) {
  const current = TOOLS.find((t) => t.id === tool && !t.off?.(info)) ? tool : "info";
  // 한 번 연 도구는 다른 탭에 다녀와도 그대로 (요약·대화·검토 결과와 진행 중인 요청이 남는다)
  const [opened, setOpened] = useState<ToolId[]>([current]);
  if (!opened.includes(current)) setOpened([...opened, current]);

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const tabs = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>("[role=tab]:not(:disabled)"));
    const i = tabs.indexOf(document.activeElement as HTMLButtonElement);
    const next = tabs[(i + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length];
    next?.focus();
    next?.click();
  };

  const render = (id: ToolId): ReactNode => {
    switch (id) {
      case "info": return <InfoTool doc={doc} info={info} />;
      case "export": return <ExportTool doc={doc} info={info} />;
      case "ai": return <AiTool doc={doc} info={info} autoSummary={autoRun?.kind === "summarize" ? autoRun.nonce : 0} onGoPage={onGoPage} />;
      case "review": return <ReviewTool doc={doc} info={info} />;
      case "redact": return <RedactTool doc={doc} info={info} autoPreview={autoRun?.kind === "redact" ? autoRun.nonce : 0} />;
      case "edit": return <EditTool doc={doc} info={info} />;
      case "tables": return <TablesTool doc={doc} info={info} />;
      case "seal": return <SealTool doc={doc} info={info} />;
    }
  };

  return (
    <aside className="kd-tools" aria-label="도구">
      <div className="kd-tabs kd-tooltabs" role="tablist" aria-label="도구 고르기" onKeyDown={onKey}>
        {TOOLS.map((t) => {
          const off = t.off?.(info);
          return (
            <button key={t.id} type="button" role="tab" className="kd-tab" aria-selected={current === t.id} disabled={!!off}
              title={off || undefined} tabIndex={current === t.id ? 0 : -1} onClick={() => onTool(t.id)}>
              {t.label}
            </button>
          );
        })}
      </div>
      <div className="kd-tool-body" role="tabpanel">
        {TOOLS.filter((t) => opened.includes(t.id) && !t.off?.(info)).map((t) => (
          <div key={t.id} hidden={t.id !== current}>{render(t.id)}</div>
        ))}
      </div>
    </aside>
  );
}
