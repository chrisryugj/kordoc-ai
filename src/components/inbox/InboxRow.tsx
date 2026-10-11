/** 받은 공문 한 줄 + 펼친 자세히 보기 (요청 전체·문서 정보·기한 고치기·메모·열기·회신·빼기) */

import { useEffect, useRef, useState } from "react";
import { ChevronRight, ExternalLink, Reply, Trash2 } from "lucide-react";
import { useApp } from "../../state/app";
import { stem } from "../../lib/format";
import { Button } from "../ui/Button";
import { autoDue, dueBadge, dueText, type InboxItem } from "./dday";

export type InboxPatch = { status?: "todo" | "done"; due?: string | null; note?: string };

interface Props {
  item: InboxItem;
  open: boolean;
  today: string;
  onToggle: () => void;
  onUpdate: (patch: InboxPatch) => void;
  onRemove: () => void;
}

export function InboxRow({ item, open, today, onToggle, onUpdate, onRemove }: Props) {
  const { startCreate } = useApp();
  const done = item.status === "done";
  const badge = item.due && !done ? dueBadge(item.due, today) : null;
  const first = item.requests[0];
  const more = item.requests.length - 1;
  const title = item.title || stem(item.name);
  const reply = () => startCreate({ route: "ai", kind: "reply", references: [item.path] });

  return (
    <>
      <tr className="kd-inbox-row" data-done={done} data-open={open}>
        <td>
          {item.due ? (
            <span className="kd-inbox-due">
              {badge && <span className="kd-badge kd-num" data-tone={badge.tone}>{badge.label}</span>}
              <span className="kd-small kd-num kd-muted">{dueText(item.due, today)}</span>
            </span>
          ) : <span className="kd-small kd-muted">기한 없음</span>}
        </td>
        <td>
          <button type="button" className="kd-inbox-toggle" aria-expanded={open} aria-controls={`inbox-${item.id}`} onClick={onToggle}>
            <ChevronRight size={14} className="kd-inbox-chev" aria-hidden="true" />
            <span className="kd-inbox-title">{title}</span>
          </button>
          <span className="kd-row-desc kd-inbox-from-inline">{item.sender ?? "보낸 곳 모름"}</span>
        </td>
        <td className="kd-inbox-c-from">
          <span className="block">{item.sender ?? "보낸 곳 모름"}</span>
          {item.doc_number && <span className="kd-row-desc block">{item.doc_number}</span>}
        </td>
        <td>
          {first ? (
            <>
              <span className="kd-inbox-req">{first.text}</span>
              {more > 0 && <span className="kd-row-desc block">외 {more}건</span>}
            </>
          ) : <span className="kd-small kd-muted">요청 문장을 찾지 못했습니다</span>}
        </td>
        <td>
          <label className="kd-check kd-inbox-check">
            <input type="checkbox" checked={done} onChange={(e) => onUpdate({ status: e.target.checked ? "done" : "todo" })} aria-label={`${title} 끝냄`} />
            <span>끝냄</span>
          </label>
        </td>
        <td className="text-right">
          <Button variant="secondary" size="sm" onClick={reply}><Reply size={13} /> 회신 쓰기</Button>
        </td>
      </tr>
      {open && (
        <tr className="kd-inbox-detail" id={`inbox-${item.id}`}>
          <td colSpan={6}>
            <InboxDetail item={item} today={today} done={done} onUpdate={onUpdate} onRemove={onRemove} onReply={reply} />
          </td>
        </tr>
      )}
    </>
  );
}

function InboxDetail({ item, today, done, onUpdate, onRemove, onReply }: {
  item: InboxItem; today: string; done: boolean; onUpdate: (p: InboxPatch) => void; onRemove: () => void; onReply: () => void;
}) {
  const { openDocs } = useApp();
  const auto = autoDue(item);
  const manual = (item.due ?? "") !== (auto ?? "");
  const [due, setDue] = useState(item.due ?? "");
  const [note, setNote] = useState(item.note ?? "");
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => setDue(item.due ?? ""), [item.due]);
  useEffect(() => setNote(item.note ?? ""), [item.note]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  // 날짜 칸은 다 고친 뒤 한 번만 저장 (덜 친 날짜는 빈 값이라 무시)
  const changeDue = (v: string) => {
    setDue(v);
    window.clearTimeout(timer.current);
    if (v && v !== item.due) timer.current = window.setTimeout(() => onUpdate({ due: v }), 600);
  };

  return (
    <div className="kd-inbox-more">
      <section aria-label="요청 사항">
        <h3 className="kd-label">요청 사항</h3>
        {item.requests.length ? (
          <ol className="kd-inbox-reqs">
            {item.requests.map((r, i) => (
              <li key={i}>
                <span>{r.text}</span>
                {r.due && <span className="kd-small kd-muted kd-num"> ({dueText(r.due, today)}까지)</span>}
              </li>
            ))}
          </ol>
        ) : <p className="kd-small kd-muted mt-1">요청 문장을 찾지 못했습니다. 문서를 열어 확인하고 기한은 오른쪽에서 직접 넣으세요.</p>}
      </section>

      <section aria-label="문서 정보">
        <h3 className="kd-label">문서</h3>
        <dl className="kd-dl kd-inbox-dl">
          <div><dt>보낸 곳</dt><dd>{item.sender ?? "모름"}</dd></div>
          <div><dt>문서번호</dt><dd>{item.doc_number ?? "모름"}</dd></div>
          <div><dt>시행일</dt><dd className="kd-num">{item.sent_date ? dueText(item.sent_date, today) : "모름"}</dd></div>
          <div><dt>파일</dt><dd className="kd-path">{item.name}</dd></div>
        </dl>
      </section>

      <section aria-label="기한과 메모" className="kd-inbox-edit">
        <label className="kd-label" htmlFor={`due-${item.id}`}>기한</label>
        <input id={`due-${item.id}`} type="date" className="kd-input kd-num" value={due} onChange={(e) => changeDue(e.target.value)} />
        <span className="kd-small flex flex-wrap gap-x-3">
          {manual && <button type="button" className="kd-link" onClick={() => onUpdate({ due: null })}>{auto ? `뽑은 기한(${dueText(auto, today)})으로` : "기한 없음으로"}</button>}
          {item.due && <button type="button" className="kd-link" onClick={() => onUpdate({ due: "" })}>기한 지우기</button>}
          {!manual && !item.due && <span className="kd-muted">기한이 있으면 날짜를 고르세요</span>}
        </span>
        <label className="kd-label mt-2" htmlFor={`note-${item.id}`}>메모</label>
        <textarea id={`note-${item.id}`} className="kd-textarea" rows={2} value={note} placeholder="담당자, 진행 상황 등"
          onChange={(e) => setNote(e.target.value)} onBlur={() => { if (note.trim() !== (item.note ?? "")) onUpdate({ note }); }} />
        <span className="kd-field-hint">칸을 벗어나면 저장합니다.</span>
      </section>

      <div className="kd-inbox-acts">
        <Button variant="secondary" size="sm" onClick={() => openDocs([item.path])}><ExternalLink size={13} /> 열기</Button>
        <Button size="sm" onClick={onReply}><Reply size={13} /> 회신 쓰기</Button>
        <Button variant="secondary" size="sm" onClick={() => onUpdate({ status: done ? "todo" : "done" })}>{done ? "할 일로 되돌리기" : "끝냄으로 표시"}</Button>
        <span className="flex-1" />
        <Button variant="ghost" size="sm" onClick={onRemove}><Trash2 size={13} /> 목록에서 빼기</Button>
      </div>
    </div>
  );
}
