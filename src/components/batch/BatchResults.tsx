/** 한꺼번에 — 결과 (폴더·파일 하나·항목 뽑기 표·찾기 결과) */

import { FileText } from "lucide-react";
import { useApp } from "../../state/app";
import { baseName } from "../../lib/format";
import { Note, SavedFile } from "../common/Status";
import type { Outcome } from "./runners";

function mark(excerpt: string, query: string) {
  if (!query) return excerpt;
  const parts = excerpt.split(query);
  return parts.flatMap((p, i) => (i === 0 ? [p] : [<mark key={i} className="kd-mark">{query}</mark>, p]));
}

export function BatchResults({ outcome }: { outcome: Outcome }) {
  const { openDocs } = useApp();
  if (outcome.kind === "files") {
    return outcome.dir ? <SavedFile path={outcome.dir} folder label={outcome.message} /> : <Note tone="ok">{outcome.message}</Note>;
  }
  if (outcome.kind === "single") return <SavedFile path={outcome.path} folder={outcome.folder} label={outcome.message} />;
  if (outcome.kind === "extract") {
    return (
      <div className="flex flex-col gap-3">
        <SavedFile path={outcome.path} label={outcome.message} />
        <div className="overflow-x-auto">
          <table className="kd-table">
            <thead><tr><th>문서</th>{outcome.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
            <tbody>
              {outcome.rows.map((r, i) => (
                <tr key={i}><td className="kd-small">{r["문서"] ?? ""}</td>{outcome.columns.map((c) => <td key={c}>{r[c] ?? ""}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }
  const found = outcome.results.filter((r) => r.hits.length);
  return (
    <div className="flex flex-col gap-3">
      <Note tone={found.length ? "ok" : "info"}>{outcome.message}</Note>
      {found.map((r) => (
        <section key={r.path} className="kd-inset p-3">
          <h3 className="kd-row-title flex items-center gap-1.5"><FileText size={14} className="kd-muted" /> {baseName(r.path)}</h3>
          <ul className="mt-1.5 flex flex-col">
            {r.hits.map((h, i) => (
              <li key={i}>
                <button type="button" className="kd-hit" onClick={() => openDocs([r.path], { page: h.page })}>
                  {h.page != null && <span className="kd-small kd-muted kd-num flex-none">{h.page}쪽</span>}
                  <span className="kd-text">{mark(h.excerpt, outcome.query)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
