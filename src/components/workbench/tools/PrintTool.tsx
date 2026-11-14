/** 인쇄 — 고른 프린터로 이 문서 한 부를 바로 보낸다 (print_files: HWP·HWPX 는 rhwp 조판 PDF 로, PDF 는 그대로) */

import { useEffect, useState } from "react";
import { Printer } from "lucide-react";
import type { ToolProps } from "../ToolPanel";
import { rpc } from "../../../lib/rpc";
import { useApp } from "../../../state/app";
import { useTask } from "../../../hooks/useTask";
import { Button } from "../../ui/Button";
import { SelectField } from "../../common/Field";
import { ErrorLine, Note, Working } from "../../common/Status";

export function PrintTool({ doc, info }: ToolProps) {
  const easy = useApp().uiMode === "easy";
  const [printers, setPrinters] = useState<Array<{ name: string; isDefault: boolean }> | null>(null);
  const [picked, setPrinter] = useState("");
  // 쉬운 화면은 프린터 고르기를 숨기고 기본 프린터로 보낸다
  const printer = easy ? printers?.find((p) => p.isDefault)?.name ?? printers?.[0]?.name ?? "" : picked;
  const print = useTask<string>();

  // 목록을 읽지 못한 것은 프린터가 없는 것과 다르다: 기본 프린터로는 보낼 수 있으니 인쇄를 막지 않고, 다시 읽을 길을 둔다
  const [failed, setFailed] = useState(false);
  const load = () => {
    setFailed(false);
    rpc("list_printers", {}).then((list) => {
      setPrinters(list);
      setPrinter(list.find((p) => p.isDefault)?.name ?? list[0]?.name ?? "");
    }).catch(() => { setPrinters([]); setFailed(true); });
  };
  // 프린터 목록은 내보내기 탭을 처음 열 때 한 번
  useEffect(load, []);

  const doPrint = () => void print.run(async () => {
    const r = await rpc("print_files", { files: [doc.path], ...(printer ? { printer } : {}) });
    if (r.failed.length) throw new Error(r.failed[0].reason);
    return printer || "기본 프린터";
  });

  // 인쇄용 PDF 를 만드는 길(export_pdf 와 같다)이 아직 문서 암호를 받지 못한다
  if (info.encrypted) return <p className="kd-small kd-muted">암호가 걸린 문서는 아직 인쇄할 수 없습니다. 암호를 푼 사본을 저장해 여세요.</p>;

  return (
    <div className="flex flex-col gap-3">
      {printers && !printers.length && !failed ? <Note tone="info">이 PC에 연결된 프린터가 없습니다.</Note> : print.busy ? <Working label="인쇄를 준비하는 중" /> : (
        <>
          {failed && (
            <Note tone="warn">
              프린터 목록을 읽지 못했습니다. 인쇄를 누르면 기본 프린터로 보냅니다. <button type="button" className="kd-link" onClick={load}>다시 읽기</button>
            </Note>
          )}
          {printers && printers.length > 1 && (
            <div className="kd-adv"><SelectField label="프린터" value={picked} onChange={setPrinter} options={printers.map((p) => ({ value: p.name, label: p.isDefault ? `${p.name} (기본)` : p.name }))} /></div>
          )}
          <div><Button variant="secondary" disabled={!printers} onClick={doPrint} data-tip={`${easy || failed ? "기본" : "고른"} 프린터로 한 부를 바로 보냅니다. 여러 부나 양면은 PDF로 저장해 열어서 인쇄하세요.`}><Printer size={14} /> 인쇄</Button></div>
        </>
      )}
      <ErrorLine message={print.error} />
      {print.result && <Note tone="ok">인쇄를 보냈습니다: {print.result}</Note>}
    </div>
  );
}
