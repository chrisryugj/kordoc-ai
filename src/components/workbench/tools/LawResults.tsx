/** 법령 근거 확인 결과 — 인용마다 판정 배지·쉬운 이유·인용 문장·법제처 원문(접기, 나란히)·그 당시 원문과 차이·주소 복사.
 *  검토 탭, 편집기 도우미, 접수함(받은 공문)이 같이 쓴다. 조문 글은 늘 법제처 원문만 보인다. */

import { ChevronRight, Copy } from "lucide-react";
import type { RpcResult } from "../../../lib/contract";
import { useApp } from "../../../state/app";
import { Note } from "../../common/Status";

export type LawResult = RpcResult<"law_check">;
export type LawCitation = LawResult["citations"][number];
type Badge = { label: string; tone?: string };

const MISSING: Record<NonNullable<LawCitation["missing"]>, string> = { article: "조문 없음", paragraph: "항 없음", item: "호 없음", subitem: "목 없음" };

/** 주 판정: 맞음 · 조문 있음(내용 대조 못 함) · 확인 필요 · 안 맞음 · 조문/항/호/목 없음 · 법령 없음 · 이름 바뀜 · 확인 못 함 */
export function lawVerdict(c: LawCitation): Badge {
  if (c.status === "unchecked") return { label: "확인 못 함" };
  if (c.status === "renamed") return { label: "이름 바뀜", tone: "warn" };
  if (c.status === "not_found") return { label: "법령 없음", tone: "err" };
  if (c.status === "article_missing") return { label: MISSING[c.missing ?? "article"], tone: "err" };
  if (c.match?.verdict === "mismatch") return { label: "안 맞음", tone: "err" };
  if (c.match?.verdict === "check") return { label: "확인 필요", tone: "warn" };
  // 공문 문장이 짧아 내용까지는 대조하지 못했다 — 조문이 있다는 것만 안다
  if (!c.match) return { label: "조문 있음", tone: "info" };
  return { label: "맞음", tone: "ok" };
}

/** 그 당시 조문과 달라진 것 (둘째 배지) */
export function lawChange(c: LawCitation): Badge | null {
  const k = c.changed_since?.kind;
  return k === "amended" ? { label: "개정됨", tone: "warn" } : k === "added_later" ? { label: "그 뒤 생김", tone: "warn" } : k === "deleted_since" ? { label: "그 뒤 삭제", tone: "info" } : null;
}

/** 상태를 쉬운 말로 (엔진이 준 reason 이 없을 때의 문장) */
export function lawReason(c: LawCitation): string | undefined {
  if (c.reason) return c.reason;
  if (c.status === "renamed") return `이름이 바뀐 법령입니다. 현행 이름은 「${c.current_name}」입니다. 조 번호도 현행 법령에서 다시 확인하세요.`;
  if (c.status === "not_found") return `현행 법령에서 이 이름을 찾지 못했습니다. ${c.current_name ? `비슷한 법령: 「${c.current_name}」.` : "폐지됐거나 이름이 틀렸는지, 행정규칙·자치법규인지 확인하세요."}`;
  if (c.status === "article_missing") return c.article_text ? `현행 법령에서 삭제된 조문입니다(${c.article_text}).` : "현행 법령에 없는 조문입니다. 조 번호를 확인하세요.";
  return undefined;
}

const squash = (s: string) => s.replace(/[\s·ㆍ]/g, "");

function Source({ c }: { c: LawCitation }) {
  const now = c.cited_text ?? (c.status === "ok" ? c.article_text : undefined);
  const ch = c.changed_since;
  const full = c.article_full && c.article_full !== now ? c.article_full : undefined;
  if (!now && !ch?.then_text && !full) return null;
  const nowTitle = `법제처 현행 원문${c.article ? ` (${c.article}${c.article_title ? ` ${c.article_title}` : ""})` : ""}`;
  return (
    <details className="kd-law-src">
      <summary><ChevronRight size={13} aria-hidden="true" /> 공문 문장과 법제처 원문 나란히 보기</summary>
      <div className="kd-law-grid">
        <div>
          <p className="kd-law-cap">공문 문장</p>
          <p className="kd-law-text">{c.sentence ?? c.text}</p>
        </div>
        <div>
          <p className="kd-law-cap">{nowTitle}</p>
          <p className="kd-law-text">{now ?? "현행 법령에 없습니다."}</p>
        </div>
      </div>
      {ch?.then_text && (
        <div className="mt-2">
          <p className="kd-law-cap">{c.as_of ? "그 당시 원문" : "예전 원문"}</p>
          <p className="kd-law-text">{ch.then_text}</p>
          {((ch.removed?.length ?? 0) > 0 || (ch.added?.length ?? 0) > 0) && (
            <p className="kd-small mt-1 text-pretty">
              {ch.removed?.length ? <>빠진 말: {ch.removed.map((x, i) => <span key={i}>{i > 0 && " · "}<span className="kd-strike">{x}</span></span>)}</> : null}
              {ch.removed?.length && ch.added?.length ? " / " : null}
              {ch.added?.length ? <>더해진 말: {ch.added.map((x, i) => <span key={i}>{i > 0 && " · "}<b>{x}</b></span>)}</> : null}
            </p>
          )}
        </div>
      )}
      {full && (
        <details className="kd-law-src mt-1">
          <summary><ChevronRight size={13} aria-hidden="true" /> 조 전체 보기</summary>
          <p className="kd-law-text">{full}</p>
        </details>
      )}
    </details>
  );
}

/** 법령 근거 확인 결과. compact 는 접수함처럼 좁은 자리 (인용 문장 줄은 나란히 보기에서만) */
export function LawResults({ result, onPick, compact }: { result: LawResult; onPick?: (c: LawCitation) => void; compact?: boolean }) {
  const { go, settings, toast } = useApp();
  const counts = new Map<string, number>();
  for (const c of result.citations) { const l = lawVerdict(c).label; counts.set(l, (counts.get(l) ?? 0) + 1); }
  const changed = result.citations.filter((c) => c.changed_since).length;
  const copy = (url: string) => void navigator.clipboard.writeText(url).then(() => toast("주소를 복사했습니다", "success")).catch(() => toast("주소를 복사하지 못했습니다. 주소를 직접 골라 복사하세요.", "error"));
  const needOc = !result.checked && !settings?.privacy.offline && !settings?.law?.oc;
  return (
    <div className="flex flex-col gap-2">
      {counts.size > 0 && (
        <p className="kd-small kd-num">{[...counts].map(([l, n]) => `${l} ${n}`).join(" · ")}{changed ? ` · 그 당시와 달라짐 ${changed}` : ""}</p>
      )}
      {result.note && (
        <Note tone={result.checked ? "info" : "warn"}>
          {result.note}
          {needOc && <> <button type="button" className="kd-link" onClick={() => go("settings")}>설정 열기</button></>}
        </Note>
      )}
      {result.checks && (
        <div className="kd-small text-pretty">
          {result.checks.done.length > 0 && <p><span className="font-semibold">확인한 것:</span> {result.checks.done.join(" · ")}</p>}
          {result.checks.skipped.map((s) => <p key={s} className="kd-muted">확인 못 한 것: {s}</p>)}
        </div>
      )}
      {result.citations.length > 0 && (
        <ul className="kd-findings" aria-label="인용한 법령">
          {result.citations.map((c, i) => {
            const v = lawVerdict(c);
            const chg = lawChange(c);
            const reason = lawReason(c);
            return (
              <li key={i} className="kd-finding">
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="kd-badge" data-tone={v.tone}>{v.label}</span>
                  {chg && <span className="kd-badge" data-tone={chg.tone}>{chg.label}</span>}
                  {onPick ? <button type="button" className="kd-link kd-small" onClick={() => onPick(c)}>{c.text}</button> : <span className="kd-small font-semibold">{c.text}</span>}
                </span>
                {!squash(c.text).includes(squash(c.law)) && <span className="kd-small kd-muted block mt-1">법령: {c.law}</span>}
                {reason && <span className="kd-text block mt-1 text-balance">{reason}</span>}
                {c.match && c.status === "ok" && (
                  <span className="kd-small block mt-1 text-balance">
                    {c.match.by === "ai" ? "AI 판단: " : "낱말 비교: "}{c.match.reason}
                    {c.match.by === "ai" && c.match.overlap.length > 0 && <span className="kd-muted"> (조문 낱말: {c.match.overlap.join(" · ")})</span>}
                  </span>
                )}
                {c.changed_since && <span className="kd-small block mt-1 text-balance">{c.changed_since.reason}</span>}
                {c.sentence && !compact && <span className="kd-small kd-muted block mt-1 text-balance">공문 문장: {c.sentence}</span>}
                <Source c={c} />
                {c.url && (
                  <span className="mt-1.5 flex items-start gap-1.5">
                    <span className="kd-path min-w-0 flex-1">법제처에서 보기: {c.url}</span>
                    <button type="button" className="kd-link kd-small shrink-0" onClick={() => copy(c.url!)}><Copy size={12} className="inline -mt-0.5" /> 복사</button>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
