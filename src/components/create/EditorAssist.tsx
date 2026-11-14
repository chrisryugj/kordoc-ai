/** 편집 보조 패널 — AI 대화(열린 문서를 말로 고치기) · 칸 채우기 · 점검(표기법 검사·법령 근거 확인·팀장 눈으로 검토) · AI 다듬기 (편집기와 postMessage 로 주고받음) */

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ClipboardCheck, Download, Replace, Scale, Sparkles, SpellCheck, Square, Undo2 } from "lucide-react";
import type { LintFinding, ReviewIssue, RpcResult } from "../../lib/contract";
import type { EditorParagraphTarget } from "../../../node-sidecar/src/types/editor-bridge";
import { useApp } from "../../state/app";
import { useCreate, visibleField } from "./session";
import { rpc, errorText } from "../../lib/rpc";
import { useTask } from "../../hooks/useTask";
import { Button } from "../ui/Button";
import { Seg } from "../common/Field";
import { ErrorLine, Note, Working } from "../common/Status";
import { IssueList, LawResults, LintList } from "../workbench/tools/ReviewTool";
import { TemplateForm, type FormField } from "./TemplateForm";
import { AgentChat } from "./AgentChat";
import { AiNeedBadge, AiOffNote } from "./AiOffNote";

type Tab = "agent" | "fields" | "check" | "rewrite";
const TABS: Array<{ id: Tab; label: string; tip: string }> = [
  { id: "agent", label: "AI 대화", tip: "열린 문서를 말로 고칩니다. 고친 것은 한 번에 되돌릴 수 있습니다" },
  { id: "fields", label: "칸 채우기", tip: "서식의 이름 붙은 칸(누름틀)에 값을 넣습니다" },
  { id: "check", label: "점검", tip: "표기법 검사, 법령 근거 확인, 팀장 눈으로 검토(AI)" },
  { id: "rewrite", label: "AI 다듬기", tip: "고른 글을 간결하게·개조식·공문체 등으로 바꿉니다" },
];

function FieldsTab() {
  const { call, editorState, docSeq } = useCreate();
  const [fields, setFields] = useState<FormField[] | null>(null);
  const [initial, setInitial] = useState<Record<string, string>>({});
  const [nonce, setNonce] = useState(0);
  /** 이 탭에서 편집기에 마지막으로 넣은 칸 값 */
  const sent = useRef<Record<string, string>>({});
  const load = useTask<void>();
  const put = useTask<{ applied: string[]; missing: string[] }>();

  const reload = () => void load.run(async () => {
    // 다른 문서를 열었으면 앞 문서의 칸·결과부터 지운다 (새 문서의 칸 읽기가 실패했을 때 앞 문서의 값이 새 문서에 들어가지 않게)
    setFields(null);
    put.reset();
    const names = (await call("fields", {})).names.filter(visibleField);
    const vals = names.length ? (await call("get_fields", { names })).values : {};
    setFields(names.map((n) => ({ name: n })));
    setInitial(vals);
    sent.current = {};
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
          onFinish={(values) => void put.run(async () => {
            // 이 탭에서 바꾼 칸만 넣는다. 손대지 않은 칸까지 보내면, 그사이 편집기에서 직접 쓴 글이 문서를 열 때 읽어 둔 값(빈 값)으로 덮인다
            // 기준은 이 탭이 그 칸에 마지막으로 넣은 값(없으면 문서를 열 때 값): 넣은 뒤 지우거나 처음 값으로 되돌린 것도 "바꾼 칸"이다
            const all = Object.entries(values).map(([k, v]) => [k, v ?? ""] as const);
            const base = (k: string) => (k in sent.current ? sent.current[k] : initial[k] ?? "");
            // 앞서 넣은 그 값 그대로인 칸은 다시 보내지 않는다(그사이 편집기에서 그 칸을 직접 고쳤으면 덮인다).
            // 다만 편집기에서 실행 취소해 문서를 열 때 값으로 돌아간 칸은 다시 넣는다
            const again = all.filter(([k, v]) => k in sent.current && sent.current[k] === v && v !== (initial[k] ?? "")).map(([k]) => k);
            const now = again.length ? (await call("get_fields", { names: again })).values : {};
            const undone = new Set(again.filter((k) => (now[k] ?? "") === (initial[k] ?? "")));
            const changed = Object.fromEntries(all.filter(([k, v]) => v !== base(k) || undone.has(k)));
            if (!Object.keys(changed).length) return { applied: [], missing: [] };
            // 비운 칸은 공백 한 칸으로 넣는다 (빈 값은 편집기가 칸의 안내 글자를 되살린다)
            const r = await call("put_fields", { values: Object.fromEntries(Object.entries(changed).map(([k, v]) => [k, v || " "])) });
            for (const k of r.applied) sent.current[k] = changed[k] ?? "";
            return r;
          })} />
      )}
      <ErrorLine message={put.error} />
      {put.result && (
        put.result.missing.length
          ? <Note tone="warn">{put.result.applied.length}칸을 넣었습니다. 찾지 못한 칸: {put.result.missing.join(", ")}</Note>
          : put.result.applied.length
            ? <Note tone="ok">{put.result.applied.length}칸을 넣었습니다. 편집기의 실행 취소 한 번이면 모두 되돌립니다.</Note>
            : <Note tone="info">바꾼 칸이 없어 넣지 않았습니다. 위 칸에 값을 적은 뒤 누르세요.</Note>
      )}
    </div>
  );
}

function LintTab() {
  const { toast } = useApp();
  const { call, editorState, docSeq } = useCreate();
  const lint = useTask<{ findings: LintFinding[]; counts: { error: number; warning: number; info: number } }>();
  // 편집기에 다른 문서를 열면 앞 문서의 결과는 지운다 (남으면 새 문서의 지적처럼 보이고, 눌러도 "찾지 못했습니다"만 뜬다)
  useEffect(() => lint.reset(), [docSeq, lint.reset]); // eslint-disable-line react-hooks/exhaustive-deps
  const pick = (f: LintFinding) => {
    if (!f.excerpt) return;
    void call("find", { text: f.excerpt }).then((r) => { if (!r.found) toast("편집기에서 그 글자를 찾지 못했습니다", "info"); }).catch((e) => toast(errorText(e), "error"));
  };
  return (
    <div className="kd-assist-sec">
      <h3 className="kd-h3">표기법 검사</h3>
      {lint.busy ? <Working label="검사하는 중" /> : (
        <Button variant="secondary" disabled={editorState !== "ready"} data-tip="지금 편집기 글을 공문서 표기 규칙으로 봅니다. 결과를 누르면 그 자리로 갑니다" onClick={() => void lint.run(async () => rpc("lint", { text: (await call("text", {})).text, numbers: true }))}><SpellCheck size={14} /> 검사하기</Button>
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
  const { call, editorState, docSeq } = useCreate();
  const law = useTask<RpcResult<"law_check">>();
  useEffect(() => law.reset(), [docSeq, law.reset]); // eslint-disable-line react-hooks/exhaustive-deps
  const pick = (c: { text: string }) => {
    void call("find", { text: c.text }).then((r) => { if (!r.found) toast("편집기에서 그 인용을 찾지 못했습니다", "info"); }).catch((e) => toast(errorText(e), "error"));
  };
  return (
    <div className="kd-assist-sec">
      <h3 className="kd-h3">법령 근거 확인</h3>
      {law.busy ? <Working label="법령 인용을 찾는 중" progress={law.progress} onCancel={law.cancel} /> : (
        <Button variant="secondary" disabled={editorState !== "ready"} data-tip="「법령명」 제N조 인용을 찾아 법제처 현행 법령과 대조합니다. 인용을 누르면 그 자리로 갑니다" onClick={() => void law.run(async ({ signal, onProgress }) => rpc("law_check", { text: (await call("text", {})).text }, { signal, onProgress }))}><Scale size={14} /> 법령 근거 확인</Button>
      )}
      <ErrorLine message={law.error} />
      {law.result && <LawResults result={law.result} onPick={pick} />}
    </div>
  );
}

/** 같은 본문 문단인가 (편집기 커서 자리) */
const sameParagraph = (a: EditorParagraphTarget | null, b: EditorParagraphTarget) => !!a && a.section === b.section && a.paragraph === b.paragraph;

type Mode = "polish" | "concise" | "gaejosik" | "narrative" | "public" | "formal";
const MODES: Array<{ value: Mode; label: string }> = [
  { value: "polish", label: "다듬기" }, { value: "concise", label: "간결하게" }, { value: "gaejosik", label: "개조식" },
  { value: "narrative", label: "서술문" }, { value: "public", label: "쉬운 공공언어" }, { value: "formal", label: "공문체" },
];

function RewriteTab() {
  const { toast, ai } = useApp();
  const { call, editorState, focusEditor, docSeq } = useCreate();
  const [source, setSource] = useState("");
  const [mode, setMode] = useState<Mode>("polish");
  const [out, setOut] = useState("");
  /** 바꿔 넣은 직후의 문서 변경 번호 (null: 되돌릴 것 없음). 그 뒤로 문서가 바뀌었으면 되돌리기가 다른 고침을 지운다 */
  const [replaced, setReplaced] = useState<number | null>(null);
  /** 가져온 문단 — 바꿔 넣기는 편집기가 지금 커서가 있는 문단을 바꾸므로, 넣기 직전에 커서가 아직 이 문단에 있고 글도 그대로인지 본다 */
  const picked = useRef<{ target: EditorParagraphTarget; text: string } | null>(null);
  const grab = useTask<void>();
  const rewrite = useTask<void>();
  const replace = useTask<void>();

  // 편집기에 다른 문서를 열면 앞 문서에서 가져온 글·다듬은 글·되돌리기를 지운다 (남으면 새 문서의 문단을 바꾸거나 되돌린다)
  useEffect(() => {
    grab.reset();
    rewrite.reset();
    replace.reset();
    setSource("");
    setOut("");
    setReplaced(null);
    picked.current = null;
  }, [docSeq, grab.reset, rewrite.reset, replace.reset]);

  const take = () => void grab.run(async () => {
    const r = await call("selection_text", {});
    setSource(r.text);
    setOut("");
    setReplaced(null);
    picked.current = r.target && r.text.trim() ? { target: r.target, text: r.text } : null;
    // 표 칸·글상자 안에서는 편집기가 문단을 알려 주지 않는다 (기안문 머리·결재란도 표다)
    if (!r.text.trim()) throw new Error(r.target ? "커서가 있는 문단이 비어 있습니다. 고칠 글이 있는 문단에 커서를 두세요." : "본문 문단에 커서를 두고 다시 누르세요. 표 칸 안의 글은 가져올 수 없으니 복사해서 아래 칸에 붙여 넣으세요.");
  });
  const run = () => {
    setOut("");
    setReplaced(null);
    void rewrite.run(async ({ signal }) => {
      const r = await rpc("ai_rewrite", { text: source, mode }, { signal, onToken: (t) => setOut((o) => o + t) });
      setOut(r.text);
    });
  };
  /** 바꿔 넣기·되돌리기 뒤: 커서가 아직 그 문단에 있으면 그 문단의 지금 글로 기억을 고친다 (다른 방식으로 다시 다듬어 또 바꿔 넣을 수 있게) */
  const repick = async (t: EditorParagraphTarget) => {
    const now = await call("selection_text", {}).catch(() => null);
    picked.current = now && sameParagraph(now.target, t) ? { target: t, text: now.text } : null;
  };
  const put = () => void replace.run(async () => {
    const from = picked.current;
    // 편집기에서 가져온 문단이 없다 (아래 칸에 직접 붙여 넣은 글): 어느 문단을 바꿀지 모르니 복사해 두고 붙여 넣게 한다
    if (!from) {
      await navigator.clipboard.writeText(out);
      focusEditor();
      toast("편집기에서 가져온 문단이 없어 바꿔 넣지 않고 복사해 두었습니다. 바꿀 글을 골라 Ctrl+V(맥은 ⌘V)로 붙여 넣으세요.", "info");
      return;
    }
    const now = await call("selection_text", {});
    if (!sameParagraph(now.target, from.target)) {
      toast("가져온 문단에서 커서가 옮겨졌습니다. 그 문단에 커서를 두고 다시 가져오세요.", "info");
      return;
    }
    if (now.text !== from.text) {
      toast("가져온 뒤 그 문단의 글이 바뀌었습니다. 고칠 문단을 다시 가져오세요.", "info");
      return;
    }
    const r = await call("replace_selection", { text: out });
    if (r.ok) {
      const st = await call("state", {}).catch(() => null);
      setReplaced(st ? st.changeSeq : null);
      await repick(from.target);
      toast("편집기의 글을 바꿨습니다", "success");
      return;
    }
    if (r.fallback === "paste") {
      await navigator.clipboard.writeText(out);
      focusEditor();
      toast("문단을 선택해 두었습니다. Ctrl+V(맥은 ⌘V)로 붙여 넣으세요.", "info");
      return;
    }
    throw new Error(r.reason || "바꿔 넣지 못했습니다. 글을 복사해 직접 붙여 넣으세요.");
  });
  // 바꿔 넣은 뒤 문서가 또 바뀌었으면(직접 고침·AI 대화·칸 채우기) 실행 취소가 그 고침을 지운다: 되돌리지 않고 알린다
  const undo = () => void replace.run(async () => {
    const st = await call("state", {});
    if (st.changeSeq !== replaced) {
      setReplaced(null);
      toast("바꿔 넣은 뒤 문서가 또 바뀌어 되돌리지 않았습니다. 편집기에서 실행 취소(Ctrl+Z, 맥은 ⌘Z)를 차례로 눌러 되돌리세요.", "info");
      return;
    }
    await call("undo", {});
    setReplaced(null);
    if (picked.current) await repick(picked.current.target);
  });

  if (!ai?.configured) return <AiOffNote>고른 글을 다듬으려면 AI가 필요합니다.</AiOffNote>;
  return (
    <div className="flex flex-col gap-3">
      <Button variant="secondary" disabled={editorState !== "ready" || grab.busy} onClick={take} data-tip="편집기에서 고른 글(고른 게 없으면 커서가 있는 문단)을 가져옵니다"><Download size={14} /> 고른 글 가져오기</Button>
      <ErrorLine message={grab.error} />
      <textarea className="kd-textarea" rows={4} value={source} onChange={(e) => setSource(e.target.value)} placeholder="편집기에서 글을 고른 뒤 가져오거나, 여기에 붙여 넣으세요" aria-label="고칠 글" />
      <Seg label="다듬는 방식" value={mode} onChange={setMode} options={MODES} />
      {rewrite.busy ? <Button variant="secondary" onClick={rewrite.cancel}><Square size={13} /> 멈추기</Button> : (
        <Button disabled={!source.trim()} onClick={run}><Sparkles size={14} /> 다듬기</Button>
      )}
      <ErrorLine message={rewrite.error} />
      {out && (
        <div className="kd-inset flex flex-col gap-2 p-3">
          <span className="kd-label">{rewrite.error ? "중간까지 받은 글" : "미리보기"}</span>
          <p className="kd-text kd-pre" aria-live="polite">{out}</p>
          {!rewrite.busy && (
            <div className="flex flex-wrap gap-2">
              {/* 멈췄거나 실패했으면 받은 데까지의 글이라 편집기 글을 바꾸지 않는다 */}
              {!rewrite.error && <Button size="sm" onClick={put} disabled={replace.busy || editorState !== "ready"} data-tip="편집기의 그 글을 이 글로 바꿉니다. 되돌리기로 돌아갈 수 있습니다"><Replace size={13} /> 바꿔 넣기</Button>}
              {replaced !== null && <Button size="sm" variant="secondary" onClick={undo} disabled={replace.busy}><Undo2 size={13} /> 되돌리기</Button>}
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
  const { outputFile, call, docSeq } = useCreate();
  const review = useTask<{ summary: string; issues: ReviewIssue[]; lint: LintFinding[]; redacted: number }>();
  useEffect(() => review.reset(), [docSeq, review.reset]); // eslint-disable-line react-hooks/exhaustive-deps
  // 지금 편집기 내용으로 검토한다 (저장 창 없이, 고친 게 있으면 작업 사본으로)
  const run = () => void review.run(async ({ signal }) => rpc("ai_review", { path: await outputFile() }, { signal }));
  return (
    <div className="kd-assist-sec">
      <h3 className="kd-h3 flex items-center gap-2">팀장 눈으로 검토 <span className="kd-muted">(AI)</span>{!ai?.configured && <AiNeedBadge />}</h3>
      {!ai?.configured ? <AiOffNote>앞뒤 논리, 숫자, 날짜와 요일을 AI가 봅니다.</AiOffNote>
        : review.busy ? <Working label="검토하는 중" onCancel={review.cancel} /> : (
        <Button variant="secondary" onClick={run} data-tip="결재 올리기 전 앞뒤 논리, 숫자, 날짜와 요일을 봅니다. 지금 편집기 내용 그대로 봅니다"><ClipboardCheck size={14} /> 검토 받기</Button>
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
  const [tab, setTab] = useState<Tab>("agent");
  // 편집기 AI 에 보낼 요청이 오면 AI 대화 탭으로 (다른 탭이면 고치는 과정과 되돌리기가 안 보인다)
  const { agentTask } = useCreate();
  useEffect(() => { if (agentTask) setTab("agent"); }, [agentTask]);
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const i = TABS.findIndex((t) => t.id === tab);
    setTab(TABS[(i + (e.key === "ArrowRight" ? 1 : -1) + TABS.length) % TABS.length].id);
  };
  return (
    <aside className="kd-assist" aria-label="편집 보조">
      <div className="kd-tabs px-2" role="tablist" aria-label="보조 도구" onKeyDown={onKey}>
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" className="kd-tab" aria-selected={tab === t.id} tabIndex={tab === t.id ? 0 : -1} onClick={() => setTab(t.id)} data-tip={t.tip}>{t.label}</button>
        ))}
      </div>
      <div className="kd-assist-body" role="tabpanel">
        <div hidden={tab !== "agent"}><AgentChat /></div>
        <div hidden={tab !== "fields"}><FieldsTab /></div>
        <div hidden={tab !== "check"}><LintTab /><LawTab /><ReviewTab /></div>
        <div hidden={tab !== "rewrite"}><RewriteTab /></div>
      </div>
    </aside>
  );
}
