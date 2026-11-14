/** 가. 내 기관 정보 › 지출조서 서식 — 기관 서식(HWP·HWPX)을 넣으면 표 머리 칸 이름으로 칸마다 넣을 값을 맞춘다(receipt_template_*).
 *  쉬운 화면에서도 보인다 (처음 쓰는 사람도 기관 서식으로 만들게). 대응표는 고르면 바로 저장 */

import { useEffect, useRef, useState } from "react";
import { FilePlus2, Trash2 } from "lucide-react";
import type { ReceiptColumn, ReceiptTemplateInfo } from "../../lib/contract";
import { useApp } from "../../state/app";
import { rpc, errorText } from "../../lib/rpc";
import { FILTERS, pickFiles } from "../../lib/native";
import { useTask } from "../../hooks/useTask";
import { Button } from "../ui/Button";
import { ConfirmRemove } from "../ui/ConfirmRemove";
import { ErrorLine, Note, Working } from "../common/Status";

const FIELD_LABEL: Array<[ReceiptColumn | "", string]> = [
  ["", "비워 둠"], ["seq", "연번"], ["date", "지출일자"], ["vendor", "거래처(상호)"], ["brn", "사업자등록번호"], ["purpose", "적요(품목)"],
  ["amount", "금액"], ["supply", "공급가액"], ["vat", "부가세"], ["payment", "결제방법"], ["approval", "승인번호"], ["owner", "대표자"], ["address", "주소"], ["note", "비고"],
];
const BY: Record<string, string> = { rule: "이름으로 맞춤", ai: "AI 제안", user: "고침", none: "못 맞춤" };

export function ReceiptTemplate() {
  const { ready, settings, saveSettings, toast, ai } = useApp();
  const [info, setInfo] = useState<ReceiptTemplateInfo | null>(null);
  const learn = useTask<ReceiptTemplateInfo>();
  const saved = settings?.receipt?.template_path ?? "";

  useEffect(() => {
    if (!ready) return;
    // 방금 넣은 서식이면 학습 결과(빈 줄 수·경고)를 지키고 대응표만 맞춘다 (저장된 정보에는 그것이 없다)
    rpc("receipt_template_get", {}).then((g) => setInfo((cur) => (g && cur && cur.template_path === g.template_path ? { ...cur, columns: g.columns } : g)), () => setInfo(null));
  }, [ready, saved]);

  const put = async () => {
    const [path] = await pickFiles({ multiple: false, filters: FILTERS.hangul });
    if (!path) return;
    const r = await learn.run(({ signal, onProgress }) => rpc("receipt_template_learn", { path, save: true, ai: !!ai?.configured }, { signal, onProgress }));
    if (!r) return;
    // 학습 결과(빈 줄 수·경고)는 이번 것으로, 설정은 다시 읽는다
    setInfo(r);
    await saveSettings({});
    toast(`지출조서 서식을 넣었습니다: ${r.name}`, "success");
  };

  /** 답을 기다리는 대응표 — 잇달아 고르면 이 위에 쌓는다 (화면 값으로 보내면 답이 오기 전에 고친 앞 칸이 되돌아갔다) */
  const pending = useRef<Array<ReceiptColumn | ""> | null>(null);
  const setSeq = useRef(0);
  const setField = async (i: number, field: ReceiptColumn | "") => {
    if (!info) return;
    const fields = (pending.current ?? info.columns.map((c) => c.field)).map((f, k) => (k === i ? field : f));
    pending.current = fields;
    const my = ++setSeq.current;
    try {
      const r = await rpc("receipt_template_set", { fields });
      if (my !== setSeq.current) return; // 더 나중에 고른 것의 답이 주인
      pending.current = null;
      setInfo((cur) => (cur ? { ...cur, columns: r.columns } : r));
      await saveSettings({});
    } catch (e) {
      if (my === setSeq.current) pending.current = null;
      toast(errorText(e), "error");
    }
  };

  const clear = async () => {
    try {
      await rpc("receipt_template_clear", {});
      setInfo(null);
      await saveSettings({});
      toast("지출조서 서식을 지웠습니다. 이제 기본 서식으로 만듭니다", "info");
    } catch (e) {
      toast(errorText(e), "error");
    }
  };

  return (
    <div id="set-receipt" className="kd-field mt-6">
      <span className="kd-label">지출조서 서식</span>
      <p className="kd-field-hint" style={{ marginTop: 0 }}>
        우리 기관 지출조서 한글 서식(HWP·HWPX)을 넣으면 표 머리 칸 이름을 읽어 칸마다 넣을 값을 맞춥니다. 영수증으로 지출조서를 만들 때 이 서식 사본에 채우고, 원본 서식은 바꾸지 않습니다.
      </p>
      {learn.busy && <Working label="서식을 읽는 중" progress={learn.progress} onCancel={learn.cancel} />}
      <ErrorLine message={learn.error} />
      {!info && !learn.busy && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="kd-small kd-muted">지금은 기본 서식(연번·지출일자·거래처·사업자등록번호·적요·금액·결제방법·비고)으로 만듭니다.</span>
          <Button variant="secondary" size="sm" onClick={() => void put()} data-tip="한글 서식 파일을 고르면 앱 데이터에 사본을 두고 칸을 맞춥니다"><FilePlus2 size={13} /> 서식 넣기</Button>
        </div>
      )}
      {info && !learn.busy && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="kd-row-title">{info.name}</span>
            {info.rows > 0 && <span className="kd-small kd-muted">빈 줄 {info.rows}개{info.total_row ? " · 합계 줄 있음" : ""} (모자라면 줄을 더합니다)</span>}
            <span className="flex-1" />
            <Button variant="secondary" size="sm" onClick={() => void put()} data-tip="다른 서식으로 바꿉니다"><FilePlus2 size={13} /> 다른 서식</Button>
            <ConfirmRemove ask="등록한 서식을 지우고 기본 서식으로 돌릴까요?" onConfirm={() => void clear()}>
              {(open) => <Button variant="ghost" size="sm" onClick={open} data-tip="등록한 서식을 지우고 기본 서식으로 만듭니다"><Trash2 size={13} /> 지우기</Button>}
            </ConfirmRemove>
          </div>
          {info.warnings.map((w) => <Note key={w} tone="warn">{w}</Note>)}
          <table className="kd-table kd-table-mini" style={{ maxWidth: 640 }} aria-label="서식 칸 대응표">
            <thead><tr><th>서식의 칸</th><th>넣을 값</th><th>맞춘 방법</th></tr></thead>
            <tbody>
              {info.columns.map((c, i) => (
                <tr key={`${c.header}-${i}`}>
                  <td>{c.header || "(빈 칸)"}</td>
                  <td>
                    <select className="kd-select kd-select-sm" value={c.field} onChange={(e) => void setField(i, e.target.value as ReceiptColumn | "")} aria-label={`${c.header || "빈 칸"}에 넣을 값`}>
                      {FIELD_LABEL.map(([v, l]) => <option key={v || "none"} value={v}>{l}</option>)}
                    </select>
                  </td>
                  <td className="kd-muted">{c.field ? BY[c.by] ?? "" : "비워 둠"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
