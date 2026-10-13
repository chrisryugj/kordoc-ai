/**
 * 명부로 여러 장 — 옵션(양식·명부·짝 미리보기)과 결과(줄마다 실패 이유·합치기·합본 PDF·한꺼번에 인쇄).
 * 짝은 엔진 mail_merge_plan 이 열마다 실제로 채워 보고 잰 것이라 실제 결과와 같다.
 */

import { useEffect, useState } from "react";
import { Combine, FileText, FileUp, Printer } from "lucide-react";
import type { RpcResult } from "../../lib/contract";

type MailMergePlan = RpcResult<"mail_merge_plan">;
import { rpc, errorText } from "../../lib/rpc";
import { FILTERS, pickFiles } from "../../lib/native";
import { baseName, joinPath } from "../../lib/format";
import { useTask } from "../../hooks/useTask";
import { Button } from "../ui/Button";
import { Field, Seg, SelectField } from "../common/Field";
import { ErrorLine, Note, SavedFile, StatusLine, Working } from "../common/Status";
import type { BatchOpts } from "./tasks";

const BUILTIN: Record<string, string> = { gian: "일반 기안문", "gian-simple": "간이 기안문" };

export function MailMergeOptions({ opts, set }: { opts: BatchOpts; set: (p: Partial<BatchOpts>) => void }) {
  const [plan, setPlan] = useState<MailMergePlan | null>(null);
  const [planError, setPlanError] = useState("");
  const [planBusy, setPlanBusy] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const [orgOpen, setOrgOpen] = useState(false);

  // 양식이나 명부가 바뀌면 짝을 다시 잰다
  useEffect(() => {
    setPlan(null);
    setPlanError("");
    if (!opts.dataPath) return;
    let stop = false;
    setPlanBusy(true);
    rpc("mail_merge_plan", { data_path: opts.dataPath, ...(opts.templatePath ? { template_path: opts.templatePath } : { template: opts.template }) })
      .then((p) => {
        if (stop) return;
        setPlan(p);
        // 다른 명부로 바꿔서 없는 열이 된 파일 이름 열은 비운다 (순번)
        if (opts.nameColumn && !p.columns.some((c) => c.name === opts.nameColumn)) set({ nameColumn: "" });
      }, (e) => { if (!stop) setPlanError(errorText(e)); })
      .finally(() => { if (!stop) setPlanBusy(false); });
    return () => { stop = true; };
    // 양식·명부가 바뀔 때만 (이름 열은 그때의 값으로 본다)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.dataPath, opts.template, opts.templatePath]);

  const pickMine = async () => {
    const p = await pickFiles({ multiple: false, filters: FILTERS.hwpx });
    if (p[0]) { setCancelled(false); set({ templatePath: p[0] }); }
    else if (!opts.templatePath) setCancelled(true);
  };

  const used = plan?.fields.filter((f) => f.column) ?? [];
  const fromOrg = plan?.fields.filter((f) => !f.column && f.org) ?? [];
  const blank = plan?.fields.filter((f) => !f.column && !f.org) ?? [];
  const extra = plan?.columns.filter((c) => !c.fields.length) ?? [];
  const sampleOf = (col: string) => plan?.columns.find((c) => c.name === col)?.sample;

  return (
    <div className="flex flex-col gap-3">
      <Field label="양식" hint="내장 기안문을 쓰거나 우리 기관 HWPX 양식을 고르세요">
        <div className="flex flex-wrap items-center gap-2">
          <Seg label="양식" value={opts.templatePath ? "mine" : opts.template} onChange={(v) => (v === "mine" ? void pickMine() : (setCancelled(false), set({ template: v, templatePath: "" })))}
            options={[{ value: "gian", label: "일반 기안문" }, { value: "gian-simple", label: "간이 기안문" }, { value: "mine", label: "내 양식" }]} />
          {opts.templatePath && <span className="kd-path">{baseName(opts.templatePath)}</span>}
        </div>
      </Field>
      {cancelled && !opts.templatePath && (
        <Note tone="info">양식 파일을 고르지 않아 {BUILTIN[opts.template] ?? "내장 기안문"}을 그대로 씁니다. 우리 기관 양식을 쓰려면 내 양식을 다시 누르고 HWPX 파일을 고르세요.</Note>
      )}
      <Field label="명부" hint="엑셀·CSV 첫 줄이 칸 이름, 그 아래 한 줄이 문서 한 장">
        <div className="kd-inset flex items-center gap-2 px-3 py-2">
          <span className="kd-path flex-1">{opts.dataPath ? baseName(opts.dataPath) : "아직 고르지 않았습니다"}</span>
          <Button variant="secondary" size="sm" onClick={() => void pickFiles({ multiple: false, filters: FILTERS.roster }).then((p) => p[0] && set({ dataPath: p[0] }))}><FileUp size={13} /> 명부 고르기</Button>
        </div>
      </Field>

      {planBusy && <StatusLine tone="busy">명부 열과 양식 칸을 맞춰 보는 중</StatusLine>}
      <ErrorLine message={planError} />
      {plan && (
        <section className="kd-inset flex flex-col gap-2.5 p-3" aria-label="명부 열과 양식 칸 짝">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="kd-label">어느 열이 어느 칸에 들어가나</h3>
            <span className="kd-small kd-muted kd-num">명부 {plan.rows}줄 → 문서 {plan.rows}장</span>
          </div>
          {!used.length ? (
            <Note tone="err">명부 열 이름이 양식 칸과 하나도 맞지 않습니다. 명부 첫 줄을 양식 칸 이름({plan.fields.slice(0, 4).map((f) => f.name).join(", ")} 등)으로 고친 뒤 명부를 다시 고르세요.</Note>
          ) : (
            <table className="kd-table">
              <thead><tr><th>양식 칸</th><th>채울 값</th></tr></thead>
              <tbody>
                {used.map((f) => (
                  <tr key={f.name}><td>{f.name}</td><td>명부 &apos;{f.column}&apos; 열{sampleOf(f.column!) ? <span className="kd-muted"> (예: {sampleOf(f.column!)})</span> : null}</td></tr>
                ))}
                {/* 기관 정보 칸은 많아서 접어 둔다 */}
                {(orgOpen ? fromOrg : []).map((f) => (
                  <tr key={f.name}><td>{f.name}</td><td>내 기관 정보 <span className="kd-muted">({f.org})</span></td></tr>
                ))}
              </tbody>
            </table>
          )}
          {used.length > 0 && fromOrg.length > 0 && (
            <button type="button" className="kd-link kd-small self-start" aria-expanded={orgOpen} onClick={() => setOrgOpen((o) => !o)}>
              {orgOpen ? "내 기관 정보로 채우는 칸 접기" : `내 기관 정보로 채우는 칸 ${fromOrg.length}개 보기 (${fromOrg.slice(0, 3).map((f) => f.name).join(", ")} 등)`}
            </button>
          )}
          {blank.length > 0 && <p className="kd-small kd-muted">비워 두는 칸 {blank.length}개: {blank.map((f) => f.name).join(", ")}</p>}
          {extra.length > 0 && <Note tone="warn">양식에 같은 이름 칸이 없어 쓰지 않는 명부 열: {extra.map((c) => `'${c.name}'`).join(", ")}. 넣으려면 명부 첫 줄을 양식 칸 이름으로 고치세요.</Note>}
          {plan.rejected.length > 0 && <Note tone="warn">양식 여러 곳에 같은 이름 칸이 있어 다른 칸을 덮지 않으려고 넣지 않는 열: {plan.rejected.map((c) => `'${c}'`).join(", ")}</Note>}
        </section>
      )}

      <div style={{ maxWidth: 260 }}>
        {plan ? (
          <SelectField label="파일 이름에 쓸 열" value={plan.columns.some((c) => c.name === opts.nameColumn) ? opts.nameColumn : ""} onChange={(v) => set({ nameColumn: v })}
            options={[{ value: "", label: "순번 (1, 2, 3)" }, ...plan.columns.map((c) => ({ value: c.name, label: c.name }))]} />
        ) : (
          <Field label="파일 이름에 쓸 열" hint="예: 성명. 비우면 1, 2, 3 순번"><input className="kd-input" value={opts.nameColumn} onChange={(e) => set({ nameColumn: e.target.value })} aria-label="파일 이름에 쓸 열" /></Field>
        )}
      </div>
    </div>
  );
}

/** 결과 — 만든 폴더, 줄마다 실패 이유, 이어서 할 일 (한 파일로 합치기·합본 PDF·한꺼번에 인쇄) */
export function MailMergeResult({ message, result }: { message: string; result: RpcResult<"mail_merge"> }) {
  const { outputs, failed, output_dir: dir, rejected } = result;
  const merge = useTask<string>();
  const pdf = useTask<{ output_path: string; page_count: number }>();
  const print = useTask<string>();
  const [printer, setPrinter] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const folder = baseName(dir);

  useEffect(() => {
    if (!outputs.length) return;
    rpc("list_printers", {}).then((l) => setPrinter(l.find((p) => p.isDefault)?.name ?? l[0]?.name ?? ""), () => setPrinter(""));
  }, [outputs.length]);

  return (
    <div className="flex flex-col gap-3">
      {dir ? <SavedFile path={dir} folder label={message} /> : <Note tone="warn">{message}</Note>}
      {failed.length > 0 && (
        <div className="kd-inset p-3">
          <h3 className="kd-label mb-1.5">만들지 못한 줄 {failed.length}개</h3>
          <ul className="flex flex-col gap-1">
            {failed.map((f) => <li key={f.row} className="kd-small"><b className="kd-num">명부 {f.row}행</b>: {f.error}</li>)}
          </ul>
        </div>
      )}
      {(rejected?.length ?? 0) > 0 && <Note tone="warn">양식 여러 곳에 같은 이름 칸이 있어 넣지 않은 열: {rejected!.map((c) => `'${c}'`).join(", ")}. 그 칸은 문서를 열어 직접 채우세요.</Note>}

      {outputs.length > 1 && (
        <section className="flex flex-col gap-2" aria-label="이어서 할 일">
          <h3 className="kd-label">만든 {outputs.length}장으로 이어서</h3>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" disabled={merge.busy} onClick={() => void merge.run(async ({ signal }) => {
              const out = joinPath(dir, `${folder}_합친 문서.hwpx`);
              await rpc("merge_files", { files: outputs, output_path: out, mode: "native" }, { signal });
              return out;
            })}><Combine size={13} /> 한 파일로 합치기</Button>
            <Button variant="secondary" size="sm" disabled={pdf.busy} onClick={() => void pdf.run(({ signal, onProgress }) => rpc("bundle_pdf", { paths: outputs, output_path: joinPath(dir, `${folder}_합본.pdf`), page_numbers: false }, { signal, onProgress }))}>
              <FileText size={13} /> 합본 PDF
            </Button>
            <Button variant="secondary" size="sm" disabled={print.busy || printer === null || confirm} onClick={() => setConfirm(true)}><Printer size={13} /> 한꺼번에 인쇄</Button>
          </div>
          {confirm && (
            printer === "" ? <Note tone="info">이 PC에 연결된 프린터가 없습니다. 합본 PDF로 만들어 다른 PC에서 인쇄하세요.</Note> : (
              <div className="kd-inset flex flex-wrap items-center gap-2 px-3 py-2">
                <span className="kd-small flex-1">{outputs.length}장을 {printer}(으)로 한 부씩 보냅니다.</span>
                <Button size="sm" onClick={() => { setConfirm(false); void print.run(async () => {
                  const r = await rpc("print_files", { files: outputs, ...(printer ? { printer } : {}) });
                  if (r.failed.length && !r.queued) throw new Error(r.failed[0].reason);
                  return `${r.queued}장을 보냈습니다${r.failed.length ? `, ${r.failed.length}장은 보내지 못했습니다(${r.failed[0].reason})` : ""}`;
                }); }}>보내기</Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>취소</Button>
              </div>
            )
          )}
          {merge.busy && <Working label="한 파일로 합치는 중" onCancel={merge.cancel} />}
          <ErrorLine message={merge.error} />
          {merge.result && <SavedFile path={merge.result} label="한 파일로 합쳤습니다" />}
          {pdf.busy && <Working label="합본 PDF를 만드는 중" progress={pdf.progress} onCancel={pdf.cancel} />}
          <ErrorLine message={pdf.error} />
          {pdf.result && <SavedFile path={pdf.result.output_path} label={`${pdf.result.page_count}쪽짜리 합본 PDF를 만들었습니다`} />}
          {print.busy && <Working label="프린터로 보내는 중" />}
          <ErrorLine message={print.error} />
          {print.result && <Note tone="ok">{print.result}</Note>}
        </section>
      )}
    </div>
  );
}
