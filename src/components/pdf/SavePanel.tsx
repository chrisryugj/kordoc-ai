/** PDF 작업 오른쪽 칸 — 하나로·고른 쪽만·나눠·그림으로 저장, 함께 넣을 것(쪽 번호·워터마크·용량), 저장할 곳·이름, 결과 */

import { CheckCircle2, Combine, FileOutput, FolderOpen, ExternalLink, ImageDown, Split } from "lucide-react";
import type { PdfComposeResult } from "../../lib/contract";
import { rpc } from "../../lib/rpc";
import { baseName, dirName, fileSize, num } from "../../lib/format";
import { pickFolder } from "../../lib/native";
import { Button } from "../ui/Button";
import { ErrorLine, Note, Working } from "../common/Status";
import type { Progress } from "../../lib/rpc";
import { planCuts, planEvery, type Board, type Selection } from "./model";

export type SplitMode = "cuts" | "each" | "every";
export interface SaveOpts {
  name: string;
  outDir: string;
  pageNumbers: boolean;
  watermark: string;
  useWatermark: boolean;
  shrink: boolean;
  /** 모든 쪽을 A4 에 맞추기 */
  fitA4: boolean;
  split: SplitMode;
  every: number;
  imageFormat: "png" | "jpg";
  dpi: number;
}
export type SaveKind = "all" | "selected" | "split" | "images";
export type SaveResult =
  | { kind: "pdf"; outputs: PdfComposeResult["outputs"]; secured: string[] }
  | { kind: "images"; dir: string; count: number };

interface Props {
  board: Board;
  sel: Selection;
  opts: SaveOpts;
  set: (patch: Partial<SaveOpts>) => void;
  names: { all: string; selected: string; split: string };
  defaultDir: string;
  /** 기본 폴더가 설정의 저장 폴더인가 (아니면 첫 파일이 있는 폴더) */
  configuredDir: boolean;
  busy: boolean;
  progress: Progress | null;
  error: string;
  result: SaveResult | null;
  onSave: (kind: SaveKind) => void;
  onCancel: () => void;
}

export function splitCount(b: Board, o: Pick<SaveOpts, "split" | "every">) {
  return o.split === "cuts" ? planCuts(b).length : planEvery(b, o.split === "each" ? 1 : o.every).length;
}

export function SavePanel({ board, sel, opts, set, names, defaultDir, configuredDir, busy, progress, error, result, onSave, onCancel }: Props) {
  const total = board.items.length;
  const picked = sel.keys.size;
  const empty = total === 0;
  const parts = splitCount(board, opts);
  const imgs = picked || total;
  const secured = board.files.filter((f) => f.secured && board.items.some((it) => it.file === f.id));

  return (
    <aside className="kd-pdf-side" aria-label="저장">
      <section className="flex flex-col gap-2">
        <h2>저장</h2>
        <button type="button" className="kd-pdf-save" data-main="true" disabled={empty || busy} onClick={() => onSave("all")}>
          <span className="kd-pdf-save-t w-full"><Combine size={16} /> PDF 하나로 저장 <kbd>Ctrl+S</kbd></span>
          <span className="kd-pdf-save-d">{empty ? "쪽을 넣으면 저장할 수 있습니다" : `${num(total)}쪽 · ${names.all}.pdf`}</span>
        </button>
        <button type="button" className="kd-pdf-save" disabled={!picked || busy} onClick={() => onSave("selected")}>
          <span className="kd-pdf-save-t"><FileOutput size={16} /> 고른 쪽만 저장</span>
          <span className="kd-pdf-save-d">{picked ? `${num(picked)}쪽 · ${names.selected}.pdf` : "쪽을 누르거나 끌어서 고르면 됩니다"}</span>
        </button>

        <div className="kd-pdf-box">
          <div className="kd-seg" data-cols="3" style={{ "--seg-basis": "30%" } as React.CSSProperties} role="group" aria-label="나누는 방법">
            <button type="button" aria-pressed={opts.split === "cuts"} onClick={() => set({ split: "cuts" })}>자른 곳마다</button>
            <button type="button" aria-pressed={opts.split === "each"} onClick={() => set({ split: "each" })}>쪽마다</button>
            <button type="button" aria-pressed={opts.split === "every"} onClick={() => set({ split: "every" })}>몇 쪽씩</button>
          </div>
          {opts.split === "every" && (
            <label className="kd-pdf-row kd-small">
              <input className="kd-input kd-pdf-num" type="number" min={1} max={Math.max(1, total)} value={opts.every}
                onChange={(e) => set({ every: Math.max(1, Math.floor(Number(e.target.value) || 1)) })} />
              쪽씩 나눕니다
            </label>
          )}
          {opts.split === "cuts" && !board.cuts.length && <p className="kd-small kd-muted">쪽 사이에 마우스를 올리면 나오는 가위를 눌러 자를 곳을 정합니다.</p>}
          <button type="button" className="kd-pdf-save" disabled={empty || busy || parts < 2} onClick={() => onSave("split")}>
            <span className="kd-pdf-save-t"><Split size={16} /> 나눠 저장</span>
            <span className="kd-pdf-save-d">{parts < 2 ? "나누면 파일이 둘 이상이 되게 정하세요" : `파일 ${num(parts)}개 · ${names.split}_01.pdf부터`}</span>
          </button>
        </div>

        <div className="kd-pdf-box">
          <div className="kd-pdf-row">
            <div className="kd-seg" role="group" aria-label="그림 형식">
              <button type="button" aria-pressed={opts.imageFormat === "png"} onClick={() => set({ imageFormat: "png" })}>PNG</button>
              <button type="button" aria-pressed={opts.imageFormat === "jpg"} onClick={() => set({ imageFormat: "jpg" })}>JPG</button>
            </div>
            <div className="kd-seg" role="group" aria-label="그림 해상도">
              <button type="button" aria-pressed={opts.dpi === 150} onClick={() => set({ dpi: 150 })}>보통</button>
              <button type="button" aria-pressed={opts.dpi === 300} onClick={() => set({ dpi: 300 })}>선명하게</button>
            </div>
          </div>
          <button type="button" className="kd-pdf-save" disabled={empty || busy} onClick={() => onSave("images")}>
            <span className="kd-pdf-save-t"><ImageDown size={16} /> 그림으로 저장</span>
            <span className="kd-pdf-save-d">{empty ? "쪽을 그림 파일로" : `${picked ? "고른 " : ""}${num(imgs)}쪽 → ${opts.imageFormat.toUpperCase()} ${num(imgs)}장 (${opts.dpi === 150 ? "150" : "300"}dpi)`}</span>
          </button>
        </div>
      </section>

      <section className="flex flex-col gap-1">
        <h2>PDF에 함께 넣기</h2>
        <label className="kd-check"><input type="checkbox" checked={opts.pageNumbers} onChange={(e) => set({ pageNumbers: e.target.checked })} /><span>쪽 번호 <span className="kd-muted">(아래 가운데 "- 1 -")</span></span></label>
        <label className="kd-check"><input type="checkbox" checked={opts.useWatermark} onChange={(e) => set({ useWatermark: e.target.checked })} /><span>워터마크 <span className="kd-muted">(대각선 흐린 글자)</span></span></label>
        {opts.useWatermark && <input className="kd-input" value={opts.watermark} placeholder="대외비" aria-label="워터마크 글자" onChange={(e) => set({ watermark: e.target.value })} />}
        <label className="kd-check"><input type="checkbox" checked={opts.shrink} onChange={(e) => set({ shrink: e.target.checked })} /><span>용량 줄이기 <span className="kd-muted">(그림만 줄이고 글자는 그대로)</span></span></label>
        <label className="kd-check"><input type="checkbox" checked={opts.fitA4} onChange={(e) => set({ fitA4: e.target.checked })} /><span>A4로 맞추기 <span className="kd-muted">(크기가 다른 스캔·영수증)</span></span></label>
      </section>

      <section className="flex flex-col gap-2">
        <h2>저장할 곳</h2>
        <div className="kd-pdf-where" title={opts.outDir || defaultDir}>
          <FolderOpen size={14} className="flex-none" />
          <span>{opts.outDir ? opts.outDir : !defaultDir ? "첫 파일이 있는 폴더" : configuredDir ? `${baseName(defaultDir)} 폴더 (설정의 저장 폴더)` : `${baseName(defaultDir)} 폴더 (첫 파일이 있는 곳)`}</span>
        </div>
        <div className="flex gap-1.5">
          <Button size="sm" variant="secondary" onClick={() => void pickFolder().then((d) => d && set({ outDir: d }))}>폴더 바꾸기</Button>
          {opts.outDir && <Button size="sm" variant="ghost" onClick={() => set({ outDir: "" })}>원래대로</Button>}
        </div>
        <label className="kd-field">
          <span className="kd-label">이름</span>
          <input className="kd-input" value={opts.name} placeholder={names.all} onChange={(e) => set({ name: e.target.value })} aria-describedby="pdf-name-hint" />
          <span id="pdf-name-hint" className="kd-field-hint">비워 두면 파일 이름에서 정합니다. 같은 이름이 있으면 (2)를 붙여 따로 저장합니다.</span>
        </label>
      </section>

      {secured.length > 0 && (
        <Note tone="warn">보안 설정 PDF({secured.map((f) => f.name).join(", ")})는 쪽을 그림으로 넣습니다. 그 쪽은 글자 복사·검색이 되지 않습니다.</Note>
      )}
      {busy && <Working label="저장하는 중" progress={progress} onCancel={onCancel} />}
      <ErrorLine message={error} />
      {result && !busy && <SaveDone result={result} />}
    </aside>
  );
}

function SaveDone({ result }: { result: SaveResult }) {
  if (result.kind === "images" || result.outputs.length > 1) {
    const dir = result.kind === "images" ? result.dir : dirName(result.outputs[0].output_path);
    const n = result.kind === "images" ? result.count : result.outputs.length;
    return (
      <div className="kd-note" data-tone="ok" role="status">
        <CheckCircle2 size={15} />
        <div className="min-w-0 flex-1">
          <div className="font-semibold">{result.kind === "images" ? `그림 ${num(n)}장을 저장했습니다` : `PDF ${num(n)}개를 저장했습니다`}</div>
          <div className="kd-path mt-0.5" title={dir}>{dir}</div>
          <div className="mt-2"><Button variant="secondary" size="sm" onClick={() => void rpc("open_folder", { path: dir }).catch(() => undefined)}><FolderOpen size={13} /> 폴더 열기</Button></div>
        </div>
      </div>
    );
  }
  const o = result.outputs[0];
  return (
    <div className="kd-note" data-tone="ok" role="status">
      <CheckCircle2 size={15} />
      <div className="min-w-0 flex-1">
        <div className="font-semibold">저장했습니다 ({num(o.page_count)}쪽 · {fileSize(o.bytes)})</div>
        <div className="kd-path mt-0.5" title={o.output_path}>{baseName(o.output_path)}</div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Button variant="secondary" size="sm" onClick={() => void rpc("open_file", { path: o.output_path }).catch(() => undefined)}><ExternalLink size={13} /> 열기</Button>
          <Button variant="secondary" size="sm" onClick={() => void rpc("reveal_file", { path: o.output_path }).catch(() => undefined)}><FolderOpen size={13} /> 폴더에서 보기</Button>
        </div>
      </div>
    </div>
  );
}
