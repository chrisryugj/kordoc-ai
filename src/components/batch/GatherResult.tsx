/** 문서 수합 결과 — 엑셀·모은 내용 한 줄·미제출 부서와 독촉 글 복사·따로 볼 문서·제출 현황·파일 더 넣기 */

import { Copy, ExternalLink, FilePlus2 } from "lucide-react";
import type { RpcResult } from "../../lib/contract";
import { useApp } from "../../state/app";
import { baseName, num } from "../../lib/format";
import { Button } from "../ui/Button";
import { Note, SavedFile } from "../common/Status";

type Gather = RpcResult<"collect_gather">;

export function GatherResult({ result, message, onAddLate }: { result: Gather; message: string; onAddLate: () => void }) {
  const { openDocs, toast } = useApp();
  const r = result;
  const hasRoster = r.status.some((s) => s.in_roster);
  const parts = [
    r.by_kind.form && `같은 서식 ${num(r.by_kind.form)}개`,
    r.by_kind.excel && `엑셀 ${num(r.by_kind.excel)}개`,
    r.by_kind.ai && `AI로 뽑은 문서 ${num(r.by_kind.ai)}개`,
  ].filter(Boolean).join(" · ");
  const totals = r.columns.filter((c) => c.total != null);
  const copy = () => void navigator.clipboard.writeText(r.reminder)
    .then(() => toast("독촉 글을 복사했습니다. 메신저나 메일에 붙여 넣으세요.", "success"))
    .catch(() => toast("복사하지 못했습니다. 글을 직접 골라 복사하세요.", "error"));

  return (
    <div className="flex flex-col gap-3">
      <SavedFile path={r.output_path} label={message} />
      <p className="kd-small kd-num">
        {parts || "모은 문서 없음"}
        {r.blanks > 0 ? ` · 빈칸 ${num(r.blanks)}곳은 노란색으로 표시했습니다` : " · 빈칸 없음"}
        {totals.length > 0 && ` · 합계 ${totals.map((c) => `${c.label} ${num(c.total!)}`).join(", ")}`}
      </p>

      {hasRoster && (r.missing.length ? (
        <section className="kd-inset flex flex-col gap-2 p-3" aria-labelledby="gather-missing-t">
          <h3 id="gather-missing-t" className="kd-row-title">미제출 {num(r.missing.length)}개 부서: {r.missing.join(", ")}</h3>
          <textarea className="kd-textarea" rows={6} readOnly value={r.reminder} aria-label="독촉 글" />
          <div><Button variant="secondary" size="sm" onClick={copy}><Copy size={13} /> 독촉 글 복사</Button></div>
        </section>
      ) : <Note tone="ok">명단의 부서가 모두 제출했습니다.</Note>)}
      {!hasRoster && <p className="kd-small kd-muted">부서 명단을 넣고 다시 만들면 안 낸 부서를 찾아 드립니다.</p>}

      {r.separate.length > 0 && (
        <section aria-labelledby="gather-sep-t">
          <h3 id="gather-sep-t" className="kd-row-title">서식이 달라 따로 봐야 할 문서 {num(r.separate.length)}개</h3>
          <ul className="kd-rows mt-1">
            {r.separate.map((s) => (
              <li key={s.path} className="kd-row">
                <span className="kd-row-main">
                  <span className="kd-row-title block" title={s.path}>{baseName(s.path)}</span>
                  <span className="kd-row-desc block">{[s.dept, s.reason].filter(Boolean).join(" · ")}</span>
                </span>
                <span className="kd-row-aside"><Button variant="secondary" size="sm" onClick={() => openDocs([s.path])}><ExternalLink size={12} /> 열기</Button></span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {r.failed.length > 0 && (
        <Note tone="warn">
          <span className="font-semibold">읽지 못한 파일 {num(r.failed.length)}개</span>
          <ul className="kd-small mt-1">{r.failed.map((f) => <li key={f.path}><b>{baseName(f.path)}</b>: {f.error}</li>)}</ul>
        </Note>
      )}

      {r.status.length > 0 && (
        <div className="overflow-x-auto">
          <table className="kd-table" aria-label="제출 현황">
            <thead><tr><th>부서</th><th>제출</th><th>빈칸</th></tr></thead>
            <tbody>
              {r.status.map((s, i) => (
                <tr key={`${s.dept}-${i}`}>
                  <td title={s.files.join(", ")}>{s.dept || "부서 확인 필요"}{hasRoster && s.dept && !s.in_roster ? " (명단에 없음)" : ""}</td>
                  <td>{s.submitted ? "제출" : <span className="kd-badge" data-tone="warn">미제출</span>}</td>
                  <td className="kd-num">{s.submitted ? num(s.blanks) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" onClick={onAddLate}><FilePlus2 size={13} /> 늦게 온 파일 더 넣기</Button>
        <span className="kd-small kd-muted">넣은 뒤 엑셀을 다시 만듭니다.</span>
      </div>
    </div>
  );
}
