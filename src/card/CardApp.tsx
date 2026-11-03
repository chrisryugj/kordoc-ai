/**
 * 문서 카드 — 탐색기 우클릭 "KorDoc AI 에게 맡기기…"·"최종본 찾기"로 뜨는 작은 창.
 * 문서 이름과 한 줄 정보, 같은 문서의 다른 판(최종본), "이 문서로 무엇을 할까요?" 말로 시키기, 결과는 이 창에서.
 * 본창이 필요한 일(앱에서 열기·편집기·비교)은 card_handoff 로 우클릭 동작과 같은 길로 넘긴다.
 * 창 주소: index.html?card=<{ action: 'ask'|'versions', paths: string[] } JSON>
 */

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, FilePen, GitCompareArrows, History, LayoutGrid, Loader2, MessageSquarePlus } from "lucide-react";
import { AppProvider, useApp } from "../state/app";
import { useToast } from "../hooks/useToast";
import { ToastContainer } from "../components/ui/Toast";
import { rpc, errorText, invokeCmd } from "../lib/rpc";
import { baseName, formatOf } from "../lib/format";
import type { DocInfo, VersionsResult } from "../lib/contract";
import { useWorkAgent } from "../hooks/useWorkAgent";
import { AgentComposer, type Suggestion } from "../components/agent/AgentComposer";
import { AgentRun } from "../components/agent/AgentRun";
import { VersionsPanel } from "../components/agent/VersionsPanel";
import { FormatBadge } from "../components/common/FormatBadge";
import { Button } from "../components/ui/Button";
import "../components/agent/agent.css";

interface CardInput { action: "ask" | "versions"; paths: string[] }

export function parseCard(raw: string): CardInput | null {
  try {
    const v = JSON.parse(raw) as CardInput;
    return Array.isArray(v.paths) && v.paths.every((p) => typeof p === "string") && v.paths.length ? { action: v.action === "versions" ? "versions" : "ask", paths: v.paths } : null;
  } catch { return null; }
}

const KIND: Record<string, string> = { hwp: "한글 문서", hwpx: "한글 문서", hwpml: "한글 문서", docx: "워드 문서", pdf: "PDF", xls: "엑셀", xlsx: "엑셀", pptx: "파워포인트", image: "그림" };
const VERSIONABLE = new Set(["hwp", "hwp3", "hwpx", "hwpml", "docx", "pdf", "xls", "xlsx", "pptx"]);
const HANGUL = new Set(["hwp", "hwpx"]);

/** 문서 갈래에 맞춘 시켜 볼 문장 */
function suggestionsFor(paths: string[]): Suggestion[] {
  if (paths.length === 2) return [
    { label: "두 문서 비교", text: "두 문서를 비교해서 바뀐 곳을 신구대조표로 만들어 줘" },
    { label: "PDF 하나로 합치기", text: "두 문서를 차례대로 PDF 한 권으로 합쳐 줘" },
  ];
  if (paths.length > 2 || formatOf(paths[0]) === "unknown") return [
    { label: "제출물 모으기", text: "붙인 제출물을 엑셀 한 장으로 모아 줘" },
    { label: "PDF 하나로 합치기", text: "붙인 문서를 PDF 한 권으로 합쳐 줘" },
    { label: "개인정보 가리기", text: "붙인 문서마다 개인정보를 가려 줘" },
  ];
  const f = formatOf(paths[0]);
  if (f === "pdf") return [
    { label: "한글로 바꾸기", text: "이 PDF 를 고칠 수 있는 한글 문서로 바꿔 줘" },
    { label: "핵심 세 줄", text: "이 문서 핵심을 세 줄로 요약해 줘" },
    { label: "용량 줄이기", text: "이 PDF 용량을 10MB 안으로 줄여 줘" },
    { label: "개인정보 가리기", text: "이 문서의 개인정보를 가려 줘" },
  ];
  if (f === "xls" || f === "xlsx") return [{ label: "내용 요약", text: "이 엑셀 내용을 표 이름과 숫자 위주로 요약해 줘" }];
  return [
    { label: "결재 전 점검", text: "이 문서를 결재 전 점검하고, 고칠 수 있는 건 고쳐 줘" },
    { label: "회신 쓰기", text: "이 공문에 회신하는 기안문을 만들어 줘" },
    { label: "핵심 세 줄", text: "이 문서 핵심을 세 줄로 요약해 줘" },
    { label: "PDF 로", text: "이 문서를 PDF 로 만들어 줘" },
    { label: "개인정보 가리기", text: "이 문서의 개인정보를 가려 줘" },
  ];
}

function Card({ input }: { input: CardInput }) {
  const { ready, toast } = useApp();
  const [paths, setPaths] = useState(input.paths);
  const [info, setInfo] = useState<DocInfo | null>(null);
  const [vers, setVers] = useState<VersionsResult | null>(null);
  const [versBusy, setVersBusy] = useState(false);
  const [versOpen, setVersOpen] = useState(input.action === "versions");
  const agent = useWorkAgent(paths);
  const first = input.paths[0];
  const fmt = formatOf(first);
  const single = input.paths.length === 1 && fmt !== "unknown";
  const suggestions = useMemo(() => suggestionsFor(input.paths), [input.paths]);

  useEffect(() => {
    if (!ready || !single) return;
    void rpc("doc_info", { path: first }).then(setInfo, () => undefined);
    if (!VERSIONABLE.has(fmt)) return;
    setVersBusy(true);
    void rpc("find_versions", { path: first }).then(setVers, (e) => toast(errorText(e), "error")).finally(() => setVersBusy(false));
  }, [ready, single, first, fmt, toast]);

  const handoff = (action: string, ps: string[]) => void invokeCmd("card_handoff", { action, paths: ps }).catch((e) => toast(errorText(e), "error"));
  const others = vers ? vers.versions.length - 1 : 0;
  const latestName = vers ? baseName(vers.latest) : "";
  const title = single ? baseName(first) : `${baseName(first)} 외 ${input.paths.length - 1}개`;

  return (
    <div className="kd-card">
      <header className="kd-card-head">
        <FormatBadge format={single ? fmt : "unknown"} />
        <div className="min-w-0">
          <div className="kd-card-title">{title}</div>
          <div className="kd-card-facts">
            {single ? [KIND[fmt] ?? "문서", info?.page_count ? `${info.page_count}쪽` : "", info?.needs_ocr ? "스캔본" : "", info?.encrypted ? "암호 걸림" : ""].filter(Boolean).join(" · ") : `문서 ${input.paths.length}개`}
          </div>
        </div>
      </header>

      <main className="kd-card-body">
        {single && VERSIONABLE.has(fmt) && (
          <section className="kd-card-vers" aria-label="같은 문서의 다른 판">
            <button type="button" onClick={() => setVersOpen((o) => !o)} aria-expanded={versOpen} disabled={versBusy || !vers}>
              {versBusy ? <Loader2 size={16} className="kd-spin" /> : <History size={16} />}
              <span className="min-w-0 flex-1">
                {versBusy ? "같은 문서의 다른 판을 찾는 중…" : !vers ? "다른 판을 찾지 못했습니다" : others === 0 ? "다른 판 없음 · 이 문서가 하나뿐입니다" : <>다른 판 {others}개 · 최종으로 보이는 것 <b>{vers.latest === first ? "이 문서" : latestName}</b></>}
              </span>
              {vers && others > 0 && (versOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />)}
            </button>
            {vers && others > 0 && versOpen && <div><VersionsPanel result={vers} onCompare={(a, b) => handoff("compare", [a, b])} /></div>}
          </section>
        )}

        <AgentComposer
          paths={paths}
          onPaths={setPaths}
          onSend={(t) => void agent.send(t)}
          onStop={agent.stop}
          busy={agent.busy}
          autoFocus
          placeholder={single ? "이 문서로 무엇을 할까요?" : "이 문서들로 무엇을 할까요?"}
          suggestions={agent.turns.length ? [] : suggestions}
        />
        <AgentRun turns={agent.turns} onSend={(t) => void agent.send(t)} busy={agent.busy} />
        {agent.turns.length > 0 && !agent.busy && (
          <div><Button size="sm" variant="ghost" onClick={agent.reset}><MessageSquarePlus size={13} /> 새로 시키기</Button></div>
        )}
      </main>

      <footer className="kd-card-foot">
        <Button size="sm" variant="secondary" onClick={() => handoff("open", input.paths)}><LayoutGrid size={13} /> 앱에서 이어서</Button>
        {single && HANGUL.has(fmt) && <Button size="sm" variant="ghost" onClick={() => handoff("edit", [first])}><FilePen size={13} /> 편집기에서 고치기</Button>}
        {input.paths.length === 2 && <Button size="sm" variant="ghost" onClick={() => handoff("compare", input.paths)}><GitCompareArrows size={13} /> 두 문서 비교 화면</Button>}
      </footer>
    </div>
  );
}

export function CardApp({ raw }: { raw: string }) {
  const { toasts, showToast, dismissToast } = useToast();
  const input = useMemo(() => parseCard(raw), [raw]);
  return (
    <AppProvider toast={showToast}>
      {input ? <Card input={input} /> : <p className="kd-text p-6">문서 정보를 읽지 못했습니다. 탐색기에서 다시 우클릭하세요.</p>}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </AppProvider>
  );
}
