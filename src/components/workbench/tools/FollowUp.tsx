/** 이 공문으로 이어서 — 접수함에 넣기 (AI 없이 됨). 받은 공문으로 보일 때 정보 칸에만 둔다.
 *  회신 쓰기는 화면 머리의 단추 하나로만 (같은 단추가 두 번 보이지 않게) */

import { useEffect, useRef } from "react";
import { Inbox } from "lucide-react";
import type { OpenDoc } from "../../../state/app";
import { useApp } from "../../../state/app";
import { rpc } from "../../../lib/rpc";
import { useTask } from "../../../hooks/useTask";
import { Button } from "../../ui/Button";
import { ErrorLine, Note } from "../../common/Status";
import { dueText } from "../../inbox/dday";

export function FollowUp({ doc }: { doc: OpenDoc }) {
  const { toast, go } = useApp();
  const inbox = useTask<{ due?: string }>();
  const addedRef = useRef<HTMLDivElement>(null);

  // 접수함에 넣기 (엔진이 보낸 곳·요청 사항·기한을 뽑는다)
  const addInbox = () => void inbox.run(async ({ signal }) => {
    const r = await rpc("inbox_add", { paths: [doc.path] }, { signal });
    if (!r.items.length) throw new Error(r.failed[0]?.error ?? "접수함에 넣지 못했습니다. 잠시 뒤 다시 눌러 보세요.");
    toast("접수함에 넣었습니다", "success");
    return { due: r.items[0].due };
  });

  useEffect(() => {
    if (inbox.result) addedRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [inbox.result]);

  return (
    <section className="flex flex-col gap-2.5" aria-label="이 공문으로 이어서">
      <h3 className="kd-h2">이 공문으로 이어서</h3>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={addInbox} disabled={inbox.busy}><Inbox size={14} /> 접수함에 넣기</Button>
      </div>
      <ErrorLine message={inbox.error} />
      {inbox.result ? (
        <div ref={addedRef} style={{ scrollMarginBottom: 16 }}>
          <Note tone="ok">
            <span className="block">접수함에 넣었습니다. {inbox.result.due ? <>제출 기한은 <span className="kd-num whitespace-nowrap">{dueText(inbox.result.due)}</span>입니다.</> : "기한을 찾지 못했으니 접수함에서 직접 넣으세요."}</span>
            <button type="button" className="kd-link kd-small kd-hit32" onClick={() => go("inbox")}>접수함에서 보기</button>
          </Note>
        </div>
      ) : <p className="kd-small kd-muted">접수함에 넣으면 보낸 곳과 요청 사항, 제출 기한을 뽑아 기한이 가까운 차례로 챙겨 줍니다.</p>}
    </section>
  );
}
