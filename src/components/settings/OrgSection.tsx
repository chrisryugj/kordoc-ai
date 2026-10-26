/** 가. 내 기관 정보 — 서식 칸 자동 채움·공문 머리와 끝·결재란·도장에 쓴다 */

import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, ImagePlus, Plus, Save, X } from "lucide-react";
import type { Settings } from "../../lib/contract";
import { useApp } from "../../state/app";
import { rpc } from "../../lib/rpc";
import { FILTERS, pickFiles } from "../../lib/native";
import { baseName } from "../../lib/format";
import { useGongmunMeta } from "../../hooks/useGongmunMeta";
import { orgCorpusChanged } from "../../hooks/useOrgCorpus";
import { Button } from "../ui/Button";
import { Field, Section, SelectField, TextField } from "../common/Field";
import { lockProps, useLocked } from "./PolicyLock";
import { UnsavedBadge, useDirtyMark } from "./dirty";

type Org = Settings["org"];

export function ApprovalLine({ value, onChange, disabled }: { value: string[]; onChange: (v: string[]) => void; disabled?: boolean }) {
  const [add, setAdd] = useState("");
  const move = (i: number, d: number) => { const n = [...value]; [n[i], n[i + d]] = [n[i + d], n[i]]; onChange(n); };
  return (
    <div className="flex flex-col gap-2">
      <ol className="kd-approval">
        {value.map((p, i) => (
          <li key={`${p}-${i}`} className="kd-approval-item">
            <span className="kd-order-n kd-num">{i + 1}</span>
            <span className="flex-1 text-sm font-semibold">{p}</span>
            {!disabled && <>
            <button type="button" className="kd-icon-btn" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`${p} 앞으로`}><ChevronUp size={14} /></button>
            <button type="button" className="kd-icon-btn" disabled={i === value.length - 1} onClick={() => move(i, 1)} aria-label={`${p} 뒤로`}><ChevronDown size={14} /></button>
            <button type="button" className="kd-icon-btn" onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label={`${p} 빼기`}><X size={13} /></button>
            </>}
          </li>
        ))}
      </ol>
      {!disabled && <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (add.trim()) { onChange([...value, add.trim()]); setAdd(""); } }}>
        <input className="kd-input" style={{ maxWidth: 200 }} value={add} onChange={(e) => setAdd(e.target.value)} placeholder="직위 (예: 국장)" aria-label="결재 직위 더하기" />
        <Button type="submit" variant="secondary" disabled={!add.trim()}><Plus size={14} /> 더하기</Button>
      </form>}
    </div>
  );
}

export function SealPreview({ path }: { path: string }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    if (!path) { setSrc(""); return; }
    rpc("read_file_b64", { path }).then((r) => setSrc(`data:image/${/\.jpe?g$/i.test(path) ? "jpeg" : "png"};base64,${r.data_b64}`)).catch(() => setSrc(""));
  }, [path]);
  return <div className="kd-seal-preview">{src ? <img src={src} alt="관인·서명 그림" /> : <span className="kd-small kd-muted">없음</span>}</div>;
}

export function OrgSection() {
  const { settings, saveSettings, toast } = useApp();
  const meta = useGongmunMeta();
  const [org, setOrg] = useState<Org>(settings!.org);
  const lk = useLocked();
  const lp = (label: string, k: keyof Org) => lockProps(label, lk(`org.${k}`));
  const [saving, setSaving] = useState(false);
  // 저장된 내 기관 정보가 바뀔 때만 입력을 맞춘다 (다른 구획을 저장해도 여기 고치던 것은 남는다)
  const savedOrg = JSON.stringify(settings!.org);
  useEffect(() => { setOrg(JSON.parse(savedOrg) as Org); }, [savedOrg]);
  const set = <K extends keyof Org>(k: K, v: Org[K]) => setOrg((o) => ({ ...o, [k]: v }));
  const dirty = JSON.stringify(org) !== JSON.stringify(settings!.org);

  const save = async () => {
    setSaving(true);
    const ok = !!(await saveSettings({ org }));
    if (ok) { toast("내 기관 정보를 저장했습니다", "success"); orgCorpusChanged(); } // 기안문 견본 표어는 기관 이름이 같을 때만
    setSaving(false);
    return ok;
  };
  useDirtyMark("set-org", "내 기관 정보", dirty, save, () => setOrg(JSON.parse(savedOrg) as Org));

  return (
    <Section id="set-org" mark="가." title="내 기관 정보" sub="서식의 기관명·부서·담당자·전화 칸과 공문 머리·끝, 결재란, 도장에 자동으로 들어갑니다. 이 PC에만 저장됩니다."
      aside={<>{dirty && <UnsavedBadge />}<Button onClick={() => void save()} disabled={!dirty || saving}><Save size={14} /> {saving ? "저장하는 중" : "저장"}</Button></>}>
      <div className="kd-fieldgrid">
        <TextField {...lp("기관명", "name")} value={org.name} onChange={(v) => set("name", v)} placeholder="예: 가온시" />
        <TextField {...lp("부서", "dept")} value={org.dept} onChange={(v) => set("dept", v)} placeholder="예: 총무과" />
        <TextField {...lp("직위", "position")} value={org.position} onChange={(v) => set("position", v)} placeholder="예: 주무관" />
        <TextField {...lp("이름", "person")} value={org.person} onChange={(v) => set("person", v)} />
        <TextField {...lp("전화", "phone")} value={org.phone} onChange={(v) => set("phone", v)} placeholder="02-000-0000" />
        <TextField {...lp("팩스", "fax")} value={org.fax} onChange={(v) => set("fax", v)} />
        <TextField {...lp("전자우편", "email")} value={org.email} onChange={(v) => set("email", v)} />
        <TextField {...lp("누리집", "homepage")} value={org.homepage} onChange={(v) => set("homepage", v)} />
        <div className="kd-span2"><TextField {...lp("주소", "address")} value={org.address} onChange={(v) => set("address", v)} /></div>
        <TextField {...lp("문서번호 앞부분", "doc_number_prefix")} hint="예: 총무과-" value={org.doc_number_prefix} onChange={(v) => set("doc_number_prefix", v)} />
        <SelectField {...lp("기관 서식", "agency")} hint="글꼴·여백·머리글을 기관 방식대로" value={org.agency} onChange={(v) => set("agency", v)}
          options={[{ value: "", label: "공통 서식" }, ...(meta?.agencies ?? []).filter((a) => a !== "공통").map((a) => ({ value: a, label: a }))]} />
      </div>
      <div className="mt-5 grid gap-6" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
        <Field label={lp("결재선", "approval_line").label} hint="결재란에 왼쪽부터 이 순서로 들어갑니다">
          <ApprovalLine value={org.approval_line} onChange={(v) => set("approval_line", v)} disabled={lk("org.approval_line")} />
        </Field>
        <Field label={lp("관인·서명 그림 (PNG)", "seal_image").label} hint="배경이 투명한 PNG가 깔끔합니다">
          <div className="flex items-center gap-3">
            <SealPreview path={org.seal_image} />
            <div className="flex flex-col gap-1.5 min-w-0">
              <span className="kd-path">{org.seal_image ? baseName(org.seal_image) : "고르지 않음"}</span>
              {!lk("org.seal_image") && <div className="flex gap-2">
                <Button variant="secondary" size="sm" onClick={() => void pickFiles({ multiple: false, filters: FILTERS.image }).then((p) => p[0] && set("seal_image", p[0]))}><ImagePlus size={13} /> 고르기</Button>
                {org.seal_image && <Button variant="ghost" size="sm" onClick={() => set("seal_image", "")}>빼기</Button>}
              </div>}
            </div>
          </div>
        </Field>
      </div>
    </Section>
  );
}
