/** 한꺼번에 — 고른 할 일의 옵션 */

import { FileUp, FolderOpen, ListChecks } from "lucide-react";
import type { BatchTaskId } from "../../state/app";
import type { RedactRule } from "../../lib/contract";
import { useApp } from "../../state/app";
import { FILTERS, pickFiles, pickFolder } from "../../lib/native";
import { baseName } from "../../lib/format";
import { Button } from "../ui/Button";
import { Check, Field, Seg, SelectField } from "../common/Field";
import { ErrorLine, Note, StatusLine } from "../common/Status";
import { RuleChecks } from "../workbench/tools/RedactTool";
import type { BatchOpts } from "./tasks";

const NO_OUTPUT: BatchTaskId[] = ["search", "pdftools", "watch"];

export interface CollectState {
  fields: Array<{ label: string; count: number }> | null;
  busy: boolean;
  error: string;
  load: () => void;
}

export function TaskOptions({ task, opts, set, fileCount, collect }: {
  task: BatchTaskId; opts: BatchOpts; set: (p: Partial<BatchOpts>) => void; fileCount: number; collect: CollectState;
}) {
  const { settings } = useApp();

  return (
    <div className="flex flex-col gap-3.5">
      {task === "convert" && (
        <Field label="형식"><Seg label="바꿀 형식" value={opts.convertFormat} onChange={(v) => set({ convertFormat: v })} options={[{ value: "md", label: "글(마크다운)" }, { value: "html", label: "HTML" }, { value: "txt", label: "글만" }]} /></Field>
      )}
      {task === "hwpx" && (
        <p className="kd-small kd-muted">문서마다 모양을 보고 서식을 맞춥니다(공문은 기안문, □○ 항목은 보고서 등). 애매하면 글·표만 옮기고, 옛 HWP는 서식 그대로 옮깁니다.</p>
      )}
      {task === "tables" && (
        <Field label="저장 형식"><Seg label="표 저장 형식" value={opts.tablesFormat} onChange={(v) => set({ tablesFormat: v })} options={[{ value: "xlsx", label: "엑셀" }, { value: "csv", label: "CSV" }, { value: "md", label: "마크다운" }]} /></Field>
      )}
      {task === "redact" && (
        <Field label="가릴 것"><RuleChecks rules={new Set(opts.rules)} onChange={(r) => set({ rules: [...r] as RedactRule[] })} /></Field>
      )}
      {task === "bundle" && (
        <>
          <p className="kd-small kd-muted">아래 파일 목록 순서대로 이어 붙입니다. 끌거나 위·아래 단추로 순서를 바꾸세요.</p>
          <div className="flex flex-wrap items-end gap-4">
            <div style={{ width: 160 }}>
              <SelectField label="워터마크" value={opts.watermark} onChange={(v) => set({ watermark: v })} options={[{ value: "", label: "없음" }, { value: "대외비", label: "대외비" }, { value: "사본", label: "사본" }, { value: "공개용", label: "공개용" }]} />
            </div>
            <Check label="쪽 번호 넣기" checked={opts.pageNumbers} onChange={(v) => set({ pageNumbers: v })} />
          </div>
        </>
      )}
      {(task === "merge" || task === "pdftools") && <p className="kd-small kd-muted">시작을 누르면 순서와 방식을 고르는 창이 열립니다.</p>}
      {task === "collect" && (
        <div className="flex flex-col gap-2">
          {collect.busy ? <StatusLine tone="busy">문서들에서 칸 이름을 찾는 중</StatusLine> : (
            <div><Button variant="secondary" size="sm" disabled={fileCount < 2} onClick={collect.load}><ListChecks size={13} /> 칸 찾기</Button></div>
          )}
          <ErrorLine message={collect.error} />
          {collect.fields && (
            collect.fields.length === 0 ? <Note tone="info">공통 칸을 찾지 못했습니다. 같은 서식으로 받은 문서인지 확인하세요.</Note> : (
              <>
                <div className="flex items-center justify-between gap-2">
                  <span className="kd-label">엑셀 열로 쓸 칸 ({opts.collectFields.length}/{collect.fields.length})</span>
                  <button type="button" className="kd-link kd-small" onClick={() => set({ collectFields: opts.collectFields.length === collect.fields!.length ? [] : collect.fields!.map((f) => f.label) })}>
                    {opts.collectFields.length === collect.fields.length ? "모두 해제" : "모두 고르기"}
                  </button>
                </div>
                <div className="kd-rulegrid">
                  {collect.fields.map((f) => (
                    <Check key={f.label} label={f.label} desc={`문서 ${f.count}개에 있음`} checked={opts.collectFields.includes(f.label)}
                      onChange={(v) => set({ collectFields: v ? [...opts.collectFields, f.label] : opts.collectFields.filter((x) => x !== f.label) })} />
                  ))}
                </div>
              </>
            )
          )}
        </div>
      )}
      {task === "extract" && (
        <Field label="뽑을 항목" hint="쉼표로 나눠 쓰세요. 문서마다 한 줄, 항목마다 한 열이 됩니다">
          <input className="kd-input" value={opts.columns} onChange={(e) => set({ columns: e.target.value })} placeholder="행사명, 일시, 장소, 담당자, 예산" aria-label="뽑을 항목" />
        </Field>
      )}
      {task === "search" && (
        <Field label="찾을 낱말" hint="Enter를 누르면 바로 찾습니다">
          <input className="kd-input" value={opts.query} onChange={(e) => set({ query: e.target.value })} placeholder="예: 안전점검" aria-label="찾을 낱말" data-run-on-enter />
        </Field>
      )}
      {task === "mailmerge" && (
        <div className="flex flex-col gap-3">
          <Field label="양식" hint="내장 기안문을 쓰거나 우리 기관 HWPX 양식을 고르세요">
            <div className="flex flex-wrap items-center gap-2">
              <Seg label="양식" value={opts.templatePath ? "mine" : opts.template} onChange={(v) => (v === "mine" ? void pickFiles({ multiple: false, filters: FILTERS.hwpx }).then((p) => p[0] && set({ templatePath: p[0] })) : set({ template: v, templatePath: "" }))}
                options={[{ value: "gian", label: "일반 기안문" }, { value: "gian-simple", label: "간이 기안문" }, { value: "mine", label: "내 양식" }]} />
              {opts.templatePath && <span className="kd-path">{baseName(opts.templatePath)}</span>}
            </div>
          </Field>
          <Field label="명부" hint="엑셀·CSV 첫 줄이 칸 이름, 그 아래 한 줄이 문서 한 장">
            <div className="kd-inset flex items-center gap-2 px-3 py-2">
              <span className="kd-path flex-1">{opts.dataPath ? baseName(opts.dataPath) : "아직 고르지 않았습니다"}</span>
              <Button variant="secondary" size="sm" onClick={() => void pickFiles({ multiple: false, filters: FILTERS.roster }).then((p) => p[0] && set({ dataPath: p[0] }))}><FileUp size={13} /> 명부 고르기</Button>
            </div>
          </Field>
          <div style={{ maxWidth: 260 }}>
            <Field label="파일 이름에 쓸 열" hint="예: 성명. 비우면 1, 2, 3 순번"><input className="kd-input" value={opts.nameColumn} onChange={(e) => set({ nameColumn: e.target.value })} aria-label="파일 이름에 쓸 열" /></Field>
          </div>
        </div>
      )}

      {!NO_OUTPUT.includes(task) && (
        <Field label="저장할 곳">
          <div className="kd-inset flex items-center gap-2 px-3 py-2">
            <FolderOpen size={14} className="kd-muted flex-none" />
            <span className="kd-path flex-1">{opts.outDir || settings?.convert.output_dir || "원본 파일 옆"}</span>
            {opts.outDir && <button type="button" className="kd-link kd-small kd-hit32 flex-none" onClick={() => set({ outDir: "" })}>원래대로</button>}
            <button type="button" className="kd-link kd-small kd-hit32 flex-none" onClick={() => void pickFolder().then((d) => d && set({ outDir: d }))}>바꾸기</button>
          </div>
        </Field>
      )}
    </div>
  );
}
