/**
 * 서식 칸 채우기 폼 — 내 기관 정보로 먼저 채우고(org_autofill), 빈 칸은 AI 제안(ai_fill_suggest).
 * 서식함(작성 단계)과 편집기 보조 패널(칸 채우기)에서 같이 쓴다.
 */

import { useEffect, useMemo, useState } from "react";
import { Building2, FileUp, Sparkles, X } from "lucide-react";
import { useApp } from "../../state/app";
import { rpc } from "../../lib/rpc";
import { pickFiles } from "../../lib/native";
import { baseName } from "../../lib/format";
import { useTask } from "../../hooks/useTask";
import { Button } from "../ui/Button";
import { Field } from "../common/Field";
import { ErrorLine } from "../common/Status";
import { ActionBar } from "./ActionBar";

export interface FormField {
  name: string;
  guide?: string;
  multiline?: boolean;
}

type Source = "org" | "ai" | "me" | "doc";
const SOURCE_LABEL: Record<Source, string> = { org: "내 기관 정보", ai: "AI 제안", me: "직접 입력", doc: "문서에 있던 값" };

export function TemplateForm({ fields, initial, onFinish, finishLabel, busy, error, compact }: {
  fields: FormField[];
  initial?: Record<string, string>;
  onFinish: (values: Record<string, string>) => void;
  finishLabel: string;
  busy?: boolean;
  /** 마무리(onFinish) 오류 — 고정 줄에 보인다 */
  error?: string;
  compact?: boolean;
}) {
  const { ai } = useApp();
  const names = useMemo(() => fields.map((f) => f.name), [fields]);
  const [form, setForm] = useState<{ values: Record<string, string>; source: Record<string, Source> }>(() => ({
    values: { ...(initial ?? {}) },
    source: Object.fromEntries(Object.entries(initial ?? {}).filter(([, v]) => v?.trim()).map(([k]) => [k, "doc" as Source])),
  }));
  const { values, source } = form;
  const [instruction, setInstruction] = useState("");
  const [refs, setRefs] = useState<string[]>([]);
  const org = useTask<void>();
  const suggest = useTask<void>();

  const fill = (vals: Record<string, string>, src: Source, onlyEmpty: boolean) => setForm((prev) => {
    const next = { values: { ...prev.values }, source: { ...prev.source } };
    for (const [k, v] of Object.entries(vals)) {
      if (!v || (onlyEmpty && prev.values[k]?.trim())) continue;
      next.values[k] = v;
      next.source[k] = src;
    }
    return next;
  });
  const edit = (k: string, v: string) => setForm((prev) => ({ values: { ...prev.values, [k]: v }, source: { ...prev.source, [k]: "me" } }));

  const autofill = () => void org.run(async () => { fill((await rpc("org_autofill", { fields: names })).values, "org", true); });

  // 처음 열 때 내 기관 정보로 빈 칸 채우기
  const namesKey = names.join("|");
  useEffect(() => {
    if (namesKey) autofill();
    // 칸 목록이 바뀔 때마다 한 번
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [namesKey]);

  const empty = names.filter((n) => !values[n]?.trim());
  const runSuggest = () => void suggest.run(async () => {
    const guides = Object.fromEntries(fields.filter((f) => f.guide).map((f) => [f.name, f.guide!]));
    const r = await rpc("ai_fill_suggest", { fields: empty, references: refs, instruction: instruction.trim() || undefined, guides });
    fill(r.values, "ai", true);
  });

  return (
    <div className={`flex flex-col ${compact ? "gap-3" : "gap-4"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" onClick={autofill} disabled={org.busy}><Building2 size={13} /> 내 기관 정보로 채우기</Button>
        <span className="kd-small kd-muted kd-num">칸 {names.length}개 중 빈칸 {empty.length}개</span>
      </div>
      <ErrorLine message={org.error} />

      <div className={compact ? "flex flex-col gap-3" : "kd-fieldgrid"}>
        {fields.map((f) => (
          <Field key={f.name} label={<span className="flex items-center gap-1.5">{f.name}{source[f.name] && values[f.name]?.trim() ? <span className="kd-badge" data-tone={source[f.name] === "ai" ? "info" : source[f.name] === "org" ? "accent" : undefined}>{SOURCE_LABEL[source[f.name]]}</span> : null}</span>}>
            {f.multiline ? (
              <textarea className="kd-textarea" rows={compact ? 3 : 4} value={values[f.name] ?? ""} placeholder={f.guide ?? ""} aria-label={f.name}
                onChange={(e) => edit(f.name, e.target.value)} />
            ) : (
              <input className="kd-input" value={values[f.name] ?? ""} placeholder={f.guide ?? ""} aria-label={f.name}
                onChange={(e) => edit(f.name, e.target.value)} />
            )}
          </Field>
        ))}
      </div>

      {ai?.configured && empty.length > 0 && (
        <div className="kd-inset flex flex-col gap-2.5 p-3">
          <span className="kd-label">빈칸 {empty.length}개를 AI로 채우기</span>
          <input className="kd-input" value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder="무슨 문서인가요? 예: 직원 체육대회 개최 안내 공문" aria-label="문서 설명" />
          {refs.length > 0 && (
            <ul className="flex flex-col gap-1">
              {refs.map((r) => (
                <li key={r} className="flex items-center gap-2 kd-small">
                  <span className="kd-path flex-1">{baseName(r)}</span>
                  <button type="button" className="kd-icon-btn" style={{ width: 24, height: 24 }} onClick={() => setRefs(refs.filter((x) => x !== r))} aria-label={`${baseName(r)} 빼기`}><X size={12} /></button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" size="sm" onClick={() => void pickFiles().then((p) => setRefs([...new Set([...refs, ...p])]))}><FileUp size={13} /> 참고 문서 붙이기</Button>
            <Button variant="secondary" size="sm" onClick={runSuggest} disabled={suggest.busy}><Sparkles size={13} /> {suggest.busy ? "채우는 중" : "AI로 채우기"}</Button>
          </div>
          <ErrorLine message={suggest.error} />
        </div>
      )}

      {compact ? (
        <div>
          <Button size="lg" onClick={() => onFinish(values)} disabled={busy}>{finishLabel}</Button>
        </div>
      ) : (
        <ActionBar error={error} status={empty.length ? <>빈칸 <b className="kd-num">{empty.length}개</b> 남음 <span className="kd-muted">(편집기에서 마저 채워도 됩니다)</span></> : `칸 ${names.length}개를 모두 채웠습니다`}>
          <Button size="lg" onClick={() => onFinish(values)} disabled={busy}>{busy ? "편집기로 넘기는 중" : finishLabel}</Button>
        </ActionBar>
      )}
    </div>
  );
}
