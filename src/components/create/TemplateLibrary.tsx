/** 서식함 — 내장 표준 기안문 · 기관 시작 서식 · 우리 기관 견본(문서 모음의 갈래별 대표) · 내가 등록한 기관 서식(끌어다 놓아 등록) */

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { FilePlus2, Trash2, FileStack, Sparkles } from "lucide-react";
import type { TemplateAnalysis, TemplateEntry } from "../../lib/contract";
import { useApp } from "../../state/app";
import { useCreate, visibleField, workingFile } from "./session";
import { useGongmunMeta } from "../../hooks/useGongmunMeta";
import { SelectField } from "../common/Field";
import { rpc, errorText, callRaw } from "../../lib/rpc";
import { FILTERS, pickFiles } from "../../lib/native";
import { useTask } from "../../hooks/useTask";
import { detectFileType } from "../../utils/fileType";
import { Button } from "../ui/Button";
import { ConfirmRemove } from "../ui/ConfirmRemove";
import { Empty, ErrorLine, Note, Working } from "../common/Status";
import { FormatBadge } from "../common/FormatBadge";
import { TemplateForm, type FormField } from "./TemplateForm";
import { FillWizard } from "../fill/FillWizard";
import { baseName } from "../../lib/format";
import { ActionBar } from "./ActionBar";
import { TemplateWrite } from "./TemplateWrite";
import { useOrgCorpus, useOrgReference } from "../../hooks/useOrgCorpus";

/** 우리 기관 견본 — 갈래의 대표 견본으로 AI 초안(구성·서식을 따름) 또는 견본 그대로 새로 쓰기 */
function OrgDetail({ kind, onDraft }: { kind: string; onDraft: (preset: string) => void }) {
  const { openSettings } = useApp();
  const ref = useOrgReference(kind);
  if (ref === undefined) return <Working label="우리 기관 견본을 읽는 중" />;
  if (!ref) return <Note tone="info">이 갈래의 문서가 모음에서 빠졌습니다. 설정의 우리 기관 문서 모음에서 확인하세요.</Note>;
  return (
    <div className="kd-route-panel">
      <div className="flex items-start gap-3">
        <FormatBadge format="hwpx" />
        <div className="min-w-0 flex-1">
          <h2 className="kd-h2">우리 기관 {ref.label}</h2>
          <p className="kd-small kd-muted mt-0.5">대표 견본 「{ref.exemplar.title}」 · 모음 {ref.count}건</p>
        </div>
        <button type="button" className="kd-link kd-small flex-none" onClick={() => openSettings("set-orgdocs")}>문서 모음</button>
      </div>
      <TemplateWrite path={ref.exemplar.template_path} name={ref.exemplar.title} />
      <ActionBar status={`우리 기관 ${ref.label} · ${ref.exemplar.title}`}>
        <Button size="lg" onClick={() => onDraft(kind)} data-tip={`우리 기관 ${ref.label}의 구성과 자주 쓰는 표현을 따르고, ${ref.apply.template_path ? "대표 견본의 쪽·글꼴·표 서식 그대로 만듭니다" : "두문·결문은 공문 규격대로 만듭니다"}`}><Sparkles size={15} /> 이 갈래로 AI 초안</Button>
      </ActionBar>
    </div>
  );
}

const GROUPS: Array<{ source: TemplateEntry["source"]; title: string }> = [
  { source: "builtin", title: "표준 기안문" },
  { source: "starter", title: "빈 문서" },
  { source: "user", title: "내 기관 서식" },
];

function Detail({ entry, onStyleSample }: { entry: TemplateEntry; onStyleSample: (path: string) => void }) {
  const { settings, toast } = useApp();
  const { openInEditor } = useCreate();
  const meta = useGongmunMeta();
  /** 빈 문서의 기관 서식 (글꼴·여백·머리글) — 처음엔 내 기관 정보의 것 */
  const [agency, setAgency] = useState(settings?.org.agency ?? "");
  const [fields, setFields] = useState<FormField[] | null>(null);
  const [analysis, setAnalysis] = useState<TemplateAnalysis | null>(null);
  const [wizard, setWizard] = useState(false);
  const load = useTask<void>();
  const start = useTask<void>();

  useEffect(() => {
    setFields(null);
    setAnalysis(null);
    void load.run(async () => {
      if (entry.source === "builtin") {
        const r = await rpc("template_fields", { template: entry.template ?? entry.id });
        // name 이 칸 이름(값의 열쇠), label 은 서식에 적힌 안내 글자
        setFields(r.fields.filter((f) => visibleField(f.name)).map((f) => ({ name: f.name, guide: f.label && f.label !== f.name ? f.label : undefined, multiline: f.multiline })));
      } else if (entry.source === "user" && entry.path) {
        const a = await rpc("template_analyze", { path: entry.path });
        setAnalysis(a);
        setFields(a.fields.filter((f) => visibleField(f.name)));
      }
    });
    // 서식마다 한 번
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.id]);

  const finishBuiltin = (values: Record<string, string>) => void start.run(async () => {
    const r = await rpc("template_fill", { template: entry.template ?? entry.id, values, output_path: await workingFile(`${values["제목"] || entry.name}.hwpx`) });
    await openInEditor(r.output_path, { title: values["제목"] || entry.name, working: true });
  });
  const finishUser = (values: Record<string, string>) => void start.run(async () => {
    await openInEditor(entry.path!, { title: values["제목"] || entry.name, fields: values });
  });
  const startStarter = () => void start.run(async () => {
    const r = await rpc("template_starter", { preset: entry.template ?? entry.id, ...(agency ? { agency } : {}), output_path: await workingFile(`${entry.category}.hwpx`) });
    await openInEditor(r.output_path, { title: entry.category, working: true });
  });

  return (
    <div className="kd-route-panel">
      <div className="flex items-start gap-3">
        <FormatBadge format={entry.format} />
        <div className="min-w-0 flex-1">
          <h2 className="kd-h2">{entry.source === "starter" ? `빈 ${entry.category}` : entry.name}</h2>
          <p className="kd-small kd-muted mt-0.5">{entry.description}</p>
        </div>
      </div>
      {load.busy && <Working label="서식을 살펴보는 중" />}
      <ErrorLine message={load.error} />

      {entry.source === "starter" && (
        <>
          <div className="kd-adv" style={{ maxWidth: 360 }}>
            <SelectField label="기관 서식" hint="글꼴·여백·머리글이 기관 방식대로 잡힙니다" value={agency} onChange={setAgency}
              options={[{ value: "", label: "공통 서식" }, ...(meta?.agencies ?? []).filter((a) => a !== "공통").map((a) => ({ value: a, label: a }))]} />
          </div>
          <ActionBar status={`빈 ${entry.category} · ${agency || "공통 서식"}`} error={start.error} busy={start.busy && <Working label="편집기로 넘기는 중" />}>
            <Button size="lg" onClick={startStarter} data-tip="빈 문서를 새로 만들어 편집기에서 엽니다. 저장하기 전까지는 앱 안 작업 사본입니다"><FilePlus2 size={15} /> 이 서식으로 시작</Button>
          </ActionBar>
        </>
      )}

      {entry.source === "builtin" && fields && <TemplateForm fields={fields} onFinish={finishBuiltin} finishLabel="채워서 편집기로" busy={start.busy} error={start.error} />}

      {entry.source === "user" && analysis && (
        analysis.strategy === "fill_fields" ? (
          fields && fields.length > 0
            ? <TemplateForm fields={fields} onFinish={finishUser} finishLabel="채워서 편집기로" busy={start.busy} error={start.error} />
            : (
              <>
                <Note tone="info">칸은 편집기 오른쪽 칸 채우기에서 채웁니다.</Note>
                <ActionBar status={entry.name}><Button size="lg" onClick={() => void openInEditor(entry.path!, { title: entry.name })} data-tip="서식 원본을 편집기에서 엽니다. 다른 이름으로 저장하면 원본은 그대로입니다">편집기에서 열기</Button></ActionBar>
              </>
            )
        ) : analysis.strategy === "fill_labels" ? (
          <>
            <p className="kd-small kd-muted">표 칸 서식{analysis.label_fields.length ? ` · 칸 ${analysis.label_fields.length}개` : ""}</p>
            <TemplateWrite path={entry.path!} name={entry.name} />
            <ActionBar status={entry.name}>
              <Button size="lg" variant="secondary" onClick={() => void openInEditor(entry.path!, { title: entry.name })} data-tip="서식을 편집기에서 열어 표 칸에 바로 씁니다">편집기에서 직접 쓰기</Button>
              <Button size="lg" disabled={entry.format !== "hwpx"} data-tip={entry.format !== "hwpx" ? "HWPX 서식에서 씁니다" : "칸 이름 옆 빈칸을 목록으로 보여 주고, 값을 넣어 새 파일로 저장합니다"} onClick={() => setWizard(true)}>칸 채우기 도우미</Button>
            </ActionBar>
          </>
        ) : (
          <>
            <p className="kd-small kd-muted">견본 서식 · 표·상자는 그대로 두고 내용만 새로</p>
            <TemplateWrite path={entry.path!} name={entry.name} />
            <ActionBar status={entry.name}><Button size="lg" variant="secondary" onClick={() => onStyleSample(entry.path!)} data-tip="AI 초안 화면으로 넘어가 이 견본의 항목 기호별 글꼴·크기로 짭니다">초안을 이 견본 글꼴로 짜기</Button></ActionBar>
          </>
        )
      )}

      {wizard && entry.path && (
        <FillWizard file={{ path: entry.path, name: baseName(entry.path), size: 0, type: detectFileType(entry.path) }} sidecarCall={callRaw}
          outputDir={settings?.convert.output_dir ?? ""} saveDir={settings?.convert.output_dir ?? ""} showToast={toast} onClose={() => setWizard(false)}
          onOpenFolder={(p) => void rpc("reveal_file", { path: p }).catch(() => undefined)} />
      )}
    </div>
  );
}

export function TemplateLibrary({ focus, onStyleSample, onDraft }: {
  /** 다른 곳에서 고르라고 넘긴 서식 (빈 문서로 시작 → 빈 기안문) */
  focus?: { id: string; nonce: number } | null;
  onStyleSample: (path: string) => void;
  onDraft: (preset: string) => void;
}) {
  const { ready, registerDrop, dragTarget, toast, openSettings } = useApp();
  const [list, setList] = useState<TemplateEntry[]>([]);
  const org = useOrgCorpus();
  const [selId, setSelId] = useState<string>("");
  const [error, setError] = useState("");

  const refresh = useCallback(async (select?: string) => {
    try {
      const r = await rpc("template_library", {});
      setList(r.templates);
      setSelId((cur) => select ?? (cur || r.templates[0]?.id || ""));
      setError("");
    } catch (e) {
      setError(errorText(e));
    }
  }, []);
  useEffect(() => { if (ready) void refresh(); }, [ready, refresh]);

  // 넘겨받은 서식은 목록을 읽은 뒤 고른다
  const focused = useRef(0);
  useEffect(() => {
    if (!focus || focus.nonce === focused.current || !list.some((t) => t.id === focus.id)) return;
    focused.current = focus.nonce;
    setSelId(focus.id);
  }, [focus, list]);

  const add = useCallback(async (paths: string[]) => {
    let last = "";
    for (const p of paths) {
      try { last = (await rpc("template_add", { path: p })).id; }
      catch (e) { toast(`${baseName(p)}: ${errorText(e)}`, "error"); }
    }
    if (last) { toast("서식함에 넣었습니다", "success"); void refresh(last); }
  }, [refresh, toast]);
  useEffect(() => registerDrop("templates", (paths) => {
    const hangul = paths.filter((p) => /\.(hwpx?|hml)$/i.test(p));
    const skipped = paths.length - hangul.length;
    if (skipped) toast(`서식함에는 한글 문서(HWP·HWPX)만 넣습니다. ${skipped}개는 넣지 않았습니다. PDF·워드는 '가진 파일을 한글로'에서 바꾸세요`, "info");
    if (hangul.length) void add(hangul);
  }), [registerDrop, add, toast]);

  const remove = async (t: TemplateEntry) => {
    try { await rpc("template_remove", { id: t.id }); void refresh(selId === t.id ? "" : undefined); }
    catch (e) { toast(errorText(e), "error"); }
  };

  const sel = list.find((t) => t.id === selId) ?? null;
  const orgKind = selId.startsWith("org:") ? selId.slice(4) : "";
  const orgGroup = (
    <div className="mb-4">
      <h3 className="kd-label px-2 pb-1">우리 기관 견본</h3>
      {org?.kinds.length ? org.kinds.map((k) => (
        <div key={k.kind} className="kd-tpl" aria-current={orgKind === k.kind ? "true" : undefined}>
          <button type="button" className="kd-tpl-main" onClick={() => setSelId(`org:${k.kind}`)}>
            <span className="kd-row-title block">{k.label}</span>
            <span className="kd-row-desc block">{org.docs.find((d) => d.id === k.exemplar_id)?.title ?? "대표 견본"} · {k.count}건</span>
          </button>
        </div>
      )) : (
        <div className="kd-tpl-add">
          <p className="kd-small kd-muted px-2">기관 문서를 모으면 갈래별 견본이 생깁니다.</p>
          <Button variant="ghost" size="sm" data-tip="우리 기관 문서를 모아 두면 AI 초안이 그 구성과 서식을 따릅니다" onClick={() => openSettings("set-orgdocs")}><FilePlus2 size={13} /> 문서 모음에 넣기</Button>
        </div>
      )}
    </div>
  );

  return (
    <div className="kd-library">
      <aside className="kd-library-list" data-drop="templates" data-over={dragTarget === "templates"} aria-label="서식 목록">
        {/* 우리 기관 견본이 있으면 맨 위, 없으면 내 기관 서식 앞에 넣는 곳 안내 */}
        {org?.kinds.length ? orgGroup : null}
        {GROUPS.map((g) => {
          const items = list.filter((t) => t.source === g.source);
          if (!items.length && g.source !== "user") return null;
          return (
            <Fragment key={g.source}>
            {g.source === "user" && !org?.kinds.length && orgGroup}
            <div className="mb-4">
              <h3 className="kd-label px-2 pb-1">{g.title}</h3>
              {items.map((t) => (
                <div key={t.id} className="kd-tpl" aria-current={t.id === selId ? "true" : undefined}>
                  <button type="button" className="kd-tpl-main" onClick={() => setSelId(t.id)}>
                    <span className="kd-row-title block">{t.source === "starter" ? t.category : t.name}</span>
                    {t.source !== "starter" && <span className="kd-row-desc block">{t.has_fields ? `칸 ${t.field_count}개` : t.category}</span>}
                  </button>
                  {t.source === "user" && (
                    <ConfirmRemove ask="서식함에서 뺄까요?" verb="빼기" onConfirm={() => void remove(t)}>
                      {(open) => <button type="button" className="kd-icon-btn" onClick={open} aria-label={`${t.name} 서식함에서 빼기`} data-tip="서식함에 넣어 둔 사본을 지웁니다. 처음 고른 원본 파일은 그대로 둡니다"><Trash2 size={14} /></button>}
                    </ConfirmRemove>
                  )}
                </div>
              ))}
              {g.source === "user" && (
                <div className="kd-tpl-add">
                  <p className="kd-small kd-muted px-2">HWP·HWPX 서식을 끌어다 놓아 등록</p>
                  <Button variant="ghost" size="sm" data-tip="우리 기관 HWP·HWPX 서식을 서식함에 넣습니다. 원본 파일은 그대로 둡니다" onClick={() => void pickFiles({ filters: FILTERS.hangul }).then((p) => { if (p.length) void add(p); })}><FilePlus2 size={13} /> 서식 등록</Button>
                </div>
              )}
            </div>
            </Fragment>
          );
        })}
      </aside>
      <div className="kd-library-detail">
        <ErrorLine message={error} />
        {orgKind ? <OrgDetail key={selId} kind={orgKind} onDraft={onDraft} /> : sel ? <Detail key={sel.id} entry={sel} onStyleSample={onStyleSample} /> : (
          <Empty icon={<FileStack size={28} />} title="서식을 고르세요">왼쪽에서 서식을 고르면 칸을 채워 바로 편집기로 넘깁니다.</Empty>
        )}
      </div>
    </div>
  );
}
