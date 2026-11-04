/** 새로 쓰기 › 우리 서식으로 맞추기 — 견본 서식 고르기(저장한 서식 또는 견본 문서) → 내용 문서 고르기 → 그 서식으로 새 한글 문서 */

import { useEffect, useState } from "react";
import { Paintbrush, Save } from "lucide-react";
import type { BatchItemResult, StyleFormat } from "../../lib/contract";
import { useApp } from "../../state/app";
import { useCreate } from "./session";
import { rpc, errorText, isAbort } from "../../lib/rpc";
import { b64ToBytes } from "../../lib/rhwp";
import { FILTERS, pickFiles } from "../../lib/native";
import { baseName, formatOf, stem } from "../../lib/format";
import { useTask } from "../../hooks/useTask";
import { Button } from "../ui/Button";
import { TextField } from "../common/Field";
import { Note, StatusLine, Working } from "../common/Status";
import { FormatBadge } from "../common/FormatBadge";
import { FileDrop } from "../common/FileDrop";
import { PageStack } from "../common/PageStack";
import { useRhwpPages } from "../common/useRhwpPages";
import { ActionBar } from "./ActionBar";
import { FormatFacts, SavedStyleList, StyleResults, useSavedStyles } from "./StyleCopyParts";

type Chosen = { kind: "saved"; id: string } | { kind: "sample"; path: string; format: StyleFormat; warnings: string[] };

export function StyleCopy({ active }: { active: boolean }) {
  const { registerDrop, toast } = useApp();
  const { openInEditor } = useCreate();
  const saved = useSavedStyles();
  const [chosen, setChosen] = useState<Chosen | null>(null);
  const [name, setName] = useState("");
  const [files, setFiles] = useState<string[]>([]);
  const [results, setResults] = useState<BatchItemResult[] | null>(null);
  const extract = useTask<void>();
  const save = useTask<void>();
  const apply = useTask<void>();
  const rh = useRhwpPages();
  const [preview, setPreview] = useState<"idle" | "busy" | "ready" | "error">("idle");

  const savedEntry = chosen?.kind === "saved" ? saved.styles?.find((s) => s.id === chosen.id) : undefined;
  const format = chosen?.kind === "sample" ? chosen.format : savedEntry?.format;

  // 저장한 서식이 있으면 맨 위 것을 먼저 골라 둔다
  useEffect(() => {
    if (!chosen && saved.styles?.length) setChosen({ kind: "saved", id: saved.styles[0].id });
  }, [saved.styles, chosen]);

  // 고른 서식으로 가상의 짧은 글을 만들어 rhwp 로 그린다
  useEffect(() => {
    if (!format) return;
    const ac = new AbortController();
    setPreview("busy");
    void (async () => {
      try {
        const r = await rpc("style_preview", chosen?.kind === "saved" ? { style_id: chosen.id } : { format }, { signal: ac.signal });
        if (ac.signal.aborted) return;
        if (!r.preview_hwpx_b64 || !(await rh.open(b64ToBytes(r.preview_hwpx_b64)))) { if (!ac.signal.aborted) setPreview("error"); return; }
        if (!ac.signal.aborted) setPreview("ready");
      } catch (e) {
        if (!isAbort(e) && !ac.signal.aborted) setPreview("error");
      }
    })();
    return () => ac.abort();
    // 서식이 바뀔 때마다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [format]);

  const readSample = (path: string) => void extract.run(async () => {
    if (!/[.](hwpx?|hml)$/i.test(path)) throw new Error("견본은 HWP·HWPX 한글 문서로 넣으세요.");
    const r = await rpc("style_extract", { path });
    setChosen({ kind: "sample", path, format: r.format, warnings: r.warnings });
    setName(stem(path).slice(0, 30));
  });

  // 견본·내용 문서는 끌어다 놓아도 된다
  useEffect(() => {
    if (!active) return;
    const offFiles = registerDrop("create-style", (paths) => setFiles((f) => [...new Set([...f, ...paths])]));
    const offSample = registerDrop("create-style-sample", (paths) => paths[0] && readSample(paths[0]));
    return () => { offFiles(); offSample(); };
    // readSample 은 늘 같은 일을 한다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, registerDrop]);

  const saveFormat = () => void save.run(async () => {
    if (chosen?.kind !== "sample") return;
    const entry = await rpc("style_save", { name: name.trim(), format: chosen.format });
    await saved.reload();
    setChosen({ kind: "saved", id: entry.id });
    toast(`"${entry.name}" 서식을 저장했습니다`, "success");
  });

  const remove = async (id: string) => {
    try {
      await rpc("style_delete", { id });
      if (chosen?.kind === "saved" && chosen.id === id) setChosen(null);
      await saved.reload();
    } catch (e) {
      toast(`서식을 지우지 못했습니다: ${errorText(e)}`, "error");
    }
  };

  const run = () => void apply.run(async ({ signal, onProgress }) => {
    if (!chosen) return;
    setResults(null);
    const r = await rpc("style_apply", { source_paths: files, ...(chosen.kind === "saved" ? { style_id: chosen.id } : { sample_path: chosen.path }) }, { signal, onProgress });
    setResults(r.results);
    requestAnimationFrame(() => document.getElementById("style-step3")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  });

  const ready = !!chosen && files.length > 0;
  const okCount = results?.filter((r) => r.ok).length ?? 0;
  const styleName = chosen?.kind === "saved" ? savedEntry?.name : chosen?.kind === "sample" ? baseName(chosen.path) : "";

  return (
    <div className="kd-draft" data-solo={!format || undefined}>
      <div className="kd-draft-left">
        <section className="flex flex-col gap-3" aria-labelledby="style-step1">
          <h2 id="style-step1" className="kd-h2">1. 맞출 서식</h2>
          {saved.styles && saved.styles.length > 0 && (
            <SavedStyleList styles={saved.styles} selected={chosen?.kind === "saved" ? chosen.id : ""} onSelect={(id) => setChosen({ kind: "saved", id })} onDelete={(id) => void remove(id)} />
          )}
          {chosen?.kind !== "sample" && (
            <FileDrop drop="create-style-sample" files={[]} onAdd={(p) => readSample(p[0])} filters={FILTERS.hangul} size={saved.styles?.length ? "sm" : "lg"}
              title={saved.styles?.length ? "다른 견본 문서" : "견본 문서를 끌어다 놓기"} hint="우리 기관 HWP·HWPX 문서 하나" pickLabel="견본 문서에서 서식 읽기"
              pickTip="견본의 여백·글꼴·항목 기호를 읽습니다. 견본 파일은 바꾸지 않습니다"
              busy={extract.busy && <StatusLine tone="busy">견본의 서식을 읽는 중</StatusLine>} />
          )}
          {extract.error && <Note tone="err">{extract.error}</Note>}
          {saved.error && <Note tone="err">{saved.error}</Note>}
          {chosen?.kind === "sample" && (
            <div className="kd-inset flex flex-col gap-3 p-3">
              <div className="flex min-w-0 items-center gap-2">
                <FormatBadge format={formatOf(chosen.path)} />
                <span className="kd-row-title min-w-0 flex-1 truncate">{baseName(chosen.path)}에서 읽은 서식</span>
                <Button variant="ghost" size="sm" disabled={extract.busy} onClick={() => void pickFiles({ multiple: false, filters: FILTERS.hangul }).then((p) => p[0] && readSample(p[0]))}>다른 견본</Button>
              </div>
              <FormatFacts format={chosen.format} />
              {chosen.warnings.map((w) => <Note key={w} tone="warn">{w}</Note>)}
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-0 flex-1" style={{ maxWidth: 320 }}>
                  <TextField label="서식 이름" value={name} onChange={setName} placeholder="예: 우리 과 기안문" />
                </div>
                <Button variant="secondary" disabled={!name.trim() || save.busy} onClick={saveFormat} data-tip="다음부터 위 목록에서 바로 고릅니다"><Save size={14} /> 이 서식 저장</Button>
              </div>
              {save.error && <Note tone="err">{save.error}</Note>}
            </div>
          )}
          {chosen?.kind === "saved" && savedEntry && (
            <details className="kd-inset px-3 py-2">
              <summary className="kd-small cursor-pointer">"{savedEntry.name}" 서식 내용 보기</summary>
              <div className="pt-2"><FormatFacts format={savedEntry.format} /></div>
            </details>
          )}
        </section>

        <section className="flex flex-col gap-3" aria-labelledby="style-step2">
          <h2 id="style-step2" className="kd-h2">2. 내용 문서</h2>
          <FileDrop drop="create-style" multiple files={files} onAdd={(p) => setFiles((f) => [...new Set([...f, ...p])])} onRemove={(p) => setFiles((x) => x.filter((y) => y !== p))}
            title="내용 문서를 끌어다 놓기" hint="한글 · PDF · 워드 · 글 파일, 여러 개 가능" pickTip="글과 표는 그대로 두고 모양만 바꿉니다" />
        </section>

        {results && (
          <section className="flex flex-col gap-3" aria-labelledby="style-step3">
            <h2 id="style-step3" className="kd-h2">3. 결과</h2>
            <p className="kd-small kd-muted">원래 이름_우리서식.hwpx · 원본은 그대로</p>
            <StyleResults results={results} onOpen={(p) => void openInEditor(p, { existing: true })} />
          </section>
        )}

        <ActionBar
          status={!chosen ? "맞출 서식을 고르세요" : !files.length ? `서식: ${styleName} · 내용 문서를 넣으세요` : results ? `${okCount}개를 만들었습니다${results.length - okCount ? ` · ${results.length - okCount}개는 만들지 못했습니다` : ""}` : `서식: ${styleName} · 문서 ${files.length}개`}
          error={apply.error}
          busy={apply.busy && <Working label="서식을 맞추는 중" progress={apply.progress} onCancel={apply.cancel} />}>
          <Button size="lg" disabled={!ready} onClick={run} data-tip="문서마다 원래 이름_우리서식.hwpx를 새로 만듭니다. 원본은 그대로입니다"><Paintbrush size={15} /> 우리 서식으로 만들기</Button>
        </ActionBar>
      </div>

      {format && <aside className="kd-draft-right" aria-label="서식 미리보기">
        <div className="kd-draft-right-head">
          <h2 className="kd-h3">이 서식으로 만들면</h2>
          {preview === "busy" ? <StatusLine tone="busy">그리는 중</StatusLine>
            : preview === "error" ? <StatusLine tone="warn">미리보기를 그리지 못했습니다</StatusLine>
            : <span className="kd-small kd-muted">가상의 글로 그린 모양</span>}
        </div>
        <div className="kd-draft-pages">
          {preview !== "error" && rh.pageCount ? <PageStack pageCount={rh.pageCount} sizes={rh.sizes} pages={rh.pages} onNeed={rh.need} zoom="fit" maxFit={620} /> : <div className="kd-desk h-full" />}
        </div>
      </aside>}
    </div>
  );
}
