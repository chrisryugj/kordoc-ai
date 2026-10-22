/** PDF 용량 줄이기 — 결재 첨부 한도에 맞춰 그림을 줄인다(글자는 그대로). 서무 도구(여러 파일)도 ShrinkOptions 를 같이 쓴다 */

import { useState } from "react";
import { FileDown } from "lucide-react";
import type { ToolProps } from "../ToolPanel";
import type { PdfShrinkLevel, RpcResult } from "../../../lib/contract";
import { rpc } from "../../../lib/rpc";
import { useTask } from "../../../hooks/useTask";
import { Button } from "../../ui/Button";
import { Check, Field, Seg } from "../../common/Field";
import { ErrorLine, Note, SavedFile, Working } from "../../common/Status";

export interface ShrinkChoice {
  /** 첨부 한도(MB) — 빈 칸이면 한도 없이 고른 단계만 */
  limit: string;
  level: PdfShrinkLevel;
  raster: boolean;
}

export const DEFAULT_SHRINK: ShrinkChoice = { limit: "", level: "normal", raster: false };
const LIMITS = ["", "5", "10", "20"];

/** 엔진 호출 인자 */
export function shrinkParams(c: ShrinkChoice): { level?: PdfShrinkLevel; target_mb?: number; allow_raster?: boolean } {
  const mb = Number(c.limit);
  return mb > 0 ? { target_mb: mb, allow_raster: c.raster } : { level: c.level };
}

export const sizeText = (b: number) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(b < 10 * 1024 * 1024 ? 1 : 0)}MB` : `${Math.max(1, Math.round(b / 1024))}KB`);

export function ShrinkOptions({ value, onChange }: { value: ShrinkChoice; onChange: (v: ShrinkChoice) => void }) {
  // 직접 입력은 지우는 중에도(빈 칸·10) 입력 칸을 그대로 둔다 — 값으로만 정하면 빈 칸이 "정하지 않음"으로 넘어간다
  const [custom, setCustom] = useState(!LIMITS.includes(value.limit));
  const preset = custom ? "custom" : value.limit;
  const set = (p: Partial<ShrinkChoice>) => onChange({ ...value, ...p });
  const limited = Number(value.limit) > 0;
  const badLimit = custom && !limited;
  return (
    <>
      <Field label="첨부 한도" hint={badLimit ? "한도를 MB 숫자로 넣으세요. 예: 15" : limited ? "한도 안에 들 때까지 가볍게부터 차례로 줄입니다. 한도는 기관 전자결재 첨부 기준에 맞춰 고르세요." : "한도를 고르면 그 안에 들 때까지 알아서 줄입니다."}>
        <Seg label="첨부 한도" value={preset} onChange={(v) => {
          setCustom(v === "custom");
          set({ limit: v === "custom" ? (LIMITS.includes(value.limit) ? "15" : value.limit) : v });
        }}
          options={[{ value: "", label: "정하지 않음" }, ...LIMITS.slice(1).map((m) => ({ value: m, label: `${m}MB` })), { value: "custom", label: "직접" }]} />
        {custom && (
          <div className="mt-2 flex items-center gap-2">
            <input className="kd-input" style={{ width: 100 }} inputMode="decimal" value={value.limit} onChange={(e) => set({ limit: e.target.value.replace(/[^\d.]/g, "") })} aria-label="첨부 한도(MB)" aria-invalid={badLimit || undefined} />
            <span className="kd-small kd-muted">MB</span>
          </div>
        )}
      </Field>
      {!limited && (
        <Field label="얼마나 줄일까요?" hint={value.level === "light" ? "그림을 거의 그대로 두고 조금만 줄입니다." : value.level === "normal" ? "화면·인쇄로 보기에 무리 없는 정도로 줄입니다." : "그림이 조금 거칠어져도 크게 줄입니다."}>
          <Seg label="줄이는 정도" value={value.level} onChange={(v) => set({ level: v })} options={[{ value: "light", label: "가볍게" }, { value: "normal", label: "보통" }, { value: "strong", label: "강하게" }]} />
        </Field>
      )}
      {limited && (
        <Check label="그래도 넘으면 쪽을 그림으로 바꿔서라도 줄이기" desc="이렇게 줄인 PDF는 글자를 복사하거나 찾을 수 없습니다." checked={value.raster} onChange={(v) => set({ raster: v })} />
      )}
    </>
  );
}

/** 결과 한 줄 — "6.8MB → 3.1MB (55% 줄임)" */
export function shrinkSummary(r: RpcResult<"pdf_shrink">): string {
  const cut = r.before_bytes ? Math.round((1 - r.after_bytes / r.before_bytes) * 100) : 0;
  return `${sizeText(r.before_bytes)} → ${sizeText(r.after_bytes)}${cut > 0 ? ` (${cut}% 줄임)` : ""}`;
}

export function ShrinkTool({ doc, info }: ToolProps) {
  const [choice, setChoice] = useState<ShrinkChoice>(DEFAULT_SHRINK);
  const task = useTask<RpcResult<"pdf_shrink">>();
  const r = task.result;
  const run = () => void task.run(({ signal, onProgress }) => rpc("pdf_shrink", { path: doc.path, ...shrinkParams(choice) }, { signal, onProgress }));

  return (
    <div className="flex flex-col gap-4">
      <p className="kd-small kd-muted text-pretty">결재 첨부 한도에 맞춰 PDF 속 그림을 줄입니다. 글자·표는 그대로라 복사·검색이 됩니다.</p>
      {info.format !== "pdf" && <p className="kd-small kd-muted">이 문서는 PDF로 바꾼 뒤 줄입니다.</p>}
      <ShrinkOptions value={choice} onChange={(v) => { setChoice(v); task.reset(); }} />
      {task.busy ? <Working label="용량을 줄이는 중" progress={task.progress} onCancel={task.cancel} /> : (
        <div><Button onClick={run}><FileDown size={14} /> 용량 줄이기</Button></div>
      )}
      <ErrorLine message={task.error} />
      {r && (r.output_path ? (
        <>
          <SavedFile path={r.output_path} label={`용량을 줄인 PDF를 저장했습니다: ${shrinkSummary(r)}`} />
          {r.under_target === false && <Note tone="warn">{r.note}</Note>}
          {!r.text_kept && r.under_target !== false && <Note tone="info">쪽을 그림으로 바꿔 줄였습니다. 이 PDF는 글자를 복사하거나 찾을 수 없습니다.</Note>}
        </>
      ) : <Note tone="info">{r.note}</Note>)}
    </div>
  );
}
