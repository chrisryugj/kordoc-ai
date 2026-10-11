/** 이 공문으로 이어서 — 회신 쓰기·받은 공문에 넣기. AI 탭(요약 아래)과 정보 탭에 같이 둔다(받은 공문에 넣기는 AI 없이도 된다) */

import { useEffect, useRef } from "react";
import { Inbox, Reply } from "lucide-react";
import type { OpenDoc } from "../../../state/app";
import { useApp } from "../../../state/app";
import { rpc } from "../../../lib/rpc";
import { useTask } from "../../../hooks/useTask";
import { Button } from "../../ui/Button";
import { ErrorLine, Note } from "../../common/Status";
import { dueText } from "../../inbox/dday";

export function FollowUp({ doc }: { doc: OpenDoc }) {
  const { toast, startCreate, go } = useApp();
  const inbox = useTask<{ due?: string }>();
  const addedRef = useRef<HTMLDivElement>(null);

  // 받은 공문 목록에 넣기 (엔진이 보낸 곳·요청 사항·기한을 뽑는다)
  const addInbox = () => void inbox.run(async ({ signal }) => {
    const r = await rpc("inbox_add", { paths: [doc.path] }, { signal });
    if (!r.items.length) throw new Error(r.failed[0]?.error ?? "받은 공문에 넣지 못했습니다. 잠시 뒤 다시 눌러 보세요.");
    toast("받은 공문에 넣었습니다", "success");
    return { due: r.items[0].due };
  });

  useEffect(() => {
    if (inbox.result) addedRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [inbox.result]);

  return (
    <section className="flex flex-col gap-2.5" aria-label="이 공문으로 이어서">
      <h3 className="kd-h2">이 공문으로 이어서</h3>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => startCreate({ route: "ai", kind: "reply", references: [doc.path] })}><Reply size={14} /> 이 공문에 회신 쓰기</Button>
        <Button variant="secondary" onClick={addInbox} disabled={inbox.busy}><Inbox size={14} /> 받은 공문에 넣기</Button>
      </div>
      <ErrorLine message={inbox.error} />
      {inbox.result ? (
        <div ref={addedRef} style={{ scrollMarginBottom: 16 }}>
          <Note tone="ok">
            <span className="block">받은 공문에 넣었습니다. {inbox.result.due ? <>제출 기한은 <span className="kd-num whitespace-nowrap">{dueText(inbox.result.due)}</span>입니다.</> : "기한을 찾지 못했으니 받은 공문에서 직접 넣으세요."}</span>
            <button type="button" className="kd-link kd-small kd-hit32" onClick={() => go("inbox")}>받은 공문에서 보기</button>
          </Note>
        </div>
      ) : <p className="kd-small kd-muted">회신 쓰기는 이 문서를 붙여 AI 회신 초안으로 넘어갑니다. 받은 공문에 넣으면 제출 기한을 목록에서 챙겨 줍니다.</p>}
    </section>
  );
}
