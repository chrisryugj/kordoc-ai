/** 한꺼번에 인쇄 — 프린터 고르기 (list_printers, 기본 프린터 먼저) */

import { useEffect, useState } from "react";
import type { RpcResult } from "../../lib/contract";
import { rpc, errorText } from "../../lib/rpc";
import { SelectField } from "../common/Field";
import { Note } from "../common/Status";

type Printers = RpcResult<"list_printers">;
const STATE: Record<Printers[number]["status"], string> = { ready: "", offline: " (꺼져 있음)", error: " (오류)" };

export function PrintOptions({ value, onChange }: { value: string; onChange: (name: string) => void }) {
  const [list, setList] = useState<Printers | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    rpc("list_printers", {})
      .then((r) => {
        setList(r);
        if (!value && r.length) onChange((r.find((p) => p.isDefault) ?? r[0]).name);
      })
      .catch((e) => setError(errorText(e)));
    // 화면에 들어올 때 한 번
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) return <Note tone="err">프린터 목록을 읽지 못했습니다: {error}</Note>;
  if (!list) return <p className="kd-small kd-muted">프린터를 찾는 중입니다.</p>;
  if (!list.length) return <Note tone="warn">연결된 프린터가 없습니다. 운영체제 설정에서 프린터를 추가한 뒤 이 화면을 다시 여세요.</Note>;
  return (
    <div className="flex flex-col gap-2">
      <div style={{ maxWidth: 320 }}>
        <SelectField label="프린터" value={value} onChange={onChange}
          options={list.map((p) => ({ value: p.name, label: `${p.name}${p.isDefault ? " (기본)" : ""}${STATE[p.status]}` }))} />
      </div>
      <p className="kd-small kd-muted">인쇄 창 없이 바로 보냅니다. 한글 문서는 화면 모양 그대로 찍히고, 매수·양면은 프린터 기본값을 따릅니다.</p>
    </div>
  );
}
