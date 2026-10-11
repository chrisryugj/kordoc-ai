/** 채우기·편집 — 한글 편집기(rhwp)로 열기 + 기존 양식 채우기(FillWizard)·클릭 편집(DocEditor) */

import { useState } from "react";
import { ClipboardList, FilePen, ShieldCheck, SquarePen } from "lucide-react";
import type { ToolProps } from "../ToolPanel";
import { useApp } from "../../../state/app";
import { callRaw, rpc } from "../../../lib/rpc";
import { useTask } from "../../../hooks/useTask";
import { detectFileType } from "../../../utils/fileType";
import { Button } from "../../ui/Button";
import { ErrorLine, Note, Working } from "../../common/Status";
import { FillWizard } from "../../fill/FillWizard";
import { DocEditor } from "../../edit/DocEditor";

export function EditTool({ doc, info }: ToolProps) {
  const { startCreate, settings, toast } = useApp();
  const [open, setOpen] = useState<"" | "fill" | "edit">("");
  const check = useTask<{ ok: boolean; issues: Array<{ severity: string; message: string; part?: string }> }>();
  const hwpx = info.format === "hwpx";
  const file = { path: doc.path, name: doc.name, size: info.size, type: detectFileType(doc.name) };
  const reveal = (p: string) => void rpc("reveal_file", { path: p }).catch(() => toast(`저장 위치: ${p}`, "info"));

  return (
    <div className="flex flex-col gap-3">
      <button type="button" className="kd-bigaction" onClick={() => startCreate({ path: doc.path })}>
        <FilePen size={20} />
        <span className="min-w-0">
          <span className="kd-row-title block">한글 편집기로 열기</span>
          <span className="kd-row-desc block">한글과 같은 편집기로 글·표·서식을 직접 고칩니다. 공문서 만들기의 편집 단계로 엽니다.</span>
        </span>
      </button>
      <button type="button" className="kd-bigaction" disabled={!hwpx} onClick={() => setOpen("fill")}>
        <ClipboardList size={20} />
        <span className="min-w-0">
          <span className="kd-row-title block">양식 칸 채우기 도우미</span>
          <span className="kd-row-desc block">{hwpx ? "표의 이름 칸을 찾아 입력란을 만들고 명부에서 값을 가져옵니다." : "HWPX 문서에서 씁니다. 한글 편집기로 열어 HWPX로 저장해 보세요."}</span>
        </span>
      </button>
      <button type="button" className="kd-bigaction" disabled={!hwpx} onClick={() => setOpen("edit")}>
        <SquarePen size={20} />
        <span className="min-w-0">
          <span className="kd-row-title block">미리보기에서 눌러 고치기</span>
          <span className="kd-row-desc block">쪽 미리보기의 문단이나 표 칸을 눌러 글자만 바로 고칩니다.</span>
        </span>
      </button>

      {hwpx && (
        <div className="mt-2 flex flex-col gap-2">
          {check.busy ? <Working label="문서 구조를 검사하는 중" /> : (
            <Button variant="ghost" onClick={() => void check.run(() => rpc("validate_hwpx", { path: doc.path }))}><ShieldCheck size={14} /> HWPX 구조 검사</Button>
          )}
          <ErrorLine message={check.error} />
          {check.result && (check.result.ok
            ? <Note tone="ok">한글에서 열리는 데 문제가 없는 구조입니다.</Note>
            : <Note tone="warn">{check.result.issues.map((i) => i.message).join(" / ")}</Note>)}
        </div>
      )}

      {open === "fill" && (
        <FillWizard file={file} sidecarCall={callRaw} outputDir={settings?.convert.output_dir ?? ""} showToast={toast}
          onClose={() => setOpen("")} onOpenFolder={reveal} />
      )}
      {open === "edit" && (
        <DocEditor file={file} sidecarCall={callRaw} outputDir={settings?.convert.output_dir ?? ""} showToast={toast}
          onClose={() => setOpen("")} onOpenFolder={reveal} />
      )}
    </div>
  );
}
