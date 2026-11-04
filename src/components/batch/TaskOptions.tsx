/** 여러 파일 한꺼번에: 고른 할 일의 옵션 */

import { FolderOpen } from "lucide-react";
import type { BatchTaskId } from "../../state/app";
import type { DocFormat, RedactRule } from "../../lib/contract";
import { useApp } from "../../state/app";
import { pickFolder } from "../../lib/native";
import { baseName } from "../../lib/format";
import { Check, Field, Seg, SelectField } from "../common/Field";
import { RuleChecks } from "../workbench/tools/RedactTool";
import { StyleTaskOptions } from "../create/StyleCopyParts";
import type { BatchOpts } from "./tasks";
import { GatherOptions } from "./GatherOptions";
import { PrintOptions } from "./PrintOptions";
import { MailMergeOptions } from "./MailMerge";
import { ShrinkOptions } from "../workbench/tools/ShrinkTool";
import { ReceiptTaskOptions } from "../receipt/ReceiptTaskOptions";

const NO_OUTPUT: BatchTaskId[] = ["search", "pdftools", "watch", "print", "compare"];
type SetOpts = (p: Partial<BatchOpts>) => void;

function HangulSplit({ opts, set }: { opts: BatchOpts; set: SetOpts }) {
  return (
    <Field label="한글 나누는 곳">
      <div className="self-start" data-tip="자동: 구역이 여럿이면 구역마다, 하나면 쪽 나눔(Ctrl+Enter)마다. 서식은 그대로, 결과는 HWPX">
        <Seg label="한글 나누는 곳" value={opts.splitMode} onChange={(v) => set({ splitMode: v })} options={[{ value: "auto", label: "자동" }, { value: "section", label: "구역마다" }, { value: "pagebreak", label: "쪽 나눔마다" }]} />
      </div>
    </Field>
  );
}

function PdfSplit({ opts, set }: { opts: BatchOpts; set: SetOpts }) {
  return (
    <fieldset className="kd-batch-radios">
      <legend className="kd-label">PDF 나누는 방법</legend>
      <label className="kd-check">
        <input type="radio" name="batch-pdf-split" checked={opts.pdfSplit === "each"} onChange={() => set({ pdfSplit: "each" })} />
        <span>쪽마다<span className="kd-row-desc block">한 쪽이 PDF 한 개</span></span>
      </label>
      <label className="kd-check">
        <input type="radio" name="batch-pdf-split" checked={opts.pdfSplit === "every"} onChange={() => set({ pdfSplit: "every" })} />
        <span>몇 쪽씩<span className="kd-row-desc block">정한 쪽 수만큼 묶어 PDF 한 개</span></span>
      </label>
      {opts.pdfSplit === "every" && (
        <label className="kd-batch-every kd-small">
          <input className="kd-input" type="number" min={1} value={opts.pdfEvery} aria-label="몇 쪽씩"
            onChange={(e) => set({ pdfEvery: Math.max(1, Math.floor(Number(e.target.value) || 1)) })} />
          쪽씩
        </label>
      )}
    </fieldset>
  );
}

export function TaskOptions({ task, opts, set, formats = [] }: {
  task: BatchTaskId; opts: BatchOpts; set: SetOpts;
  /** 넣은 파일 형식 (나누기: 있는 형식의 설정만) */
  formats?: DocFormat[];
}) {
  const hangul = !formats.length || formats.some((x) => x === "hwp" || x === "hwpx");
  const pdf = !formats.length || formats.includes("pdf");
  const { settings } = useApp();

  return (
    <div className="flex flex-col gap-3.5">
      {task === "convert" && (
        <Field label="형식"><Seg label="바꿀 형식" value={opts.convertFormat} onChange={(v) => set({ convertFormat: v })} options={[{ value: "md", label: "제목·표 살린 글" }, { value: "html", label: "웹 페이지" }, { value: "txt", label: "글자만" }]} /></Field>
      )}
      {task === "hwpx" && (
        <p className="kd-small kd-muted">문서마다 모양을 보고 서식을 맞춥니다(공문은 기안문, □○ 항목은 보고서 등). 애매하면 글·표만 옮기고, 옛 HWP는 서식 그대로 옮깁니다.</p>
      )}
      {task === "stylecopy" && <StyleTaskOptions styleId={opts.styleId} onChange={(id) => set({ styleId: id })} />}
      {task === "tables" && (
        <Field label="저장 형식"><Seg label="표 저장 형식" value={opts.tablesFormat} onChange={(v) => set({ tablesFormat: v })} options={[{ value: "xlsx", label: "엑셀" }, { value: "csv", label: "CSV" }, { value: "md", label: "글(마크다운)" }]} /></Field>
      )}
      {task === "redact" && (
        <Field label="가릴 것"><RuleChecks rules={new Set(opts.rules)} onChange={(r) => set({ rules: [...r] as RedactRule[] })} /></Field>
      )}
      {task === "bundle" && (
        <>
          <p className="kd-small kd-muted">위 목록 차례대로 붙입니다. 끌어서 차례를 바꿉니다.</p>
          <div className="flex flex-wrap items-end gap-4">
            <div style={{ width: 160 }}>
              <SelectField label="워터마크" value={opts.watermark} onChange={(v) => set({ watermark: v })} options={[{ value: "", label: "없음" }, { value: "대외비", label: "대외비" }, { value: "사본", label: "사본" }, { value: "공개용", label: "공개용" }]} />
            </div>
            <Check label="쪽 번호 넣기" checked={opts.pageNumbers} onChange={(v) => set({ pageNumbers: v })} />
          </div>
        </>
      )}
      {task === "merge" && <p className="kd-small kd-muted">시작을 누르면 순서와 방식을 고르는 창이 열립니다.</p>}
      {task === "hwpsplit" && <HangulSplit opts={opts} set={set} />}
      {task === "split" && hangul && <HangulSplit opts={opts} set={set} />}
      {task === "split" && pdf && <PdfSplit opts={opts} set={set} />}
      {task === "join" && <p className="kd-small kd-muted">위 목록 차례대로 붙입니다. 끌어서 차례를 바꿉니다.</p>}
      {task === "pdftools" && <p className="kd-small kd-muted">시작을 누르면 넣은 파일을 PDF 작업 화면에 놓습니다. 한글·워드·그림도 PDF로 바꿔 넣습니다.</p>}
      {task === "shrink" && <ShrinkOptions value={opts.shrink} onChange={(shrink) => set({ shrink })} />}
      {task === "collect" && <GatherOptions opts={opts} set={set} />}
      {task === "print" && <PrintOptions value={opts.printer} onChange={(printer) => set({ printer })} />}
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
      {task === "mailmerge" && <MailMergeOptions opts={opts} set={set} />}
      {task === "receipt" && <ReceiptTaskOptions />}

      {!NO_OUTPUT.includes(task) && (
        <Field label="저장할 곳">
          <div className="kd-inset flex items-center gap-2 px-3 py-2">
            <FolderOpen size={14} className="kd-muted flex-none" />
            <span className="kd-path flex-1" title={opts.outDir || settings?.convert.output_dir || undefined}>{(opts.outDir || settings?.convert.output_dir) ? baseName(opts.outDir || settings!.convert.output_dir) : "원본 파일 옆"}</span>
            {opts.outDir && <button type="button" className="kd-link kd-small kd-hit32 flex-none" onClick={() => set({ outDir: "" })}>원래대로</button>}
            <button type="button" className="kd-link kd-small kd-hit32 flex-none" onClick={() => void pickFolder().then((d) => d && set({ outDir: d }))}>바꾸기</button>
          </div>
        </Field>
      )}
    </div>
  );
}
