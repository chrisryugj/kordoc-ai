/**
 * 묻기 상자 — ask() 가 고른 단추 id 를 돌려준다 (Esc 는 "cancel"). 새로 쓰기 세션의 묻기(create/session.tsx)와 같은 꼴.
 * 상자는 body 에 그린다: 트레이 "완전 종료"처럼 지금 보고 있지 않은(숨은) 화면이 물어도 보이게.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button } from "./Button";
import { Modal } from "./Modal";

export interface AskChoice { id: string; label: string; variant?: "secondary" | "ghost" }
export interface AskSpec { title: string; body: ReactNode; choices: AskChoice[] }
export type AskFn = (a: AskSpec) => Promise<string>;

export function useAsk(): { ask: AskFn; dialog: ReactNode } {
  const [cur, setCur] = useState<(AskSpec & { done: (id: string) => void }) | null>(null);
  const open = useRef<((id: string) => void) | null>(null);
  const ask = useCallback<AskFn>((a) => {
    // 앞 물음이 떠 있으면 취소로 닫고 새로 묻는다 (앞 물음을 기다리던 쪽이 멈춰 있지 않게)
    open.current?.("cancel");
    return new Promise<string>((resolve) => {
      const done = (id: string) => {
        if (open.current !== done) return;
        open.current = null;
        setCur(null);
        resolve(id);
      };
      open.current = done;
      setCur({ ...a, done });
    });
  }, []);
  // 묻는 중에 화면이 내려가면 취소로 끝낸다 (기다리던 쪽이 멈추지 않게: 완전 종료는 끄지도 취소하지도 못한 채 남는다)
  useEffect(() => () => open.current?.("cancel"), []);
  const dialog = createPortal(
    <Modal isOpen={!!cur} title={cur?.title ?? ""} closable={false} size="sm" onClose={() => cur?.done("cancel")}
      footer={(
        <div className="flex flex-wrap justify-end gap-2">
          {cur?.choices.map((c) => <Button key={c.id} variant={c.variant} onClick={() => cur.done(c.id)}>{c.label}</Button>)}
        </div>
      )}>
      {cur?.body}
    </Modal>,
    document.body,
  );
  return { ask, dialog };
}

/** 트레이 "완전 종료" 전에 묻는다: 끄면 무엇이 사라지는지 밝히고, "버리고 끄기"를 고르면 true (onQuitGuard 에 넘긴다).
 *  카드 창은 창 X 가 같은 물음을 쓴다: 앱이 아니라 그 창만 닫히니 단추 이름을 바꿔 넘긴다 */
export async function askQuit(ask: AskFn, title: string, what: string, leave = "버리고 끄기"): Promise<boolean> {
  const a = await ask({
    title,
    body: <p className="kd-text" style={{ overflowWrap: "anywhere" }}>{what}</p>,
    choices: [{ id: "cancel", label: "취소", variant: "ghost" }, { id: "quit", label: leave, variant: "secondary" }],
  });
  return a === "quit";
}
