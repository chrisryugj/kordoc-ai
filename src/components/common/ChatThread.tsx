/**
 * 문서와 대화 기록 — 질문·답을 괘선으로 나누고, 답 속 [n] 은 근거로 가는 단추.
 * 인용 검증: 근거 원문에 없는 숫자가 있으면(verified false) "숫자 확인 필요"로, 근거 번호 없이 숫자를 쓴 문장도 따로 알린다.
 */

import { Fragment, useEffect, useRef } from "react";
import { AlertTriangle, FileText, Loader2 } from "lucide-react";
import type { Citation } from "../../lib/contract";
import type { ChatItem } from "../../hooks/useChat";
import { baseName } from "../../lib/format";
import { Note } from "./Status";

function withCites(text: string, cites: Citation[] | undefined, onCite: (c: Citation) => void) {
  return text.split(/(\[\d+\])/g).map((part, i) => {
    const m = /^\[(\d+)\]$/.exec(part);
    if (!m) return <Fragment key={i}>{part}</Fragment>;
    const c = cites?.find((x) => x.n === Number(m[1]));
    if (!c || !c.path) return <sup key={i} className="kd-cite-ref" data-bad="true" title="근거 조각이 없는 번호입니다">{m[1]}</sup>;
    return (
      <button key={i} type="button" className="kd-cite-ref" data-bad={!c.verified || undefined} onClick={() => onCite(c)}
        title={`${baseName(c.path)}${c.page ? ` ${c.page}쪽` : ""} 열기${c.verified ? "" : " (숫자 확인 필요)"}`}>
        {m[1]}
      </button>
    );
  });
}

export function ChatThread({ items, onCite, empty }: { items: ChatItem[]; onCite: (c: Citation) => void; empty?: React.ReactNode }) {
  const endRef = useRef<HTMLDivElement>(null);
  const last = items[items.length - 1];
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [items.length, last?.content.length]);

  if (!items.length) return <>{empty}</>;
  return (
    <div className="kd-thread" aria-live="polite">
      {items.map((it, i) => (
        <div key={i} className="kd-turn" data-role={it.role}>
          <div className="kd-turn-label">{it.role === "user" ? "질문" : "답"}</div>
          <div className="min-w-0 flex-1">
            <div className="kd-turn-text kd-pre">
              {it.role === "assistant" ? withCites(it.content, it.citations, onCite) : it.content}
              {it.pending && !it.content && <span className="kd-status"><Loader2 size={13} className="kd-spin" /> 문서를 읽는 중</span>}
            </div>
            {it.error && <div className="mt-2"><Note tone={it.error === "답을 멈췄습니다" ? "info" : "err"}>{it.error}</Note></div>}
            {!!it.redacted && <p className="kd-small kd-muted mt-1.5">보내기 전에 개인정보 {it.redacted}건을 가렸습니다.</p>}
            {!!it.unsupported?.length && (
              <div className="mt-2">
                <Note tone="warn">
                  <span className="block font-semibold">근거 번호 없이 숫자가 나온 문장이 있습니다. 원문에서 확인하세요.</span>
                  <ul className="mt-1 flex flex-col gap-0.5">{it.unsupported.map((s, k) => <li key={k} className="kd-small">{s}</li>)}</ul>
                </Note>
              </div>
            )}
            {!!it.citations?.length && (
              <div className="kd-cites">
                {it.citations.map((c) => {
                  const body = (
                    <>
                      <span className="kd-cite-n" data-bad={!c.verified || undefined}>{c.n}</span>
                      {c.verified ? <FileText size={13} /> : <AlertTriangle size={13} className="kd-cite-warn" />}
                      <span className="min-w-0">
                        <span className="block font-semibold">{c.path ? `${baseName(c.path)}${c.page ? ` · ${c.page}쪽` : ""}` : "근거 조각 없음"}</span>
                        {!c.verified && (
                          <span className="block kd-cite-mismatch">숫자 확인 필요{c.mismatch?.length ? `: 근거에 없는 ${c.mismatch.join(", ")}` : ""}</span>
                        )}
                        {c.excerpt && <span className="block kd-row-desc">{c.heading ? `${c.heading}: ` : ""}{c.excerpt}</span>}
                      </span>
                    </>
                  );
                  return c.path
                    ? <button key={c.n} type="button" className="kd-cite" onClick={() => onCite(c)}>{body}</button>
                    : <div key={c.n} className="kd-cite" data-static="true">{body}</div>;
                })}
              </div>
            )}
          </div>
        </div>
      ))}
      <div ref={endRef} />
    </div>
  );
}
