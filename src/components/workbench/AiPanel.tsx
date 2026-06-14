/**
 * AiPanel — 워크벤치 AI 탭 (KorDoc Studio Phase R / W4).
 *
 * 참고자료(붙여넣은 텍스트 또는 파일)를 Gemini로 분석해 현재 양식의 필드값을
 * 추론하고, 채우기 탭 폼에 제안으로 머지한다(form_infer RPC → aiExtractFields 재사용).
 * 필드 라벨은 채우기 폼(useFillForm)에서 공유받는다.
 *
 * 보안: 문서 내용이 외부 Gemini API로 전송됨 — 패널에 명시.
 */

import { useState } from "react";
import { Sparkles, FileUp, Loader2, ShieldAlert, Wand2, GraduationCap } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { Button } from "../ui/Button";
import { useDocumentSession } from "../../contexts/DocumentSession";
import type { FillForm } from "./useFillForm";

interface FormInferRes {
  success: boolean;
  fields: Array<{ label: string; value: string }>;
  error?: string;
}

export function AiPanel({ form, onApplied }: { form: FillForm; onApplied?: () => void }) {
  const { sidecarCall, showToast } = useDocumentSession();
  const [refText, setRefText] = useState("");
  const [refFile, setRefFile] = useState("");
  const [busy, setBusy] = useState(false);

  const pickFile = async () => {
    try {
      const sel = await open({ multiple: false, filters: [{ name: "참고자료", extensions: ["hwp", "hwpx", "pdf", "xlsx", "docx", "txt", "md"] }] });
      if (!sel) return;
      setRefFile(Array.isArray(sel) ? sel[0] : sel);
    } catch { /* 취소 */ }
  };

  const infer = async () => {
    if (form.labels.length === 0) { showToast("먼저 채우기 탭에서 양식 필드가 인식돼야 합니다", "info"); return; }
    if (!refText.trim() && !refFile) { showToast("참고자료 텍스트를 입력하거나 파일을 선택하세요", "info"); return; }
    setBusy(true);
    try {
      const res = await sidecarCall("form_infer", {
        labels: form.labels,
        ...(refFile ? { reference_path: refFile } : { reference_text: refText }),
      }) as FormInferRes;
      if (!res.success) { showToast(res.error || "추론 실패", "error"); return; }
      const n = form.applySuggestions(res.fields, "AI 추론");
      if (n > 0) onApplied?.();
      showToast(n > 0 ? `${n}개 필드에 AI 제안 반영 — 채우기 탭에서 확인/수정` : "추론된 값이 없습니다", n > 0 ? "success" : "info");
    } catch (e) {
      showToast(`추론 실패: ${e}`, "error");
    } finally {
      setBusy(false);
    }
  };

  const fileName = refFile.split(/[/\\]/).pop();

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2.5 shrink-0" style={{ borderBottom: "1px solid var(--color-border)" }}>
        <span className="ts-2xs font-semibold flex items-center gap-1.5" style={{ color: "var(--color-text-primary)" }}>
          <Sparkles size={12} style={{ color: "var(--color-accent)" }} /> AI 필드 추론
        </span>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2.5">
        <p className="ts-2xs" style={{ color: "var(--color-text-muted)", lineHeight: 1.5 }}>
          참고자료를 분석해 양식 필드값을 제안합니다. 결과는 <span style={{ color: "var(--color-text-secondary)" }}>채우기 탭</span>에 반영됩니다.
        </p>

        {/* 참고자료 텍스트 */}
        <div>
          <label className="ts-2xs font-semibold mb-1 block" style={{ color: "var(--color-text-secondary)" }}>참고자료 붙여넣기</label>
          <textarea
            value={refText}
            onChange={(e) => setRefText(e.target.value)}
            rows={6}
            placeholder="공문 본문, 명단, 안내문 등 — 필드값의 근거가 될 텍스트"
            className="w-full px-2.5 py-2 rounded-md ts-2xs resize-y"
            style={{ backgroundColor: "var(--color-bg-tertiary)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)", outline: "none" }}
          />
        </div>

        {/* 파일 선택 */}
        <div>
          <label className="ts-2xs font-semibold mb-1 block" style={{ color: "var(--color-text-secondary)" }}>또는 파일에서</label>
          <button onClick={() => void pickFile()} className="w-full flex items-center gap-2 px-2.5 py-2 rounded-md ts-2xs hover-bg-tertiary" style={{ border: "1px solid var(--color-border)", color: fileName ? "var(--color-text-primary)" : "var(--color-text-muted)" }}>
            <FileUp size={13} style={{ color: "var(--color-accent)" }} />
            <span className="flex-1 truncate text-left">{fileName ?? "참고 문서 선택 (HWP/PDF/XLSX…)"}</span>
            {fileName && <span onClick={(e) => { e.stopPropagation(); setRefFile(""); }} className="ts-2xs px-1" style={{ color: "var(--color-text-muted)" }}>✕</span>}
          </button>
          {fileName && refText.trim() && (
            <p className="ts-2xs mt-1" style={{ color: "var(--color-text-muted)" }}>파일이 우선 사용됩니다 (텍스트 무시).</p>
          )}
        </div>

        {/* 보안 경고 */}
        <div className="flex items-start gap-1.5 px-2.5 py-2 rounded-md" style={{ backgroundColor: "var(--color-warning-subtle)" }}>
          <ShieldAlert size={12} className="mt-0.5 shrink-0" style={{ color: "var(--color-warning)" }} />
          <p className="ts-2xs" style={{ color: "var(--color-warning)", lineHeight: 1.4 }}>
            참고자료가 Gemini API로 전송됩니다. 민감 정보는 주의하세요.
          </p>
        </div>

        {/* 시험지 문항 생성 — 후속 안내 */}
        <div className="flex items-start gap-2 px-2.5 py-2 rounded-md" style={{ border: "1px dashed var(--color-border)" }}>
          <GraduationCap size={14} className="mt-0.5 shrink-0" style={{ color: "var(--color-text-muted)" }} />
          <div>
            <p className="ts-2xs font-semibold" style={{ color: "var(--color-text-secondary)" }}>시험지 문항 생성</p>
            <p className="ts-2xs mt-0.5" style={{ color: "var(--color-text-muted)", lineHeight: 1.4 }}>참고자료로 문항을 생성해 서식 그대로 채우기 — 다음 단계에서 합류합니다.</p>
          </div>
        </div>
      </div>

      {/* 추론 실행 */}
      <div className="px-3 py-2.5 shrink-0" style={{ borderTop: "1px solid var(--color-border)" }}>
        <Button size="sm" onClick={() => void infer()} disabled={busy} className="w-full">
          <span className="flex items-center justify-center gap-1.5">
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />} 필드값 추론
          </span>
        </Button>
      </div>
    </div>
  );
}
