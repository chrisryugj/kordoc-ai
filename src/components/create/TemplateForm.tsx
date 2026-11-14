/**
 * 서식 칸 채우기 폼 — 내 기관 정보로 먼저 채우고(org_autofill), 빈 칸은 AI 제안(ai_fill_suggest).
 * 서식함(작성 단계)과 편집기 보조 패널(칸 채우기)에서 같이 쓴다.
 * 핵심 칸(기관명·수신자·제목·본문·붙임)만 펼치고 나머지(결재란·시행 정보)는 접어 둔다. 전체 화면은 펼친 채로 시작.
 */

import { useEffect, useMemo, useState } from "react";
import { Building2, ChevronDown, FileUp, Sparkles, X } from "lucide-react";
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

/** 먼저 보일 핵심 칸 (공문 머리·본문) */
const CORE = new Set(["행정기관명", "기관명", "작성기관", "수신자", "수신", "제목", "본문", "내용", "요약설명", "붙임"]);
/** 접은 칸이 결재·시행 정보인지 (묶음 이름을 고른다) */
const APPROVAL = /기안|검토|결재|협조|시행|접수|우편|주소|홈페이지|전화|팩스|전송|메일|공개|등록|생산/;

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
  const { ai, uiMode } = useApp();
  const names = useMemo(() => fields.map((f) => f.name), [fields]);
  const [form, setForm] = useState<{ values: Record<string, string>; source: Record<string, Source> }>(() => ({
    values: { ...(initial ?? {}) },
    source: Object.fromEntries(Object.entries(initial ?? {}).filter(([, v]) => v?.trim()).map(([k]) => [k, "doc" as Source])),
  }));
  const { values, source } = form;
  const [instruction, setInstruction] = useState("");
  const [refs, setRefs] = useState<string[]>([]);
  /** AI 제안이 참고 문서를 일부만 읽었다는 알림 */
  const [suggestNote, setSuggestNote] = useState("");
  const org = useTask<void>();
  const suggest = useTask<void>();

  // 핵심 칸 / 접어 둘 칸. 핵심 칸 이름이 하나도 없는 서식은 앞 다섯 칸을 펼친다. 접을 칸이 둘 이하면 다 펼친다
  const { main, more, moreLabel } = useMemo(() => {
    const core = fields.filter((f) => CORE.has(f.name));
    const head = core.length ? core : fields.slice(0, 5);
    const rest = fields.filter((f) => !head.includes(f));
    if (rest.length <= 2) return { main: fields, more: [] as FormField[], moreLabel: "" };
    return { main: head, more: rest, moreLabel: rest.some((f) => APPROVAL.test(f.name)) ? "결재란·시행 정보" : "나머지 칸" };
  }, [fields]);
  const [moreOpen, setMoreOpen] = useState(uiMode === "full");

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

  const filled = (n: string) => !!values[n]?.trim();
  const empty = names.filter((n) => !filled(n));
  const mainEmpty = main.filter((f) => !filled(f.name)).length;
  const runSuggest = () => void suggest.run(async () => {
    const guides = Object.fromEntries(fields.filter((f) => f.guide).map((f) => [f.name, f.guide!]));
    const r = await rpc("ai_fill_suggest", { fields: empty, references: refs, instruction: instruction.trim() || undefined, guides });
    fill(r.values, "ai", true);
    setSuggestNote(r.note ?? "");
  });

  const field = (f: FormField) => (
    <Field key={f.name} label={<span className="flex items-center gap-1.5">{f.name}{source[f.name] && filled(f.name) ? <span className="kd-badge" data-tone={source[f.name] === "ai" ? "info" : source[f.name] === "org" ? "accent" : undefined}>{SOURCE_LABEL[source[f.name]]}</span> : null}</span>}>
      {f.multiline ? (
        <textarea className="kd-textarea" rows={compact ? 3 : 4} value={values[f.name] ?? ""} placeholder={f.guide ?? ""} aria-label={f.name}
          onChange={(e) => edit(f.name, e.target.value)} />
      ) : (
        <input className="kd-input" value={values[f.name] ?? ""} placeholder={f.guide ?? ""} aria-label={f.name}
          onChange={(e) => edit(f.name, e.target.value)} />
      )}
    </Field>
  );
  const grid = compact ? "flex flex-col gap-3" : "kd-fieldgrid";

  return (
    <div className={`flex flex-col ${compact ? "gap-3" : "gap-4"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" onClick={autofill} disabled={org.busy} data-tip="설정의 내 기관 정보(기관명·주소·전화 등)로 비어 있는 칸만 채웁니다"><Building2 size={13} /> 내 기관 정보로 채우기</Button>
      </div>
      <ErrorLine message={org.error} />

      <div className={grid}>{main.map(field)}</div>

      {more.length > 0 && (
        <section className="kd-fold kd-form-more" data-open={moreOpen}>
          <button type="button" className="kd-fold-head" aria-expanded={moreOpen} onClick={() => setMoreOpen((o) => !o)}>
            <span className="kd-h3">{moreLabel}</span>
            <span className="kd-small kd-muted flex-1 text-left kd-num">{more.length}칸{more.some((f) => filled(f.name)) ? ` · ${more.filter((f) => filled(f.name)).length}칸 채움` : ""}</span>
            <ChevronDown size={16} className="kd-fold-chev" />
          </button>
          {moreOpen && <div className="kd-fold-body"><div className={grid}>{more.map(field)}</div></div>}
        </section>
      )}

      {ai?.configured && empty.length > 0 && (
        <div className="kd-inset flex flex-col gap-2.5 p-3">
          <span className="kd-label">빈칸 AI로 채우기</span>
          <input className="kd-input" value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder="무슨 문서인가요? 예: 직원 체육대회 개최 안내 공문" aria-label="문서 설명" />
          {refs.length > 0 && (
            <ul className="flex flex-col gap-1">
              {refs.map((r) => (
                <li key={r} className="flex items-center gap-2 kd-small">
                  <span className="kd-path flex-1">{baseName(r)}</span>
                  <button type="button" className="kd-icon-btn" onClick={() => setRefs(refs.filter((x) => x !== r))} aria-label={`${baseName(r)} 빼기`}><X size={12} /></button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" size="sm" onClick={() => void pickFiles().then((p) => setRefs([...new Set([...refs, ...p])]))} data-tip="AI가 칸 값을 정할 때 읽을 문서"><FileUp size={13} /> 참고 문서 붙이기</Button>
            <Button variant="secondary" size="sm" onClick={runSuggest} disabled={suggest.busy} data-tip="비어 있는 칸에만 제안을 넣습니다. 이미 쓴 칸은 그대로 둡니다"><Sparkles size={13} /> {suggest.busy ? "채우는 중" : "AI로 채우기"}</Button>
          </div>
          <ErrorLine message={suggest.error} />
          {suggestNote && <p className="kd-small kd-muted" role="status">{suggestNote}</p>}
        </div>
      )}

      {compact ? (
        <div>
          <Button size="lg" onClick={() => onFinish(values)} disabled={busy} data-tip="넣은 값을 편집기의 칸에 넣습니다. 실행 취소 한 번이면 되돌립니다">{finishLabel}</Button>
        </div>
      ) : (
        <ActionBar error={error} status={!empty.length ? "칸을 모두 채웠습니다" : mainEmpty ? "다 채우지 않아도 됩니다. 남은 칸은 편집기에서 채워도 됩니다" : "필요한 칸은 채웠습니다. 나머지는 편집기에서 채워도 됩니다"}>
          <Button size="lg" onClick={() => onFinish(values)} disabled={busy} data-tip="넣은 값으로 새 문서를 만들어 한글 편집기에서 엽니다. 서식 원본은 그대로입니다">{busy ? "편집기로 넘기는 중" : finishLabel}</Button>
        </ActionBar>
      )}
    </div>
  );
}
