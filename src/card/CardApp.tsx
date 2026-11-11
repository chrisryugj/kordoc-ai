/**
 * 문서 카드 — 탐색기 우클릭 "KorDoc AI에게 맡기기…"·"최종본 찾기"로 뜨는 작은 창.
 * 문서 이름과 한 줄 정보, 같은 문서의 다른 판(최종본), "이 문서로 무엇을 할까요?" 말로 시키기, 결과는 이 창에서.
 * AI 가 꺼져 있으면 문서 갈래에 맞는 일을 바로 실행 단추로 보인다 (우클릭 동작 id 를 card_handoff 로 본창에 넘김).
 * 본창이 필요한 일(앱에서 열기·편집기·비교)도 card_handoff 로 우클릭 동작과 같은 길로 넘긴다.
 * "영수증으로 지출조서 만들기"(action 'receipt')는 같은 창에 영수증 값 표·지출조서 미리보기(ReceiptCard).
 * 창 주소: index.html?card=<{ action: 'ask'|'versions'|'receipt', paths: string[] } JSON>
 */

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, ExternalLink, FilePen, Files, GitCompareArrows, History, LayoutGrid, Loader2, MessageSquarePlus, Sparkles, X } from "lucide-react";
import { AppProvider, useApp } from "../state/app";
import { useToast } from "../hooks/useToast";
import { ToastContainer } from "../components/ui/Toast";
import { TipLayer } from "../components/ui/TipLayer";
import { rpc, errorText, invokeCmd } from "../lib/rpc";
import { baseName, formatOf } from "../lib/format";
import { isQuick } from "../lib/quick-actions";
import type { DocInfo, VersionsResult } from "../lib/contract";
import { useWorkAgent } from "../hooks/useWorkAgent";
import { AgentComposer, type Suggestion } from "../components/agent/AgentComposer";
import { AgentRun } from "../components/agent/AgentRun";
import { AiQuickSetup } from "../components/agent/AiQuickSetup";
import { VersionsPanel } from "../components/agent/VersionsPanel";
import { FormatBadge } from "../components/common/FormatBadge";
import { Button } from "../components/ui/Button";
import "../components/agent/agent.css";
import "./card.css";
import { ReceiptCard } from "./ReceiptCard";

interface CardInput { action: "ask" | "versions" | "receipt"; paths: string[] }

export function parseCard(raw: string): CardInput | null {
  try {
    const v = JSON.parse(raw) as CardInput;
    return Array.isArray(v.paths) && v.paths.every((p) => typeof p === "string") && v.paths.length ? { action: v.action === "versions" || v.action === "receipt" ? v.action : "ask", paths: v.paths } : null;
  } catch { return null; }
}

const KIND: Record<string, string> = { hwp: "한글 문서", hwpx: "한글 문서", hwpml: "한글 문서", docx: "워드 문서", pdf: "PDF", xls: "엑셀", xlsx: "엑셀", pptx: "파워포인트", image: "그림" };
const VERSIONABLE = new Set(["hwp", "hwp3", "hwpx", "hwpml", "docx", "pdf", "xls", "xlsx", "pptx"]);
const HANGUL = new Set(["hwp", "hwpx"]);
const COMPARABLE = new Set(["hwp", "hwpx", "docx", "pdf"]);

/** 문서 갈래에 맞춘 시켜 볼 문장 (AI 켜짐) */
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
    { label: "한글로 바꾸기", text: "이 PDF를 고칠 수 있는 한글 문서로 바꿔 줘" },
    { label: "핵심 세 줄", text: "이 문서 핵심을 세 줄로 요약해 줘" },
    { label: "용량 줄이기", text: "이 PDF 용량을 10MB 안으로 줄여 줘" },
    { label: "개인정보 가리기", text: "이 문서의 개인정보를 가려 줘" },
  ];
  if (f === "xls" || f === "xlsx") return [{ label: "내용 요약", text: "이 엑셀 내용을 표 이름과 숫자 위주로 요약해 줘" }];
  return [
    { label: "결재 전 점검", text: "이 문서를 결재 전 점검하고, 고칠 수 있는 건 고쳐 줘" },
    { label: "회신 쓰기", text: "이 공문에 회신하는 기안문을 만들어 줘" },
    { label: "핵심 세 줄", text: "이 문서 핵심을 세 줄로 요약해 줘" },
    { label: "PDF로", text: "이 문서를 PDF로 만들어 줘" },
    { label: "개인정보 가리기", text: "이 문서의 개인정보를 가려 줘" },
  ];
}

/** AI 없이 바로 하는 일 (우클릭 동작 id: src/hooks/useDeepLink.ts LINK_ACTIONS) */
interface Direct { id: string; label: string }
function directFor(paths: string[]): Direct[] {
  const fmts = paths.map(formatOf);
  if (paths.length === 2) return [
    ...(fmts.every((f) => COMPARABLE.has(f)) ? [{ id: "compare", label: "두 문서 비교" }] : []),
    { id: "join", label: "하나로 합치기" },
  ];
  if (paths.length > 2 || fmts[0] === "unknown") return [
    { id: "join", label: "하나로 합치기" },
    { id: "pdf", label: "모두 PDF로 저장" },
    { id: "redact", label: "개인정보 모두 가리기" },
  ];
  const f = fmts[0];
  if (f === "pdf") return [
    { id: "hwpx", label: "한글 문서로 바꾸기" }, { id: "shrink", label: "용량 줄이기" },
    { id: "redact", label: "개인정보 가리기" }, { id: "split", label: "나누기" }, { id: "pdfwork", label: "쪽 정리하기" },
  ];
  if (HANGUL.has(f)) return [
    { id: "precheck", label: "결재 전 점검" }, { id: "pdf", label: "PDF로 저장" }, { id: "redact", label: "개인정보 가리기" },
    ...(f === "hwp" ? [{ id: "hwpx", label: "HWPX로 바꾸기" }] : []), { id: "split", label: "나누기" },
  ];
  if (f === "docx") return [
    { id: "precheck", label: "결재 전 점검" }, { id: "pdf", label: "PDF로 저장" }, { id: "hwpx", label: "한글 문서로 바꾸기" }, { id: "redact", label: "개인정보 가리기" },
  ];
  if (f === "image") return [{ id: "hwpx", label: "한글 문서로 바꾸기" }, { id: "pdf", label: "PDF로 저장" }];
  return [{ id: "pdf", label: "PDF로 저장" }];
}

function Card({ input }: { input: CardInput }) {
  const { ready, toast, ai } = useApp();
  const [info, setInfo] = useState<DocInfo | null>(null);
  const [vers, setVers] = useState<VersionsResult | null>(null);
  const [versBusy, setVersBusy] = useState(false);
  const [versOpen, setVersOpen] = useState(input.action === "versions");
  const [filesOpen, setFilesOpen] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const agent = useWorkAgent({ from: "card" });
  const { paths, setPaths } = agent;
  // 카드 창은 우클릭한 문서를 붙인 새 대화로 시작한다 (대화는 본창 AI 대화 목록에도 남는다)
  useEffect(() => { agent.newChat(input.paths); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const first = input.paths[0];
  const fmt = formatOf(first);
  const single = input.paths.length === 1 && fmt !== "unknown";
  const multi = input.paths.length > 1;
  const docs = paths.length ? paths : input.paths;
  const suggestions = useMemo(() => suggestionsFor(input.paths), [input.paths]);
  // 바로 하기·앱에서 이어서도 지금 남긴 문서로 (카드에서 뺀 문서가 딸려 가면 머리의 "문서 N개"와 실제 처리한 수가 다르다)
  const direct = useMemo(() => directFor(docs), [docs]);
  // AI 상태를 아직 모르면(null) 어느 쪽도 그리지 않는다 (깜빡임 없게)
  const aiOn = !!ai?.configured;
  const aiOff = !!ai && !ai.configured;

  useEffect(() => {
    if (!ready || !single) return;
    void rpc("doc_info", { path: first }).then(setInfo, () => undefined);
    if (!VERSIONABLE.has(fmt)) return;
    setVersBusy(true);
    void rpc("find_versions", { path: first }).then(setVers, (e) => toast(errorText(e), "error")).finally(() => setVersBusy(false));
  }, [ready, single, first, fmt, toast]);

  const handoff = (action: string, ps: string[]) => invokeCmd("card_handoff", { action, paths: ps }).then(() => true, (e) => { toast(errorText(e), "error"); return false; });
  const runDirect = async (d: Direct) => {
    if (await handoff(d.id, docs) && isQuick(d.id)) toast(`${d.label}: 본창에서 시작했습니다. 끝나면 알림이 뜹니다.`, "info");
  };
  // 카드 창에는 설정 화면이 없다: 본창을 띄우고 어디를 누를지 알린다
  const toMainSettings = () => {
    void invokeCmd("shell_show").catch(() => undefined);
    toast("본창 왼쪽 아래 'AI 꺼짐 · 켜기'를 누르세요", "info");
  };
  const others = vers ? vers.versions.length - 1 : 0;
  const latestName = vers ? baseName(vers.latest) : "";
  // 폴더 하나를 우클릭한 경우 (안의 문서는 본창의 여러 파일 한꺼번에가 펼친다)
  const folder = input.paths.length === 1 && fmt === "unknown";
  const title = single || folder ? baseName(first) : `${baseName(first)} 외 ${input.paths.length - 1}개`;
  // 고른 문서보다 나중 판이 있다는 짚음은 하나로 (이름의 "최종"보다 나중 판 · 고른 문서보다 나중 판은 같은 말)
  const isNewer = (n: string) => n.startsWith('이름에 "최종"') || n.startsWith("고른 문서보다");
  const newer = vers && vers.latest !== first ? (vers.notes.find((n) => n.startsWith('이름에 "최종"')) ?? vers.notes.find((n) => n.startsWith("고른 문서보다"))) : undefined;
  const panelResult = vers && newer ? { ...vers, notes: vers.notes.filter((n) => !isNewer(n)) } : vers;

  return (
    <div className="kd-card" data-multi={multi || undefined} data-files-open={filesOpen || undefined}>
      <header className="kd-card-head">
        {single ? <FormatBadge format={fmt} /> : <span className="kd-card-multi-icon" aria-hidden="true"><Files size={18} /></span>}
        <div className="min-w-0 flex-1">
          <div className="kd-card-title">{title}</div>
          {multi ? (
            <button type="button" className="kd-card-facts kd-card-fold" aria-expanded={filesOpen} onClick={() => setFilesOpen((o) => !o)}>
              문서 {docs.length}개 · {filesOpen ? "접기" : "펼치기"} {filesOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            </button>
          ) : (
            <div className="kd-card-facts">
              {single ? [KIND[fmt] ?? "문서", info?.page_count ? `${info.page_count}쪽` : "", info?.needs_ocr ? "스캔본" : "", info?.encrypted ? "암호 걸림" : ""].filter(Boolean).join(" · ") : "폴더 · 안의 문서를 모두 씁니다"}
            </div>
          )}
          {multi && filesOpen && (
            <ul className="kd-card-files" aria-label="붙인 문서">
              {docs.map((p) => (
                <li key={p} title={p}>
                  <FormatBadge format={formatOf(p)} />
                  <span className="kd-card-file-name">{baseName(p)}</span>
                  {aiOn && docs.length > 1 && <button type="button" onClick={() => setPaths(docs.filter((x) => x !== p))} aria-label={`${baseName(p)} 빼기`}><X size={13} /></button>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </header>

      <main className="kd-card-body">
        {single && VERSIONABLE.has(fmt) && (
          <section className="kd-card-vers" aria-label="같은 문서의 다른 판">
            <button type="button" onClick={() => setVersOpen((o) => !o)} aria-expanded={versOpen} disabled={versBusy || !vers}>
              {versBusy ? <Loader2 size={16} className="kd-spin" /> : <History size={16} />}
              <span className="min-w-0 flex-1">
                {versBusy ? "같은 문서의 다른 판을 찾는 중" : !vers ? "다른 판을 찾지 못했습니다" : others === 0 ? "다른 판 없음 · 이 문서가 하나뿐입니다" : <>다른 판 {others}개 · 최종으로 보이는 것 <b>{vers.latest === first ? "이 문서" : latestName}</b></>}
              </span>
              {vers && others > 0 && (versOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />)}
            </button>
            {newer && vers && (
              <div className="kd-vers-note kd-card-newer">
                <AlertTriangle size={14} />
                <span className="min-w-0 flex-1">{newer}</span>
                <Button size="sm" variant="secondary" onClick={() => void rpc("open_file", { path: vers.latest }).catch((e) => toast(errorText(e), "error"))}
                  data-tip={`${latestName}을 기본 프로그램으로 엽니다`}><ExternalLink size={13} /> 이 판 열기</Button>
              </div>
            )}
            {panelResult && others > 0 && versOpen && <div><VersionsPanel result={panelResult} onCompare={(a, b) => void handoff("compare", [a, b])} /></div>}
          </section>
        )}

        {aiOff && (
          <>
            <section className="kd-card-do" aria-label="바로 하기">
              <h2 className="kd-card-do-title">바로 하기</h2>
              <div className="kd-card-do-list">
                {direct.map((d) => (
                  <Button key={d.id} variant="secondary" onClick={() => void runDirect(d)}
                    data-tip={isQuick(d.id) ? "새 파일로 저장하고 끝나면 알림을 띄웁니다. 원본은 그대로입니다" : "본창에서 이 문서로 엽니다"}>{d.label}</Button>
                ))}
              </div>
            </section>
            <p className="kd-card-aioff">
              <Sparkles size={14} /> 말로 시키려면 AI가 필요합니다.
              <button type="button" className="kd-link kd-small" aria-expanded={setupOpen} onClick={() => setSetupOpen((o) => !o)}>{setupOpen ? "접기" : "AI 켜기"}</button>
            </p>
            {setupOpen && <AiQuickSetup onSettings={toMainSettings} />}
          </>
        )}

        {aiOn && (
          <>
            <AgentComposer
              paths={paths}
              onPaths={setPaths}
              onSend={(t) => void agent.send(t)}
              onStop={agent.stop}
              busy={agent.busy}
              locked={agent.elsewhere}
              autoFocus
              placeholder={single ? "이 문서로 할 일 입력" : "이 문서들로 할 일 입력"}
              suggestions={agent.turns.length ? [] : suggestions}
            />
            <AgentRun turns={agent.turns} onSend={(t) => void agent.send(t)} busy={agent.busy} />
            {agent.turns.length > 0 && !agent.busy && (
              <div><Button size="sm" variant="ghost" onClick={() => agent.newChat(input.paths)}><MessageSquarePlus size={13} /> 새로 시키기</Button></div>
            )}
            {direct.length > 0 && (
              // AI 가 켜져 있어도 AI 없이 바로 되는 일은 접어서 둔다
              <details className="kd-advanced kd-card-direct">
                <summary><ChevronRight size={14} aria-hidden="true" /> AI 없이 바로 하기</summary>
                <div className="kd-advanced-body">
                  <div className="kd-card-do-list">
                    {direct.map((d) => (
                      <Button key={d.id} variant="secondary" onClick={() => void runDirect(d)}
                        data-tip={isQuick(d.id) ? "새 파일로 저장하고 끝나면 알림을 띄웁니다. 원본은 그대로입니다" : "본창에서 이 문서로 엽니다"}>{d.label}</Button>
                    ))}
                  </div>
                </div>
              </details>
            )}
          </>
        )}
      </main>

      <footer className="kd-card-foot">
        {/* 폴더는 문서 화면이 열지 못한다 → 여러 파일 한꺼번에 화면으로 */}
        <Button size="sm" variant="secondary" onClick={() => void handoff(folder ? "tools" : "open", docs)} data-tip={folder ? "본창의 여러 파일 한꺼번에 화면에 이 폴더의 문서를 놓습니다" : "본창을 열어 이 문서로 이어서 합니다"}><LayoutGrid size={13} /> 앱에서 이어서</Button>
        {single && HANGUL.has(fmt) && <Button size="sm" variant="ghost" onClick={() => void handoff("edit", [first])} data-tip="본창의 한글 편집기로 엽니다"><FilePen size={13} /> 편집기에서 고치기</Button>}
        {docs.length === 2 && <Button size="sm" variant="ghost" onClick={() => void handoff("compare", docs)} data-tip="본창에서 두 문서의 바뀐 곳을 나란히 봅니다"><GitCompareArrows size={13} /> 두 문서 비교 화면</Button>}
      </footer>
    </div>
  );
}

export function CardApp({ raw }: { raw: string }) {
  const { toasts, showToast, dismissToast } = useToast();
  const input = useMemo(() => parseCard(raw), [raw]);
  return (
    <AppProvider toast={showToast}>
      {input?.action === "receipt" ? <ReceiptCard paths={input.paths} /> : input ? <Card input={input} /> : <p className="kd-text p-6">문서 정보를 읽지 못했습니다. 탐색기에서 다시 우클릭하세요.</p>}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
      <TipLayer />
    </AppProvider>
  );
}
