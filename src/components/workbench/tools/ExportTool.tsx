/** 내보내기 — PDF·한글(HWPX)·글만(표시 없는 글, 표는 탭). 글(마크다운)·HTML 은 그 밖의 형식이라 전체 화면에서만 */

import { useState } from "react";
import { Download, FolderOpen, FilePen } from "lucide-react";
import type { ToolProps } from "../ToolPanel";
import { useApp } from "../../../state/app";
import { rpc } from "../../../lib/rpc";
import { pickFolder } from "../../../lib/native";
import { baseName, dirName, isHangul, joinPath, stem } from "../../../lib/format";
import { useTask } from "../../../hooks/useTask";
import { Button } from "../../ui/Button";
import { Check, Field, Seg } from "../../common/Field";
import { ErrorLine, Note, SavedFile, Working } from "../../common/Status";

type Target = "md" | "html" | "txt" | "pdf" | "hwpx";

/** 자주 쓰는 차례. other 는 그 밖의 형식 (전체 화면에서만 보인다) */
const TARGETS: Array<{ value: Target; label: string; desc: string; other?: true }> = [
  { value: "pdf", label: "PDF", desc: "인쇄 모양 그대로 보낼 때" },
  { value: "hwpx", label: "한글(HWPX)", desc: "글과 표를 한글 문서로 다시 짭니다. 서식은 문서 모양을 보고 맞춥니다." },
  { value: "txt", label: "글만", desc: "꾸밈 없이 글자만. 표는 칸마다 탭으로 나눕니다." },
  { value: "md", label: "글(마크다운)", desc: "제목·표를 살린 글 파일. AI·누리집에 붙이기 좋습니다.", other: true },
  { value: "html", label: "HTML", desc: "웹 브라우저로 여는 문서", other: true },
];

export function ExportTool({ doc, info }: ToolProps) {
  const { settings, startCreate, uiMode } = useApp();
  const [picked, setTarget] = useState<Target | null>(null);
  const [pages, setPages] = useState("");
  const [images, setImages] = useState(true);
  const [ocr, setOcr] = useState<"auto" | "force" | "off">(settings?.convert.ocr ?? "auto");
  const [dir, setDir] = useState("");
  /** 한글로 바꾼 결과에 엔진이 고른 서식 */
  const [style, setStyle] = useState("");
  /** 엔진이 알린 것 (스캔 쪽이 있어 글이 빠졌다, 서식 그대로 옮기지 못했다 …): 결과 옆에 남긴다 */
  const [warns, setWarns] = useState<string[]>([]);
  const task = useTask<string>();

  const defaultDir = settings?.convert.output_dir || dirName(doc.path);
  const outDir = dir || defaultDir;
  const hangulSource = isHangul(info.format);
  // PDF·HWPX 만들기는 엔진이 아직 문서 암호를 받지 못한다 (글 변환은 암호를 받는다)
  const pwOnly = (t: Target) => info.encrypted && (t === "pdf" || t === "hwpx");
  // 같은 형식으로는 저장하지 않는다 (HWPX→HWPX, PDF→PDF). 쉬운 화면은 그 밖의 형식을 뺀다
  const options = TARGETS
    .filter((t) => t.value !== info.format && (uiMode === "full" || !t.other))
    .map((t) => ({ ...t, disabled: pwOnly(t.value) }));
  // 고른 형식이 목록에서 빠지면(화면 방식을 바꿈) 쓸 수 있는 첫 칸으로. 처음 값도 첫 칸 (보통 PDF)
  const target: Target = options.find((o) => o.value === picked && !o.disabled)?.value ?? options.find((o) => !o.disabled)?.value ?? "txt";

  const run = () => void task.run(async ({ signal, onProgress }) => {
    setWarns([]);
    const pw = doc.password ? { password: doc.password } : {};
    // 쉬운 화면은 쪽 범위·그림 칸을 숨기므로 전체 화면에서 넣어 둔 값을 쓰지 않는다 (전체 쪽·그림 함께)
    const easy = uiMode === "easy";
    if (target === "pdf") {
      const r = await rpc("export_pdf", { path: doc.path, output_path: joinPath(outDir, `${stem(doc.name)}.pdf`) }, { signal, onProgress });
      setWarns(r.warnings ?? []);
      return r.output_path;
    }
    if (target === "hwpx") {
      // 서식은 문서 모양을 보고 엔진이 고른다 (공문은 기안문, □○ 항목은 보고서 …, 애매하면 꾸밈 없이)
      const r = await rpc("to_hwpx", { path: doc.path, ocr, preset: "auto", output_path: joinPath(outDir, `${stem(doc.name)}.hwpx`) }, { signal, onProgress });
      setStyle(r.style);
      setWarns(r.warnings ?? []);
      return r.output_path;
    }
    const r = await rpc("convert", {
      path: doc.path, format: target, save: true, output_dir: outDir, images: easy || images, ...pw,
      ...(pages.trim() && !easy ? { pages: pages.trim() } : {}), ...(info.needs_ocr ? { ocr } : {}),
    }, { signal, onProgress });
    setWarns(r.warnings ?? []);
    return r.output_path ?? "";
  });

  const desc = TARGETS.find((t) => t.value === target)?.desc;
  const main = options.filter((o) => !o.other);
  const others = options.filter((o) => o.other);
  const pick = (v: Target) => { setTarget(v); task.reset(); };

  return (
    <div className="flex flex-col gap-4">
      <Field label="저장 형식" hint={info.encrypted ? `${desc} 암호 문서는 아직 PDF·한글로 저장할 수 없습니다.` : desc}>
        <Seg label="저장 형식" value={target} onChange={pick} options={main} cols={main.length} />
      </Field>
      {others.length > 0 && (
        <Field label="그 밖의 형식">
          <Seg label="그 밖의 저장 형식" value={target} onChange={pick} options={others} cols={others.length} />
        </Field>
      )}

      {target === "hwpx" && hangulSource && (
        <Note tone="info">
          <span className="block">서식을 그대로 두려면 한글 편집기에서 HWPX로 저장하세요.</span>
          <Button className="mt-2" size="sm" variant="secondary" onClick={() => startCreate({ path: doc.path })}><FilePen size={13} /> 한글 편집기로 열기</Button>
        </Note>
      )}

      {/* 쪽 범위·그림·글자 읽기는 세부 설정이라 전체 화면에서만 (쉬운 화면은 전체 쪽·그림 함께·필요한 쪽만) */}
      {(target === "md" || target === "html" || target === "txt") && (
        <div className="kd-adv flex flex-col gap-4">
          {!!info.page_count && info.page_count > 1 && (
            <Field label="쪽 범위" hint="비우면 전체. 예: 1-3, 5">
              <input className="kd-input" value={pages} onChange={(e) => setPages(e.target.value)} placeholder="전체" aria-label="쪽 범위" />
            </Field>
          )}
          {target !== "txt" && <Check label="그림 파일도 함께 뽑기" checked={images} onChange={setImages} />}
        </div>
      )}

      {info.needs_ocr && target !== "pdf" && (
        <Field label="스캔한 쪽 글자 읽기(OCR)">
          <Seg label="글자 읽기" value={ocr} onChange={setOcr} options={[{ value: "auto", label: "필요한 쪽만" }, { value: "force", label: "모든 쪽" }, { value: "off", label: "안 함" }]} />
        </Field>
      )}

      <Field label="저장할 곳">
        <div className="kd-inset flex items-center gap-2 px-3 py-2">
          <FolderOpen size={14} className="kd-muted flex-none" />
          {/* 긴 경로는 폴더 이름만, 전체 경로는 마우스를 올리면 */}
          <span className="kd-path flex-1" title={outDir || undefined}>{outDir ? baseName(outDir) || outDir : "원본 파일 옆"}{!dir && !settings?.convert.output_dir ? " (원본 옆)" : ""}</span>
          <button type="button" className="kd-link kd-small flex-none" onClick={() => void pickFolder().then((d) => d && setDir(d))}>바꾸기</button>
        </div>
      </Field>

      {task.busy ? <Working label="저장하는 중" progress={task.progress} onCancel={task.cancel} /> : (
        <Button size="lg" onClick={run} disabled={target === "hwpx" && info.format === "hwpx"} data-tip="원본은 그대로 두고 새 파일로 저장합니다."><Download size={15} /> 저장</Button>
      )}
      <ErrorLine message={task.error} />
      {task.result && <SavedFile path={task.result} />}
      {task.result && warns.map((w) => <Note key={w} tone="warn">{w}</Note>)}
      {task.result && target === "hwpx" && style && <p className="kd-small kd-muted">{style === "꾸밈 없이" ? "문서 갈래가 뚜렷하지 않아 서식은 입히지 않고 글·표만 옮겼습니다." : style === "서식 그대로" ? "원본 서식 그대로 옮겼습니다." : `문서 모양을 보고 ${style}으로 맞췄습니다.`}</p>}
    </div>
  );
}
