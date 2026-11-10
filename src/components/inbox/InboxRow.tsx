/** 받은 공문 한 줄 + 펼친 자세히 보기 (요청 전체·문서 정보·기한 고치기·메모·열기·회신·빼기) */

import { useEffect, useRef, useState } from "react";
import { Check, ChevronRight, ExternalLink, Reply, Scale, Trash2 } from "lucide-react";
import { useFileMenu } from "../common/file-menu";
import { useApp } from "../../state/app";
import { stem } from "../../lib/format";
import { rpc } from "../../lib/rpc";
import type { RpcResult } from "../../lib/contract";
import { useTask } from "../../hooks/useTask";
import { Button } from "../ui/Button";
import { ConfirmRemove } from "../ui/ConfirmRemove";
import { ErrorLine, Working } from "../common/Status";
import { LawResults } from "../workbench/tools/LawResults";
import { useReply } from "../workbench/reply";
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
  const done = item.status === "done";
  const badge = item.due && !done ? dueBadge(item.due, today) : null;
  const first = item.requests[0];
  const more = item.requests.length - 1;
  const title = item.title || stem(item.name);
  // AI 가 꺼져 있으면 서식함의 표준 기안문으로 (AI 필요 화면으로 보내지 않는다)
  const { aiOn, start, tip } = useReply();
  const reply = () => start(item.path);
  // 펼친 칸·문서 보기 머리와 같은 말로
  const replyLabel = aiOn ? "회신 쓰기" : "서식으로 회신 쓰기";
  const menu = useFileMenu();
  // 우클릭 "목록에서 빼기…": 줄을 펼치고 묻는 줄을 띄운다 (메모·기한까지 지워지니 메뉴에서 바로 빼지 않는다)
  const [askRemove, setAskRemove] = useState(0);
  // 접었다 다시 펼칠 때 묻는 줄이 또 뜨지 않게
  useEffect(() => { if (!open) setAskRemove(0); }, [open]);
  const onMenu = (e: React.MouseEvent) => menu.open(e, item.path, {
    before: [
      { label: replyLabel, icon: <Reply size={14} />, onClick: reply },
      { label: done ? "할 일로 되돌리기" : "끝냄으로 표시", icon: <Check size={14} />, onClick: () => onUpdate({ status: done ? "todo" : "done" }) },
      { label: open ? "자세히 보기 접기" : "자세히 보기", icon: <ChevronRight size={14} />, onClick: onToggle },
    ],
    after: [{ label: "목록에서 빼기…", icon: <Trash2 size={14} />, danger: true, onClick: () => { if (!open) onToggle(); setAskRemove((n) => n + 1); } }],
  });

  return (
    <>
      {/* 줄 어디를 눌러도 펼친다 (단추·끝냄 칸은 제 할 일만). 키보드는 제목 단추로 */}
      <tr className="kd-inbox-row" data-done={done} data-open={open} onContextMenu={onMenu}
        onClick={(e) => { if (!(e.target as HTMLElement).closest("button, input, label, a")) onToggle(); }}>
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
          <Button variant="secondary" size="sm" onClick={reply} data-tip={tip}><Reply size={13} /> {replyLabel}</Button>
        </td>
      </tr>
      {open && (
        <tr className="kd-inbox-detail" id={`inbox-${item.id}`}>
          <td colSpan={6}>
            <InboxDetail item={item} today={today} done={done} onUpdate={onUpdate} onRemove={onRemove} onReply={reply} replyLabel={replyLabel} replyTip={tip} askRemove={askRemove} />
          </td>
        </tr>
      )}
    </>
  );
}

function InboxDetail({ item, today, done, onUpdate, onRemove, onReply, replyLabel, replyTip, askRemove }: {
  item: InboxItem; today: string; done: boolean; onUpdate: (p: InboxPatch) => void; onRemove: () => void; onReply: () => void; replyLabel: string; replyTip: string; askRemove: number;
}) {
  const { openDocs } = useApp();
  const auto = autoDue(item);
  const manual = (item.due ?? "") !== (auto ?? "");
  const [due, setDue] = useState(item.due ?? "");
  const [note, setNote] = useState(item.note ?? "");
  const timer = useRef<number | undefined>(undefined);
  // 인용 법령 확인은 누를 때만 (넣을 때마다 법제처에 묻지 않는다). 기준 날짜는 이 공문의 시행일
  const law = useTask<RpcResult<"law_check">>();
  const checkLaw = () => void law.run(({ signal, onProgress }) => rpc("law_check", { path: item.path, ...(item.sent_date ? { as_of: item.sent_date } : {}) }, { signal, onProgress }));

  useEffect(() => setDue(item.due ?? ""), [item.due]);
  useEffect(() => setNote(item.note ?? ""), [item.note]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  // 날짜 칸은 다 고친 뒤 한 번만 저장. 연도를 한 자씩 치는 동안은 0002·0020·0202년 같은 날짜가 지나가므로 2000년 이후만 받는다
  const changeDue = (v: string) => {
    setDue(v);
    window.clearTimeout(timer.current);
    if (v && v !== item.due && Number(v.slice(0, 4)) >= 2000) timer.current = window.setTimeout(() => onUpdate({ due: v }), 600);
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
        ) : <p className="kd-small kd-muted mt-1">요청 문장을 찾지 못했습니다. 기한은 오른쪽에서 직접 넣으세요.</p>}
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
        <Button variant="secondary" size="sm" onClick={() => openDocs([item.path])} data-tip="문서 화면에서 본문을 읽고 검토·내보내기를 합니다."><ExternalLink size={13} /> 열기</Button>
        <Button size="sm" onClick={onReply} data-tip={replyTip}><Reply size={13} /> {replyLabel}</Button>
        <Button variant="secondary" size="sm" onClick={() => onUpdate({ status: done ? "todo" : "done" })}>{done ? "할 일로 되돌리기" : "끝냄으로 표시"}</Button>
        <Button variant="secondary" size="sm" onClick={checkLaw} disabled={law.busy}
          data-tip={`공문이 인용한 법령을 법제처 원문과 맞춰 봅니다.${item.sent_date ? ` 시행일(${dueText(item.sent_date, today)}) 당시 조문과 지금 조문도 견줍니다.` : ""}`}><Scale size={13} /> 인용 법령 확인</Button>
        <span className="flex-1" />
        {/* 적어 둔 메모·고친 기한도 함께 사라지므로 한 번 묻는다 */}
        <ConfirmRemove ask="목록에서 뺄까요? 메모·기한도 지워집니다. 파일은 그대로입니다." verb="빼기" onConfirm={onRemove} openSignal={askRemove}>
          {(open) => <Button variant="ghost" size="sm" onClick={open} data-tip="접수함 목록에서만 뺍니다. 파일은 그대로 둡니다."><Trash2 size={13} /> 목록에서 빼기</Button>}
        </ConfirmRemove>
      </div>

      {(law.busy || law.result || law.error) && (
        <section className="kd-inbox-law" aria-label="인용 법령 확인">
          <h3 className="kd-label">인용 법령 확인</h3>
          {law.busy && <Working label="법령 인용을 확인하는 중" progress={law.progress} onCancel={law.cancel} />}
          <ErrorLine message={law.error} />
          {law.result && <LawResults result={law.result} compact />}
        </section>
      )}
    </div>
  );
}
