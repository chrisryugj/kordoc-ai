/**
 * 지우기 확인 — 지우기·빼기·버리기 단추를 누르면 그 자리에 "지울까요? [지우기][취소]" 줄이 뜬다(대화 목록과 같은 방식).
 * 단추 모양은 화면마다 달라서 children 에 여는 함수를 넘겨 그리게 한다. Esc·취소면 되돌아간다.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "./Button";
import "./confirm.css";

export function ConfirmRemove({ ask, verb = "지우기", onConfirm, children, openSignal = 0 }: {
  /** 묻는 말 (예: "이 서식을 지울까요?") */
  ask: string;
  /** 확인 단추 글자 */
  verb?: string;
  onConfirm: () => void;
  children: (open: () => void) => ReactNode;
  /** 밖에서 묻는 줄을 띄울 때 (우클릭 메뉴의 "목록에서 빼기…"). 값이 바뀌면 띄운다 */
  openSignal?: number;
}) {
  const [on, setOn] = useState(false);
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (openSignal) setOn(true); }, [openSignal]);
  useEffect(() => { if (on) cancel.current?.focus(); }, [on]);
  if (!on) return <>{children(() => setOn(true))}</>;
  return (
    <span className="kd-confirm" role="group" aria-label={ask} onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setOn(false); } }}>
      <span className="kd-confirm-ask">{ask}</span>
      <Button size="sm" variant="danger" onClick={() => { setOn(false); onConfirm(); }}>{verb}</Button>
      <Button ref={cancel} size="sm" variant="ghost" onClick={() => setOn(false)}>취소</Button>
    </span>
  );
}
