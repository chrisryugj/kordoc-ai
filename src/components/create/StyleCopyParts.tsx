/** 우리 서식으로 맞추기 — 화면 부품: 서식 내용 표, 저장한 서식 목록, 결과 목록, 서무 도구용 서식 고르기 */

import { useCallback, useEffect, useState } from "react";
import { FileDown, FilePen, FolderOpen, Trash2 } from "lucide-react";
import type { BatchItemResult, StyleEntry, StyleFormat } from "../../lib/contract";
import { rpc, errorText } from "../../lib/rpc";
import { baseName, formatOf } from "../../lib/format";
import { useTask } from "../../hooks/useTask";
import { Button } from "../ui/Button";
import { SelectField } from "../common/Field";
import { ErrorLine, Note, StatusLine } from "../common/Status";
import { FormatBadge } from "../common/FormatBadge";

const KIND: Record<string, string> = {
  official: "기안문", report: "보고서", plan: "계획서", notice: "통지·안내", minutes: "회의록",
  gaejosik: "개조식 보고서", press: "보도자료", ministry: "업무보고", bangchim: "방침서",
};

const n = (v: number) => String(Math.round(v * 10) / 10);
const glyph = (f: StyleFormat, k: string) => (k === "○" && f.numbering.bullet2 ? f.numbering.bullet2 : k);

/** 서식 내용을 항목별로 (요약 한 줄보다 읽기 쉽게) */
export function FormatFacts({ format: f }: { format: StyleFormat }) {
  const m = f.margins;
  const title = { box: "맨 위 제목 상자", center: "가운데 제목 줄", left: "왼쪽 제목 줄", head: "수신·제목 머리 표", none: "따로 없음" }[f.title.kind];
  const rows: Array<[string, string]> = [
    ["갈래", `${KIND[f.preset] ?? "문서"}${f.front?.cover ? " · 표지" : ""}${f.front?.toc ? " · 목차" : ""}`],
    ["용지·여백", `${f.paper.size === "custom" ? `${n(f.paper.width_mm)}×${n(f.paper.height_mm)}mm` : f.paper.size}${f.paper.landscape ? " 가로" : ""} · 위 ${n(m.top)} 아래 ${n(m.bottom)} 왼쪽 ${n(m.left)} 오른쪽 ${n(m.right)} mm`],
    ...(m.header || m.footer ? [["머리말·꼬리말", `${n(m.header)} · ${n(m.footer)} mm`] as [string, string]] : []),
    ["본문", `${f.body.font || "기본 글꼴"} ${n(f.body.pt)}pt · 줄 간격 ${f.body.line_spacing}%`],
    ["항목 기호", f.numbering.markers.length ? f.numbering.markers.map((k) => glyph(f, k)).join("  ") : "없음"],
    ...f.levels.map((l): [string, string] => [`${glyph(f, l.marker)} 단계`, `${l.font || f.body.font} ${n(l.pt)}pt${l.bold ? " 굵게" : ""}`]),
    ["제목", title],
    ["쪽 번호", f.page_numbers ? "있음" : "없음"],
  ];
  if (f.table) rows.push(["표", `${f.table.body.font ?? f.body.font} ${f.table.body.pt ? `${n(f.table.body.pt)}pt` : ""}${f.table.header.fill ? " · 머리 줄 음영" : ""}`]);
  return (
    <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="kd-small kd-muted">{k}</dt>
          <dd className="kd-small break-keep text-pretty">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** 저장한 서식 — 엔진 목록 불러오기·지우기 */
export function useSavedStyles() {
  const [styles, setStyles] = useState<StyleEntry[] | null>(null);
  const [error, setError] = useState("");
  const reload = useCallback(async () => {
    try {
      setStyles((await rpc("style_list", {})).styles);
      setError("");
    } catch (e) {
      setError(errorText(e));
      setStyles([]);
    }
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  return { styles, error, reload };
}

export function SavedStyleList({ styles, selected, onSelect, onDelete }: {
  styles: StyleEntry[]; selected: string; onSelect: (id: string) => void; onDelete: (id: string) => void;
}) {
  return (
    <div className="kd-preset-grid" role="radiogroup" aria-label="저장한 서식">
      {styles.map((s) => (
        <div key={s.id} className="relative">
          <button type="button" role="radio" aria-checked={selected === s.id} className="kd-preset h-full w-full" onClick={() => onSelect(s.id)}>
            <span className="kd-row-title block pr-7">{s.name}</span>
            <span className="kd-row-desc block">{KIND[s.format.preset] ?? "문서"} 서식 · 본문 {s.format.body.font} {n(s.format.body.pt)}pt</span>
          </button>
          <button type="button" className="kd-icon-btn absolute right-1 top-1" aria-label={`${s.name} 서식 지우기`} title="이 서식 지우기" onClick={() => onDelete(s.id)}>
            <Trash2 size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}

/** 결과 목록 — 편집기에서 열기 · 폴더에서 보기 · PDF로 저장 */
export function StyleResults({ results, onOpen }: { results: BatchItemResult[]; onOpen: (path: string) => void }) {
  const pdf = useTask<string>();
  const [pdfDone, setPdfDone] = useState<Record<string, string>>({});
  return (
    <ul className="flex flex-col gap-2">
      {results.map((r) => (
        <li key={r.path} className="kd-inset flex flex-col gap-2 px-3 py-2.5">
          <div className="flex min-w-0 items-center gap-2">
            <FormatBadge format={r.ok ? "hwpx" : formatOf(r.path)} />
            <span className="kd-row-title min-w-0 flex-1 truncate" title={r.output_path ?? r.path}>{baseName(r.output_path ?? r.path)}</span>
            {r.ok ? <StatusLine tone="ok">만들었습니다</StatusLine> : <StatusLine tone="err">만들지 못했습니다</StatusLine>}
          </div>
          {r.ok && r.output_path ? (
            <div className="flex flex-wrap gap-1.5">
              <Button size="sm" onClick={() => onOpen(r.output_path!)}><FilePen size={13} /> 편집기에서 열기</Button>
              <Button variant="secondary" size="sm" onClick={() => void rpc("reveal_file", { path: r.output_path! }).catch(() => undefined)}><FolderOpen size={13} /> 폴더에서 보기</Button>
              {pdfDone[r.output_path] ? (
                <Button variant="secondary" size="sm" onClick={() => void rpc("reveal_file", { path: pdfDone[r.output_path!] }).catch(() => undefined)}><FileDown size={13} /> PDF 보기</Button>
              ) : (
                <Button variant="secondary" size="sm" disabled={pdf.busy} onClick={() => void pdf.run(async () => {
                  const out = (await rpc("export_pdf", { path: r.output_path! })).output_path;
                  setPdfDone((d) => ({ ...d, [r.output_path!]: out }));
                  return out;
                })}><FileDown size={13} /> PDF로 저장</Button>
              )}
            </div>
          ) : null}
          {r.ok && r.note ? <p className="kd-small kd-muted break-keep text-pretty">{r.note}</p> : null}
          {!r.ok && r.error ? <p className="kd-small">{baseName(r.path)}: {r.error}</p> : null}
        </li>
      ))}
      {pdf.busy && <li><StatusLine tone="busy">PDF로 저장하는 중</StatusLine></li>}
      {pdf.error && <li><ErrorLine message={pdf.error} /></li>}
    </ul>
  );
}

/** 서무 도구 "우리 서식으로 맞추기" — 저장한 서식 고르기 */
export function StyleTaskOptions({ styleId, onChange }: { styleId: string; onChange: (id: string) => void }) {
  const { styles, error } = useSavedStyles();
  useEffect(() => {
    if (styles?.length && !styles.some((s) => s.id === styleId)) onChange(styles[0].id);
  }, [styles, styleId, onChange]);
  if (error) return <ErrorLine message={error} />;
  if (!styles) return <StatusLine tone="busy">저장한 서식을 불러오는 중</StatusLine>;
  if (!styles.length) return <Note tone="info">저장한 서식이 없습니다. 새로 쓰기 › 우리 서식으로 맞추기에서 견본 문서를 넣고 서식을 저장하세요.</Note>;
  const pick = styles.find((s) => s.id === styleId);
  return (
    <div className="flex flex-col gap-2">
      <div style={{ maxWidth: 360 }}>
        <SelectField label="맞출 서식" hint="고른 파일마다 내용은 두고 이 서식으로 새 한글 문서를 만듭니다" value={styleId} onChange={onChange}
          options={styles.map((s) => ({ value: s.id, label: s.name }))} />
      </div>
      {pick && <FormatFacts format={pick.format} />}
      <p className="kd-small kd-muted break-keep text-pretty">결과는 "원래 이름_우리서식.hwpx"로 저장하고 원본은 그대로 둡니다.</p>
    </div>
  );
}
