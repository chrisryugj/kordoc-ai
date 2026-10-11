/** 한꺼번에 — 파일·폴더 여러 개 + 할 일 고르기 → 파일별 진행·결과·취소. 폴더 지켜보기 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Circle, FilePlus2, FolderPlus, Loader2, Play, Trash2, XCircle, Layers } from "lucide-react";
import type { FileEntry } from "../../lib/contract";
import { useApp, type BatchTaskId } from "../../state/app";
import { rpc, errorText, callRaw } from "../../lib/rpc";
import { notifySystem, pickFiles, pickFolder } from "../../lib/native";
import { baseName, dirName, fileSize, joinPath, num, stem } from "../../lib/format";
import { useTask } from "../../hooks/useTask";
import { detectFileType } from "../../utils/fileType";
import { ScreenHeader } from "../shell/ScreenHeader";
import { Button } from "../ui/Button";
import { Empty, ErrorLine, Note, Working } from "../common/Status";
import { FormatBadge } from "../common/FormatBadge";
import { OrderList } from "../common/OrderList";
import { MergeOrderDialog } from "../pipeline/MergeOrderDialog";
import { PdfToolsDialog } from "../pipeline/PdfToolsDialog";
import type { ImportedFile, MergeMode, PdfUtilsOptions } from "../../types/pipeline";
import { TASKS, GROUPS, DEFAULT_OPTS, accepts, type BatchOpts } from "./tasks";
import { runTask, type Outcome, type RowState } from "./runners";
import { TaskOptions, type CollectState } from "./TaskOptions";
import { BatchResults } from "./BatchResults";
import { WatchPanel } from "./WatchPanel";

const toImported = (f: FileEntry): ImportedFile => ({ path: f.path, name: f.name, size: f.size, type: detectFileType(f.name) });

function RowStatus({ s }: { s?: RowState }) {
  if (!s || (s.status === "wait" && !s.note)) return <span className="kd-status"><Circle size={13} /> 대기</span>;
  if (s.status === "run") return <span className="kd-status" data-tone="busy"><Loader2 size={13} className="kd-spin" /> 하는 중</span>;
  if (s.status === "ok") return <span className="kd-status" data-tone="ok"><CheckCircle2 size={13} /> {s.note ?? "완료"}</span>;
  if (s.status === "fail") return <span className="kd-status" data-tone="err"><XCircle size={13} /> 실패</span>;
  return <span className="kd-status"><Circle size={13} /> {s.note}</span>;
}

export function BatchScreen({ active }: { active: boolean }) {
  const { batchIntent, registerDrop, dragTarget, setBadge, ai, toast, settings } = useApp();
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [skipped, setSkipped] = useState(0);
  // 서무가 가장 자주 하는 일 (결재 첨부·정보공개·게시용 PDF)
  const [task, setTask] = useState<BatchTaskId>("pdf");
  const [opts, setOpts] = useState<BatchOpts>(DEFAULT_OPTS);
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [dialog, setDialog] = useState<"" | "merge" | "pdftools">("");
  const [collectFields, setCollectFields] = useState<Array<{ label: string; count: number }> | null>(null);
  const [watchCount, setWatchCount] = useState(0);
  const run = useTask<Outcome | null>();
  const collect = useTask<void>();
  const handled = useRef(0);
  const def = TASKS.find((t) => t.id === task)!;
  const usable = useMemo(() => files.filter((f) => accepts(def, f.format)), [files, def]);

  const add = useCallback(async (paths: string[], replace = false) => {
    if (!paths.length) return [];
    try {
      const r = await rpc("scan_paths", { paths });
      setSkipped(r.skipped);
      let merged: FileEntry[] = [];
      setFiles((prev) => {
        const base = replace ? [] : prev;
        const have = new Set(base.map((f) => f.path));
        merged = [...base, ...r.files.filter((f) => !have.has(f.path))];
        return merged;
      });
      run.reset();
      setRows({});
      return replace ? r.files : merged;
    } catch (e) {
      toast(`파일 목록을 만들지 못했습니다: ${errorText(e)}`, "error");
      return [];
    }
  }, [toast, run]);

  useEffect(() => registerDrop("batch", (p) => void add(p)), [registerDrop, add]);
  useEffect(() => setBadge("batch", run.busy ? "진행" : watchCount ? `감시 ${watchCount}` : undefined), [run.busy, watchCount, setBadge]);

  const loadCollect = useCallback((list: FileEntry[]) => void collect.run(async () => {
    const r = await rpc("collect_fields", { paths: list.map((f) => f.path) });
    setCollectFields(r.fields);
    // 가장 많이 겹치는 칸 기준 — 같은 서식만 넣으면 파일 수 기준과 같고, 다른 문서가 섞여도 가장 많은 서식의 칸이 골라진다
    const top = Math.max(0, ...r.fields.map((f) => f.count));
    setOpts((o) => ({ ...o, collectFields: r.fields.filter((f) => f.count >= Math.max(2, Math.ceil(top / 2))).map((f) => f.label) }));
  }), [collect]);

  const start = useCallback(async (list = usable, t = task) => {
    if (t === "merge") { setDialog("merge"); return; }
    if (t === "pdftools") { setDialog("pdftools"); return; }
    const outcome = await run.run((ctx) => runTask(t, { ...ctx, files: list, opts, setRow: (p, s) => setRows((r) => ({ ...r, [p]: s })) }));
    if (outcome) void notifySystem("KorDoc AI: 한꺼번에 끝", outcome.message);
  }, [usable, task, opts, run]);

  // 홈·우클릭·예제에서 넘어온 파일과 할 일 (우클릭은 바로 시작)
  useEffect(() => {
    if (!batchIntent || batchIntent.nonce === handled.current) return;
    handled.current = batchIntent.nonce;
    const { paths, task: t, autoRun } = batchIntent.value;
    if (t) setTask(t);
    void (async () => {
      const list = paths.length ? await add(paths, true) : files;
      const d = TASKS.find((x) => x.id === (t ?? task))!;
      const ok = list.filter((f) => accepts(d, f.format));
      if (t === "collect" && ok.length >= 2) loadCollect(ok);
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
    void run.run(async ({ signal }) => {
      await rpc("merge_files", { files: ordered.map((f) => f.path), output_path: out, mode }, { signal });
      return { kind: "single", message: `문서 ${ordered.length}개를 합쳤습니다`, path: out };
    });
  };

  const runPdf = (o: PdfUtilsOptions) => {
    setDialog("");
    const target = o.targetFile ?? toImported(usable[0]);
    const dir = o.outputDir || opts.outDir || settings?.convert.output_dir || dirName(target.path);
    void run.run(async ({ signal }) => {
      if (o.mode === "merge") {
        const out = joinPath(dir, `병합_${stem(usable[0].name)}.pdf`);
        await rpc("merge_files", { files: usable.map((f) => f.path), output_path: out, mode: "native" }, { signal });
        return { kind: "single", message: `PDF ${usable.length}개를 하나로 합쳤습니다`, path: out };
      }
      if (o.mode === "split") {
        const outDir = joinPath(dir, `${stem(target.name)}_분할`);
        await rpc("split_pdf", { input_path: target.path, output_dir: outDir, mode: o.splitMode ?? "each", ...(o.pages ? { ranges: o.pages } : {}) }, { signal });
        return { kind: "single", message: "PDF를 나눴습니다", path: outDir, folder: true };
      }
      const out = joinPath(dir, `${stem(target.name)}_${o.extractMode === "exclude" ? "제외" : "추출"}.pdf`);
      await rpc("pdf_extract_pages", { input_path: target.path, pages: o.pages ?? "", mode: o.extractMode ?? "include", output_path: out }, { signal });
      return { kind: "single", message: "고른 쪽으로 새 PDF를 만들었습니다", path: out };
    });
  };

  const collectState: CollectState = { fields: collectFields, busy: collect.busy, error: collect.error, load: () => loadCollect(usable) };
  const needAi = task === "extract" && !ai?.configured;
  const blocked = needAi || usable.length < def.min
    || (task === "collect" && !opts.collectFields.length) || (task === "extract" && !opts.columns.trim())
    || (task === "search" && !opts.query.trim()) || (task === "mailmerge" && !opts.dataPath) || (task === "redact" && !opts.rules.length);
  const done = Object.values(rows).filter((r) => r.status === "ok").length;
  const failed = Object.values(rows).filter((r) => r.status === "fail").length;

  return (
    <div className="kd-screen" hidden={!active}>
      <ScreenHeader title="한꺼번에" sub="여러 파일을 골라 같은 일을 한 번에 돌립니다. 폴더째 넣어도 됩니다."
        actions={task !== "watch" && (
          <>
            <Button variant="secondary" onClick={() => void pickFiles().then((p) => add(p))}><FilePlus2 size={15} /> 파일 추가</Button>
            <Button variant="secondary" onClick={() => void pickFolder().then((d) => { if (d) void add([d]); })}><FolderPlus size={15} /> 폴더 추가</Button>
          </>
        )} />
      <div className="kd-batch">
        <nav className="kd-tasklist" aria-label="할 일">
          {GROUPS.map((g) => (
            <div key={g} className="mb-3">
              <h2 className="kd-label px-2 pb-1">{g}</h2>
              {TASKS.filter((t) => t.group === g).map((t) => (
                <button key={t.id} type="button" className="kd-taskitem" aria-pressed={task === t.id} disabled={run.busy} onClick={() => { setTask(t.id); run.reset(); setRows({}); }}>
                  <span className="kd-row-title block">{t.title}</span>
                  <span className="kd-row-desc block">{t.desc}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="kd-batch-main">
          <WatchPanel active={task === "watch"} onCount={setWatchCount} />
          {task !== "watch" && (
            <>
              <section className="kd-panel kd-batch-opts" aria-labelledby="task-t">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 id="task-t" className="kd-h2">{def.title}</h2>
                    <p className="kd-small kd-muted mt-0.5">{def.desc}{def.accepts ? ` (${def.accepts.map((a) => (a === "image" ? "그림" : a.toUpperCase())).join("·")} 파일만)` : ""}</p>
                  </div>
                  {run.busy ? null : (
                    <Button size="lg" disabled={blocked} onClick={() => void start()}>
                      <Play size={15} /> 시작{usable.length ? ` (${num(usable.length)}개)` : ""}
                    </Button>
                  )}
                </div>
                <div onKeyDown={(e) => { if (e.key === "Enter" && (e.target as HTMLElement).dataset.runOnEnter !== undefined && !blocked) void start(); }}>
                  <TaskOptions task={task} opts={opts} set={(p) => setOpts((o) => ({ ...o, ...p }))} fileCount={usable.length} collect={collectState} />
                </div>
                {needAi && <Note tone="info">AI 연결이 필요합니다. 설정의 AI 연결에서 고르세요.</Note>}
                {run.busy && <Working label={`${def.title}: 진행 중`} progress={run.progress} onCancel={run.cancel} />}
                {!run.busy && !run.result && (done > 0 || failed > 0) && <p className="kd-small kd-num">완료 {num(done)} · 실패 {num(failed)}</p>}
                <ErrorLine message={run.error} />
                {run.result && <BatchResults outcome={run.result} />}
              </section>

              <section className="kd-batch-files" data-drop="batch" aria-label="파일 목록">
                <div className="kd-block-head">
                  <h2 className="kd-h3">파일 {num(files.length)}개{usable.length !== files.length ? ` (이 일에 쓰는 것 ${num(usable.length)}개)` : ""}</h2>
                  {files.length > 0 && <button type="button" className="kd-link kd-small kd-hit32" disabled={run.busy} onClick={() => { setFiles([]); setRows({}); run.reset(); setCollectFields(null); }}>모두 빼기</button>}
                </div>
                {skipped > 0 && <p className="kd-small kd-muted py-1">지원하지 않는 파일 {num(skipped)}개는 뺐습니다.</p>}
                {files.length === 0 ? (
                  <div className="kd-dropzone mt-3" data-over={dragTarget === "batch"}>
                    <Empty icon={<Layers size={28} />} title="파일을 끌어다 놓으세요" action={<Button variant="secondary" onClick={() => void pickFiles().then((p) => add(p))}><FilePlus2 size={14} /> 파일 고르기</Button>}>
                      폴더를 놓으면 안쪽 문서까지 모두 넣습니다.
                    </Empty>
                  </div>
                ) : task === "bundle" ? (
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
                            <span className="kd-row-desc block">{off ? "이 일에는 쓰지 않는 형식" : s?.error ?? (s?.output ? baseName(s.output) : `${fileSize(f.size)}`)}</span>
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
            </>
          )}
        </div>
      </div>

      {dialog === "merge" && (
        <MergeOrderDialog files={usable.map(toImported)} uniformType={(() => {
          const t = usable.map((f) => (f.format === "hwp" ? "hwpx" : f.format));
          return t.every((x) => x === t[0]) && ["hwpx", "docx", "xlsx", "pdf"].includes(t[0]) ? t[0] : null;
        })()} outputDir={opts.outDir} onConfirm={runMerge} onCancel={() => setDialog("")} />
      )}
      {dialog === "pdftools" && <PdfToolsDialog files={usable.map(toImported)} sidecarCall={callRaw} onConfirm={runPdf} onCancel={() => setDialog("")} />}
    </div>
  );
}
