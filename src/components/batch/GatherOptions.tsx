/** 문서 수합 — 부서 명단(붙여 넣기·명단 파일)·제출 기한·서식이 다른 문서 AI 뽑기 */

import { useState } from "react";
import { FileUp } from "lucide-react";
import { useApp } from "../../state/app";
import { rpc, errorText } from "../../lib/rpc";
import { pickFiles } from "../../lib/native";
import { num } from "../../lib/format";
import { Button } from "../ui/Button";
import { Check, Field } from "../common/Field";
import { ErrorLine } from "../common/Status";
import type { BatchOpts } from "./tasks";

const ROSTER_FILTER = [{ name: "부서 명단 (엑셀·CSV·한글·글)", extensions: ["xlsx", "xls", "csv", "hwpx", "hwp", "docx", "txt"] }];

export const rosterCount = (text: string) => new Set(text.split("\n").map((x) => x.trim()).filter(Boolean)).size;

export function GatherOptions({ opts, set }: { opts: BatchOpts; set: (p: Partial<BatchOpts>) => void }) {
  const { ai } = useApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const count = rosterCount(opts.roster);

  const loadFile = async () => {
    const [path] = await pickFiles({ multiple: false, filters: ROSTER_FILTER });
    if (!path) return;
    setBusy(true);
    setError("");
    try {
      const r = await rpc("collect_roster", { path });
      set({ roster: r.names.join("\n") });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3.5">
      <p className="kd-small kd-muted">제출물 폴더를 아래에 끌어다 놓으세요. 같은 서식은 칸끼리, 엑셀은 열끼리 맞춰 한 줄씩 잇고 합계 행과 빈칸 표시를 넣습니다.</p>
      <Field label={`부서 명단 (선택${count ? `, ${num(count)}개 부서` : ""})`} hint="한 줄에 부서 하나. 넣으면 안 낸 부서를 찾아 독촉 글을 만들어 드립니다">
        <div className="flex flex-col gap-2">
          <textarea className="kd-textarea" rows={4} value={opts.roster} onChange={(e) => set({ roster: e.target.value })}
            placeholder={"총무과\n기획예산과\n민원봉사과"} aria-label="부서 명단" spellCheck={false} />
          <div><Button variant="secondary" size="sm" disabled={busy} onClick={() => void loadFile()}><FileUp size={13} /> {busy ? "명단 읽는 중" : "명단 파일에서 가져오기"}</Button></div>
        </div>
      </Field>
      <ErrorLine message={error} />
      <div style={{ maxWidth: 280 }}>
        <Field label="제출 기한 (선택)" hint="독촉 글에 그대로 넣습니다">
          <input className="kd-input" value={opts.deadline} onChange={(e) => set({ deadline: e.target.value })} placeholder="예: 10. 20.(화)" aria-label="제출 기한" />
        </Field>
      </div>
      <Check label="서식이 다른 문서는 AI로 항목 뽑기" checked={!!ai?.configured && opts.gatherAi} disabled={!ai?.configured}
        desc={ai?.configured ? "뽑은 값은 원문과 대조하세요" : "AI 연결이 없어 따로 봐야 할 문서로 남깁니다"}
        onChange={(v) => set({ gatherAi: v })} />
    </div>
  );
}
