/** 비교 — 옛 문서/새 문서 두 칸 → 신구대조표(바뀐 곳 강조) → 한글·HTML·마크다운·엑셀로 저장 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeftRight, Columns2, FileUp, GitCompareArrows } from "lucide-react";
import type { CompareResult } from "../../lib/contract";
import { useApp } from "../../state/app";
import { rpc } from "../../lib/rpc";
import { pickFiles } from "../../lib/native";
import { baseName, dirName, formatOf, joinPath, num, stem } from "../../lib/format";
import { useTask } from "../../hooks/useTask";
import { ScreenHeader } from "../shell/ScreenHeader";
import { Button } from "../ui/Button";
import { Check } from "../common/Field";
import { Empty, ErrorLine, SavedFile, Working } from "../common/Status";
import { FormatBadge } from "../common/FormatBadge";

type Row = CompareResult["rows"][number];
const TYPE: Record<Row["type"], { label: string; tone: string }> = {
  modified: { label: "바뀜", tone: "warn" },
  added: { label: "새로 넣음", tone: "ok" },
  removed: { label: "뺌", tone: "err" },
  unchanged: { label: "같음", tone: "" },
};

/** 낱말 단위 차이 (LCS) — 너무 길면 강조 없이 */
function wordDiff(a: string, b: string): { old: Array<[string, boolean]>; next: Array<[string, boolean]> } | null {
  const x = a.split(/(\s+)/);
  const y = b.split(/(\s+)/);
  if (x.length * y.length > 60000) return null;
  const dp = Array.from({ length: x.length + 1 }, () => new Array<number>(y.length + 1).fill(0));
  for (let i = x.length - 1; i >= 0; i--) for (let j = y.length - 1; j >= 0; j--) dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const old: Array<[string, boolean]> = [];
  const next: Array<[string, boolean]> = [];
  let i = 0;
  let j = 0;
  while (i < x.length || j < y.length) {
    if (i < x.length && j < y.length && x[i] === y[j]) { old.push([x[i], false]); next.push([y[j], false]); i++; j++; }
    else if (j < y.length && (i >= x.length || dp[i][j + 1] >= dp[i + 1][j])) { next.push([y[j], !/^\s+$/.test(y[j])]); j++; }
    else { old.push([x[i], !/^\s+$/.test(x[i])]); i++; }
  }
  return { old, next };
}

function Slot({ id, label, path, onPick }: { id: string; label: string; path: string; onPick: (p: string) => void }) {
  const { dragTarget } = useApp();
  return (
    <div className="kd-dropzone kd-slot" data-drop={id} data-over={dragTarget === id}>
      <span className="kd-label">{label}</span>
      {path ? (
        <div className="flex items-start gap-2.5 mt-2">
          <FormatBadge format={formatOf(path)} />
          <span className="min-w-0 flex-1">
            <span className="kd-row-title block" style={{ overflowWrap: "anywhere" }}>{baseName(path)}</span>
            <span className="kd-path block">{dirName(path)}</span>
          </span>
          <button type="button" className="kd-link kd-small flex-none" onClick={() => void pickFiles({ multiple: false }).then((p) => p[0] && onPick(p[0]))}>바꾸기</button>
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <span className="kd-small kd-muted">끌어다 놓거나</span>
          <Button variant="secondary" size="sm" onClick={() => void pickFiles({ multiple: false }).then((p) => p[0] && onPick(p[0]))}><FileUp size={13} /> 파일 고르기</Button>
        </div>
      )}
    </div>
  );
}

export function CompareScreen({ active }: { active: boolean }) {
  const { compareIntent, registerDrop, settings } = useApp();
  const [oldPath, setOldPath] = useState("");
  const [newPath, setNewPath] = useState("");
  const [onlyChanged, setOnlyChanged] = useState(true);
  const cmp = useTask<CompareResult>();
  const exp = useTask<string>();
  const handled = useRef(0);

  const runCompare = useCallback((o = oldPath, n = newPath) => {
    exp.reset();
    void cmp.run(() => rpc("compare", { old_path: o, new_path: n }));
  }, [oldPath, newPath, cmp, exp]);

  useEffect(() => {
    if (!compareIntent || compareIntent.nonce === handled.current) return;
    handled.current = compareIntent.nonce;
    const { old, new: n } = compareIntent.value;
    if (old) setOldPath(old);
    if (n) setNewPath(n);
    if (old && n) runCompare(old, n);
  }, [compareIntent, runCompare]);

  useEffect(() => {
    const a = registerDrop("compare-old", (p) => p[0] && setOldPath(p[0]));
    const b = registerDrop("compare-new", (p) => p[0] && setNewPath(p[0]));
    const c = registerDrop("compare", (p) => { if (p[1]) { setOldPath(p[0]); setNewPath(p[1]); } else if (p[0]) (oldPath ? setNewPath : setOldPath)(p[0]); });
    return () => { a(); b(); c(); };
  }, [registerDrop, oldPath]);

  const outDir = settings?.convert.output_dir || dirName(newPath);
  const title = `${stem(newPath || oldPath)} 신구대조표`;
  const save = (kind: "hwpx" | "html" | "md" | "xlsx") => void exp.run(async () => {
    const output_path = joinPath(outDir, `${title}.${kind}`);
    if (kind === "hwpx") return (await rpc("compare_hwpx", { old_path: oldPath, new_path: newPath, title, output_path })).output_path;
    return (await rpc("compare", { old_path: oldPath, new_path: newPath, export: kind, output_path })).output_path ?? output_path;
  });

  const rows = useMemo(() => (cmp.result?.rows ?? []).filter((r) => !onlyChanged || r.type !== "unchanged"), [cmp.result, onlyChanged]);
  const st = cmp.result?.stats;

  return (
    <div className="kd-screen" hidden={!active}>
      <ScreenHeader title="비교" sub="옛 문서와 새 문서를 나란히 놓고 바뀐 곳을 찾아 신구대조표로 만듭니다." />
      <div className="kd-body">
        <div className="kd-compare">
          <div className="kd-slots">
            <Slot id="compare-old" label="옛 문서 (현행)" path={oldPath} onPick={setOldPath} />
            <button type="button" className="kd-icon-btn kd-swap" onClick={() => { setOldPath(newPath); setNewPath(oldPath); }} aria-label="옛 문서와 새 문서 바꾸기" disabled={!oldPath && !newPath}>
              <ArrowLeftRight size={16} />
            </button>
            <Slot id="compare-new" label="새 문서 (개정안)" path={newPath} onPick={setNewPath} />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {cmp.busy ? <Working label="비교하는 중" /> : (
              <Button size="lg" disabled={!oldPath || !newPath} onClick={() => runCompare()}><GitCompareArrows size={15} /> 비교하기</Button>
            )}
            <span className="kd-small kd-muted">형식이 달라도 됩니다. 예: 옛 HWP와 새 PDF</span>
          </div>
          <ErrorLine message={cmp.error} />

          {!cmp.result && !cmp.busy && (
            <Empty icon={<Columns2 size={30} />} title="두 문서를 넣고 비교하기를 누르세요">규정·조례·지침 개정안에서 바뀐 조문만 골라 현행과 개정안을 나란히 보여 줍니다.</Empty>
          )}

          {cmp.result && st && (
            <section className="flex flex-col gap-3" aria-labelledby="cmp-t">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 id="cmp-t" className="kd-h2 kd-num">바뀜 {num(st.modified)} · 새로 넣음 {num(st.added)} · 뺌 {num(st.removed)} · 같음 {num(st.unchanged)}</h2>
                <Check label="바뀐 곳만 보기" checked={onlyChanged} onChange={setOnlyChanged} />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="kd-label">저장</span>
                <Button size="sm" onClick={() => save("hwpx")} disabled={exp.busy}>한글(HWPX) 신구대조표</Button>
                <Button size="sm" variant="secondary" onClick={() => save("xlsx")} disabled={exp.busy}>엑셀</Button>
                <Button size="sm" variant="secondary" onClick={() => save("html")} disabled={exp.busy}>HTML</Button>
                <Button size="sm" variant="secondary" onClick={() => save("md")} disabled={exp.busy}>마크다운</Button>
              </div>
              {exp.busy && <Working label="저장하는 중" />}
              <ErrorLine message={exp.error} />
              {exp.result && <SavedFile path={exp.result} />}
              <table className="kd-table kd-cmp">
                <thead><tr><th style={{ width: 84 }}>구분</th><th>현행</th><th>개정안</th></tr></thead>
                <tbody>
                  {rows.map((r, i) => {
                    const d = r.type === "modified" ? wordDiff(r.old, r.new) : null;
                    return (
                      <tr key={i} data-type={r.type}>
                        <td><span className="kd-badge" data-tone={TYPE[r.type].tone || undefined}>{TYPE[r.type].label}</span></td>
                        <td className="kd-cmp-old">{d ? d.old.map(([t, ch], k) => (ch ? <del key={k}>{t}</del> : t)) : r.old || <span className="kd-muted">(없음)</span>}</td>
                        <td className="kd-cmp-new">{d ? d.next.map(([t, ch], k) => (ch ? <ins key={k}>{t}</ins> : t)) : r.new || <span className="kd-muted">(삭제)</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
