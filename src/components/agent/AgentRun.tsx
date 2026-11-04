/**
 * 일 시키기 진행과 결과 — 요청 말풍선, 단계 타임라인(도구마다 아이콘), AI 의 말, 만든 파일 카드(첫 쪽 그림·열기·편집기·폴더),
 * 마지막 요청 뒤에는 "다음에 할 일" 칩. 결과는 늘 새 파일이고 원본은 그대로임을 카드마다 밝힌다.
 */

import { useEffect, useState, type ReactNode } from "react";
import { BookOpen, ClipboardCheck, EyeOff, ExternalLink, FilePen, FileSearch, FileStack, FolderOpen, GitCompareArrows, History, Loader2, Table2, Wrench } from "lucide-react";
import { useApp } from "../../state/app";
import { rpc } from "../../lib/rpc";
import { baseName, dirName, formatOf } from "../../lib/format";
import type { AgentTurn } from "../../hooks/useWorkAgent";
import { Button } from "../ui/Button";
import { FormatBadge } from "../common/FormatBadge";
import "./agent.css";

const ICON: Array<[RegExp, ReactNode]> = [
  [/^(read_|list_|search_|form_fields)/, <FileSearch size={15} key="r" />],
  [/^(document_guide|org_format)/, <BookOpen size={15} key="g" />],
  [/^(write_document|convert_to_hwp|fill_form|mail_merge)/, <FilePen size={15} key="w" />],
  [/^(collect_|extract_tables)/, <Table2 size={15} key="t" />],
  [/^compare_/, <GitCompareArrows size={15} key="c" />],
  [/^find_versions/, <History size={15} key="v" />],
  [/^(precheck|fix_notation|check_law)/, <ClipboardCheck size={15} key="p" />],
  [/^redact_/, <EyeOff size={15} key="x" />],
  [/pdf/, <FileStack size={15} key="f" />],
];
const iconOf = (tool: string) => ICON.find(([re]) => re.test(tool))?.[1] ?? <Wrench size={15} />;
const HANGUL = new Set(["hwp", "hwpx"]);
/** 모델 답의 마크다운 표시(굵게·글자 상자·머리 기호)는 걷어 낸다: 말풍선은 그냥 글 */
const plain = (s: string) => s.replace(/\*\*(.+?)\*\*/g, "$1").replace(/`([^`]+)`/g, "$1").replace(/^#{1,6}\s+/gm, "");
const LAYOUT = new Set(["hwp", "hwpx", "pdf"]);

function Thumb({ path }: { path: string }) {
  const [src, setSrc] = useState("");
  const fmt = formatOf(path);
  useEffect(() => {
    if (!LAYOUT.has(fmt)) return;
    let alive = true;
    void rpc("render_pages", { path, pages: "1", max_width: 132 }).then((r) => { if (alive) setSrc(r.pages[0]?.data_url ?? ""); }, () => undefined);
    return () => { alive = false; };
  }, [path, fmt]);
  return <span className="kd-result-thumb" aria-hidden="true">{src ? <img src={src} alt="" /> : <FormatBadge format={fmt} />}</span>;
}

export function ResultCard({ path }: { path: string }) {
  const { startCreate, toast } = useApp();
  const fmt = formatOf(path);
  const fail = (e: unknown) => toast(e instanceof Error ? e.message : String(e), "error");
  return (
    <div className="kd-result">
      <Thumb path={path} />
      <div className="kd-result-main">
        <span className="kd-result-name">{baseName(path)}</span>
        <span className="kd-result-meta" title={path}>원본은 그대로 · 새 파일로 {baseName(dirName(path))} 폴더에</span>
        <span className="kd-result-acts">
          <Button size="sm" variant="secondary" onClick={() => void rpc("open_file", { path }).catch(fail)}><ExternalLink size={13} /> 열기</Button>
          {HANGUL.has(fmt) && <Button size="sm" variant="ghost" onClick={() => startCreate({ path })}><FilePen size={13} /> 편집기에서 고치기</Button>}
          <Button size="sm" variant="ghost" onClick={() => void rpc("reveal_file", { path }).catch(fail)}><FolderOpen size={13} /> 폴더</Button>
        </span>
      </div>
    </div>
  );
}

/** 만든 파일로 이어 할 만한 일 (맨 끝 요청에만) */
function nextOf(files: string[]): Array<{ label: string; text: string }> {
  const out: Array<{ label: string; text: string }> = [];
  const hangul = files.find((f) => HANGUL.has(formatOf(f)));
  const pdf = files.find((f) => formatOf(f) === "pdf");
  if (hangul) {
    const n = baseName(hangul);
    out.push({ label: "결재 전 점검", text: `방금 만든 문서(${n})를 결재 전 점검하고, 고칠 수 있는 건 고쳐 줘` });
    out.push({ label: "PDF로", text: `방금 만든 문서(${n})를 PDF로 만들어 줘` });
    out.push({ label: "개인정보 가리기", text: `방금 만든 문서(${n})의 개인정보를 가려 줘` });
  }
  if (pdf) out.push({ label: "용량 줄이기", text: `방금 만든 PDF(${baseName(pdf)})의 용량을 10MB 안으로 줄여 줘` });
  return out;
}

export function AgentRun({ turns, onSend, busy }: { turns: AgentTurn[]; onSend: (text: string) => void; busy: boolean }) {
  if (!turns.length) return null;
  return (
    <div className="kd-run" aria-live="polite">
      {turns.map((t, i) => {
        const last = i === turns.length - 1;
        const next = last && t.state === "done" && !busy ? nextOf(t.files) : [];
        return (
          <section key={i} className="kd-job" aria-label={`요청 ${i + 1}`}>
            <div className="kd-job-req">{t.request}</div>
            {(t.steps.length > 0 || t.state === "running") && (
              <ol className="kd-tl">
                {t.steps.map((s, k) => (
                  <li key={k} className="kd-tl-item" data-err={s.isError}>{iconOf(s.tool)}{s.isError ? "못 함: " : ""}{s.summary}</li>
                ))}
                {t.state === "running" && <li className="kd-tl-item" data-live="true"><Loader2 size={15} className="kd-spin" />{t.steps.length ? "다음 일을 고르는 중" : "요청을 읽는 중"}</li>}
              </ol>
            )}
            {t.text && <p className="kd-job-say" data-err={t.state === "error"}>{plain(t.text)}</p>}
            {t.files.length > 0 && <div className="kd-results">{t.files.map((f) => <ResultCard key={f} path={f} />)}</div>}
            {t.ms != null && t.state === "done" && <span className="kd-job-time">{Math.max(1, Math.round(t.ms / 1000))}초 걸림 · 도구 {t.steps.length}번{t.saved > 0 && <> · <b>손으로 하면 약 {t.saved >= 60 ? `${Math.round(t.saved / 6) / 10}시간` : `${Math.round(t.saved)}분`}</b> (가정치, 효과 화면에서 바꿈)</>}</span>}
            {next.length > 0 && (
              <div className="kd-then">
                <span className="kd-then-label">이어서</span>
                {next.map((n) => <button key={n.label} type="button" className="kd-chip" onClick={() => onSend(n.text)}>{n.label}</button>)}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
