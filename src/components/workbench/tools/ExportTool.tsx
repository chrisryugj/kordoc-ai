/** 내보내기 — 글(마크다운)·HTML·글만·PDF·한글(HWPX) */

import { useState } from "react";
import { Download, FolderOpen, FilePen } from "lucide-react";
import type { ToolProps } from "../ToolPanel";
import { useApp } from "../../../state/app";
import { rpc } from "../../../lib/rpc";
import { pickFolder } from "../../../lib/native";
import { dirName, isHangul, joinPath, stem } from "../../../lib/format";
import { useTask } from "../../../hooks/useTask";
import { Button } from "../../ui/Button";
import { Check, Field, Seg } from "../../common/Field";
import { ErrorLine, Note, SavedFile, Working } from "../../common/Status";

type Target = "md" | "html" | "txt" | "pdf" | "hwpx";

const TARGETS: Array<{ value: Target; label: string; desc: string }> = [
  { value: "md", label: "글(마크다운)", desc: "제목·표를 살린 글 파일. AI·누리집에 붙이기 좋습니다." },
  { value: "html", label: "HTML", desc: "웹 브라우저로 여는 문서" },
  { value: "txt", label: "글만", desc: "꾸밈 없이 글자만" },
  { value: "pdf", label: "PDF", desc: "인쇄 모양 그대로 보낼 때" },
  { value: "hwpx", label: "한글(HWPX)", desc: "글과 표를 한글 문서로 다시 짭니다" },
];

export function ExportTool({ doc, info }: ToolProps) {
  const { settings, startCreate } = useApp();
  const [target, setTarget] = useState<Target>("md");
  const [pages, setPages] = useState("");
  const [images, setImages] = useState(true);
  const [ocr, setOcr] = useState<"auto" | "force" | "off">(settings?.convert.ocr ?? "auto");
  const [dir, setDir] = useState("");
  /** 한글이 아닌 문서를 HWPX 로 다시 짤 때의 서식 (빈 값 = 꾸밈 없이) */
  const [preset, setPreset] = useState<"" | "report" | "official">("");
  const task = useTask<string>();

  const defaultDir = settings?.convert.output_dir || dirName(doc.path);
  const outDir = dir || defaultDir;
  const hangulSource = isHangul(info.format);
  // PDF·HWPX 만들기는 엔진이 아직 문서 암호를 받지 못한다 (글 변환은 암호를 받는다)
  const pwOnly = (t: Target) => info.encrypted && (t === "pdf" || t === "hwpx");
  const options = TARGETS.filter((t) => !(t.value === "hwpx" && info.format === "hwpx")).map((t) => ({ ...t, disabled: pwOnly(t.value) }));

  const run = () => void task.run(async ({ signal, onProgress }) => {
    const pw = doc.password ? { password: doc.password } : {};
    if (target === "pdf") return (await rpc("export_pdf", { path: doc.path, output_path: joinPath(outDir, `${stem(doc.name)}.pdf`) }, { signal, onProgress })).output_path;
    if (target === "hwpx") return (await rpc("to_hwpx", { path: doc.path, ocr, ...(preset && !hangulSource ? { preset } : {}), output_path: joinPath(outDir, `${stem(doc.name)}.hwpx`) }, { signal, onProgress })).output_path;
    const r = await rpc("convert", {
      path: doc.path, format: target, save: true, output_dir: outDir, images, ...pw,
      ...(pages.trim() ? { pages: pages.trim() } : {}), ...(info.needs_ocr ? { ocr } : {}),
    }, { signal, onProgress });
    return r.output_path ?? "";
  });

  const desc = TARGETS.find((t) => t.value === target)?.desc;

  return (
    <div className="flex flex-col gap-4">
      <Field label="무엇으로 저장할까요?" hint={info.encrypted ? `${desc} 암호가 걸린 문서는 아직 PDF·한글(HWPX)로 저장할 수 없습니다.` : desc}>
        <Seg label="저장 형식" value={target} onChange={(v) => { setTarget(v); task.reset(); }} options={options} />
      </Field>

      {target === "hwpx" && hangulSource && (
        <Note tone="info">
          <span className="block">한글 문서는 한글 편집기에서 HWPX로 저장하면 서식이 그대로 남습니다.</span>
          <Button className="mt-2" size="sm" variant="secondary" onClick={() => startCreate({ path: doc.path })}><FilePen size={13} /> 한글 편집기로 열기</Button>
        </Note>
      )}

      {target === "hwpx" && !hangulSource && (
        <Field label="공문 서식" hint="보고서·기안문을 고르면 글꼴·항목 기호·여백을 공문서 모양으로 맞춥니다">
          <Seg label="공문 서식" value={preset} onChange={setPreset} options={[{ value: "", label: "꾸밈 없이" }, { value: "report", label: "보고서" }, { value: "official", label: "기안문" }]} />
        </Field>
      )}

      {(target === "md" || target === "html" || target === "txt") && (
        <>
          {!!info.page_count && info.page_count > 1 && (
            <Field label="쪽 범위" hint="비우면 전체. 예: 1-3, 5">
              <input className="kd-input" value={pages} onChange={(e) => setPages(e.target.value)} placeholder="전체" aria-label="쪽 범위" />
            </Field>
          )}
          {target !== "txt" && <Check label="그림 파일도 함께 뽑기" checked={images} onChange={setImages} />}
        </>
      )}

      {info.needs_ocr && target !== "pdf" && (
        <Field label="스캔한 쪽 글자 읽기(OCR)">
          <Seg label="글자 읽기" value={ocr} onChange={setOcr} options={[{ value: "auto", label: "필요한 쪽만" }, { value: "force", label: "모든 쪽" }, { value: "off", label: "안 함" }]} />
        </Field>
      )}

      <Field label="저장할 곳">
        <div className="kd-inset flex items-center gap-2 px-3 py-2">
          <FolderOpen size={14} className="kd-muted flex-none" />
          <span className="kd-path flex-1">{outDir || "원본 파일 옆"}{!dir && !settings?.convert.output_dir ? " (원본 옆)" : ""}</span>
          <button type="button" className="kd-link kd-small flex-none" onClick={() => void pickFolder().then((d) => d && setDir(d))}>바꾸기</button>
        </div>
      </Field>

      {task.busy ? <Working label="저장하는 중" progress={task.progress} onCancel={task.cancel} /> : (
        <Button size="lg" onClick={run} disabled={target === "hwpx" && info.format === "hwpx"}><Download size={15} /> 저장</Button>
      )}
      <ErrorLine message={task.error} />
      {task.result && <SavedFile path={task.result} />}
    </div>
  );
}
