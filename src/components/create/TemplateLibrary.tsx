/** 서식함 — 내장 표준 기안문 · 기관 시작 서식 · 내가 등록한 기관 서식(끌어다 놓아 등록) */

import { useCallback, useEffect, useState } from "react";
import { FilePlus2, Trash2, FileStack } from "lucide-react";
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
            <Note tone="info">이름 칸이 표로 된 서식입니다{analysis.label_fields.length ? ` (칸 ${analysis.label_fields.length}개)` : ""}. 칸 채우기 도우미로 값을 넣거나 편집기에서 직접 씁니다.</Note>
            <ActionBar status={entry.name}>
              <Button size="lg" variant="secondary" onClick={() => void openInEditor(entry.path!, { title: entry.name })}>편집기에서 직접 쓰기</Button>
              <Button size="lg" disabled={entry.format !== "hwpx"} title={entry.format !== "hwpx" ? "HWPX 서식에서 씁니다" : undefined} onClick={() => setWizard(true)}>칸 채우기 도우미</Button>
            </ActionBar>
          </>
        ) : (
          <>
            <Note tone="info">견본 서식입니다. AI 초안이나 직접 쓴 글을 이 견본의 글꼴과 항목 기호 단계로 짭니다.</Note>
            <ActionBar status={entry.name}><Button size="lg" onClick={() => onStyleSample(entry.path!)}>이 견본으로 초안 쓰기</Button></ActionBar>
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

export function TemplateLibrary({ onStyleSample }: { onStyleSample: (path: string) => void }) {
  const { ready, registerDrop, dragTarget, toast } = useApp();
  const [list, setList] = useState<TemplateEntry[]>([]);
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

  return (
    <div className="kd-library">
      <aside className="kd-library-list" data-drop="templates" data-over={dragTarget === "templates"} aria-label="서식 목록">
        {GROUPS.map((g) => {
          const items = list.filter((t) => t.source === g.source);
          if (!items.length && g.source !== "user") return null;
          return (
            <div key={g.source} className="mb-4">
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
          );
        })}
      </aside>
      <div className="kd-library-detail">
        <ErrorLine message={error} />
        {sel ? <Detail key={sel.id} entry={sel} onStyleSample={onStyleSample} /> : (
          <Empty icon={<FileStack size={28} />} title="서식을 고르세요">왼쪽에서 서식을 고르면 칸을 채워 바로 편집기로 넘깁니다.</Empty>
        )}
      </div>
    </div>
  );
}
