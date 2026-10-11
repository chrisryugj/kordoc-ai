/** 홈 — 첫 화면에 끌어다 놓는 자리 + 최근 문서(처음 쓰는 날은 예제), 그 아래 "무엇을 할까요?" 일 단위 목차 */

import { useCallback, useEffect, useState } from "react";
import { ChevronRight, FolderOpen, FileUp, X, BookOpenText, Layers, Columns2, MessageSquareText, History } from "lucide-react";
import { useApp, type ToolId } from "../../state/app";
import { Button } from "../ui/Button";
import { FormatBadge } from "../common/FormatBadge";
import { HomeIndex } from "./HomeIndex";
import { HomeSamples } from "./HomeSamples";
import { rpc } from "../../lib/rpc";
import { pickFiles, pickFolder } from "../../lib/native";
import { baseName, dirName, num, timeAgo } from "../../lib/format";
import type { UsageReport } from "../../lib/contract";

function ImpactLine() {
  const { ready, go } = useApp();
  const [r, setR] = useState<UsageReport | null>(null);
  useEffect(() => {
    if (!ready) return;
    rpc("usage_report", { range: "month" }).then(setR).catch(() => setR(null));
  }, [ready]);
  if (!r) return null;
  const hours = Math.round(r.total_saved_min / 60);
  return (
    <button type="button" className="kd-impact-line" onClick={() => go("impact")}>
      <span>이번 달 처리 문서 <b className="kd-num">{num(r.total_count)}</b>건</span>
      <span aria-hidden="true" className="kd-dot" />
      <span>아낀 시간 약 <b className="kd-num">{num(hours)}</b>시간</span>
      <ChevronRight size={14} />
    </button>
  );
}

function DropArea() {
  const { openDocs, startBatch, startCompare, askAbout, registerDrop, dragTarget } = useApp();
  const [many, setMany] = useState<string[] | null>(null);

  const receive = useCallback((paths: string[]) => {
    if (paths.length === 1 && /\.[a-z0-9]+$/i.test(paths[0])) openDocs(paths);
    else setMany(paths);
  }, [openDocs]);
  useEffect(() => registerDrop("home", receive), [registerDrop, receive]);

  const over = dragTarget === "home";
  return (
    <section className="kd-dropzone kd-drop" data-drop="home" data-over={over} aria-label="문서 받는 곳">
      <div className="kd-papers" aria-hidden="true">
        <span className="kd-paper" data-k="hwp">HWPX</span>
        <span className="kd-paper" data-k="pdf">PDF</span>
        <span className="kd-paper" data-k="xls">XLSX</span>
      </div>
      {many ? (
        <div className="min-w-0">
          <p className="kd-drop-title">{many.length === 1 ? "폴더를 받았습니다" : `파일 ${num(many.length)}개를 받았습니다`}. 어떻게 할까요?</p>
          <p className="kd-drop-sub kd-drop-names">{many.slice(0, 3).map(baseName).join(", ")}{many.length > 3 ? ` 외 ${num(many.length - 3)}개` : ""}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="lg" onClick={() => { openDocs(many); setMany(null); }}><BookOpenText size={15} /> 작업대에서 하나씩 보기</Button>
            <Button size="lg" variant="secondary" onClick={() => { startBatch({ paths: many }); setMany(null); }}><Layers size={15} /> 한꺼번에 처리하기</Button>
            {many.length === 2 && <Button size="lg" variant="secondary" onClick={() => { startCompare(many[0], many[1]); setMany(null); }}><Columns2 size={15} /> 두 문서 비교하기</Button>}
            <Button size="lg" variant="secondary" onClick={() => { askAbout({ paths: many }); setMany(null); }}><MessageSquareText size={15} /> AI에게 묻기</Button>
            <Button size="lg" variant="ghost" onClick={() => setMany(null)}><X size={15} /> 취소</Button>
          </div>
        </div>
      ) : (
        <div className="min-w-0">
          <p className="kd-drop-title">{over ? "여기에 놓으세요" : "문서를 여기에 끌어다 놓으세요"}</p>
          <p className="kd-drop-sub">한글(HWP·HWPX), PDF, 엑셀, 워드, 파워포인트, 그림 파일. 폴더째 놓아도 됩니다.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button size="lg" onClick={() => void pickFiles().then((p) => p.length && receive(p))}><FileUp size={15} /> 파일 고르기</Button>
            <Button size="lg" variant="secondary" onClick={() => void pickFolder().then((d) => d && setMany([d]))}><FolderOpen size={15} /> 폴더 고르기</Button>
          </div>
        </div>
      )}
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
              <span className="kd-path block">{dirName(d.path)}</span>
            </span>
            <span className="kd-row-aside kd-small kd-muted">{timeAgo(d.at)}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

export function HomeScreen({ active }: { active: boolean }) {
  const { openDocs, startBatch, startCreate, go, askAbout, recent } = useApp();

  const openWith = useCallback(async (tool?: ToolId, hwpxOnly?: boolean) => {
    const paths = await pickFiles(hwpxOnly ? { filters: [{ name: "HWPX 문서", extensions: ["hwpx"] }] } : {});
    if (paths.length) openDocs(paths, tool ? { tool } : undefined);
  }, [openDocs]);

  return (
    <div className="kd-screen" hidden={!active}>
      <div className="kd-body">
        <div className="kd-home">
          <div className="kd-home-top">
            <h1 className="kd-home-title">무엇을 할까요?</h1>
            <p className="kd-head-sub">문서를 끌어다 놓거나 아래에서 하려는 일을 고르세요.</p>
          </div>
          <ImpactLine />
          <div className="kd-home-hero">
            <DropArea />
            {recent.length > 0 ? <RecentDocs /> : <HomeSamples />}
          </div>
          <HomeIndex
            onOpen={openWith}
            onCreate={(route, kind) => startCreate({ route, kind })}
            onBatch={(task) => startBatch({ paths: [], task })}
            onCompare={() => go("compare")}
            onAsk={(tab) => askAbout({ paths: [], tab })}
            onInbox={() => go("inbox")}
          />
          {recent.length > 0 && <HomeSamples />}
        </div>
      </div>
    </div>
  );
}
