/** 1. 작성 — 시작점 고르기: 서식함 · 빈 문서 · AI 초안 · 기존 문서를 한글로 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { FileStack, FilePlus2, Sparkles, FileInput, FileUp } from "lucide-react";
import { useApp, type DraftKind } from "../../state/app";
import { useCreate } from "./session";
import { rpc } from "../../lib/rpc";
import { pickFiles } from "../../lib/native";
import { baseName, stem } from "../../lib/format";
import { useTask } from "../../hooks/useTask";
import { useGongmunMeta } from "../../hooks/useGongmunMeta";
import { Button } from "../ui/Button";
import { Field, Seg, SelectField } from "../common/Field";
import { Note, Working } from "../common/Status";
import { FormatBadge } from "../common/FormatBadge";
import { TemplateLibrary } from "./TemplateLibrary";
import { DraftComposer, type DraftSeed } from "./DraftComposer";
import { formatOf } from "../../lib/format";
import { ActionBar, ActionBarSlot } from "./ActionBar";

type Route = "library" | "blank" | "ai" | "convert";

const ROUTES: Array<{ id: Route; title: string; desc: string; icon: ReactNode }> = [
  { id: "library", title: "서식함에서 고르기", desc: "표준 기안문, 기관 시작 서식, 내가 등록한 서식", icon: <FileStack size={20} /> },
  { id: "blank", title: "빈 문서로 시작", desc: "문서 갈래와 기관 서식만 골라 바로 쓰기", icon: <FilePlus2 size={20} /> },
  { id: "ai", title: "AI 초안", desc: "회신, 민원 답변, 회의록, 한 장 보고, 보도자료", icon: <Sparkles size={20} /> },
  { id: "convert", title: "기존 문서를 한글로", desc: "PDF·워드·스캔본·엑셀을 고칠 수 있는 한글로", icon: <FileInput size={20} /> },
];

/** 갈래 설명이 "·" 뒤나 괄호 안에서 줄이 갈리지 않게 */
const keepTogether = (s: string) => s.replace(/·/g, "\u2060·\u2060").replace(/\([^)]*\)/g, (m) => "\u2060" + m.replace(/ /g, "\u00a0"));

function BlankStart() {
  const { settings } = useApp();
  const { openInEditor } = useCreate();
  const meta = useGongmunMeta();
  const [preset, setPreset] = useState("official");
  const [agency, setAgency] = useState(settings?.org.agency ?? "");
  const task = useTask<string>();
  const label = meta?.presets.find((p) => p.id === preset)?.label ?? "새 문서";

  return (
    <div className="kd-route-panel">
      <h2 className="kd-h2">어떤 문서를 쓸까요?</h2>
      <div className="kd-preset-grid" role="radiogroup" aria-label="문서 갈래">
        {(meta?.presets ?? []).map((p) => (
          <button key={p.id} type="button" role="radio" aria-checked={preset === p.id} className="kd-preset" onClick={() => setPreset(p.id)}>
            <span className="kd-row-title block">{p.label}</span>
            <span className="kd-row-desc block">{keepTogether(p.description)}</span>
          </button>
        ))}
      </div>
      <div className="kd-form-row">
        <SelectField label="기관 서식" hint="글꼴·여백·머리글이 기관 방식대로 잡힙니다" value={agency} onChange={setAgency}
          options={[{ value: "", label: "공통 서식" }, ...(meta?.agencies ?? []).filter((a) => a !== "공통").map((a) => ({ value: a, label: a }))]} />
      </div>
      <ActionBar status={`${label} · ${agency || "공통 서식"}`} error={task.error} busy={task.busy && <Working label="서식을 준비하는 중" />}>
        <Button size="lg" onClick={() => void task.run(async () => {
          const r = await rpc("template_starter", { preset, ...(agency ? { agency } : {}) });
          await openInEditor(r.output_path, { title: label });
          return r.output_path;
        })}><FilePlus2 size={15} /> 이 서식으로 시작</Button>
      </ActionBar>
    </div>
  );
}

function ConvertStart({ file, setFile }: { file: string; setFile: (p: string) => void }) {
  const { openInEditor } = useCreate();
  const meta = useGongmunMeta();
  const [preset, setPreset] = useState("official");
  const [ocr, setOcr] = useState<"auto" | "force" | "off">("auto");
  const task = useTask<string>();

  return (
    <div className="kd-route-panel">
      <h2 className="kd-h2">한글로 바꿀 문서</h2>
      <p className="kd-small kd-muted">모양을 그대로 옮기는 것이 아니라 글과 표를 한글 문서로 다시 짭니다. 스캔본은 글자를 읽어서 옮깁니다.</p>
      <div className="kd-inset flex items-center gap-3 px-3 py-2.5" data-drop="create-convert">
        {file ? <FormatBadge format={formatOf(file)} /> : null}
        <span className="kd-path flex-1">{file ? baseName(file) : "아직 고르지 않았습니다"}</span>
        <Button variant="secondary" size="sm" onClick={() => void pickFiles({ multiple: false }).then((p) => p[0] && setFile(p[0]))}><FileUp size={13} /> 파일 고르기</Button>
      </div>
      <div className="kd-form-row">
        <SelectField label="문서 갈래" value={preset} onChange={setPreset} options={(meta?.presets ?? [{ id: "official", label: "기안문", description: "" }]).map((p) => ({ value: p.id, label: p.label }))} />
        <Field label="스캔 쪽 글자 읽기">
          <Seg label="글자 읽기" value={ocr} onChange={setOcr} options={[{ value: "auto", label: "필요한 쪽만" }, { value: "force", label: "모든 쪽" }, { value: "off", label: "안 함" }]} />
        </Field>
      </div>
      <ActionBar status={file ? baseName(file) : "바꿀 파일을 먼저 고르세요"} error={task.error}
        busy={task.busy && <Working label="한글 문서로 다시 짜는 중" progress={task.progress} onCancel={task.cancel} />}>
        <Button size="lg" disabled={!file} onClick={() => void task.run(async ({ signal, onProgress }) => {
          const r = await rpc("to_hwpx", { path: file, preset, ocr }, { signal, onProgress });
          await openInEditor(r.output_path, { title: stem(file) });
          return r.output_path;
        })}><FileInput size={15} /> 한글로 바꿔 편집하기</Button>
      </ActionBar>
      {formatOf(file) === "hwp" && <Note tone="info">HWP 문서는 바꾸지 않아도 됩니다. 작업대에서 한글 편집기로 바로 여세요.</Note>}
    </div>
  );
}

export function ComposeStep({ active }: { active: boolean }) {
  const { createIntent, registerDrop } = useApp();
  const { openInEditor } = useCreate();
  const [route, setRoute] = useState<Route>("library");
  const [convertFile, setConvertFile] = useState("");
  const [seed, setSeed] = useState<DraftSeed | null>(null);
  const [visited, setVisited] = useState<Set<Route>>(() => new Set<Route>(["library"]));
  const [barEl, setBarEl] = useState<HTMLDivElement | null>(null);
  const handled = useRef(0);

  const go = (r: Route) => { setRoute(r); setVisited((v) => new Set(v).add(r)); };

  useEffect(() => {
    if (!createIntent || createIntent.nonce === handled.current || createIntent.value.path) return;
    handled.current = createIntent.nonce;
    const { route: r, kind, references, markdown } = createIntent.value;
    if (r) go(r);
    if (r === "ai") setSeed({ kind: kind as DraftKind | undefined, references, markdown, nonce: createIntent.nonce });
  }, [createIntent]);

  // 이 화면에 끌어다 놓으면: 한글 문서는 바로 편집, 그 밖은 한글로 바꾸기
  useEffect(() => {
    if (!active) return;
    const offScreen = registerDrop("create", (paths) => {
      const p = paths[0];
      if (!p) return;
      if (["hwp", "hwpx", "hwpml"].includes(formatOf(p))) void openInEditor(p);
      else { setConvertFile(p); go("convert"); }
    });
    const offConvert = registerDrop("create-convert", (paths) => paths[0] && setConvertFile(paths[0]));
    return () => { offScreen(); offConvert(); };
  }, [active, registerDrop, openInEditor]);

  // 고정 줄 높이를 스크롤 여백(screens-2.css .kd-create-pane)에 — Tab 으로 옮긴 칸이 줄 밑에 숨지 않게
  useEffect(() => {
    const pane = barEl?.closest<HTMLElement>(".kd-create-pane");
    if (!barEl || !pane) return;
    const ro = new ResizeObserver(() => pane.style.setProperty("--kd-actionbar-h", `${barEl.offsetHeight}px`));
    ro.observe(barEl);
    return () => { ro.disconnect(); pane.style.removeProperty("--kd-actionbar-h"); };
  }, [barEl]);

  return (
    <div className="kd-compose">
      <div className="kd-routes" role="tablist" aria-label="시작점">
        {ROUTES.map((r) => (
          <button key={r.id} type="button" role="tab" aria-selected={route === r.id} className="kd-route" onClick={() => go(r.id)}>
            <span className="kd-route-icon">{r.icon}</span>
            <span className="min-w-0">
              <span className="kd-row-title block">{r.title}</span>
              <span className="kd-row-desc block">{r.desc}</span>
            </span>
          </button>
        ))}
      </div>
      <div className="kd-route-body">
        {/* 다음 동작은 바닥 고정 줄로 — 보이는 시작점만 그 자리에 그린다 */}
        {visited.has("library") && <ActionBarSlot.Provider value={route === "library" ? barEl : null}><div hidden={route !== "library"} className="h-full"><TemplateLibrary onStyleSample={(p) => { go("ai"); setSeed({ levelsFrom: p, nonce: Date.now() }); }} /></div></ActionBarSlot.Provider>}
        {visited.has("blank") && <ActionBarSlot.Provider value={route === "blank" ? barEl : null}><div hidden={route !== "blank"}><BlankStart /></div></ActionBarSlot.Provider>}
        {visited.has("ai") && <ActionBarSlot.Provider value={route === "ai" ? barEl : null}><div hidden={route !== "ai"} className="h-full"><DraftComposer seed={seed} /></div></ActionBarSlot.Provider>}
        {visited.has("convert") && <ActionBarSlot.Provider value={route === "convert" ? barEl : null}><div hidden={route !== "convert"}><ConvertStart file={convertFile} setFile={setConvertFile} /></div></ActionBarSlot.Provider>}
      </div>
      <div ref={setBarEl} className="kd-actionbar" role="region" aria-label="다음 단계" />
    </div>
  );
}
