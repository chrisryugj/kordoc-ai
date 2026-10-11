/** 서식 옵션 — 기관 서식·표지·결재란·목차·쪽 번호·끝 표시·견본 서식 학습 */

import { ChevronDown, FileUp, X } from "lucide-react";
import { useGongmunMeta } from "../../hooks/useGongmunMeta";
import { FILTERS, pickFiles } from "../../lib/native";
import { baseName } from "../../lib/format";
import { Check, Field, SelectField } from "../common/Field";

export interface FormatOpts {
  agency: string;
  cover: boolean;
  coverOrg: string;
  coverDate: string;
  approval: string;
  toc: boolean;
  pageNumbers: boolean;
  endMark: boolean;
  levelsFrom: string;
  profileFrom: string;
}

function FilePick({ label, hint, value, onChange }: { label: string; hint: string; value: string; onChange: (v: string) => void }) {
  return (
    <Field label={label} hint={hint}>
      <div className="kd-inset flex items-center gap-2 px-2.5 py-1.5">
        <span className="kd-path flex-1">{value ? baseName(value) : "쓰지 않음"}</span>
        {value && <button type="button" className="kd-icon-btn" style={{ width: 26, height: 26 }} onClick={() => onChange("")} aria-label={`${label} 빼기`}><X size={13} /></button>}
        <button type="button" className="kd-link kd-small flex-none" onClick={() => void pickFiles({ multiple: false, filters: FILTERS.hwpx }).then((p) => p[0] && onChange(p[0]))}>
          <FileUp size={12} className="inline -mt-0.5" /> 고르기
        </button>
      </div>
    </Field>
  );
}

export function FormatOptions({ value, onChange, open, onToggle }: { value: FormatOpts; onChange: (v: FormatOpts) => void; open: boolean; onToggle: () => void }) {
  const meta = useGongmunMeta();
  const set = <K extends keyof FormatOpts>(k: K, v: FormatOpts[K]) => onChange({ ...value, [k]: v });
  const summary = [value.agency || "공통 서식", value.approval ? `결재 ${value.approval.split(",").filter((s) => s.trim()).length}칸` : "", value.cover ? "표지" : "", value.toc ? "목차" : "", value.levelsFrom ? "견본 학습" : ""].filter(Boolean).join(" · ");

  return (
    <section className="kd-fold" data-open={open}>
      <button type="button" className="kd-fold-head" aria-expanded={open} onClick={onToggle}>
        <span className="kd-h3">서식 옵션</span>
        <span className="kd-small kd-muted flex-1 text-left">{summary}</span>
        <ChevronDown size={16} className="kd-fold-chev" />
      </button>
      {open && (
        <div className="kd-fold-body">
          <div className="kd-form-row">
            <SelectField label="기관 서식" value={value.agency} onChange={(v) => set("agency", v)}
              options={[{ value: "", label: "공통 서식" }, ...(meta?.agencies ?? []).filter((a) => a !== "공통").map((a) => ({ value: a, label: a }))]} />
            <Field label="결재란" hint="직위를 쉼표로 구분. 비우면 결재란 없음">
              <input className="kd-input" value={value.approval} onChange={(e) => set("approval", e.target.value)} placeholder="담당, 팀장, 과장" aria-label="결재란 직위" />
            </Field>
          </div>
          <div className="kd-checkrow">
            <Check label="표지" checked={value.cover} onChange={(v) => set("cover", v)} />
            <Check label="목차" checked={value.toc} onChange={(v) => set("toc", v)} />
            <Check label="쪽 번호" checked={value.pageNumbers} onChange={(v) => set("pageNumbers", v)} />
            <Check label="끝 표시" desc="본문 끝에 “끝.”" checked={value.endMark} onChange={(v) => set("endMark", v)} />
          </div>
          {value.cover && (
            <div className="kd-form-row">
              <Field label="표지 기관명"><input className="kd-input" value={value.coverOrg} onChange={(e) => set("coverOrg", e.target.value)} aria-label="표지 기관명" /></Field>
              <Field label="표지 날짜"><input className="kd-input" value={value.coverDate} onChange={(e) => set("coverDate", e.target.value)} aria-label="표지 날짜" /></Field>
            </div>
          )}
          <div className="kd-form-row">
            <FilePick label="견본 서식 학습" hint="우리 기관 문서를 고르면 항목 기호 단계별 글꼴·크기를 따라 합니다" value={value.levelsFrom} onChange={(v) => set("levelsFrom", v)} />
            <FilePick label="표 서식 참고" hint="표 테두리·칸 색을 이 문서처럼" value={value.profileFrom} onChange={(v) => set("profileFrom", v)} />
          </div>
        </div>
      )}
    </section>
  );
}
