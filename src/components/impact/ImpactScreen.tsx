/**
 * 효과 — 일 종류별 처리 건수 × 기준 시간(가정치) = 아낀 시간. 담백한 표 하나.
 * 기준 시간은 기관 실정에 맞게 바꾸고(impact.baselines), 기관 보고용 HWPX 로 저장한다.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, FileDown, RotateCcw, Save } from "lucide-react";
import type { UsageReport } from "../../lib/contract";
import { useApp } from "../../state/app";
import { rpc, errorText } from "../../lib/rpc";
import { num } from "../../lib/format";
import { useTask } from "../../hooks/useTask";
import { useGongmunMeta } from "../../hooks/useGongmunMeta";
import { ScreenHeader } from "../shell/ScreenHeader";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";
import { Seg } from "../common/Field";
import { ErrorLine, Note, SavedFile, Working } from "../common/Status";

const hm = (min: number) => {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h ? `${num(h)}시간${m ? ` ${m}분` : ""}` : `${m}분`;
};
const day = (ymd: string) => { const [y, m, d] = ymd.split("-").map(Number); return y ? `${y}. ${m}. ${d}.` : ymd; };

export function ImpactScreen({ active }: { active: boolean }) {
  const { go, ready, settings, saveSettings, toast } = useApp();
  const meta = useGongmunMeta();
  const [range, setRange] = useState<"month" | "all">("month");
  const [report, setReport] = useState<UsageReport | null>(null);
  const [error, setError] = useState("");
  const [base, setBase] = useState<Record<string, string>>({});
  const exp = useTask<string>();

  const load = useCallback(async () => {
    try {
      const r = await rpc("usage_report", { range });
      setReport(r);
      setBase(Object.fromEntries(r.items.map((i) => [i.key, String(i.baseline_min)])));
      setError("");
    } catch (e) { setError(errorText(e)); }
  }, [range]);
  useEffect(() => { if (active && ready) void load(); }, [active, ready, load]);

  const changed = useMemo(() => report?.items.some((i) => String(i.baseline_min) !== base[i.key]) ?? false, [report, base]);

  const saveBase = async () => {
    const baselines = { ...(settings?.impact.baselines ?? {}) };
    for (const [k, v] of Object.entries(base)) { const n = Number(v); if (Number.isFinite(n) && n >= 0) baselines[k] = n; }
    if (await saveSettings({ impact: { baselines } })) { toast("기준 시간을 저장했습니다", "success"); void load(); }
  };

  const [confirmReset, setConfirmReset] = useState(false);
  const reset = async () => {
    setConfirmReset(false);
    try { await rpc("usage_reset", {}); void load(); } catch (e) { toast(errorText(e), "error"); }
  };

  const exportHwpx = () => void exp.run(async () => {
    if (!report) throw new Error("집계를 아직 읽지 못했습니다");
    const [y, m] = report.since.split("-").map(Number);
    const title = `KorDoc AI 활용 효과 (${range === "month" ? `${y}년 ${m}월` : `${day(report.since)}부터`})`;
    const md = [
      `# ${title}`, "",
      `- 집계 시작: ${day(report.since)}`,
      `- 처리 문서: ${num(report.total_count)}건`,
      `- 아낀 시간: 약 ${hm(report.total_saved_min)} (아래 기준 시간 가정치로 계산)`, "",
      "| 일 | 건수 | 한 건 기준 시간 | 아낀 시간 |", "|---|---|---|---|",
      ...report.items.map((i) => `| ${i.label} | ${num(i.count)}${i.unit} | ${i.baseline_min}분 | ${hm(i.saved_min)} |`), "",
      Object.keys(settings?.impact.baselines ?? {}).length
        ? "※ 기준 시간은 손으로 할 때 걸리는 시간의 가정치로, 기관에서 정한 값으로 계산했습니다."
        : "※ 기준 시간은 손으로 할 때 걸리는 시간의 가정치입니다. 설정에서 기관 실정에 맞게 바꿀 수 있습니다.",
    ].join("\n");
    const preset = meta?.presets.find((p) => p.id === "report" || p.label.includes("보고서"))?.id;
    const r = await rpc("generate_hwpx", { markdown: md, no_usage: true, ...(preset ? { preset } : {}) });
    if (!r.output_path) throw new Error("보고서를 저장하지 못했습니다");
    return r.output_path;
  });

  return (
    <div className="kd-screen" hidden={!active}>
      <ScreenHeader title="효과" sub="이 PC에서 처리한 문서 수와, 손으로 할 때보다 아낀 시간입니다."
        actions={<Button variant="ghost" onClick={() => go("home")}><ArrowLeft size={15} /> 홈으로</Button>} />
      <div className="kd-body">
        <div className="kd-impact">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Seg label="집계 기간" value={range} onChange={setRange} options={[{ value: "month", label: "이번 달" }, { value: "all", label: "전체" }]} />
            {report && <span className="kd-small kd-muted">{day(report.since)}부터 · 이 PC에만 기록하고 어디에도 보내지 않습니다</span>}
          </div>
          <ErrorLine message={error} />
          {report && (
            <>
              <p className="kd-impact-total kd-num">처리 문서 <b>{num(report.total_count)}</b>건 · 아낀 시간 약 <b>{hm(report.total_saved_min)}</b></p>
              <table className="kd-table kd-impact-table">
                <thead><tr><th>일</th><th className="text-right">건수</th><th className="text-right">한 건 기준 시간</th><th className="text-right">아낀 시간</th></tr></thead>
                <tbody>
                  {report.items.map((i) => (
                    <tr key={i.key}>
                      <td>{i.label}</td>
                      <td className="text-right kd-num">{num(i.count)}{i.unit}</td>
                      <td className="text-right">
                        <span className="inline-flex items-center gap-1.5">
                          <input className="kd-input kd-num text-right" style={{ width: 72, height: 30 }} inputMode="numeric" value={base[i.key] ?? ""} aria-label={`${i.label} 한 건 기준 분`}
                            onChange={(e) => setBase((b) => ({ ...b, [i.key]: e.target.value.replace(/[^\d.]/g, "") }))} />
                          <span className="kd-small kd-muted">분</span>
                        </span>
                      </td>
                      <td className="text-right kd-num">{hm(i.saved_min)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Note tone="info">기준 시간은 손으로 할 때 걸리는 시간의 가정치입니다. 기관 실정에 맞게 바꾸세요. 바꾼 값은 아낀 시간 계산에만 씁니다.</Note>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="secondary" disabled={!changed} onClick={() => void saveBase()}><Save size={14} /> 기준 시간 저장</Button>
                {exp.busy ? <Working label="보고서를 만드는 중" /> : <Button onClick={exportHwpx}><FileDown size={14} /> 기관 보고용 HWPX로 저장</Button>}
                <span className="flex-1" />
                <Button variant="ghost" size="sm" onClick={() => setConfirmReset(true)}><RotateCcw size={13} /> 기록 지우기</Button>
              </div>
              <ErrorLine message={exp.error} />
              {exp.result && <SavedFile path={exp.result} label="기관 보고용 문서를 저장했습니다" />}
            </>
          )}
        </div>
      </div>
      <Modal isOpen={confirmReset} onClose={() => setConfirmReset(false)} title="처리 기록 지우기" size="sm"
        footer={<div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setConfirmReset(false)}>그만두기</Button><Button variant="danger" onClick={() => void reset()}>지우기</Button></div>}>
        <p className="kd-text">이 PC에 쌓인 처리 기록을 모두 지울까요? 지우면 되돌리지 못합니다.</p>
      </Modal>
    </div>
  );
}
