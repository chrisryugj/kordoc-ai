/** 채우기·편집 — 한글 편집기(rhwp)로 열기 + 기존 양식 채우기(FillWizard)·클릭 편집(DocEditor) */

import { useState } from "react";
import { createPortal } from "react-dom";
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
          <span className="kd-row-desc block">글·표·서식을 직접 고칩니다.</span>
        </span>
      </button>
      <button type="button" className="kd-bigaction" disabled={!hwpx} onClick={() => setOpen("fill")}>
        <ClipboardList size={20} />
        <span className="min-w-0">
          <span className="kd-row-title block">양식 칸 채우기</span>
          <span className="kd-row-desc block">{hwpx ? "표의 이름 칸에 명부 값을 넣습니다." : "HWPX 문서에서 씁니다. 한글 편집기에서 HWPX로 저장하세요."}</span>
        </span>
      </button>
      <button type="button" className="kd-bigaction" disabled={!hwpx} onClick={() => setOpen("edit")}>
        <SquarePen size={20} />
        <span className="min-w-0">
          <span className="kd-row-title block">미리보기에서 눌러 고치기</span>
          <span className="kd-row-desc block">문단이나 표 칸을 눌러 글자만 고칩니다.</span>
        </span>
      </button>

      {hwpx && (
        // 개발·문제 확인용이라 전체 화면에서만
        <div className="kd-adv mt-2 flex flex-col gap-2">
          {check.busy ? <Working label="문서 구조를 검사하는 중" /> : (
            <Button variant="ghost" onClick={() => void check.run(() => rpc("validate_hwpx", { path: doc.path }))} data-tip="한글에서 열리지 않을 구조 문제가 있는지 봅니다. 파일은 바꾸지 않습니다."><ShieldCheck size={14} /> HWPX 구조 검사</Button>
          )}
          <ErrorLine message={check.error} />
          {check.result && (check.result.ok
            ? <Note tone="ok">한글에서 열리는 데 문제가 없는 구조입니다.</Note>
            : <Note tone="warn">{check.result.issues.map((i) => i.message).join(" / ")}</Note>)}
        </div>
      )}

      {/* 창 전체를 덮는 화면이라 문서 자리 밖(body)에 그린다. 문서 자리 안에 두면, 창이 열린 채 다른 문서가 열릴 때
          (파일 끌어다 놓기·Ctrl+O·탐색기 우클릭) 이 문서 자리가 숨으면서 채우던 창도 같이 사라진다 */}
      {open === "fill" && createPortal(
        <FillWizard file={file} sidecarCall={callRaw} outputDir={settings?.convert.output_dir ?? ""} showToast={toast}
          onClose={() => setOpen("")} onOpenFolder={reveal} />, document.body)}
      {open === "edit" && createPortal(
        <DocEditor file={file} sidecarCall={callRaw} outputDir={settings?.convert.output_dir ?? ""} showToast={toast}
          onClose={() => setOpen("")} onOpenFolder={reveal} />, document.body)}
    </div>
  );
}
