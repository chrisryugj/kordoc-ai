/** 검토 — 결재 전 한 번에 점검: 엔진의 빠른 검사(표기법·날짜와 요일·표 합계·끝. 표시·빈칸·개인정보)를 먼저 보이고,
 *  K팀장(AI)·법령 근거는 뒤에서 이어 붙인다. 고칠 수 있는 것은 서식 그대로 사본으로 고치고 그 사본을 다시 점검한다. */

import { ChevronRight, ClipboardCheck, Eye, Wand2 } from "lucide-react";
import type { ToolProps } from "../ToolPanel";
import type { LintFinding, ReviewIssue, RpcResult } from "../../../lib/contract";
import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../../../state/app";
import { rpc } from "../../../lib/rpc";
import { useTask } from "../../../hooks/useTask";
import { Button } from "../../ui/Button";
import { ErrorLine, Note, SavedFile, StatusLine, Working } from "../../common/Status";
import { Check } from "../../common/Field";
import { isHangul } from "../../../lib/format";
import { LawResults, lawReason, type LawCitation } from "./LawResults";

const SEV: Record<string, { label: string; tone: string }> = {
  error: { label: "고칠 것", tone: "err" },
  warning: { label: "살필 것", tone: "warn" },
  info: { label: "참고", tone: "info" },
};
const ORDER = { error: 0, warning: 1, info: 2 } as const;

/** 지적 한 건의 몸 — 갈래·쪽·설명·걸린 곳(낱말 단위)·바르게 고친 모양. 규칙 코드는 보이지 않는다 */
type Shown = Pick<LintFinding, "severity" | "message"> & Partial<Pick<LintFinding, "category" | "page" | "context" | "excerpt" | "fix" | "suggestion">>;

export function FindingBody({ f }: { f: Shown }) {
  const context = f.context ?? (f.excerpt && f.excerpt !== f.fix?.from ? f.excerpt : undefined);
  return (
    <>
      <span className="flex flex-wrap items-center gap-1.5">
        <span className="kd-badge" data-tone={SEV[f.severity].tone}>{SEV[f.severity].label}</span>
        <span className="kd-small font-semibold">{f.category ?? "표기"}</span>
        {f.page != null && <span className="kd-small kd-muted kd-num">{f.page}쪽</span>}
      </span>
      <span className="kd-text block mt-1">{f.message}</span>
      {context && <span className="kd-small kd-muted block mt-1 text-balance">{context}</span>}
      {f.fix ? (
        <span className="kd-small block mt-1 text-balance"><span className="kd-strike">{f.fix.from}</span> → 바르게: <b>{f.fix.to}</b></span>
      ) : f.suggestion && (
        <span className="kd-small block mt-1 text-pretty">{/^예:/.test(f.suggestion) ? f.suggestion : <>바르게: <b>{f.suggestion}</b></>}</span>
      )}
    </>
  );
}

export function LintList({ findings, onPick, picked, onToggle }: {
  findings: LintFinding[]; onPick?: (f: LintFinding) => void;
  /** 고칠 거리(fix)가 있는 지적을 고르는 상자 (서식 그대로 고치기) */
  picked?: Set<number>; onToggle?: (i: number) => void;
}) {
  if (!findings.length) return <Note tone="ok">표기법에 걸린 곳이 없습니다.</Note>;
  return (
    <ul className="kd-findings">
      {findings.map((f, i) => {
        const body = <FindingBody f={f} />;
        return (
          <li key={i} className={picked && f.fix ? "flex items-start gap-2" : undefined}>
            {picked && f.fix && (
              <input type="checkbox" className="mt-3 flex-none" checked={picked.has(i)} onChange={() => onToggle?.(i)} aria-label={`${f.fix.from}을(를) ${f.fix.to}(으)로 고치기`} />
            )}
            {onPick ? <button type="button" className="kd-finding flex-1" onClick={() => onPick(f)}>{body}</button> : <div className="kd-finding flex-1">{body}</div>}
          </li>
        );
      })}
    </ul>
  );
}

export function IssueList({ issues }: { issues: ReviewIssue[] }) {
  if (!issues.length) return <Note tone="ok">논리·숫자·날짜에서 걸린 곳이 없습니다.</Note>;
  return (
    <ul className="kd-findings">
      {issues.map((it, i) => (
        <li key={i} className="kd-finding">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="kd-badge" data-tone={SEV[it.severity].tone}>{SEV[it.severity].label}</span>
            <span className="kd-small font-semibold">{it.category}</span>
            {it.location && <span className="kd-small kd-muted">{it.location}</span>}
          </span>
          <span className="kd-text block mt-1">{it.message}</span>
          {it.suggestion && <span className="kd-small block mt-1">고치기: {it.suggestion}</span>}
        </li>
      ))}
    </ul>
  );
}

export { LawResults } from "./LawResults";

// ── 결재 전 한 번에 점검 ──

type Item = Shown & {
  key: string;
  /** 쪽을 모를 때 쪽을 찾아볼 글 */
  find?: string;
};

/** K팀장 지적 → 목록 한 줄. location 은 "3쪽 표 2 합계 행 \"원문\"" 꼴 */
function issueItem(it: ReviewIssue, i: number): Item {
  const loc = it.location ?? "";
  const quoted = /"([^"]+)"/.exec(loc)?.[1];
  const where = loc.replace(/"[^"]*"/, "").replace(/[〔〕]/g, "").trim();
  const page = /(\d+)\s*쪽/.exec(where)?.[1];
  return {
    key: `ai-${i}`, severity: it.severity, category: `K팀장 · ${it.category}`,
    message: where && !/^\d+\s*쪽$/.test(where) ? `${it.message} (${where.replace(/^\d+\s*쪽\s*/, "")})` : it.message,
    ...(quoted ? { context: quoted, find: quoted } : {}),
    ...(page ? { page: Number(page) } : {}),
    ...(it.suggestion ? { suggestion: it.suggestion } : {}),
  };
}

/** 법령 대조에서 살필 인용만 — 법령·조·항·호·목 없음, 이름 바뀜, 조문 내용과 안 맞음·확인 필요, 그 당시와 달라짐 */
function lawItems(c: LawCitation, i: number): Item[] {
  const out: Item[] = [];
  const at = { category: "법령 근거", context: c.sentence ?? c.text, find: c.text };
  if (c.status === "renamed" || c.status === "not_found" || c.status === "article_missing") {
    out.push({ key: `law-${i}`, severity: c.status === "renamed" ? "warning" : "error", message: lawReason(c) ?? "법령 인용을 확인하세요.", ...at });
  } else if (c.status === "ok" && c.match && c.match.verdict !== "match") {
    out.push({
      key: `law-${i}-m`, severity: c.match.verdict === "mismatch" ? "error" : "warning", ...at,
      message: `${c.text}: ${c.match.reason}`,
    });
  }
  if (c.changed_since) out.push({ key: `law-${i}-c`, severity: c.changed_since.kind === "deleted_since" && c.status !== "ok" ? "info" : "warning", ...at, message: `${c.text}: ${c.changed_since.reason}` });
  return out;
}

/** 설정의 기관 대표번호·팩스·내 이름 — 개인정보로 짚지 않고 가리지도 않는다 */
export function keepFromSettings(org?: { phone?: string; fax?: string; person?: string } | null): string[] {
  return [org?.phone, org?.fax, org?.person].map((v) => v?.trim() ?? "").filter((v) => v.length >= 2);
}

export function ReviewTool({ doc, info, onGoPage, autoRun = 0 }: ToolProps & { onGoPage?: (page: number) => void; autoRun?: number }) {
  const { ai, openSettings, settings, openDocs } = useApp();
  const hangul = isHangul(info.format);
  const [munche, setMunche] = useState(false);
  /** 지금 점검한 문서 (고친 뒤엔 고친 사본) */
  const [target, setTarget] = useState(doc.path);
  const pre = useTask<RpcResult<"precheck">>();
  const review = useTask<RpcResult<"ai_review">>();
  const law = useTask<RpcResult<"law_check">>();
  const fix = useTask<RpcResult<"lint_fix">>();
  const [found, setFound] = useState<Record<string, number>>({});
  const run = useRef(0);
  const keep = keepFromSettings(settings?.org);

  const runAll = (path: string) => {
    const n = ++run.current;
    setTarget(path);
    setFound({});
    review.reset();
    law.reset();
    // 빠른 검사 먼저, 다 보인 뒤 AI·법령을 뒤에서
    void pre.run(({ signal }) => rpc("precheck", { path, munche, keep }, { signal })).then((r) => {
      if (!r || n !== run.current) return;
      if (ai?.configured) void review.run(({ signal }) => rpc("ai_review", { path }, { signal }));
      void law.run(({ signal, onProgress }) => rpc("law_check", { path }, { signal, onProgress }));
    });
  };

  // 홈 "결재 올리기 전 점검"처럼 다른 화면에서 점검을 바로 시작하라고 왔으면
  const autoDone = useRef(0);
  useEffect(() => {
    if (!autoRun || autoRun === autoDone.current) return;
    autoDone.current = autoRun;
    fix.reset();
    runAll(doc.path);
    // runAll 은 매번 새로 만들어지는 함수라 요청 번호(autoRun)에만 반응한다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRun, doc.path]);

  const items = useMemo<Item[]>(() => {
    const list: Item[] = [
      ...(pre.result?.items ?? []).map((f, i) => ({ ...f, key: `e-${i}` })),
      ...(review.result?.issues ?? []).map(issueItem),
      ...(law.result?.citations ?? []).flatMap(lawItems),
    ];
    return list
      .map((x) => (x.page == null && x.find && found[x.find] ? { ...x, page: found[x.find] } : x))
      .map((x, i) => ({ x, i }))
      .sort((a, b) => ORDER[a.x.severity] - ORDER[b.x.severity] || a.i - b.i)
      .map(({ x }) => x);
  }, [pre.result, review.result, law.result, found]);

  // K팀장·법령 지적의 쪽은 엔진에 찾아 달라고 한다 (한글은 미리보기와 같은 조판으로)
  const askFor = items.filter((x) => x.page == null && x.find && !(x.find in found)).map((x) => x.find!);
  const askKey = askFor.join("\u0000");
  useEffect(() => {
    if (!askFor.length) return;
    const n = run.current;
    rpc("find_pages", { path: target, texts: askFor })
      .then((r) => { if (n === run.current) setFound((prev) => ({ ...prev, ...Object.fromEntries(askFor.map((t, i) => [t, r.pages[i] ?? 0])) })); })
      .catch(() => undefined);
    // askKey 가 바뀔 때만
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [askKey, target]);

  const counts = { error: 0, warning: 0, info: 0 };
  for (const x of items) counts[x.severity]++;
  const fixes = [...new Map(items.filter((x) => x.fix && x.key.startsWith("e-")).map((x) => [`${x.fix!.from}\u0000${x.fix!.to}`, x.fix!])).values()];
  const canFix = hangul && fixes.length > 0;
  const fixedCopy = target !== doc.path;

  const jump = (x: Item) => {
    if (x.page == null) return;
    if (!fixedCopy && onGoPage) onGoPage(x.page);
    else openDocs([target], { page: x.page });
  };
  const runFix = () => void fix.run(() => rpc("lint_fix", { path: target, fixes })).then((r) => { if (r) runAll(r.output_path); });

  const done = !!pre.result && !pre.busy;
  /** K팀장·법령 확인이 아직 돈다 — 이때 "고칠 것 0" 을 녹색으로 내면 다 본 것처럼 읽힌다 */
  const more = review.busy || law.busy;
  return (
    <div className="flex flex-col gap-4">
      <p className="kd-small kd-muted text-pretty">
        표기법, 날짜와 요일, 표 합계, 끝. 표시, 빈칸 안내 글자, 남은 개인정보를 한 번에 봅니다.
        AI가 연결되어 있으면 K팀장 검토와 법령 근거 확인도 이어서 합니다.
      </p>
      <Check label="보고서·계획서라면 개조식 끝맺음(함·임)도 보기" checked={munche} onChange={setMunche} />
      {pre.busy ? <Working label="빠른 검사를 하는 중" onCancel={pre.cancel} /> : (
        <div><Button onClick={() => { fix.reset(); runAll(doc.path); }}><ClipboardCheck size={14} /> 결재 전 한 번에 점검</Button></div>
      )}
      <ErrorLine message={pre.error} />

      {done && (
        <div className="flex flex-col gap-3" aria-live="polite">
          {fixedCopy && fix.result && (
            <>
              <SavedFile path={fix.result.output_path} label={`${fix.result.replaced}곳을 고친 사본을 저장하고 다시 점검했습니다`} />
              <div><Button variant="secondary" size="sm" onClick={() => openDocs([fix.result!.output_path])}><Eye size={13} /> 고친 사본을 작업대에서 보기</Button></div>
            </>
          )}
          {fixedCopy && fix.result && fix.result.skipped.length > 0 && (
            <p className="kd-small kd-muted kd-num">서식을 지키려고 {fix.result.skipped.length}곳은 고치지 않았습니다. 그 부분은 한글 편집기에서 고치세요.</p>
          )}
          {counts.error === 0 && more ? (
            <p className="kd-text font-semibold kd-num" role="status">빠른 검사: 고칠 것 0 · 살필 것 {counts.warning}. AI·법령 확인이 끝나면 결과를 더합니다</p>
          ) : counts.error === 0 ? (
            <Note tone="ok">
              <span className="block font-semibold">점검 결과: 고칠 것 0</span>
              {(counts.warning > 0 || counts.info > 0) && <span className="block mt-0.5 kd-num">살필 것 {counts.warning} · 참고 {counts.info}. 아래에서 한 번 더 확인하세요.</span>}
            </Note>
          ) : (
            <p className="kd-text font-semibold kd-num" role="status">점검 결과: 고칠 것 {counts.error} · 살필 것 {counts.warning} · 참고 {counts.info}</p>
          )}

          {canFix && (
            <div className="kd-inset flex flex-col gap-2 p-3">
              <p className="kd-small text-pretty">바르게 고칠 값이 정해진 {fixes.length}곳을 서식 그대로 고친 사본을 만들고, 그 사본을 다시 점검합니다. 원본은 그대로 둡니다.</p>
              {fix.busy ? <Working label="고치는 중" /> : (
                <div><Button variant="secondary" onClick={runFix}><Wand2 size={14} /> 고칠 수 있는 것 모두 고치기</Button></div>
              )}
              <ErrorLine message={fix.error} />
            </div>
          )}

          <div className="flex flex-col gap-1">
            {!ai?.configured ? (
              <StatusLine tone="muted">
                K팀장 검토(AI)는 AI 연결 시 함께 봅니다. <button type="button" className="kd-link" onClick={() => openSettings("set-ai")}>AI 연결하기</button>
              </StatusLine>
            ) : review.busy ? <Working label="K팀장이 논리·숫자·날짜를 읽는 중" onCancel={review.cancel} />
              : review.result ? <StatusLine tone="ok">K팀장 검토: {review.result.issues.length ? `${review.result.issues.length}건을 목록에 더했습니다` : "더 짚을 곳이 없습니다"}</StatusLine>
              : null}
            <ErrorLine message={review.error} />
            {law.busy ? <Working label="법령 인용을 찾는 중" progress={law.progress} onCancel={law.cancel} />
              : law.result ? (
                <StatusLine tone={law.result.checked ? "ok" : "muted"}>
                  법령 근거: {law.result.note ?? `인용 ${law.result.citations.length}건을 현행 법령과 대조했습니다`}
                  {!law.result.checked && law.result.citations.length > 0 && !settings?.privacy.offline && !settings?.law?.oc && <> <button type="button" className="kd-link" onClick={() => openSettings("set-law")}>설정 열기</button></>}
                </StatusLine>
              ) : null}
            <ErrorLine message={law.error} />
          </div>

          {items.length > 0 && (
            <ul className="kd-findings" aria-label="점검 결과 목록">
              {items.map((x) => (
                <li key={x.key}>
                  {x.page != null
                    ? <button type="button" className="kd-finding" onClick={() => jump(x)} title={`${x.page}쪽으로 가기`}><FindingBody f={x} /></button>
                    : <div className="kd-finding"><FindingBody f={x} /></div>}
                </li>
              ))}
            </ul>
          )}
          {law.result && law.result.citations.length > 0 && (
            <details className="kd-advanced" data-testid="law-detail">
              <summary><ChevronRight size={14} aria-hidden="true" /> 인용한 법령 {law.result.citations.length}건 자세히 (공문 문장과 법제처 원문)</summary>
              <div className="kd-advanced-body"><LawResults result={law.result} /></div>
            </details>
          )}
          <p className="kd-small kd-muted text-balance">
            본 것: {[...pre.result!.checked, ...(review.result ? ["K팀장"] : []), ...(law.result?.checked ? ["법령 근거"] : [])].join(" · ")}
          </p>
          {pre.result!.skipped.map((s) => <p key={s} className="kd-small kd-muted text-pretty">못 본 것: {s}</p>)}
        </div>
      )}
    </div>
  );
}
