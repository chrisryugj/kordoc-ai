/** 오늘(홈) — 맨 위 "무엇을 할까요?" 말로 시키기(문서는 홈 어디에 놓아도 거기 붙음), 기한이 다가온 공문, 자주 하는 일, 최근 문서(처음 쓰는 날은 예제), 업무별 목차 */

import { useCallback, useEffect, useState } from "react";
import { ChevronRight, History, CalendarClock, LayoutGrid, LifeBuoy } from "lucide-react";
import { useApp, type ToolId } from "../../state/app";
import { Button } from "../ui/Button";
import { ConfirmRemove } from "../ui/ConfirmRemove";
import { FormatBadge } from "../common/FormatBadge";
import { HomeIndex } from "./HomeIndex";
import { HomeSamples } from "./HomeSamples";
import { HomeTasks } from "./HomeTasks";
import { HomeAgent } from "./HomeAgent";
import { readPref, writePref } from "../../lib/recent";
import { rpc } from "../../lib/rpc";
import { pickFiles } from "../../lib/native";
import { baseName, dirName, num, stem, timeAgo } from "../../lib/format";
import type { RecoveryEntry, UsageReport } from "../../lib/contract";
import { daysLeft, dueBadge, dueText, sortItems, type InboxItem } from "../inbox/dday";

/** 기한 임박: 할 일 가운데 기한이 지났거나 7일 안인 것 */
const SOON_DAYS = 7;

function ImpactLine() {
  const { ready, go } = useApp();
  const [r, setR] = useState<UsageReport | null>(null);
  useEffect(() => {
    if (!ready) return;
    rpc("usage_report", { range: "month" }).then(setR).catch(() => setR(null));
  }, [ready]);
  // 처음 쓰는 달(처리 0건)에는 "0건 · 0시간" 을 보이지 않는다
  if (!r || !r.total_count) return null;
  const hours = Math.round(r.total_saved_min / 60);
  return (
    <button type="button" className="kd-impact-line" onClick={() => go("impact")}>
      <span>이번 달 처리 문서 <b className="kd-num">{num(r.total_count)}</b>건</span>
      {hours > 0 && <>
        <span aria-hidden="true" className="kd-dot" />
        <span>아낀 시간 약 <b className="kd-num">{num(hours)}</b>시간</span>
      </>}
      <ChevronRight size={14} />
    </button>
  );
}

/** 한글 편집기에서 저장하지 않은 채 앱이 꺼진 문서 (복구 사본). 없으면 자리도 없다 */
function Recovered({ active }: { active: boolean }) {
  const { ready, startCreate } = useApp();
  const [items, setItems] = useState<RecoveryEntry[]>([]);
  const load = useCallback(() => rpc("recovery_list", {}).then((r) => setItems(r.entries)).catch(() => setItems([])), []);
  useEffect(() => {
    if (ready && active) void load();
  }, [ready, active, load]);
  if (!items.length) return null;
  return (
    <section className="kd-home-block" aria-labelledby="recovered-t">
      <div className="kd-block-head">
        <h2 id="recovered-t" className="kd-h2 flex items-center gap-2"><LifeBuoy size={16} className="kd-muted" /> 저장하지 않고 꺼진 문서</h2>
      </div>
      <div className="kd-rows">
        {items.slice(0, 3).map((it) => (
          <div key={it.path} className="kd-row">
            <span className="kd-row-main">
              <span className="kd-row-title block" style={{ overflowWrap: "anywhere" }}>{it.working && it.title ? it.title : it.name}</span>
              <span className="kd-row-desc block">{timeAgo(it.saved_at)} 고친 내용이 남아 있습니다{it.exists || it.working ? "" : ". 원래 파일이 없어 저장할 때 새로 만듭니다"}</span>
            </span>
            <span className="kd-row-aside">
              <ConfirmRemove ask="고친 내용을 버릴까요?" verb="버리기" onConfirm={() => void rpc("recovery_discard", { path: it.path }).finally(load)}>
                {(open) => <Button size="sm" variant="ghost" onClick={open} data-tip="저장하지 않은 고친 내용을 지웁니다. 원래 파일은 그대로 둡니다">버리기</Button>}
              </ConfirmRemove>
              <Button size="sm" onClick={() => startCreate({ path: it.path, recover: { title: it.title, working: it.working } })}>되살리기</Button>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

/** 접수함에서 기한이 다가온 공문 셋까지 (없으면 자리도 없다) */
function DueSoon({ active }: { active: boolean }) {
  const { ready, go, openDocs } = useApp();
  const [items, setItems] = useState<InboxItem[]>([]);
  useEffect(() => {
    if (!ready || !active) return;
    rpc("inbox_list", {}).then((r) => setItems(sortItems(r.items))).catch(() => setItems([]));
  }, [ready, active]);
  const soon = items.filter((it) => it.status === "todo" && it.due && daysLeft(it.due) <= SOON_DAYS).slice(0, 3);
  if (!soon.length) return null;
  return (
    <section className="kd-home-block" aria-labelledby="due-t">
      <div className="kd-block-head">
        <h2 id="due-t" className="kd-h2 flex items-center gap-2"><CalendarClock size={16} className="kd-muted" /> 기한이 다가온 공문</h2>
        <button type="button" className="kd-link kd-small" onClick={() => go("inbox")}>접수함 전체 보기</button>
      </div>
      <div className="kd-rows">
        {soon.map((it) => {
          const b = dueBadge(it.due!);
          return (
            <button key={it.id} type="button" className="kd-row" onClick={() => openDocs([it.path])}>
              <span className="kd-badge kd-num" data-tone={b.tone}>{b.label}</span>
              <span className="kd-row-main">
                <span className="kd-row-title block">{it.title || stem(it.name)}</span>
                <span className="kd-row-desc block">{[it.sender, `${dueText(it.due!)}까지`].filter(Boolean).join(" · ")}</span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function RecentDocs() {
  const { recent, openDocs, clearRecent } = useApp();
  return (
    <section className="kd-home-block" aria-labelledby="recent-t">
      <div className="kd-block-head">
        <h2 id="recent-t" className="kd-h2 flex items-center gap-2"><History size={16} className="kd-muted" /> 최근 문서</h2>
        <button type="button" className="kd-link kd-small" onClick={clearRecent}>최근 목록 지우기</button>
      </div>
      <div className="kd-rows">
        {recent.slice(0, 4).map((d) => (
          <button key={d.path} type="button" className="kd-row" onClick={() => openDocs([d.path])}>
            <FormatBadge format={d.format} />
            <span className="kd-row-main">
              <span className="kd-row-title block">{d.name}</span>
              {/* 긴 경로는 폴더 이름만, 전체 경로는 마우스를 올리면 */}
              <span className="kd-path block" title={d.path}>{baseName(dirName(d.path))}</span>
            </span>
            <span className="kd-row-aside kd-small kd-muted">{timeAgo(d.at)}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

export function HomeScreen({ active }: { active: boolean }) {
  const { openDocs, startBatch, startCreate, go, askAbout, recent, uiMode } = useApp();
  const easy = uiMode === "easy";
  const [allOpen, setAllOpen] = useState(() => readPref<boolean>("kordoc-home-all", true));

  const openWith = useCallback(async (tool?: ToolId, hwpxOnly?: boolean) => {
    const paths = await pickFiles(hwpxOnly ? { filters: [{ name: "HWPX 문서", extensions: ["hwpx"] }] } : {});
    if (paths.length) openDocs(paths, tool ? { tool } : undefined);
  }, [openDocs]);

  return (
    <div className="kd-screen" hidden={!active}>
      <div className="kd-body">
        <div className="kd-home">
          {/* 급한 것(기한 공문·꺼진 문서)을 맨 위에, 그다음 입력창과 할 일 */}
          <DueSoon active={active} />
          <Recovered active={active} />
          <HomeAgent />
          {!easy && <ImpactLine />}
          <HomeTasks />
          {/* 문서를 놓는 자리는 맨 위 말로 시키기 입력창 (홈 어디에 놓아도 거기 붙는다) */}
          {recent.length > 0 ? <RecentDocs /> : <HomeSamples />}
          {/* 기능 전체 목차는 접어 둔다 (처음 쓰는 사람에게 할 일 25개는 많다). 연 상태는 기억 */}
          <details className="kd-allfeatures kd-adv" open={allOpen} onToggle={(e) => { const o = (e.currentTarget as HTMLDetailsElement).open; setAllOpen(o); writePref("kordoc-home-all", o); }}>
            <summary><LayoutGrid size={15} /> 모든 기능 보기</summary>
            <HomeIndex
              onOpen={openWith}
              onCreate={(route, kind) => startCreate({ route, kind })}
              onBatch={(task) => startBatch({ paths: [], task })}
              onCompare={() => go("compare")}
              onAsk={(tab) => askAbout({ paths: [], tab })}
              onInbox={() => go("inbox")}
              onPdf={() => go("pdf")}
            />
          </details>
        </div>
      </div>
    </div>
  );
}
