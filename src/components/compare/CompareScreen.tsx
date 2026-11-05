/** 비교 — 원본/비교본 두 칸(끌어다 놓으면 바로 비교) → 나란히 보기(쪽 모양 그대로, 바뀐 곳 칠함) 또는 대조표 → 한글·HTML·마크다운·엑셀로 저장 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeftRight, ChevronDown, ChevronUp, Columns2, FileUp, Maximize2, Minus, Plus, RefreshCw } from "lucide-react";
import type { CompareVisualResult, VisualChange } from "../../lib/contract";
import { useApp } from "../../state/app";
import { rpc } from "../../lib/rpc";
import { pickFiles } from "../../lib/native";
import { baseName, dirName, formatOf, joinPath, num, stem } from "../../lib/format";
import type { DocFormat } from "../../lib/contract";
import { useTask } from "../../hooks/useTask";
import { ScreenHeader } from "../shell/ScreenHeader";
import { Button } from "../ui/Button";
import { Check, Seg } from "../common/Field";
import { Empty, ErrorLine, Note, SavedFile, Working } from "../common/Status";
import { FormatBadge } from "../common/FormatBadge";
import { ComparePane } from "./ComparePane";

type Row = CompareVisualResult["rows"][number];
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

/** 비교는 쪽 구조가 있는 문서만 (글 파일·그림은 엔진 비교가 읽지 못한다) */
const COMPARE_FORMATS: DocFormat[] = ["hwp", "hwpx", "hwpml", "pdf", "docx", "xlsx", "xls", "pptx"];
const COMPARE_FILTER = [{ name: "비교할 문서 (한글·PDF·워드·엑셀·파워포인트)", extensions: ["hwp", "hwpx", "hml", "pdf", "docx", "xlsx", "xls", "pptx"] }];
const UNSUPPORTED = "비교할 수 없는 형식입니다. 한글(HWP·HWPX), PDF, 워드, 엑셀, 파워포인트 문서를 넣으세요.";
const comparable = (p: string) => COMPARE_FORMATS.includes(formatOf(p));
const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2];

function Slot({ id, label, path, onPick }: { id: string; label: string; path: string; onPick: (p: string) => void }) {
  const { dragTarget } = useApp();
  const pick = () => void pickFiles({ multiple: false, filters: COMPARE_FILTER }).then((p) => p[0] && onPick(p[0]));
  return (
    <div className="kd-dropzone kd-slot" data-drop={id} data-over={dragTarget === id}>
      <span className="kd-label">{label}</span>
      {path ? (
        <div className="flex items-start gap-2.5 mt-2">
          <FormatBadge format={formatOf(path)} />
          {/* 파일 이름만, 전체 경로는 마우스를 올리면 */}
          <span className="min-w-0 flex-1" title={path}>
            <span className="kd-row-title block" style={{ overflowWrap: "anywhere" }}>{baseName(path)}</span>
          </span>
          <button type="button" className="kd-link kd-small flex-none" onClick={pick} data-tip={`${label} 다른 파일로`}>바꾸기</button>
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <span className="kd-small kd-muted">끌어다 놓거나</span>
          <Button variant="secondary" size="sm" onClick={pick}><FileUp size={13} /> 파일 고르기</Button>
        </div>
      )}
    </div>
  );
}

/** 바뀐 곳 목록의 한 줄 — 바뀐 어절만 표시 */
function ChangeText({ c }: { c: VisualChange }) {
  if (c.type === "added") return <ins>{c.new}</ins>;
  if (c.type === "removed") return <del>{c.old}</del>;
  const d = wordDiff(c.old, c.new);
  if (!d) return <><del>{c.old}</del> <ins>{c.new}</ins></>;
  // 바뀐 어절 덩어리 (덩어리 안 띄어쓰기는 살린다)
  const runs = (segs: Array<[string, boolean]>) => {
    const out: string[] = [];
    let cur = "";
    segs.forEach(([t, ch], k) => {
      if (ch) cur += t;
      else if (cur && /^\s+$/.test(t) && segs[k + 1]?.[1]) cur += t;
      else if (cur) { out.push(cur); cur = ""; }
    });
    if (cur) out.push(cur);
    return out;
  };
  const gone = runs(d.old);
  const put = runs(d.next);
  // 띄어쓰기만 다르면 바뀐 어절이 없다
  if (!gone.length && !put.length) return <><span className="kd-muted">띄어쓰기만 바뀜: </span>{c.new}</>;
  return (
    <>
      {gone.map((t, k) => <span key={`o${k}`}>{k > 0 && " … "}<del>{t}</del></span>)}
      {gone.length > 0 && put.length > 0 && " → "}
      {put.map((t, k) => <span key={`n${k}`}>{k > 0 && " … "}<ins>{t}</ins></span>)}
    </>
  );
}

const where = (c: VisualChange) => [c.old_page && `원본 ${c.old_page}쪽`, c.new_page && `비교본 ${c.new_page}쪽`].filter(Boolean).join(" · ");

export function CompareScreen({ active }: { active: boolean }) {
  const { compareIntent, registerDrop, settings } = useApp();
  const [oldPath, setOldPath] = useState("");
  const [newPath, setNewPath] = useState("");
  const [onlyChanged, setOnlyChanged] = useState(true);
  const [formatError, setFormatError] = useState("");
  const [view, setView] = useState<"side" | "table">("side");
  const [current, setCurrent] = useState<number | null>(null);
  const [sync, setSync] = useState(true);
  const [zoom, setZoom] = useState<number | "fit">("fit");
  const [jump, setJump] = useState<{ old: { page: number; frac?: number; nonce: number } | null; new: { page: number; frac?: number; nonce: number } | null }>({ old: null, new: null });
  const [follow, setFollow] = useState<{ old: { page: number; frac: number; nonce: number } | null; new: { page: number; frac: number; nonce: number } | null }>({ old: null, new: null });
  const lead = useRef<"old" | "new">("old");
  /** 바뀐 곳으로 옮겨 가는 동안은 같이 넘기기를 잠시 멈춘다 (두 칸이 각자 제자리로 가야 한다) */
  const quietUntil = useRef(0);
  /** 같이 넘기기의 맞춤점(쪽 + 쪽 안 비율). 바뀐 곳으로 옮기면 그 두 자리를 맞춤점으로 삼아, 한쪽에 쪽이 끼어도 그 어긋남을 지킨다 */
  const syncBase = useRef({ old: 1, new: 1 });
  /** 결과에 그 결과를 낸 두 문서를 붙여 둔다 (새 비교가 도는 동안 앞 결과의 상자가 새 문서 위에 겹치지 않게) */
  /** run: 같은 두 문서를 다시 비교해도 두 칸이 파일을 새로 읽게 (한글에서 고쳐 저장한 뒤) */
  const cmp = useTask<CompareVisualResult & { pair: string; run: number }>();
  const exp = useTask<string>();
  // 문서를 바꾸거나 맞바꾸면 앞 비교 결과·저장 결과를 보이지 않는다.
  // 결과는 그 결과를 낸 두 문서가 지금 두 칸과 같을 때만 보인다 (돌던 비교가 늦게 끝나도 섞이지 않게)
  const [ranFor, setRanFor] = useState("");
  const pairKey = (o: string, n: string) => [o, n].join("|");
  const { reset: clearExp } = exp;
  const clear = clearExp;
  // 끌어다 놓기·고르기 모두 여기서 형식을 본다
  const putOld = useCallback((p: string) => { if (!comparable(p)) { setFormatError(UNSUPPORTED); return; } setFormatError(""); setOldPath(p); clear(); }, [clear]);
  const putNew = useCallback((p: string) => { if (!comparable(p)) { setFormatError(UNSUPPORTED); return; } setFormatError(""); setNewPath(p); clear(); }, [clear]);
  const handled = useRef(0);

  const runCompare = useCallback((o: string, n: string) => {
    exp.reset();
    setRanFor(pairKey(o, n));
    setCurrent(null);
    setJump({ old: null, new: null });
    setFollow({ old: null, new: null });
    syncBase.current = { old: 1, new: 1 };
    const pair = pairKey(o, n);
    void cmp.run(async ({ signal, onProgress }) => ({ ...(await rpc("compare_visual", { old_path: o, new_path: n }, { signal, onProgress })), pair, run: Date.now() }));
  }, [cmp, exp]);

  /** 두 칸에 한꺼번에 넣기 (메뉴·끌어다 놓기). 지금 두 칸과 같은 두 문서면 다시 비교한다 */
  const putBoth = useCallback((o: string, n: string) => {
    if (!comparable(o) || !comparable(n)) { setFormatError(UNSUPPORTED); return; }
    setFormatError("");
    if (o === oldPath && n === newPath) { if (!cmp.busy) runCompare(o, n); return; }
    setOldPath(o);
    setNewPath(n);
    clear();
  }, [oldPath, newPath, cmp.busy, runCompare, clear]);

  // 두 칸이 다 차면 바로 비교한다 (바꾸거나 맞바꿔도)
  useEffect(() => {
    if (!oldPath || !newPath || ranFor === pairKey(oldPath, newPath)) return;
    runCompare(oldPath, newPath);
    // 두 칸이 바뀔 때만
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oldPath, newPath]);

  useEffect(() => {
    if (!compareIntent || compareIntent.nonce === handled.current) return;
    handled.current = compareIntent.nonce;
    const { old, new: n } = compareIntent.value;
    if (old && n) putBoth(old, n);
    else if (old) putOld(old);
    else if (n) putNew(n);
  }, [compareIntent, putOld, putNew, putBoth]);

  useEffect(() => {
    const a = registerDrop("compare-old", (p) => p[0] && putOld(p[0]));
    const b = registerDrop("compare-new", (p) => p[0] && putNew(p[0]));
    const c = registerDrop("compare", (p) => { if (p[1]) putBoth(p[0], p[1]); else if (p[0]) (oldPath ? putNew : putOld)(p[0]); });
    return () => { a(); b(); c(); };
  }, [registerDrop, oldPath, putOld, putNew, putBoth]);

  const outDir = settings?.convert.output_dir || dirName(newPath);
  const title = `${stem(newPath || oldPath)} 신구대조표`;
  const save = (kind: "hwpx" | "html" | "md" | "xlsx") => void exp.run(async () => {
    const output_path = joinPath(outDir, `${title}.${kind}`);
    if (kind === "hwpx") return (await rpc("compare_hwpx", { old_path: oldPath, new_path: newPath, title, output_path })).output_path;
    return (await rpc("compare", { old_path: oldPath, new_path: newPath, export: kind, output_path })).output_path ?? output_path;
  });

  const fresh = ranFor === pairKey(oldPath, newPath);
  // 다시 비교가 실패·멈춤이면 앞 결과는 지금 파일과 다를 수 있어 감춘다
  const result = !cmp.error && cmp.result?.pair === pairKey(oldPath, newPath) ? cmp.result : null;
  const rows = useMemo(() => (result?.rows ?? []).filter((r) => !onlyChanged || r.type !== "unchanged"), [result, onlyChanged]);
  const st = result?.stats;
  /** 바뀐 곳이 하나도 없다 (같은 파일을 두 번 넣었거나 내용이 같다) */
  const same = !!st && st.modified + st.added + st.removed === 0;
  const visual = !!result?.old && !!result?.new;
  const why = result && !visual ? (result.old_why || result.new_why || "") : "";
  const shown = visual ? view : "table";
  const changes = result?.changes ?? [];
  const idx = changes.findIndex((c) => c.id === current);

  const goTo = useCallback((c: VisualChange) => {
    setCurrent(c.id);
    quietUntil.current = Date.now() + 900;
    if (c.old_page && c.new_page) syncBase.current = { old: c.old_page + (c.old_y ?? 0), new: c.new_page + (c.new_y ?? 0) };
    const nonce = Date.now();
    setJump({
      old: c.old_page ? { page: c.old_page, frac: c.old_y, nonce } : null,
      new: c.new_page ? { page: c.new_page, frac: c.new_y, nonce } : null,
    });
  }, []);
  const step = (dir: 1 | -1) => {
    if (!changes.length) return;
    const next = idx < 0 ? (dir > 0 ? 0 : changes.length - 1) : (idx + dir + changes.length) % changes.length;
    goTo(changes[next]);
  };
  const pickMark = useCallback((id: number) => { const c = changes.find((x) => x.id === id); if (c) goTo(c); }, [changes, goTo]);

  // 목록은 바뀐 곳·고른 줄이 바뀔 때만 다시 그린다 (같이 넘기기는 넘길 때마다 화면을 다시 그린다)
  const listRef = useRef<HTMLElement>(null);
  const list = useMemo(() => (
    <nav ref={listRef} className="kd-cmp-list" aria-label="바뀐 곳 목록">
      {changes.map((c, k) => (
        <button key={c.id} type="button" className="kd-cmp-item" data-type={c.type} aria-current={current === c.id || undefined} onClick={() => goTo(c)}>
          <span className="flex items-center gap-2">
            <span className="kd-small kd-muted kd-num">{k + 1}</span>
            <span className="kd-badge" data-tone={TYPE[c.type].tone || undefined}>{TYPE[c.type].label}</span>
            <span className="kd-small kd-muted">{where(c) || "쪽 자리를 찾지 못함"}</span>
          </span>
          <span className="kd-cmp-item-text"><ChangeText c={c} /></span>
        </button>
      ))}
    </nav>
  ), [changes, current, goTo]);
  // N·P·상자 누르기로 고른 줄이 목록 밖이면 보이게
  useEffect(() => { listRef.current?.querySelector<HTMLElement>("[aria-current]")?.scrollIntoView({ block: "nearest" }); }, [current]);

  const onView = (side: "old" | "new") => (page: number, frac: number) => {
    if (!sync || lead.current !== side || Date.now() < quietUntil.current) return;
    const other = side === "old" ? "new" : "old";
    const base = syncBase.current;
    const at = Math.max(1, base[other] + (page + frac - base[side]));
    setFollow((f) => ({ ...f, [other]: { page: Math.floor(at), frac: at - Math.floor(at), nonce: Date.now() } }));
  };
  const onViewOld = useCallback(onView("old"), [sync]);
  const onViewNew = useCallback(onView("new"), [sync]);

  const zoomStep = (dir: 1 | -1) => {
    const cur = zoom === "fit" ? 1 : zoom;
    const i = ZOOMS.findIndex((z) => z >= cur);
    setZoom(ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, (i < 0 ? ZOOMS.length - 1 : i) + dir))]);
  };

  // 나란히 보기에서 N·P(또는 ]·[)로 앞뒤 바뀐 곳 (입력칸에 있을 때는 그대로)
  useEffect(() => {
    if (!active || shown !== "side" || !changes.length) return;
    const onKey = (e: KeyboardEvent) => {
      // 글을 쓰는 칸에서만 비킨다 (같이 넘기기 확인란을 누른 뒤에도 N·P 는 된다)
      if (e.altKey || e.ctrlKey || e.metaKey || (e.target as HTMLElement)?.closest("input:not([type=checkbox]):not([type=radio]), textarea, select, [contenteditable]")) return;
      // 글쇠 자리로 본다 (한글 입력 상태면 e.key 가 ㅜ·ㅔ 라서)
      if (e.code === "KeyN" || e.code === "BracketRight") { e.preventDefault(); step(1); }
      else if (e.code === "KeyP" || e.code === "BracketLeft") { e.preventDefault(); step(-1); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // 같은 두 문서를 다시 (실패·멈춤 뒤, 한글에서 고쳐 저장한 뒤)
  const again = oldPath && newPath && !cmp.busy && fresh && (cmp.error || result)
    ? <Button size="sm" variant="secondary" onClick={() => runCompare(oldPath, newPath)}><RefreshCw size={13} /> 다시 비교</Button>
    : null;
  /** 나란히 보기는 창 높이를 다 쓴다 (화면 전체가 아니라 두 칸이 각자 넘어간다) */
  const wide = !!result && !same && shown === "side";

  return (
    <div className="kd-screen" hidden={!active}>
      <ScreenHeader title="비교" sub="두 문서를 나란히 놓고 바뀐 곳 표시" />
      <div className="kd-body">
        <div className="kd-compare" data-wide={wide || undefined}>
          <div className="kd-slots">
            <Slot id="compare-old" label="원본" path={oldPath} onPick={putOld} />
            <button type="button" className="kd-icon-btn kd-swap" onClick={() => { setOldPath(newPath); setNewPath(oldPath); clear(); }} aria-label="원본과 비교본 맞바꾸기" disabled={!oldPath && !newPath}>
              <ArrowLeftRight size={16} />
            </button>
            <Slot id="compare-new" label="비교본" path={newPath} onPick={putNew} />
          </div>
          {cmp.busy && <Working label="비교하는 중" progress={cmp.progress} onCancel={cmp.cancel} />}
          <ErrorLine message={formatError} />
          <ErrorLine message={fresh ? cmp.error : ""} />
          {again && (!result || same) && <div>{again}</div>}

          {(!oldPath || !newPath) && !cmp.busy && (
            <Empty icon={<Columns2 size={30} />} title="비교할 두 문서를 끌어다 놓으세요">두 문서를 한꺼번에 놓아도 됩니다. 원본과 비교본이 거꾸로면 가운데 단추로 맞바꾸세요. 형식이 달라도 됩니다(예: 옛 HWP와 새 PDF).</Empty>
          )}

          {same && <Note tone="ok">두 문서 내용이 같습니다. 바뀐 곳이 없습니다.</Note>}

          {result && st && !same && (
            <section className="kd-cmp-result flex flex-col gap-3" aria-labelledby="cmp-t">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 id="cmp-t" className="kd-h2 kd-num">바뀜 {num(st.modified)} · 새로 넣음 {num(st.added)} · 뺌 {num(st.removed)} · 같음 {num(st.unchanged)}</h2>
                <div className="flex items-center gap-2">
                  {again}
                  <Seg label="보기 방식" value={shown} onChange={setView}
                    options={[{ value: "side", label: "나란히 보기", disabled: !visual }, { value: "table", label: "대조표" }]} />
                </div>
              </div>
              {why && <Note tone="info">{why}</Note>}
              <div className="flex flex-wrap items-center gap-2">
                <span className="kd-label">저장</span>
                <Button size="sm" onClick={() => save("hwpx")} disabled={exp.busy}>한글(HWPX) 신구대조표</Button>
                <Button size="sm" variant="secondary" onClick={() => save("xlsx")} disabled={exp.busy}>엑셀</Button>
                <Button size="sm" variant="secondary" onClick={() => save("html")} disabled={exp.busy}>HTML</Button>
                <Button size="sm" variant="secondary" onClick={() => save("md")} disabled={exp.busy}>글(마크다운)</Button>
              </div>
              {exp.busy && <Working label="저장하는 중" />}
              <ErrorLine message={exp.error} />
              {exp.result && <SavedFile path={exp.result} />}

              {shown === "side" && result.old && result.new ? (
                <>
                  <div className="kd-toolbar kd-cmp-bar">
                    <button type="button" className="kd-icon-btn" onClick={() => step(-1)} aria-label="이전 바뀐 곳" data-tip="이전 바뀐 곳 (P)"><ChevronUp size={15} /></button>
                    <span className="kd-small kd-num" aria-live="polite">{idx < 0 ? `바뀐 곳 ${num(changes.length)}개` : `${idx + 1} / ${changes.length}`}</span>
                    <button type="button" className="kd-icon-btn" onClick={() => step(1)} aria-label="다음 바뀐 곳" data-tip="다음 바뀐 곳 (N)"><ChevronDown size={15} /></button>
                    <p className="kd-cmp-legend kd-small kd-muted">
                      <i data-kind="del" /> 원본에서 빠지거나 바뀐 글자
                      <i data-kind="add" /> 비교본에 넣거나 바뀐 글자
                      <i data-kind="gap" /> 한쪽에만 있는 내용이 들어갈 자리
                    </p>
                    <span className="kd-toolbar-gap" />
                    <Check label="같이 넘기기" checked={sync} onChange={setSync} />
                    <button type="button" className="kd-icon-btn" onClick={() => zoomStep(-1)} aria-label="작게 보기"><Minus size={15} /></button>
                    <span className="kd-small kd-num kd-zoom">{zoom === "fit" ? "폭 맞춤" : `${Math.round(zoom * 100)}%`}</span>
                    <button type="button" className="kd-icon-btn" onClick={() => zoomStep(1)} aria-label="크게 보기"><Plus size={15} /></button>
                    <button type="button" className="kd-icon-btn" aria-pressed={zoom === "fit"} onClick={() => setZoom("fit")} aria-label="폭 맞춤"><Maximize2 size={14} /></button>
                  </div>
                  <div className="kd-cmp-visual">
                    {list}
                    {/* 다른 화면에 가 있는 동안은 두 칸(한글 그리기 일꾼·쪽 그림)을 내려놓는다. run 이 바뀌면 파일을 새로 읽는다 */}
                    {active && <>
                      <ComparePane key={`o${result.run}`} id="compare-old" label="원본" path={oldPath} side={result.old} active={current} onPick={pickMark}
                        scrollTo={jump.old} follow={follow.old} onView={onViewOld} onLead={() => { lead.current = "old"; }} zoom={zoom} />
                      <ComparePane key={`n${result.run}`} id="compare-new" label="비교본" path={newPath} side={result.new} active={current} onPick={pickMark}
                        scrollTo={jump.new} follow={follow.new} onView={onViewNew} onLead={() => { lead.current = "new"; }} zoom={zoom} />
                    </>}
                  </div>
                </>
              ) : (
                <>
                  <Check label="바뀐 곳만 보기" checked={onlyChanged} onChange={setOnlyChanged} />
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
                </>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
