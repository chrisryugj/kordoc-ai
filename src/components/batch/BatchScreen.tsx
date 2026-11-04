/** 여러 파일 한꺼번에: 파일 넣기 → 할 일·설정 → 아래 고정 시작, 끝나면 결과를 맨 위에. 문서 수합(늦게 온 파일 이어 넣기)·폴더 지켜보기 */

import "./batch.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, CheckCircle2, Circle, FilePlus2, FolderPlus, Loader2, Play, RotateCcw, Sparkles, Trash2, XCircle, Layers } from "lucide-react";
import type { FileEntry } from "../../lib/contract";
import { useApp, type BatchTaskId } from "../../state/app";
import { rpc, errorText } from "../../lib/rpc";
import { notifySystem, pickFiles, pickFolder } from "../../lib/native";
import { baseName, dirName, fileSize, joinPath, num, stem } from "../../lib/format";
import { useTask } from "../../hooks/useTask";
import { detectFileType } from "../../utils/fileType";
import { ScreenHeader } from "../shell/ScreenHeader";
import { Button } from "../ui/Button";
import { ErrorLine, Note, Working } from "../common/Status";
import { FormatBadge } from "../common/FormatBadge";
import { OrderList } from "../common/OrderList";
import { MergeOrderDialog } from "../pipeline/MergeOrderDialog";
import type { ImportedFile, MergeMode } from "../../types/pipeline";
import { TASKS, GROUPS, DEFAULT_OPTS, accepts, resultLine, type BatchOpts } from "./tasks";
import { mergeFailed, runTask, type Outcome, type RowState } from "./runners";
import { TaskOptions } from "./TaskOptions";
import { keepFromSettings } from "../workbench/tools/ReviewTool";
import { BatchResults } from "./BatchResults";
import { WatchPanel } from "./WatchPanel";

const toImported = (f: FileEntry): ImportedFile => ({ path: f.path, name: f.name, size: f.size, type: detectFileType(f.name) });

function RowStatus({ s }: { s?: RowState }) {
  if (!s || (s.status === "wait" && !s.note)) return <span className="kd-status"><Circle size={13} /> 대기</span>;
  if (s.status === "run") return <span className="kd-status" data-tone="busy"><Loader2 size={13} className="kd-spin" /> 하는 중</span>;
  if (s.status === "ok") return <span className="kd-status" data-tone="ok" title={s.note}><CheckCircle2 size={13} /> <span className="kd-status-note">{s.note ?? "완료"}</span></span>;
  if (s.status === "fail") return <span className="kd-status" data-tone="err"><XCircle size={13} /> 실패</span>;
  return <span className="kd-status" title={s.note}><Circle size={13} /> <span className="kd-status-note">{s.note}</span></span>;
}

export function BatchScreen({ active }: { active: boolean }) {
  const { batchIntent, registerDrop, dragTarget, setBadge, ai, toast, settings, startCompare, startPdf, uiMode, setUiMode, openSettings } = useApp();
  const mainRef = useRef<HTMLDivElement>(null);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [skipped, setSkipped] = useState(0);
  // 서무가 가장 품이 많이 드는 일 (부서 제출물 모으기)
  const [task, setTask] = useState<BatchTaskId>("collect");
  const [opts, setOpts] = useState<BatchOpts>(DEFAULT_OPTS);
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [dialog, setDialog] = useState<"" | "merge">("");
  const [watchCount, setWatchCount] = useState(0);
  // 문서 수합: 앞서 만든 엑셀 + 그 뒤에 더 넣은 파일 수 (다시 만들 때 같은 파일을 바꿀지 묻는다)
  const [gatherPrev, setGatherPrev] = useState("");
  const [late, setLate] = useState(0);
  const lateRef = useRef({ task, gatherPrev });
  lateRef.current = { task, gatherPrev };
  const run = useTask<Outcome | null>();
  const filesRef = useRef(files);
  filesRef.current = files;
  const busyRef = useRef(false);
  busyRef.current = run.busy;
  const handled = useRef(0);
  const def = TASKS.find((t) => t.id === task)!;
  // 쉬운 화면은 자주 쓰는 일만 (지금 고른 일은 늘 보임)
  const shown = TASKS.filter((t) => uiMode === "full" || !t.adv || t.id === task);
  const usable = useMemo(() => files.filter((f) => accepts(def, f.format)), [files, def]);

  const add = useCallback(async (paths: string[], replace = false) => {
    if (!paths.length) return [];
    try {
      const r = await rpc("scan_paths", { paths });
      setSkipped(r.skipped);
      const base = replace ? [] : filesRef.current;
      const have = new Set(base.map((f) => f.path));
      const fresh = r.files.filter((f) => !have.has(f.path));
      const added = fresh.length;
      const merged = [...base, ...fresh];
      filesRef.current = merged;
      setFiles(merged);
      const { task: t, gatherPrev: prev } = lateRef.current;
      if (!replace && t === "collect" && prev && added) setLate((n) => n + added);
      if (replace) { setGatherPrev(""); setLate(0); }
      run.reset();
      setRows({});
      return replace ? r.files : merged;
    } catch (e) {
      toast(`파일 목록을 만들지 못했습니다: ${errorText(e)}`, "error");
      return [];
    }
  }, [toast, run]);

  useEffect(() => registerDrop("batch", (p) => {
    if (busyRef.current) { toast("작업 중에는 파일을 넣을 수 없습니다. 끝나거나 멈춘 뒤 넣으세요.", "info"); return; }
    void add(p);
  }), [registerDrop, add, toast]);
  // 늦게 온 파일을 넣으면 다시 만들기 묻는 곳이 보이게 (결과 아래쪽에서 눌러도)
  useEffect(() => { if (late > 0) document.getElementById("gather-late")?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [late]);
  useEffect(() => setBadge("batch", run.busy ? "진행" : watchCount ? `지켜봄 ${watchCount}` : undefined), [run.busy, watchCount, setBadge]);

  /** again: 문서 수합을 앞서 만든 엑셀로 다시 만들기 (overwrite 면 같은 파일을 바꾸고, 아니면 번호 붙은 새 파일) */
  const start = useCallback(async (list = usable, t = task, again?: { overwrite: boolean }) => {
    if (t === "merge") { setDialog("merge"); return; }
    // 쪽 다루기는 PDF 작업 화면에서 (쪽 그림을 보며 고르고 옮긴다)
    if (t === "pdftools") { startPdf({ paths: list.map((f) => f.path) }); return; }
    const gather = { ai: !!ai?.configured, ...(again && gatherPrev ? { previous: gatherPrev, overwrite: again.overwrite } : {}) };
    const outcome = await run.run((ctx) => runTask(t, { ...ctx, files: list, opts, gather, keep: keepFromSettings(settings?.org), defaultDir: settings?.convert.output_dir || undefined, setRow: (p, s) => setRows((r) => ({ ...r, [p]: s })) }));
    if (outcome?.kind === "gather") { setGatherPrev(outcome.result.output_path); setLate(0); }
    // 결과는 맨 위에 나온다: 작은 화면에서도 보이게 올린다
    if (outcome) mainRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    if (outcome) void notifySystem("KorDoc AI: 여러 파일 작업 끝", outcome.message);
  }, [usable, task, opts, run, ai, gatherPrev, startPdf]);

  // 홈·우클릭·예제에서 넘어온 파일과 할 일 (우클릭은 바로 시작)
  useEffect(() => {
    if (!batchIntent || batchIntent.nonce === handled.current) return;
    handled.current = batchIntent.nonce;
    const { paths, task: t, autoRun } = batchIntent.value;
    if (t) {
      setTask(t);
      // 고른 할 일이 왼쪽 목록 아래쪽이어도 보이게
      requestAnimationFrame(() => requestAnimationFrame(() => document.querySelector(`.kd-tasklist [data-task="${t}"]`)?.scrollIntoView({ block: "nearest" })));
    }
    void (async () => {
      const list = paths.length ? await add(paths, true) : files;
      const d = TASKS.find((x) => x.id === (t ?? task))!;
      const ok = list.filter((f) => accepts(d, f.format));
      if (autoRun && t && ok.length >= Math.max(1, d.min)) void start(ok, t);
    })();
    // 넘어온 요청마다 한 번
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchIntent]);

  const runMerge = (ordered: ImportedFile[], mode: MergeMode, outDir?: string) => {
    setDialog("");
    const dir = outDir || opts.outDir || settings?.convert.output_dir || dirName(ordered[0].path);
    const ext = mode === "native" ? (ordered[0].type === "hwp" ? "hwpx" : ordered[0].type) : "md";
    const out = joinPath(dir, `수합_${stem(ordered[0].name)}${ordered.length > 1 ? `_외${ordered.length - 1}건` : ""}.${ext}`);
    // PDF 끼리 합치기는 합본 PDF 와 같은 길 하나로 (쪽 번호·워터마크 선택도 같다)
    if (ext === "pdf") { void bundle(ordered.map((f) => f.path), outDir); return; }
    void run.run(async ({ signal }) => {
      const r = (await rpc("merge_files", { files: ordered.map((f) => f.path), output_path: out, mode }, { signal })) as { output_path?: string } | null;
      const bad = mergeFailed(r);
      setRows(Object.fromEntries(ordered.map((f) => { const x = bad.find((b) => b.path === f.path); return [f.path, x ? { status: "fail", error: x.error } : { status: "ok" }]; })));
      return { kind: "single", message: `문서 ${ordered.length - bad.length}개를 합쳤습니다${bad.length ? ` (${bad.length}개는 넣지 못함)` : ""}`, path: r?.output_path || out };
    });
  };

  const bundle = (paths: string[], outDir?: string) => {
    const list = paths.map((p) => files.find((f) => f.path === p)!).filter(Boolean);
    return run.run((ctx) => runTask("bundle", { ...ctx, files: list, opts: { ...opts, outDir: outDir || opts.outDir }, setRow: (p, s) => setRows((r) => ({ ...r, [p]: s })) }));
  };

  const needAi = !!def.ai && !ai?.configured;
  // 시작을 못 누르는 까닭 (단추 옆에 글로)
  const blockReason = needAi ? "이 일은 AI가 문서를 읽습니다. AI를 켠 뒤 다시 오세요."
    : def.min > 0 && !files.length ? "파일을 먼저 넣으세요."
    : usable.length < def.min ? (usable.length ? `파일이 ${def.min}개 이상 있어야 합니다.` : "넣은 파일 중에 이 일에 쓸 수 있는 형식이 없습니다.")
    : task === "extract" && !opts.columns.trim() ? "뽑을 항목을 적으세요."
    : task === "search" && !opts.query.trim() ? "찾을 낱말을 적으세요."
    : task === "mailmerge" && !opts.dataPath ? "명부 파일을 고르세요."
    : task === "redact" && !opts.rules.length ? "가릴 것을 하나 이상 고르세요."
    : task === "print" && !opts.printer ? "프린터를 찾는 중이거나 연결된 프린터가 없습니다."
    : task === "stylecopy" && !opts.styleId ? "맞출 서식을 먼저 저장하세요. 새로 쓰기 › 우리 서식으로 맞추기에서 견본 문서로 서식을 저장합니다."
    : "";
  const blocked = blockReason !== "";
  const pickTask = (t: BatchTaskId) => {
    // 신구대조표는 비교 화면에서 (넣은 파일 앞 두 개를 고치기 전·후로)
    if (t === "compare") { startCompare(usable[0]?.path, usable[1]?.path); return; }
    setTask(t);
    run.reset();
    setRows({});
  };
  const done = Object.values(rows).filter((r) => r.status === "ok").length;
  const failed = Object.values(rows).filter((r) => r.status === "fail").length;

  const pickIn = () => void pickFiles().then((p) => add(p));
  const pickDir = () => void pickFolder().then((d) => { if (d) void add([d]); });
  const clearAll = () => { setFiles([]); setRows({}); run.reset(); setGatherPrev(""); setLate(0); };
  const showFiles = def.min > 0;
  const ordered = task === "bundle" || task === "join";
  const plan = resultLine(task, usable.map((f) => f.format), opts);
  const lateNote = task === "collect" && late > 0 && !!gatherPrev && !run.busy;
  const hasResult = !!run.result || !!run.error || lateNote;

  return (
    <div className="kd-screen" hidden={!active}>
      <ScreenHeader title="여러 파일 한꺼번에" sub="파일마다 같은 일을 한 번에 합니다. 원본은 그대로 둡니다." />
      <div className="kd-batch">
        <nav className="kd-tasklist" aria-label="할 일">
          {GROUPS.filter((g) => shown.some((t) => t.group === g)).map((g) => (
            <div key={g} className="mb-3">
              <h2 className="kd-label px-2 pb-1">{g}</h2>
              {shown.filter((t) => t.group === g).map((t) => (
                <button key={t.id} type="button" className="kd-taskitem" data-task={t.id} aria-pressed={task === t.id} disabled={run.busy} onClick={() => pickTask(t.id)}>
                  <span className="kd-row-title block">{t.title}{t.ai && !ai?.configured && <span className="kd-badge" data-tone="warn">AI 필요</span>}</span>
                  <span className="kd-row-desc block">{t.desc}</span>
                </button>
              ))}
            </div>
          ))}
          {shown.length < TASKS.length && (
            <button type="button" className="kd-link kd-small px-2" onClick={() => setUiMode("full")}>
              다른 일 {TASKS.length - shown.length}가지 더 보기 (전체 화면으로)
            </button>
          )}
        </nav>

        <div className="kd-batch-col">
          <div ref={mainRef} className="kd-batch-main">
            <WatchPanel active={task === "watch"} onCount={setWatchCount} />
            {task !== "watch" && (
              <>
                {hasResult && (
                  <section className="kd-panel kd-batch-result" aria-label="결과" aria-live="polite">
                    {lateNote && (
                      <div id="gather-late"><Note tone="info">
                        <p>늦게 온 파일 {num(late)}개를 넣었습니다. 앞서 만든 엑셀({baseName(gatherPrev)})을 다시 만듭니다.</p>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          <Button size="sm" data-tip="앞서 만든 엑셀을 새 내용으로 덮어씁니다" onClick={() => void start(usable, "collect", { overwrite: true })}>같은 파일 바꾸기</Button>
                          <Button size="sm" variant="secondary" data-tip="앞 엑셀은 두고 이름에 번호를 붙인 새 엑셀을 만듭니다" onClick={() => void start(usable, "collect", { overwrite: false })}>새 파일로 만들기</Button>
                        </div>
                      </Note></div>
                    )}
                    <ErrorLine message={run.error} />
                    {run.result && <BatchResults outcome={run.result} onAddLate={pickIn} />}
                  </section>
                )}

                {showFiles && (
                  <section className="kd-batch-files" data-drop="batch" aria-labelledby="batch-files-t">
                    <div className="kd-block-head">
                      <h2 id="batch-files-t" className="kd-h3 kd-batch-step"><span className="kd-batch-step-n" aria-hidden="true">1</span>파일</h2>
                      {files.length > 0 && (
                        <div className="kd-batch-files-act">
                          <span className="kd-small kd-muted kd-num">파일 {num(files.length)}개{usable.length !== files.length ? ` (이 일에 쓰는 것 ${num(usable.length)}개)` : ""}</span>
                          <button type="button" className="kd-link kd-small kd-hit32" disabled={run.busy} data-tip="목록에서만 뺍니다. 파일은 지우지 않습니다" onClick={clearAll}>모두 빼기</button>
                          <Button size="sm" variant="secondary" disabled={run.busy} onClick={pickIn}><FilePlus2 size={14} /> 파일 추가</Button>
                          <Button size="sm" variant="secondary" disabled={run.busy} data-tip="폴더 안 문서를 모두 넣습니다" onClick={pickDir}><FolderPlus size={14} /> 폴더 추가</Button>
                        </div>
                      )}
                    </div>
                    {skipped > 0 && <p className="kd-small kd-muted py-1">지원하지 않는 파일 {num(skipped)}개는 뺐습니다.</p>}
                    {files.length === 0 ? (
                      <div className="kd-dropzone kd-batch-drop mt-3" data-over={dragTarget === "batch"} data-tip="폴더를 놓으면 안쪽 문서까지 모두 넣습니다">
                        <Layers size={28} className="kd-muted" aria-hidden="true" />
                        <p className="kd-h3">파일·폴더를 끌어다 놓기</p>
                        <div className="kd-batch-drop-btns">
                          <Button onClick={pickIn}><FilePlus2 size={15} /> 파일 고르기</Button>
                          <Button variant="secondary" data-tip="폴더 안 문서를 모두 넣습니다" onClick={pickDir}><FolderPlus size={15} /> 폴더 고르기</Button>
                        </div>
                      </div>
                    ) : ordered ? (
                      <div className="mt-2"><OrderList items={usable.map((f) => f.path)} onChange={(order) => setFiles((prev) => [...order.map((p) => prev.find((f) => f.path === p)!), ...prev.filter((f) => !order.includes(f.path) && !accepts(def, f.format))])} /></div>
                    ) : (
                      <ul className="kd-filetable">
                        {files.map((f) => {
                          const s = rows[f.path];
                          const off = !accepts(def, f.format);
                          return (
                            <li key={f.path} className="kd-filerow" data-off={off}>
                              <FormatBadge format={f.format} />
                              <span className="min-w-0 flex-1">
                                <span className="kd-row-title block" style={{ overflowWrap: "anywhere" }}>{f.name}</span>
                                <span className="kd-row-desc block" title={s?.output ?? f.path}>{off ? "이 일에는 쓰지 않는 형식" : s?.error ?? (s?.output ? baseName(s.output) : `${baseName(dirName(f.path))} 폴더 · ${fileSize(f.size)}`)}</span>
                              </span>
                              <RowStatus s={s} />
                              {s?.output && <button type="button" className="kd-link kd-small kd-hit32 flex-none" onClick={() => void rpc("reveal_file", { path: s.output! }).catch(() => undefined)}>폴더에서 보기</button>}
                              <button type="button" className="kd-icon-btn" disabled={run.busy} onClick={() => setFiles((prev) => prev.filter((x) => x.path !== f.path))} aria-label={`${f.name} 빼기`}><Trash2 size={14} /></button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </section>
                )}

                <section className="kd-panel kd-batch-opts" aria-labelledby="task-t">
                  <div className="min-w-0">
                    <h2 id="task-t" className="kd-h2 kd-batch-step">{showFiles && <span className="kd-batch-step-n" aria-hidden="true">2</span>}{def.title}</h2>
                    <p className="kd-small kd-muted mt-0.5">{def.desc}{def.accepts ? ` (${def.accepts.map((a) => (a === "image" ? "그림" : a.toUpperCase())).join("·")} 파일만)` : ""}</p>
                  </div>
                  {plan && <p className="kd-batch-plan" role="status"><ArrowRight size={16} aria-hidden="true" />{plan}</p>}
                  <div onKeyDown={(e) => { if (e.key === "Enter" && (e.target as HTMLElement).dataset.runOnEnter !== undefined && !blocked) void start(); }}>
                    <TaskOptions task={task} opts={opts} set={(p) => setOpts((o) => ({ ...o, ...p }))} formats={usable.map((f) => f.format)} />
                  </div>
                </section>
              </>
            )}
          </div>

          {task !== "watch" && (
            <div className="kd-batch-go" role="group" aria-label="시작">
              {run.busy ? (
                <div className="kd-batch-go-work"><Working label={`${def.title}: 진행 중`} progress={run.progress} onCancel={run.cancel} /></div>
              ) : (
                <>
                  <div className="kd-batch-go-msg">
                    {blocked ? (
                      <>
                        <p id="task-block" className="kd-small kd-muted">{blockReason}</p>
                        {needAi && <Button size="sm" variant="secondary" onClick={() => openSettings("set-ai")}><Sparkles size={13} /> AI 켜기</Button>}
                      </>
                    ) : (done > 0 || failed > 0) && !run.result ? (
                      <p className="kd-small kd-num">완료 {num(done)} · 실패 {num(failed)}</p>
                    ) : run.result ? (
                      <p className="kd-small kd-muted">완료. 결과는 위에 있습니다.</p>
                    ) : (
                      <p className="kd-small kd-muted">{def.title}{usable.length ? ` · 파일 ${num(usable.length)}개` : ""}</p>
                    )}
                  </div>
                  {run.result ? (
                    <Button size="lg" disabled={blocked} data-tip="같은 파일과 지금 설정으로 한 번 더 합니다" onClick={() => void start()}>
                      <RotateCcw size={15} /> 다시 하기
                    </Button>
                  ) : (
                    <Button size="lg" disabled={blocked} data-tip="넣은 파일마다 고른 일을 합니다. 원본 파일은 바꾸지 않습니다" onClick={() => void start()} aria-describedby={blocked ? "task-block" : undefined}>
                      <Play size={15} /> 시작{usable.length ? ` (${num(usable.length)}개)` : ""}
                    </Button>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {dialog === "merge" && (
        <MergeOrderDialog files={usable.map(toImported)} uniformType={(() => {
          const t = usable.map((f) => (f.format === "hwp" ? "hwpx" : f.format));
          return t.every((x) => x === t[0]) && ["hwpx", "docx", "xlsx", "pdf"].includes(t[0]) ? t[0] : null;
        })()} outputDir={opts.outDir} onConfirm={runMerge} onCancel={() => setDialog("")} />
      )}
    </div>
  );
}
