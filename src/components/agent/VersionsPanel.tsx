/**
 * 버전 계보 — 같은 문서의 판들을 고친 차례로, 최종으로 보이는 판과 까닭, 짚을 것(이름의 '최종'보다 나중 판 등).
 * 판마다 열기·바로 앞 판과 비교. 비교는 onCompare 로 넘긴다(카드 창이면 본창의 비교 화면).
 */

import { AlertTriangle, ExternalLink, GitCompareArrows } from "lucide-react";
import { rpc } from "../../lib/rpc";
import type { VersionsResult } from "../../lib/contract";
import { Button } from "../ui/Button";
import "./agent.css";

const when = (ms: number) => {
  const d = new Date(ms);
  const days = Math.floor((Date.now() - ms) / 86_400_000);
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return days === 0 ? `오늘 ${hm}` : days === 1 ? `어제 ${hm}` : `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}. ${hm}`;
};

export function VersionsPanel({ result, onCompare }: { result: VersionsResult; onCompare: (older: string, newer: string) => void }) {
  const list = [...result.versions].reverse(); // 최근 것부터
  return (
    <div className="kd-vers">
      {result.notes.filter((n) => !n.startsWith("같은 문서의 다른 판을")).map((n) => (
        <p key={n} className="kd-vers-note"><AlertTriangle size={14} /> {n}</p>
      ))}
      <ol className="kd-vers-list">
        {list.map((v) => {
          const idx = result.versions.indexOf(v);
          const prev = idx > 0 ? result.versions[idx - 1] : null;
          const latest = v.path === result.latest;
          return (
            <li key={v.path} className="kd-vers-row" data-latest={latest}>
              <span className="kd-vers-main">
                <span className="kd-vers-name">{v.name}</span>
                <span className="kd-vers-meta">
                  {when(v.modified)}
                  {v.change && (v.change.added || v.change.removed ? <> · <b className="kd-plus">+{v.change.added}</b> <b className="kd-minus">−{v.change.removed}</b>줄</> : <> · 앞 판과 내용 같음</>)}
                  {latest && <span className="kd-badge" data-tone="accent">최종으로 보임</span>}
                  {v.target && <span className="kd-badge">고른 문서</span>}
                </span>
              </span>
              <span className="kd-vers-acts">
                <Button size="sm" variant="ghost" onClick={() => void rpc("open_file", { path: v.path })} aria-label={`${v.name} 열기`}><ExternalLink size={13} /></Button>
                {prev && <Button size="sm" variant="ghost" onClick={() => onCompare(prev.path, v.path)}><GitCompareArrows size={13} /> 앞 판과 비교</Button>}
              </span>
            </li>
          );
        })}
      </ol>
      {result.versions.length > 1 && <p className="kd-vers-why">최종으로 본 까닭: {result.reasons.join(" · ")}</p>}
    </div>
  );
}
