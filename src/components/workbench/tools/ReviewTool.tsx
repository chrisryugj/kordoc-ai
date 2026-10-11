/** 검토 — 공문서 표기법 검사(lint) + K팀장 검토(AI 논리·숫자·날짜) + 법령 근거 확인(법제처 대조) */

import { ClipboardCheck, Copy, Scale, SpellCheck, Wand2 } from "lucide-react";
import type { ToolProps } from "../ToolPanel";
import type { LintFinding, ReviewIssue, RpcResult } from "../../../lib/contract";
import { useState } from "react";
import { useApp } from "../../../state/app";
import { rpc } from "../../../lib/rpc";
import { useTask } from "../../../hooks/useTask";
import { Button } from "../../ui/Button";
import { ErrorLine, Note, SavedFile, Working } from "../../common/Status";
import { Check } from "../../common/Field";
import { isHangul } from "../../../lib/format";

const SEV: Record<string, { label: string; tone: string }> = {
  error: { label: "고칠 것", tone: "err" },
  warning: { label: "살필 것", tone: "warn" },
  info: { label: "참고", tone: "info" },
};

export function LintList({ findings, onPick, picked, onToggle }: {
  findings: LintFinding[]; onPick?: (f: LintFinding) => void;
  /** 고칠 거리(fix)가 있는 지적을 고르는 상자 (서식 그대로 고치기) */
  picked?: Set<number>; onToggle?: (i: number) => void;
}) {
  if (!findings.length) return <Note tone="ok">표기법에 걸린 곳이 없습니다.</Note>;
  return (
    <ul className="kd-findings">
      {findings.map((f, i) => {
        const body = (
          <>
            <span className="flex flex-wrap items-center gap-1.5">
              <span className="kd-badge" data-tone={SEV[f.severity].tone}>{SEV[f.severity].label}</span>
              <span className="kd-small font-semibold">{f.rule}</span>
              {f.line != null && <span className="kd-small kd-muted kd-num">{f.line}줄</span>}
            </span>
            <span className="kd-text block mt-1">{f.message}</span>
            {(f.excerpt || f.suggestion) && (
              <span className="kd-small block mt-1">
                {f.excerpt && <span className="kd-strike">{f.excerpt}</span>}
                {(f.fix || f.suggestion) && <> 바르게: <b>{f.fix ? f.fix.to : f.suggestion}</b></>}
              </span>
            )}
          </>
        );
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

type LawResult = RpcResult<"law_check">;
type LawCitation = LawResult["citations"][number];

const LAW_STATUS: Record<LawCitation["status"], { label: string; tone?: string }> = {
  ok: { label: "맞음", tone: "ok" },
  article_missing: { label: "조문 없음", tone: "err" },
  not_found: { label: "법령 없음", tone: "err" },
  renamed: { label: "이름 바뀜", tone: "warn" },
  unchecked: { label: "확인 안 함" },
};
const ORDER: LawCitation["status"][] = ["ok", "article_missing", "not_found", "renamed", "unchecked"];
const squash = (s: string) => s.replace(/[\s·ㆍ]/g, "");

function LawDetail({ c }: { c: LawCitation }) {
  if (c.status === "renamed") return <span className="kd-small block mt-1">이름이 바뀐 법령입니다. 현행 이름: <b>{c.current_name}</b>. 조 번호도 현행 법령에서 다시 확인하세요.</span>;
  if (c.status === "not_found") return (
    <span className="kd-small block mt-1">
      현행 법령에서 이 이름을 찾지 못했습니다. {c.current_name ? <>비슷한 법령: <b>{c.current_name}</b></> : "폐지됐거나 이름이 틀렸는지, 행정규칙·자치법규인지 확인하세요."}
    </span>
  );
  if (c.status === "article_missing") return <span className="kd-small block mt-1">{c.article_text ? `현행 법령에서 삭제된 조문입니다(${c.article_text}).` : "현행 법령에 없는 조문입니다. 조 번호를 확인하세요."}</span>;
  if (c.status === "ok" && (c.article_title || c.article_text)) return (
    <span className="block mt-1">
      {c.article_title && <span className="kd-text block font-semibold">{c.article_title}</span>}
      {c.article_text && <span className="kd-small kd-muted block">{c.article_text}</span>}
    </span>
  );
  return null;
}

/** 법령 근거 확인 결과 — 인용 글·상태 배지·조문 앞부분·법제처 주소(열기 대신 주소 표시와 복사) */
export function LawResults({ result, onPick }: { result: LawResult; onPick?: (c: LawCitation) => void }) {
  const { go, settings, toast } = useApp();
  const counts = ORDER.map((s) => [s, result.citations.filter((c) => c.status === s).length] as const).filter(([, n]) => n > 0);
  const copy = (url: string) => void navigator.clipboard.writeText(url).then(() => toast("주소를 복사했습니다", "success")).catch(() => toast("주소를 복사하지 못했습니다. 주소를 직접 골라 복사하세요.", "error"));
  const needOc = !result.checked && !settings?.privacy.offline && !settings?.law?.oc;
  return (
    <>
      {counts.length > 0 && <p className="kd-small kd-num">{counts.map(([s, n]) => `${LAW_STATUS[s].label} ${n}`).join(" · ")}</p>}
      {result.note && (
        <Note tone={result.checked ? "info" : "warn"}>
          {result.note}
          {needOc && <> <button type="button" className="kd-link" onClick={() => go("settings")}>설정 열기</button></>}
        </Note>
      )}
      {result.citations.length > 0 && (
        <ul className="kd-findings">
          {result.citations.map((c, i) => (
            <li key={i} className="kd-finding">
              <span className="flex flex-wrap items-center gap-1.5">
                <span className="kd-badge" data-tone={LAW_STATUS[c.status].tone}>{LAW_STATUS[c.status].label}</span>
                {onPick ? <button type="button" className="kd-link kd-small" onClick={() => onPick(c)}>{c.text}</button> : <span className="kd-small font-semibold">{c.text}</span>}
              </span>
              {!squash(c.text).includes(squash(c.law)) && <span className="kd-small kd-muted block mt-1">법령: {c.law}</span>}
              <LawDetail c={c} />
              {c.url && (
                <span className="mt-1.5 flex items-start gap-1.5">
                  <span className="kd-path min-w-0 flex-1">법제처에서 보기: {c.url}</span>
                  <button type="button" className="kd-link kd-small shrink-0" onClick={() => copy(c.url!)}><Copy size={12} className="inline -mt-0.5" /> 복사</button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export function ReviewTool({ doc, info }: ToolProps) {
  const { ai, go } = useApp();
  const hangul = isHangul(info.format);
  const lint = useTask<{ findings: LintFinding[]; counts: { error: number; warning: number; info: number } }>();
  const [styles, setStyles] = useState(true);
  const [munche, setMunche] = useState(false);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const fix = useTask<RpcResult<"lint_fix">>();
  const toggle = (i: number) => setPicked((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; });
  const fixable = lint.result?.findings.filter((f) => f.fix).length ?? 0;
  const runFix = () => void fix.run(() => rpc("lint_fix", {
    path: doc.path,
    // 같은 말이 여러 번 걸려도 한 번만 보낸다 (엔진이 문서 안의 같은 말을 모두 바꾼다)
    fixes: [...new Map([...picked].map((i) => lint.result!.findings[i].fix!).map((f) => [`${f.from}\u0000${f.to}`, f])).values()],
  }));
  const review = useTask<{ summary: string; issues: ReviewIssue[]; lint: LintFinding[]; redacted: number }>();
  const law = useTask<LawResult>();

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3" aria-labelledby="lint-t">
        <h3 id="lint-t" className="kd-h2">공문서 표기법 검사</h3>
        <p className="kd-small kd-muted">날짜·시각·숫자·띄어쓰기·끝맺음 같은 공문서 표기 규칙을 봅니다. 인터넷 없이 이 PC에서 돌아갑니다.</p>
        {hangul && <Check label="같은 단계 항목끼리 글꼴·크기·굵기가 다른 곳도 보기" checked={styles} onChange={setStyles} />}
        <Check label="보고서·계획서의 개조식 끝맺음(함·임)도 보기" checked={munche} onChange={setMunche} />
        {lint.busy ? <Working label="검사하는 중" /> : (
          <Button onClick={() => { setPicked(new Set()); fix.reset(); void lint.run(() => rpc("lint", { path: doc.path, numbers: true, styles: hangul && styles, munche }).then((r) => {
            // 바꿀 말이 정해진 지적은 처음부터 골라 둔다 (한글 문서만 서식 그대로 고칠 수 있다)
            if (hangul) setPicked(new Set(r.findings.flatMap((f, i) => (f.fix ? [i] : []))));
            return r;
          })); }}><SpellCheck size={14} /> 검사하기</Button>
        )}
        <ErrorLine message={lint.error} />
        {lint.result && (
          <>
            <p className="kd-small kd-num">고칠 것 {lint.result.counts.error} · 살필 것 {lint.result.counts.warning} · 참고 {lint.result.counts.info}</p>
            {hangul && fixable > 0 && (
              <div className="kd-inset flex flex-col gap-2 p-3">
                <p className="kd-small">바꿀 말이 정해진 {fixable}곳은 고를 수 있습니다. 고른 것만 바꿔 서식 그대로 사본(_수정)으로 저장합니다. 원본은 그대로 둡니다.</p>
                {fix.busy ? <Working label="고치는 중" /> : (
                  <div><Button variant="secondary" disabled={!picked.size} onClick={runFix}><Wand2 size={14} /> 고른 {picked.size}곳 고쳐 저장</Button></div>
                )}
                <ErrorLine message={fix.error} />
                {fix.result && (
                  <>
                    <SavedFile path={fix.result.output_path} />
                    <p className="kd-small kd-muted kd-num">{fix.result.replaced}곳을 바꿨습니다{fix.result.skipped.length ? `. 서식을 지키려고 ${fix.result.skipped.length}곳은 건너뛰었습니다(그 부분은 한글 편집기에서 고치세요).` : "."}</p>
                  </>
                )}
              </div>
            )}
            <LintList findings={lint.result.findings} picked={hangul ? picked : undefined} onToggle={toggle} />
          </>
        )}
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="kteam-t">
        <h3 id="kteam-t" className="kd-h2">K팀장 검토(AI)</h3>
        <p className="kd-small kd-muted">팀장이 결재 전에 보듯 앞뒤 논리, 숫자 합계, 날짜와 요일을 짚어 줍니다.</p>
        {!ai?.configured ? (
          <Note tone="info">
            AI 연결이 필요합니다. <button type="button" className="kd-link" onClick={() => go("settings")}>설정에서 AI 연결하기</button>
          </Note>
        ) : review.busy ? <Working label="검토하는 중" onCancel={review.cancel} /> : (
          <Button variant="secondary" onClick={() => void review.run(({ signal }) => rpc("ai_review", { path: doc.path }, { signal }))}><ClipboardCheck size={14} /> 검토 받기</Button>
        )}
        <ErrorLine message={review.error} />
        {review.result && (
          <>
            <div className="kd-inset p-3"><p className="kd-text">{review.result.summary}</p></div>
            <IssueList issues={review.result.issues} />
          </>
        )}
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="law-t">
        <h3 id="law-t" className="kd-h2">법령 근거 확인</h3>
        <p className="kd-small kd-muted">문서 속 「법령명」 제N조 인용을 법제처 현행 법령과 대조해 없는 조문, 폐지되거나 이름이 바뀐 법령을 짚어 줍니다.</p>
        {law.busy ? <Working label="법령 인용을 찾는 중" progress={law.progress} onCancel={law.cancel} /> : (
          <Button variant="secondary" onClick={() => void law.run(({ signal, onProgress }) => rpc("law_check", { path: doc.path }, { signal, onProgress }))}><Scale size={14} /> 법령 근거 확인</Button>
        )}
        <ErrorLine message={law.error} />
        {law.result && <LawResults result={law.result} />}
      </section>
    </div>
  );
}
