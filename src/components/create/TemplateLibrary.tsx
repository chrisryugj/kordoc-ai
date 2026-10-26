/** 서식함 — 내장 표준 기안문 · 기관 시작 서식 · 우리 기관 견본(문서 모음의 갈래별 대표) · 내가 등록한 기관 서식(끌어다 놓아 등록) */

import { Fragment, useCallback, useEffect, useState } from "react";
import { FilePlus2, Trash2, FileStack, Sparkles } from "lucide-react";
import type { TemplateAnalysis, TemplateEntry } from "../../lib/contract";
import { useApp } from "../../state/app";
import { useCreate, visibleField, workingFile } from "./session";
import { rpc, errorText, callRaw } from "../../lib/rpc";
import { FILTERS, pickFiles } from "../../lib/native";
import { useTask } from "../../hooks/useTask";
import { detectFileType } from "../../utils/fileType";
import { Button } from "../ui/Button";
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
      <Note tone="info">AI 초안은 우리 기관 {ref.label}의 구성과 자주 쓰는 표현을 따르고, {ref.apply.template_path ? "대표 견본의 쪽·글꼴·표 서식 그대로 만듭니다" : "두문·결문은 공문 규격대로 만듭니다"}. 견본의 표·상자를 그대로 두고 내용만 바꾸려면 아래에서 쓰세요.</Note>
      <TemplateWrite path={ref.exemplar.template_path} name={ref.exemplar.title} />
      <ActionBar status={`우리 기관 ${ref.label} · ${ref.exemplar.title}`}>
        <Button size="lg" onClick={() => onDraft(kind)}><Sparkles size={15} /> 이 갈래로 AI 초안</Button>
      </ActionBar>
    </div>
  );
}

const GROUPS: Array<{ source: TemplateEntry["source"]; title: string }> = [
  { source: "builtin", title: "표준 기안문" },
  { source: "starter", title: "기관 시작 서식" },
  { source: "user", title: "내 기관 서식" },
];

function Detail({ entry, onStyleSample }: { entry: TemplateEntry; onStyleSample: (path: string) => void }) {
  const { settings, toast } = useApp();
  const { openInEditor } = useCreate();
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
    const r = await rpc("template_starter", { preset: entry.template ?? entry.id, ...(settings?.org.agency ? { agency: settings.org.agency } : {}), output_path: await workingFile(`${entry.name}.hwpx`) });
    await openInEditor(r.output_path, { title: entry.name, working: true });
  });

  return (
    <div className="kd-route-panel">
      <div className="flex items-start gap-3">
        <FormatBadge format={entry.format} />
        <div className="min-w-0 flex-1">
          <h2 className="kd-h2">{entry.name}</h2>
          <p className="kd-small kd-muted mt-0.5">{entry.description}</p>
        </div>
      </div>
      {load.busy && <Working label="서식을 살펴보는 중" />}
      <ErrorLine message={load.error} />

      {entry.source === "starter" && (
        <>
          <p className="kd-text">기관 서식{settings?.org.agency ? `(${settings.org.agency})` : ""}과 내 기관 정보로 머리·끝을 채운 빈 문서를 만들어 편집기에서 엽니다.</p>
          <ActionBar status={`${entry.name} · ${settings?.org.agency || "공통 서식"}`} error={start.error} busy={start.busy && <Working label="편집기로 넘기는 중" />}>
            <Button size="lg" onClick={startStarter}><FilePlus2 size={15} /> 이 서식으로 시작</Button>
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
                <Note tone="info">칸 목록은 편집기에서 읽습니다. 열면 오른쪽 칸 채우기에서 값을 넣으세요.</Note>
                <ActionBar status={entry.name}><Button size="lg" onClick={() => void openInEditor(entry.path!, { title: entry.name })}>편집기에서 열기</Button></ActionBar>
              </>
            )
        ) : analysis.strategy === "fill_labels" ? (
          <>
            <Note tone="info">이름 칸이 표로 된 서식입니다{analysis.label_fields.length ? ` (칸 ${analysis.label_fields.length}개)` : ""}. AI 가 빈칸까지 채워 쓰게 하거나, 칸 채우기 도우미·편집기에서 직접 씁니다.</Note>
            <TemplateWrite path={entry.path!} name={entry.name} />
            <ActionBar status={entry.name}>
              <Button size="lg" variant="secondary" onClick={() => void openInEditor(entry.path!, { title: entry.name })}>편집기에서 직접 쓰기</Button>
              <Button size="lg" disabled={entry.format !== "hwpx"} title={entry.format !== "hwpx" ? "HWPX 서식에서 씁니다" : undefined} onClick={() => setWizard(true)}>칸 채우기 도우미</Button>
            </ActionBar>
          </>
        ) : (
          <>
            <Note tone="info">견본 서식입니다. AI 가 이 견본의 표·상자까지 그대로 두고 내용만 새로 쓰게 하거나, 초안을 이 견본의 글꼴과 항목 기호 단계로 다시 짭니다.</Note>
            <TemplateWrite path={entry.path!} name={entry.name} />
            <ActionBar status={entry.name}><Button size="lg" variant="secondary" onClick={() => onStyleSample(entry.path!)}>초안을 이 견본 글꼴로 짜기</Button></ActionBar>
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

export function TemplateLibrary({ onStyleSample, onDraft }: { onStyleSample: (path: string) => void; onDraft: (preset: string) => void }) {
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

  const add = useCallback(async (paths: string[]) => {
    let last = "";
    for (const p of paths) {
      try { last = (await rpc("template_add", { path: p })).id; }
      catch (e) { toast(`${baseName(p)}: ${errorText(e)}`, "error"); }
    }
    if (last) { toast("서식함에 넣었습니다", "success"); void refresh(last); }
  }, [refresh, toast]);
  useEffect(() => registerDrop("templates", (paths) => void add(paths.filter((p) => /\.(hwpx?|hml)$/i.test(p)))), [registerDrop, add]);

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
          <p className="kd-small kd-muted px-2">우리 기관 문서를 모아 두면 갈래마다 대표 견본이 여기 보이고, AI 초안이 그 구성과 서식을 따릅니다.</p>
          <Button variant="ghost" size="sm" onClick={() => openSettings("set-orgdocs")}><FilePlus2 size={13} /> 문서 모음에 넣기</Button>
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
                    <span className="kd-row-title block">{t.name}</span>
                    <span className="kd-row-desc block">{t.has_fields ? `칸 ${t.field_count}개` : t.category}</span>
                  </button>
                  {t.source === "user" && (
                    <button type="button" className="kd-icon-btn" onClick={() => void remove(t)} aria-label={`${t.name} 서식함에서 빼기`}><Trash2 size={14} /></button>
                  )}
                </div>
              ))}
              {g.source === "user" && (
                <div className="kd-tpl-add">
                  <p className="kd-small kd-muted px-2">우리 기관 HWP·HWPX 서식을 여기에 끌어다 놓으면 등록됩니다.</p>
                  <Button variant="ghost" size="sm" onClick={() => void pickFiles({ filters: FILTERS.hangul }).then((p) => { if (p.length) void add(p); })}><FilePlus2 size={13} /> 서식 등록</Button>
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
