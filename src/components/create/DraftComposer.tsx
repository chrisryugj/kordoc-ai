/**
 * AI 초안 — 지시·참고 문서로 초안(ai_draft, 토큰 실시간) → 글 편집기에서 손보기 →
 * (초안이 끝나면 따로 한 줄 맞춤: 마지막 줄이 몇 글자 넘친 문단만 줄여 씀, 되돌리기·멈추기 가능. 맞추는 사이 고친 글이 우선)
 * 입력을 멈추고 600ms 뒤 실시간 미리보기(generate_hwpx preview_only + preview_hwpx → 화면 안 rhwp 로 전 쪽, 안 되면 엔진의 앞쪽 PNG)
 * + 표기법 결과(누르면 그 줄로) →
 * 한글 문서로 만들어 편집 단계로.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, FileUp, Plus, Sparkles, Square, Undo2, X, FilePen } from "lucide-react";
import type { LintFinding, PagePreview } from "../../lib/contract";
import { useApp, type DraftKind } from "../../state/app";
import { useCreate } from "./session";
import { rpc, errorText, isAbort } from "../../lib/rpc";
import { pickFiles } from "../../lib/native";
import { baseName, gongmunDate } from "../../lib/format";
import { useTask } from "../../hooks/useTask";
import { useGongmunMeta } from "../../hooks/useGongmunMeta";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";
import { Field, Seg, SelectField } from "../common/Field";
import { AiWhere } from "../common/AiGate";
import { ErrorLine, Note, StatusLine, Working } from "../common/Status";
import { PageStack } from "../common/PageStack";
import { useRhwpPages } from "../common/useRhwpPages";
import { b64ToBytes } from "../../lib/rhwp";
import { LintList } from "../workbench/tools/ReviewTool";
import { FormatOptions, type FormatOpts } from "./FormatOptions";
import { ActionBar } from "./ActionBar";

export interface DraftSeed { kind?: DraftKind; references?: string[]; levelsFrom?: string; markdown?: string; nonce: number }

const KINDS: Array<{ value: DraftKind | "general"; label: string; hint: string; ref?: string }> = [
  { value: "general", label: "일반 초안", hint: "예: 10월 24일 14시 3층 대회의실에서 전 직원 안전교육을 한다는 계획 보고서" },
  { value: "reply", label: "회신", hint: "회신할 내용을 짧게 적으세요. 예: 요청한 자료를 10월 20일까지 보내겠다", ref: "받은 공문" },
  { value: "complaint", label: "민원 답변", hint: "민원 내용과 답할 방향을 적으세요", ref: "민원 서류" },
  { value: "minutes", label: "회의록", hint: "회의 메모를 그대로 붙여 넣으세요" },
  { value: "onepage", label: "한 장 보고", hint: "강조할 점을 적으세요. 줄일 문서는 위에서 붙이세요", ref: "줄일 문서" },
  { value: "press", label: "보도자료", hint: "알릴 소식을 적으세요. 예: 청년 창업 지원 공모 시작" },
  { value: "memo", label: "메모 정리", hint: "두서없이 적은 메모를 그대로 붙여 넣으세요. 회의·전화·현장 메모를 개조식 보고서로 정리합니다" },
];

interface Fit { before: string; changes: Array<{ before: string; after: string }>; remaining: number }

/** 받는 중인 초안을 기호 없이 — 제목 #, 항목 -, 표 칸 | 를 걷는다 */
const plainDraft = (md: string) => md
  .replace(/^#+\s*/gm, "").replace(/^(\s*)- /gm, "$1")
  .replace(/^\|[\s:|-]*-[\s:|-]*\|\n?/gm, "")
  .replace(/^\|(.*)\|$/gm, (_, row: string) => row.split("|").map((c) => c.trim()).join("   "));

const firstTitle = (md: string) => /^#\s+(.+)$/m.exec(md)?.[1]?.trim() ?? "새 공문서";

export function DraftComposer({ seed }: { seed: DraftSeed | null }) {
  const { ai, settings, go, docs } = useApp();
  const { openInEditor } = useCreate();
  const meta = useGongmunMeta();
  // 갈래를 고르면 문서 갈래도 맞춘다 (대응표는 엔진 gongmun_meta 가 정본)
  const kindPreset = (kd: DraftKind) => meta?.kind_presets[kd] ?? preset;
  const [kind, setKind] = useState<DraftKind | "general">("general");
  const [refs, setRefs] = useState<string[]>([]);
  const [instruction, setInstruction] = useState("");
  const [preset, setPreset] = useState("official");
  const [length, setLength] = useState<"short" | "medium" | "long">("medium");
  const [markdown, setMarkdown] = useState("");
  /** 글(마크다운) 직접 고치기 — 초안이 있으면 미리보기가 주인공이라 접어 둔다. AI 가 없으면 처음부터 펼침 */
  const [textOpen, setTextOpen] = useState(!ai?.configured);
  /** 한 줄 맞춤 결과 — before 로 되돌린다 */
  const [fit, setFit] = useState<Fit | null>(null);
  const [fitOpen, setFitOpen] = useState(false);
  /** 쓰던 초안을 덮어쓸 시작값이 왔을 때 — 고르면 이걸 부른다 */
  const [seedAsk, setSeedAsk] = useState<(() => void) | null>(null);
  const [optsOpen, setOptsOpen] = useState(false);
  const [opts, setOpts] = useState<FormatOpts>(() => ({
    agency: settings?.org.agency ?? "", cover: false, coverOrg: settings?.org.name ?? "", coverDate: gongmunDate(),
    approval: (settings?.org.approval_line ?? []).join(", "), toc: false, pageNumbers: true, endMark: true, levelsFrom: "", profileFrom: "",
  }));
  /** rhwp: 만든 HWPX 를 화면 안 rhwp 로 그림 (pages 는 비어 있음) · 아니면 엔진이 그린 앞쪽 PNG */
  const [preview, setPreview] = useState<{ pages: PagePreview[]; lint: LintFinding[]; rhwp: boolean } | null>(null);
  const [pngOnly, setPngOnly] = useState(false);
  const rh = useRhwpPages();
  const [previewState, setPreviewState] = useState<"idle" | "busy" | "error">("idle");
  const [previewError, setPreviewError] = useState("");
  const draft = useTask<void>();
  const make = useTask<void>();
  const refit = useTask<void>();
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const handledSeed = useRef(0);
  /** 지금 글 (늦게 온 한 줄 맞춤 결과가 그사이 고친 글을 덮지 않게 견준다) */
  const mdRef = useRef(markdown);
  useEffect(() => { mdRef.current = markdown; }, [markdown]);
  /** 마지막으로 한글 문서로 만든 글 — 이와 같으면 덮어써도 잃는 게 없다 */
  const made = useRef("");

  const k = KINDS.find((x) => x.value === kind)!;
  const genParams = useMemo(() => ({
    markdown, preset, ...(opts.agency ? { agency: opts.agency } : {}),
    ...(opts.cover ? { cover: { org: opts.coverOrg, date: opts.coverDate } } : {}),
    toc: opts.toc, page_numbers: opts.pageNumbers, end_mark: opts.endMark,
    approval: opts.approval.split(",").map((s) => s.trim()).filter(Boolean),
    ...(opts.levelsFrom ? { levels_from: opts.levelsFrom } : {}), ...(opts.profileFrom ? { profile_from: opts.profileFrom } : {}),
  }), [markdown, preset, opts]);

  const pickKind = (kd: DraftKind | "general") => {
    setKind(kd);
    if (kd !== "general") setPreset(kindPreset(kd));
  };

  /** 한 줄 맞춤 — 미리보기와 같은 옵션으로 재서 넘친 문단만 줄여 쓴다 */
  const fitLines = async (md: string, signal?: AbortSignal, ps = preset) => {
    const f = await rpc("ai_fit_lines", { ...genParams, preset: ps, markdown: md }, { signal });
    if (mdRef.current !== md) return; // 맞추는 사이 글을 고쳤으면 고친 글이 우선 (맞춘 결과는 버린다)
    setFit(f.changes.length || f.remaining ? { before: md, changes: f.changes, remaining: f.remaining } : null);
    setFitOpen(false);
    if (f.changes.length) setMarkdown(f.markdown);
  };

  const runDraft = (instr = instruction, kd = kind, rf = refs) => {
    setMarkdown("");
    setFit(null);
    refit.cancel();
    // 갈래를 넘겨받은 바로 그 자리(시작값)에서는 상태가 아직 안 바뀌었으니 여기서 맞춘다
    const ps = kd !== kind && kd !== "general" ? kindPreset(kd) : preset;
    void draft.run(async ({ signal }) => {
      const r = await rpc("ai_draft", {
        instruction: instr.trim() || (kd === "reply" ? "받은 공문에 협조하겠다는 회신 공문을 써 줘" : kd === "memo" ? "" : "공문서 초안을 써 줘"),
        preset: ps, length, references: rf, ...(kd !== "general" ? { kind: kd } : {}),
      }, { signal, onToken: (t) => setMarkdown((m) => m + t) });
      setMarkdown(r.markdown);
      mdRef.current = r.markdown;
      // 한 줄 맞춤은 초안을 먼저 보여 준 뒤 따로 (멈출 수 있고, 맞추는 동안 한글 문서로 만들어도 된다). 줄 맞춤은 덤: 안 되면 초안 그대로
      void refit.run(({ signal: s }) => fitLines(r.markdown, s, ps));
    });
  };

  // 홈·예제·서식함에서 넘어온 시작값 (예제 "회신"은 받은 공문을 붙인 채 바로 초안)
  useEffect(() => {
    if (!seed || seed.nonce === handledSeed.current) return;
    handledSeed.current = seed.nonce;
    const autoDraft = !!(seed.kind && seed.references?.length && ai?.configured);
    const apply = () => {
      if (seed.kind) pickKind(seed.kind);
      if (seed.references) setRefs(seed.references);
      if (seed.markdown) { setMarkdown(seed.markdown); setFit(null); }
      if (seed.levelsFrom) { setOpts((o) => ({ ...o, levelsFrom: seed.levelsFrom! })); setOptsOpen(true); }
      if (autoDraft) runDraft("", seed.kind, seed.references);
    };
    // 쓰던 초안을 덮어쓰는 시작값(보낸 글·회신 자동 초안)은 먼저 묻는다
    if ((seed.markdown || autoDraft) && markdown.trim() && markdown !== made.current) setSeedAsk(() => apply);
    else apply();
    // 시작값마다 한 번
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed]);

  // 실시간 미리보기 — 입력을 멈추고 600ms 뒤, 앞 요청은 취소
  useEffect(() => {
    if (!markdown.trim() || draft.busy) return;
    const ac = new AbortController();
    const t = setTimeout(async () => {
      setPreviewState("busy");
      try {
        const r = await rpc("generate_hwpx", { ...genParams, preview_only: true, preview_pages: 3, ...(pngOnly ? {} : { preview_hwpx: true }) }, { signal: ac.signal });
        if (r.preview_hwpx_b64) {
          try {
            if (!(await rh.open(b64ToBytes(r.preview_hwpx_b64))) || ac.signal.aborted) return;
          } catch {
            if (!ac.signal.aborted) setPngOnly(true); // rhwp 가 안 되면 엔진 PNG 로 다시
            return;
          }
          setPreview({ pages: [], lint: r.lint, rhwp: true });
        } else setPreview({ pages: r.preview ?? [], lint: r.lint, rhwp: false });
        setPreviewState("idle");
      } catch (e) {
        if (isAbort(e)) return;
        setPreviewError(errorText(e));
        setPreviewState("error");
      }
    }, 600);
    return () => { clearTimeout(t); ac.abort(); };
  }, [genParams, draft.busy, markdown, pngOnly, rh.open]);

  // rhwp 쪽 그리기가 도중에 실패하면 엔진 PNG 로
  useEffect(() => { if (rh.error) setPngOnly(true); }, [rh.error]);

  const gotoLine = (f: LintFinding) => {
    if (!f.line) return;
    setTextOpen(true);
    // 펼친 뒤 다음 그림에서 그 줄을 고른다
    requestAnimationFrame(() => selectLine(f.line!));
  };

  const selectLine = (line: number) => {
    const ta = editorRef.current;
    if (!ta) return;
    const lines = markdown.split("\n");
    const start = lines.slice(0, line - 1).reduce((a, l) => a + l.length + 1, 0);
    ta.focus();
    ta.setSelectionRange(start, start + (lines[line - 1]?.length ?? 0));
    ta.scrollTop = Math.max(0, (line - 3) * 23);
  };

  const pagesMap = useMemo(() => Object.fromEntries((preview?.pages ?? []).map((p) => [p.page, p])), [preview]);

  return (
    <div className="kd-draft">
      <div className="kd-draft-left">
        <section className="kd-panel kd-draft-ai" aria-labelledby="draft-ai-t">
          <div className="flex items-center justify-between gap-2">
            <h2 id="draft-ai-t" className="kd-h3 flex items-center gap-1.5"><Sparkles size={15} className="kd-muted" /> AI에게 초안 부탁하기</h2>
            <AiWhere />
          </div>
          {!ai?.configured ? (
            <Note tone="info">AI가 연결돼 있지 않습니다. <button type="button" className="kd-link" onClick={() => go("settings")}>설정에서 연결</button>하거나 아래에 직접 쓰세요.</Note>
          ) : (
            <>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="초안 갈래">
                {KINDS.map((x) => (
                  <button key={x.value} type="button" className="kd-chip kd-chip-lg" aria-pressed={kind === x.value} onClick={() => pickKind(x.value)}>{x.label}</button>
                ))}
              </div>
              {(k.ref || refs.length > 0) && (
                <div className="flex flex-col gap-1.5">
                  <span className="kd-label">{k.ref ?? "참고 문서"}</span>
                  {refs.map((r) => (
                    <div key={r} className="kd-inset flex items-center gap-2 px-2.5 py-1.5">
                      <span className="kd-path flex-1">{baseName(r)}</span>
                      <button type="button" className="kd-icon-btn" style={{ width: 26, height: 26 }} onClick={() => setRefs(refs.filter((x) => x !== r))} aria-label={`${baseName(r)} 빼기`}><X size={13} /></button>
                    </div>
                  ))}
                  {/* 작업대에 열어 둔 문서는 한 번에 붙인다 */}
                  {k.ref && docs.some((d) => !refs.includes(d.path)) && (
                    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="지금 연 문서">
                      <span className="kd-small kd-muted">지금 연 문서</span>
                      {docs.filter((d) => !refs.includes(d.path)).map((d) => (
                        <button key={d.path} type="button" className="kd-chip kd-docchip" title={d.path} onClick={() => setRefs([...refs, d.path])}>
                          <Plus size={12} /> <span className="kd-docchip-name">{d.name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  <div><Button variant="ghost" size="sm" onClick={() => void pickFiles().then((p) => setRefs([...new Set([...refs, ...p])]))}><FileUp size={13} /> {k.ref ? `${k.ref} 붙이기` : "참고 문서 붙이기"}</Button></div>
                </div>
              )}
              <textarea className="kd-textarea" rows={kind === "memo" ? 10 : 3} value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder={k.hint} aria-label="AI에게 부탁할 내용" />
              <div className="flex flex-wrap items-end gap-3">
                <div style={{ minWidth: 150 }}>
                  <SelectField label="문서 갈래" value={preset} onChange={setPreset} options={(meta?.presets ?? [{ id: "official", label: "기안문", description: "" }]).map((p) => ({ value: p.id, label: p.label }))} />
                </div>
                <Field label="분량"><Seg label="분량" value={length} onChange={setLength} options={[{ value: "short", label: "짧게" }, { value: "medium", label: "보통" }, { value: "long", label: "길게" }]} /></Field>
                <div className="flex-1" />
                {draft.busy
                  ? <Button variant="secondary" onClick={draft.cancel}><Square size={13} /> 멈추기</Button>
                  : <Button onClick={() => runDraft()} disabled={!!k.ref && !refs.length}><Sparkles size={14} /> 초안 쓰기</Button>}
              </div>
              {k.ref && !refs.length && <p className="kd-small kd-muted">{k.ref}부터 붙이세요.</p>}
              <ErrorLine message={draft.error} />
            </>
          )}
        </section>

        {fit && (
          <div className="kd-inset kd-fit" aria-live="polite">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              {fit.changes.length > 0 && <StatusLine tone="ok">한 줄 맞춤: {fit.changes.length}곳 줄여 씀</StatusLine>}
              {fit.remaining > 0 && <StatusLine tone="warn">아직 넘친 줄 {fit.remaining}곳</StatusLine>}
              <div className="flex-1" />
              {fit.changes.length > 0 && <button type="button" className="kd-link kd-small" aria-expanded={fitOpen} onClick={() => setFitOpen((o) => !o)}>{fitOpen ? "바뀐 곳 접기" : "바뀐 곳 보기"}</button>}
              {fit.remaining > 0 && <Button variant="ghost" size="sm" disabled={refit.busy} onClick={() => void refit.run(({ signal }) => fitLines(markdown, signal))}>{refit.busy ? "맞추는 중" : "다시 맞추기"}</Button>}
              {fit.changes.length > 0 && <Button variant="ghost" size="sm" onClick={() => { setMarkdown(fit.before); setFit(null); }}><Undo2 size={13} /> 되돌리기</Button>}
            </div>
            {fitOpen && (
              <ul className="kd-fit-list">
                {fit.changes.map((c, i) => <li key={i}><del>{c.before}</del><ins>{c.after}</ins></li>)}
              </ul>
            )}
            <ErrorLine message={refit.error} />
          </div>
        )}

        <section className="kd-fold" data-open={textOpen} aria-label="글로 직접 고치기">
          <button type="button" className="kd-fold-head" aria-expanded={textOpen} onClick={() => setTextOpen((o) => !o)}>
            <span className="kd-h3">{markdown.trim() ? "글로 직접 고치기" : "직접 쓰기"}</span>
            <span className="kd-small kd-muted flex-1 text-left">{markdown.trim() ? "미리보기의 글을 한 줄씩 고칠 때" : "AI 없이 제목과 항목을 직접 쓸 때"}</span>
            <ChevronDown size={16} className="kd-fold-chev" />
          </button>
          <div className="kd-fold-body" hidden={!textOpen}>
            <span className="kd-small kd-muted">{draft.busy ? "AI가 초안을 다 쓰면 고칠 수 있습니다. 바로 고치려면 위에서 멈추기를 누르세요." : "# 제목, 1. 가. 같은 항목 기호를 그대로 쓰면 됩니다"}</span>
            <textarea ref={editorRef} className="kd-textarea kd-mdeditor" value={markdown} readOnly={draft.busy} onChange={(e) => { setMarkdown(e.target.value); setFit(null); }}
              placeholder={"# 직원 안전교육 실시 계획\n\n1. 목적\n  가. 재난 상황에서 직원이 스스로 대피하고 민원인을 안내하도록 교육한다."} aria-label="공문서 글" spellCheck={false} />
          </div>
        </section>

        <FormatOptions value={opts} onChange={setOpts} open={optsOpen} onToggle={() => setOptsOpen((o) => !o)} />

        <ActionBar error={make.error} busy={make.busy && <Working label="한글 문서로 만드는 중" />}
          status={draft.busy ? <StatusLine tone="busy">AI가 초안을 쓰는 중</StatusLine>
            : refit.busy ? <StatusLine tone="busy">넘친 줄을 맞추는 중 (기다리지 않고 만들어도 됩니다)</StatusLine>
            : !markdown.trim() ? (ai?.configured ? "초안을 쓰면 미리보기를 보고 한글 문서로 만듭니다" : "글을 쓰면 미리보기를 보고 한글 문서로 만듭니다")
            : preview ? `초안 미리보기 ${preview.rhwp ? `${rh.pageCount}쪽` : `앞 ${preview.pages.length}쪽`}${preview.lint.length ? ` · 표기법 ${preview.lint.length}건` : ""}`
            : "미리보기를 그리는 중"}>
          {refit.busy && <Button variant="secondary" onClick={refit.cancel}><Square size={13} /> 맞추기 멈추기</Button>}
          <Button size="lg" disabled={!markdown.trim() || draft.busy} onClick={() => void make.run(async () => {
            refit.cancel(); // 맞추는 중이면 멈추고 지금 글로 만든다
            const r = await rpc("generate_hwpx", genParams);
            if (!r.output_path) throw new Error("한글 문서를 만들지 못했습니다. 글을 확인하고 다시 누르세요.");
            made.current = markdown;
            await openInEditor(r.output_path, { title: firstTitle(markdown) });
          })}><FilePen size={15} /> 한글 문서로 만들어 편집하기</Button>
        </ActionBar>
      </div>

      <aside className="kd-draft-right" aria-label="실시간 미리보기">
        <div className="kd-draft-right-head">
          <h2 className="kd-h3">미리보기</h2>
          {draft.busy ? <StatusLine tone="busy">AI가 초안을 쓰는 중</StatusLine>
            : previewState === "busy" ? <StatusLine tone="busy">그리는 중</StatusLine>
            : previewState === "error" ? <StatusLine tone="err">{previewError}</StatusLine>
            : preview ? <span className="kd-small kd-muted">{preview.rhwp ? `전체 ${rh.pageCount}쪽` : `앞 ${preview.pages.length}쪽`}</span>
            : <span className="kd-small kd-muted">글을 쓰면 여기에 공문서 모양으로 보입니다</span>}
        </div>
        <div className="kd-draft-pages">
          {/* 초안을 받는 동안엔 들어오는 글을 그대로 (제목·항목 기호만 걷어서) */}
          {draft.busy && markdown ? <div className="kd-desk h-full kd-draft-stream"><p>{plainDraft(markdown)}</p></div>
            : preview?.rhwp && rh.pageCount ? <PageStack pageCount={rh.pageCount} sizes={rh.sizes} pages={rh.pages} onNeed={rh.need} zoom="fit" maxFit={620} />
            : preview?.pages.length ? <PageStack pageCount={preview.pages.length} pages={pagesMap} zoom="fit" maxFit={620} />
            : <div className="kd-desk h-full" />}
        </div>
        {preview && (
          <div className="kd-draft-lint">
            <h3 className="kd-label mb-2">표기법 검사 {preview.lint.length ? `${preview.lint.length}건` : ""}</h3>
            <LintList findings={preview.lint} onPick={gotoLine} />
          </div>
        )}
      </aside>

      <Modal isOpen={!!seedAsk} title="쓰던 초안이 있습니다" closable={false} size="sm" onClose={() => setSeedAsk(null)}
        footer={(
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={() => setSeedAsk(null)}>쓰던 초안 두기</Button>
            <Button onClick={() => { const apply = seedAsk; setSeedAsk(null); apply?.(); }}>새 내용으로 바꾸기</Button>
          </div>
        )}>
        <p className="kd-text">다른 화면에서 보낸 내용으로 바꾸면 지금 쓰던 초안은 사라집니다. 쓰던 초안을 두면 보낸 내용은 받지 않습니다.</p>
      </Modal>
    </div>
  );
}
