/** 1. 작성 — 시작점 고르기: 서식 골라 쓰기(빈 문서 포함) · AI 초안 · 가진 파일을 한글로 · 우리 서식으로 맞추기 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { FileStack, Sparkles, FileInput, Paintbrush } from "lucide-react";
import { useApp, type DraftKind } from "../../state/app";
import { useCreate, workingFile } from "./session";
import { rpc } from "../../lib/rpc";
import { baseName, stem } from "../../lib/format";
import { useTask } from "../../hooks/useTask";
import { useGongmunMeta } from "../../hooks/useGongmunMeta";
import { Button } from "../ui/Button";
import { Field, Seg, SelectField } from "../common/Field";
import { Note, Working } from "../common/Status";
import { FileDrop } from "../common/FileDrop";
import { TemplateLibrary } from "./TemplateLibrary";
import { DraftComposer, type DraftSeed } from "./DraftComposer";
import { formatOf } from "../../lib/format";
import { ActionBar, ActionBarSlot } from "./ActionBar";
import { StyleCopy } from "./StyleCopy";
import { AiNeedBadge } from "./AiOffNote";

type Route = "library" | "ai" | "convert" | "style";
/** 다른 화면이 부르는 갈래. "blank"(빈 문서로 시작)는 서식함의 빈 문서 묶음으로 연다 */
type RouteIn = Route | "blank";

const ROUTES: Array<{ id: Route; title: string; desc: string; tip: string; icon: ReactNode; ai?: boolean }> = [
  { id: "library", title: "서식 골라 쓰기", desc: "표준 기안문 · 빈 문서 · 기관 서식", tip: "서식을 고르고 칸을 채워 편집기로 넘깁니다. AI 없이 됩니다", icon: <FileStack size={22} /> },
  { id: "ai", title: "AI 초안", desc: "회신 · 민원 답변 · 회의록 · 보도자료", tip: "지시 한 줄과 참고 문서로 AI가 초안을 쓰고, 미리보기를 보며 한글 문서로 만듭니다", icon: <Sparkles size={22} />, ai: true },
  { id: "convert", title: "가진 파일을 한글로", desc: "PDF · 워드 · 스캔본을 한글 문서로", tip: "글과 표를 고쳐 쓸 수 있는 한글 문서로 다시 짭니다. 원본은 그대로 둡니다", icon: <FileInput size={22} /> },
  { id: "style", title: "우리 서식으로 맞추기", desc: "다른 문서 내용을 기관 서식으로", tip: "견본 문서의 여백·글꼴·항목 기호로 새 한글 문서를 만듭니다. 원본은 그대로 둡니다", icon: <Paintbrush size={22} /> },
];

/** 빈 문서로 시작할 때 고를 서식 (서식함 빈 문서 묶음의 기안문) */
const BLANK_ID = "starter:official";

function ConvertStart({ file, setFile }: { file: string; setFile: (p: string) => void }) {
  const { openInEditor } = useCreate();
  const meta = useGongmunMeta();
  const [preset, setPreset] = useState("auto");
  const [ocr, setOcr] = useState<"auto" | "force" | "off">("auto");
  const task = useTask<string>();
  const { toast } = useApp();

  return (
    <div className="kd-route-panel">
      <h2 className="kd-h2">바꿀 파일</h2>
      <FileDrop drop="create-convert" files={file ? [file] : []} onAdd={(p) => setFile(p[0])} onRemove={() => setFile("")}
        title="파일을 끌어다 놓기" hint="PDF · 워드 · 엑셀 · 스캔본 그림" pickTip="글과 표를 한글 문서로 다시 짭니다. 스캔본은 글자를 읽어서 옮깁니다" />
      {formatOf(file) === "hwp" && <Note tone="info">HWP는 바꿀 필요가 없습니다. <button type="button" className="kd-link" onClick={() => void openInEditor(file, { existing: true })}>편집기로 바로 열기</button></Note>}
      {formatOf(file) === "pdf" && <Note tone="info">쪽 모양을 그대로 살리려면 <button type="button" className="kd-link" onClick={() => void openInEditor(file, { existing: true, title: stem(file) })}>PDF를 편집기로 바로 열기</button>. 편집기가 가져오기 창을 띄우고, 저장하면 원본은 두고 새 한글 문서가 됩니다.</Note>}
      {/* 세부 옵션: 쉬운 화면에선 자동 그대로 */}
      <div className="kd-form-row kd-adv">
        <SelectField label="문서 갈래" hint="자동은 문서 모양을 보고 고릅니다" value={preset} onChange={setPreset}
          options={[{ value: "auto", label: "자동" }, ...(meta?.presets ?? []).map((p) => ({ value: p.id, label: p.label }))]} />
        <Field label="스캔 쪽 글자 읽기">
          <Seg label="글자 읽기" value={ocr} onChange={setOcr} options={[{ value: "auto", label: "필요한 쪽만" }, { value: "force", label: "모든 쪽" }, { value: "off", label: "안 함" }]} />
        </Field>
      </div>
      <ActionBar status={file ? baseName(file) : "파일을 고르면 시작합니다"} error={task.error}
        busy={task.busy && <Working label="한글 문서로 다시 짜는 중" progress={task.progress} onCancel={task.cancel} />}>
        <Button size="lg" disabled={!file} data-tip="원본은 그대로 두고 새 한글 문서를 만들어 편집기에서 엽니다" onClick={() => void task.run(async ({ signal, onProgress }) => {
          const r = await rpc("to_hwpx", { path: file, preset, ocr, output_path: await workingFile(`${stem(file)}.hwpx`) }, { signal, onProgress });
          await openInEditor(r.output_path, { title: stem(file), working: true });
          // 엔진이 알린 것(글자 층 없는 스캔 쪽, 서식 그대로 옮기지 못함)은 편집기로 넘어간 뒤에도 보이게 남긴다
          for (const w of r.warnings ?? []) toast(w, "error");
          return r.output_path;
        })}><FileInput size={15} /> 한글로 바꿔 편집하기</Button>
      </ActionBar>
    </div>
  );
}

export function ComposeStep({ active }: { active: boolean }) {
  const { createIntent, registerDrop, ai } = useApp();
  const { openInEditor } = useCreate();
  /** null: 아직 안 고름 (큰 선택 4개) */
  const [route, setRoute] = useState<Route | null>(null);
  const [convertFile, setConvertFile] = useState("");
  const [seed, setSeed] = useState<DraftSeed | null>(null);
  const [focus, setFocus] = useState<{ id: string; nonce: number } | null>(null);
  const [visited, setVisited] = useState<Set<Route>>(() => new Set<Route>());
  const [barEl, setBarEl] = useState<HTMLDivElement | null>(null);
  const handled = useRef(0);

  const go = (r: RouteIn) => {
    if (r === "blank") setFocus({ id: BLANK_ID, nonce: Date.now() });
    const to: Route = r === "blank" ? "library" : r;
    setRoute(to);
    setVisited((v) => new Set(v).add(to));
  };

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
      if (["hwp", "hwpx", "hwpml"].includes(formatOf(p))) void openInEditor(p, { existing: true });
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

  const aiOff = !ai?.configured;

  return (
    <div className="kd-compose">
      {route === null ? (
        <div className="kd-routes kd-start" role="group" aria-label="시작점">
          <h2 className="kd-h2">시작 방법</h2>
          <div className="kd-start-grid">
            {ROUTES.map((r) => (
              <button key={r.id} type="button" className="kd-start-card" onClick={() => go(r.id)} data-tip={r.tip}>
                <span className="kd-start-icon" aria-hidden="true">{r.icon}</span>
                <span className="min-w-0">
                  <span className="kd-start-title">{r.title}{r.ai && aiOff && <AiNeedBadge />}</span>
                  <span className="kd-start-desc">{r.desc}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="kd-routes kd-routes-tabs" role="tablist" aria-label="시작점">
          {ROUTES.map((r) => (
            <button key={r.id} type="button" role="tab" aria-selected={route === r.id} className="kd-route" onClick={() => go(r.id)} data-tip={r.tip}>
              <span className="kd-route-icon">{r.icon}</span>
              <span className="kd-route-name">{r.title}</span>
              {r.ai && aiOff && <AiNeedBadge />}
            </button>
          ))}
        </div>
      )}
      {route !== null && (
        <div className="kd-route-body">
          {/* 다음 동작은 바닥 고정 줄로 — 보이는 시작점만 그 자리에 그린다 */}
          {visited.has("library") && <ActionBarSlot.Provider value={route === "library" ? barEl : null}><div hidden={route !== "library"} className="h-full"><TemplateLibrary focus={focus} onStyleSample={(p) => { go("ai"); setSeed({ levelsFrom: p, nonce: Date.now() }); }} onDraft={(preset) => { go("ai"); setSeed({ preset, nonce: Date.now() }); }} /></div></ActionBarSlot.Provider>}
          {visited.has("ai") && <ActionBarSlot.Provider value={route === "ai" ? barEl : null}><div hidden={route !== "ai"} className="h-full"><DraftComposer seed={seed} onRoute={go} /></div></ActionBarSlot.Provider>}
          {visited.has("convert") && <ActionBarSlot.Provider value={route === "convert" ? barEl : null}><div hidden={route !== "convert"}><ConvertStart file={convertFile} setFile={setConvertFile} /></div></ActionBarSlot.Provider>}
          {visited.has("style") && <ActionBarSlot.Provider value={route === "style" ? barEl : null}><div hidden={route !== "style"}><StyleCopy active={active && route === "style"} /></div></ActionBarSlot.Provider>}
        </div>
      )}
      <div ref={setBarEl} className="kd-actionbar" role="region" aria-label="다음 단계" />
    </div>
  );
}
