/** 편집 보조 패널 — 칸 채우기 · 표기법 검사 · 법령 근거 확인 · AI 다듬기 · K팀장 검토 (편집기와 postMessage 로 주고받음) */

import { useEffect, useState, type KeyboardEvent } from "react";
import { ClipboardCheck, Download, Replace, Scale, Sparkles, SpellCheck, Square, Undo2 } from "lucide-react";
import type { LintFinding, ReviewIssue, RpcResult } from "../../lib/contract";
import { useApp } from "../../state/app";
import { useCreate, visibleField } from "./session";
import { rpc, errorText } from "../../lib/rpc";
import { useTask } from "../../hooks/useTask";
import { Button } from "../ui/Button";
import { Seg } from "../common/Field";
import { ErrorLine, Note, Working } from "../common/Status";
import { IssueList, LawResults, LintList } from "../workbench/tools/ReviewTool";
import { TemplateForm, type FormField } from "./TemplateForm";

type Tab = "fields" | "lint" | "law" | "rewrite" | "review";
const TABS: Array<{ id: Tab; label: string }> = [
  { id: "fields", label: "칸 채우기" },
  { id: "lint", label: "표기법" },
  { id: "law", label: "법령" },
  { id: "rewrite", label: "AI 다듬기" },
  { id: "review", label: "K팀장" },
];

function FieldsTab() {
  const { call, editorState, docSeq } = useCreate();
  const [fields, setFields] = useState<FormField[] | null>(null);
  const [initial, setInitial] = useState<Record<string, string>>({});
  const [nonce, setNonce] = useState(0);
  const load = useTask<void>();
  const put = useTask<{ applied: string[]; missing: string[] }>();

  const reload = () => void load.run(async () => {
    const names = (await call("fields", {})).names.filter(visibleField);
    const vals = names.length ? (await call("get_fields", { names })).values : {};
    setFields(names.map((n) => ({ name: n })));
    setInitial(vals);
    setNonce((x) => x + 1);
  });
  useEffect(() => {
    if (editorState === "ready" && docSeq) reload();
    // 편집기에 문서를 새로 열 때마다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docSeq]);

  if (editorState !== "ready" || !docSeq) return <Note tone="info">편집기에 문서가 열리면 누름틀 칸을 읽어 옵니다.</Note>;
  return (
    <div className="flex flex-col gap-3">
      {load.busy && <Working label="칸 목록을 읽는 중" />}
      <ErrorLine message={load.error} />
      {fields && fields.length === 0 && <Note tone="info">이 문서에는 이름 붙은 칸(누름틀)이 없습니다. 편집기에서 바로 쓰세요.</Note>}
      {fields && fields.length > 0 && (
        <TemplateForm key={nonce} compact fields={fields} initial={initial} finishLabel="편집기에 넣기" busy={put.busy}
          onFinish={(values) => void put.run(() => call("put_fields", { values }))} />
      )}
      <ErrorLine message={put.error} />
      {put.result && (
        put.result.missing.length
          ? <Note tone="warn">{put.result.applied.length}칸을 넣었습니다. 찾지 못한 칸: {put.result.missing.join(", ")}</Note>
          : <Note tone="ok">{put.result.applied.length}칸을 넣었습니다. 편집기의 실행 취소 한 번이면 모두 되돌립니다.</Note>
      )}
    </div>
  );
}

function LintTab() {
  const { toast } = useApp();
  const { call, editorState } = useCreate();
  const lint = useTask<{ findings: LintFinding[]; counts: { error: number; warning: number; info: number } }>();
  const pick = (f: LintFinding) => {
    if (!f.excerpt) return;
    void call("find", { text: f.excerpt }).then((r) => { if (!r.found) toast("편집기에서 그 글자를 찾지 못했습니다", "info"); }).catch((e) => toast(errorText(e), "error"));
  };
  return (
    <div className="flex flex-col gap-3">
      <p className="kd-small kd-muted">지금 편집기에 있는 글을 공문서 표기 규칙으로 검사합니다. 결과를 누르면 그 자리로 갑니다.</p>
      {lint.busy ? <Working label="검사하는 중" /> : (
        <Button disabled={editorState !== "ready"} onClick={() => void lint.run(async () => rpc("lint", { text: (await call("text", {})).text, numbers: true }))}><SpellCheck size={14} /> 검사하기</Button>
      )}
      <ErrorLine message={lint.error} />
      {lint.result && (
        <>
          <p className="kd-small kd-num">고칠 것 {lint.result.counts.error} · 살필 것 {lint.result.counts.warning} · 참고 {lint.result.counts.info}</p>
          <LintList findings={lint.result.findings} onPick={pick} />
        </>
      )}
    </div>
  );
}

function LawTab() {
  const { toast } = useApp();
  const { call, editorState } = useCreate();
  const law = useTask<RpcResult<"law_check">>();
  const pick = (c: { text: string }) => {
    void call("find", { text: c.text }).then((r) => { if (!r.found) toast("편집기에서 그 인용을 찾지 못했습니다", "info"); }).catch((e) => toast(errorText(e), "error"));
  };
  return (
    <div className="flex flex-col gap-3">
      <p className="kd-small kd-muted">지금 편집기 글에서 「법령명」 제N조 인용을 찾아 법제처 현행 법령과 대조합니다. 인용을 누르면 그 자리로 갑니다.</p>
      {law.busy ? <Working label="법령 인용을 찾는 중" progress={law.progress} onCancel={law.cancel} /> : (
        <Button disabled={editorState !== "ready"} onClick={() => void law.run(async ({ signal, onProgress }) => rpc("law_check", { text: (await call("text", {})).text }, { signal, onProgress }))}><Scale size={14} /> 법령 근거 확인</Button>
      )}
      <ErrorLine message={law.error} />
      {law.result && <LawResults result={law.result} onPick={pick} />}
    </div>
  );
}

type Mode = "polish" | "concise" | "gaejosik" | "narrative" | "public" | "formal";
const MODES: Array<{ value: Mode; label: string }> = [
  { value: "polish", label: "다듬기" }, { value: "concise", label: "간결하게" }, { value: "gaejosik", label: "개조식" },
  { value: "narrative", label: "서술문" }, { value: "public", label: "쉬운 공공언어" }, { value: "formal", label: "공문체" },
];

function RewriteTab() {
  const { toast, ai } = useApp();
  const { call, editorState, focusEditor } = useCreate();
  const [source, setSource] = useState("");
  const [mode, setMode] = useState<Mode>("polish");
  const [out, setOut] = useState("");
  const [replaced, setReplaced] = useState(false);
  const grab = useTask<void>();
  const rewrite = useTask<void>();
  const replace = useTask<void>();

  const take = () => void grab.run(async () => {
    const r = await call("selection_text", {});
    setSource(r.text);
    setOut("");
    setReplaced(false);
    if (!r.text.trim()) throw new Error("편집기에서 고칠 글을 고르거나, 고칠 문단에 커서를 두세요.");
  });
  const run = () => {
    setOut("");
    setReplaced(false);
    void rewrite.run(async ({ signal }) => {
      const r = await rpc("ai_rewrite", { text: source, mode }, { signal, onToken: (t) => setOut((o) => o + t) });
      setOut(r.text);
    });
  };
  const put = () => void replace.run(async () => {
    const r = await call("replace_selection", { text: out });
    if (r.ok) { setReplaced(true); toast("편집기의 글을 바꿨습니다", "success"); return; }
    if (r.fallback === "paste") {
      await navigator.clipboard.writeText(out);
      focusEditor();
      toast("문단을 선택해 두었습니다. Ctrl+V(맥은 ⌘V)로 붙여 넣으세요.", "info");
      return;
    }
    throw new Error(r.reason || "바꿔 넣지 못했습니다. 글을 복사해 직접 붙여 넣으세요.");
  });

  if (!ai?.configured) return <Note tone="info">AI 연결이 필요합니다. 설정의 AI 연결에서 고르세요.</Note>;
  return (
    <div className="flex flex-col gap-3">
      <Button variant="secondary" disabled={editorState !== "ready" || grab.busy} onClick={take}><Download size={14} /> 고른 글 가져오기</Button>
      <ErrorLine message={grab.error} />
      <textarea className="kd-textarea" rows={4} value={source} onChange={(e) => setSource(e.target.value)} placeholder="편집기에서 글을 고른 뒤 가져오거나, 여기에 붙여 넣으세요" aria-label="고칠 글" />
      <Seg label="다듬는 방식" value={mode} onChange={setMode} options={MODES} />
      {rewrite.busy ? <Button variant="secondary" onClick={rewrite.cancel}><Square size={13} /> 멈추기</Button> : (
        <Button disabled={!source.trim()} onClick={run}><Sparkles size={14} /> 다듬기</Button>
      )}
      <ErrorLine message={rewrite.error} />
      {out && (
        <div className="kd-inset flex flex-col gap-2 p-3">
          <span className="kd-label">미리보기</span>
          <p className="kd-text kd-pre" aria-live="polite">{out}</p>
          {!rewrite.busy && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={put} disabled={replace.busy || editorState !== "ready"}><Replace size={13} /> 바꿔 넣기</Button>
              {replaced && <Button size="sm" variant="secondary" onClick={() => void call("undo", {}).then(() => setReplaced(false))}><Undo2 size={13} /> 되돌리기</Button>}
            </div>
          )}
          <ErrorLine message={replace.error} />
        </div>
      )}
    </div>
  );
}

function ReviewTab() {
  const { ai } = useApp();
  const { session, ensureSaved, syncDirty, call } = useCreate();
  const review = useTask<{ summary: string; issues: ReviewIssue[]; lint: LintFinding[]; redacted: number }>();
  const run = () => void review.run(async ({ signal }) => {
    const path = (await syncDirty()) ? await ensureSaved() : session?.path;
    if (!path) throw new Error("검토하려면 먼저 파일을 저장하세요.");
    return rpc("ai_review", { path }, { signal });
  });
  if (!ai?.configured) return <Note tone="info">AI 연결이 필요합니다. 설정의 AI 연결에서 고르세요.</Note>;
  return (
    <div className="flex flex-col gap-3">
      <p className="kd-small kd-muted">결재 올리기 전 팀장 눈으로 앞뒤 논리, 숫자, 날짜와 요일을 봅니다.{session?.dirty ? " 고친 내용을 먼저 저장한 뒤 검토합니다." : ""}</p>
      {review.busy ? <Working label="검토하는 중" onCancel={review.cancel} /> : (
        <Button onClick={run}><ClipboardCheck size={14} /> {session?.dirty ? "저장하고 검토 받기" : "검토 받기"}</Button>
      )}
      <ErrorLine message={review.error} />
      {review.result && (
        <>
          <div className="kd-inset p-3"><p className="kd-text">{review.result.summary}</p></div>
          <IssueList issues={review.result.issues} />
          {review.result.lint.length > 0 && <LintList findings={review.result.lint} onPick={(f) => f.excerpt && void call("find", { text: f.excerpt })} />}
        </>
      )}
    </div>
  );
}

export function EditorAssist() {
  const [tab, setTab] = useState<Tab>("fields");
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const i = TABS.findIndex((t) => t.id === tab);
    setTab(TABS[(i + (e.key === "ArrowRight" ? 1 : -1) + TABS.length) % TABS.length].id);
  };
  return (
    <aside className="kd-assist" aria-label="편집 보조">
      <div className="kd-tabs px-2" role="tablist" aria-label="보조 도구" onKeyDown={onKey}>
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" className="kd-tab" aria-selected={tab === t.id} tabIndex={tab === t.id ? 0 : -1} onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </div>
      <div className="kd-assist-body" role="tabpanel">
        <div hidden={tab !== "fields"}><FieldsTab /></div>
        <div hidden={tab !== "lint"}><LintTab /></div>
        <div hidden={tab !== "law"}><LawTab /></div>
        <div hidden={tab !== "rewrite"}><RewriteTab /></div>
        <div hidden={tab !== "review"}><ReviewTab /></div>
      </div>
    </aside>
  );
}
