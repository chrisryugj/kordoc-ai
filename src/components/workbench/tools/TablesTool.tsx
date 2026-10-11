/** 표 — 문서 속 표를 엑셀·CSV·마크다운으로 (자료표/배치표 구분) */

import { useState } from "react";
import { Table2 } from "lucide-react";
import type { ToolProps } from "../ToolPanel";
import type { TablesResult } from "../../../lib/contract";
import { rpc } from "../../../lib/rpc";
import { useTask } from "../../../hooks/useTask";
import { Button } from "../../ui/Button";
import { Check, Field, Seg } from "../../common/Field";
import { ErrorLine, Note, SavedFile, Working } from "../../common/Status";

const KIND = { data: { label: "자료표", tone: "ok" }, layout: { label: "배치용 표", tone: "" }, uncertain: { label: "판단 보류", tone: "warn" } } as const;

export function TablesTool({ doc, info }: ToolProps) {
  const [format, setFormat] = useState<"xlsx" | "csv" | "md">("xlsx");
  const [onlyData, setOnlyData] = useState(true);
  const [pages, setPages] = useState("");
  const task = useTask<TablesResult>();

  const run = () => void task.run(() => rpc("tables_extract", { path: doc.path, format, only_data: onlyData, ...(pages.trim() ? { pages: pages.trim() } : {}) }));

  return (
    <div className="flex flex-col gap-4">
      <Field label="저장 형식">
        <Seg label="표 저장 형식" value={format} onChange={setFormat} options={[{ value: "xlsx", label: "엑셀" }, { value: "csv", label: "CSV" }, { value: "md", label: "마크다운" }]} />
      </Field>
      <Check label="자료가 든 표만" desc="결재란·글상자처럼 배치에만 쓴 표는 뺍니다" checked={onlyData} onChange={setOnlyData} />
      {!!info.page_count && info.page_count > 1 && (
        <Field label="쪽 범위" hint="비우면 전체">
          <input className="kd-input" value={pages} onChange={(e) => setPages(e.target.value)} placeholder="전체" aria-label="쪽 범위" />
        </Field>
      )}
      {task.busy ? <Working label="표를 찾는 중" /> : <Button size="lg" onClick={run}><Table2 size={15} /> 표 뽑기</Button>}
      <ErrorLine message={task.error} />
      {task.result && (
        <div className="flex flex-col gap-3">
          {task.result.tables.length === 0 && <Note tone="info">표를 찾지 못했습니다.</Note>}
          {task.result.output_path && <SavedFile path={task.result.output_path} label={`표 ${task.result.tables.length}개를 저장했습니다`} />}
          {task.result.tables.map((t) => (
            <div key={t.index} className="kd-inset p-2.5">
              <div className="mb-2 flex flex-wrap items-center gap-1.5">
                <span className="kd-small font-semibold">표 {t.index}</span>
                {t.page != null && <span className="kd-small kd-muted">{t.page}쪽</span>}
                <span className="kd-small kd-muted kd-num">{t.rows}행 {t.cols}열</span>
                <span className="kd-badge" data-tone={KIND[t.kind].tone || undefined}>{KIND[t.kind].label}</span>
              </div>
              <div className="overflow-x-auto">
                <table className="kd-table kd-table-mini">
                  <tbody>
                    {t.preview.slice(0, 4).map((row, r) => (
                      <tr key={r}>{row.slice(0, 5).map((c, ci) => (r === 0 ? <th key={ci}>{c}</th> : <td key={ci}>{c}</td>))}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
