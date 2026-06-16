/**
 * AiPanel — 워크벤치 AI 탭 (KorDoc Studio Phase R / W4).
 *
 * 두 기능을 공유 참고자료 위에서 제공한다:
 *  - AI 필드 추론: 참고자료 → Gemini → 양식 필드값 추론 → 채우기 폼에 제안(form_infer)
 *  - 시험지 문항 생성: 참고자료/과목·범위 → Gemini → 문항 생성. 3모드(exam_generate):
 *      채우기(양식 필드에 제안) · 텍스트(.md 저장) · 문서(.hwpx 생성)
 *
 * 보안: 문서/참고자료가 외부 Gemini API로 전송됨 — 패널에 명시.
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

type ExamType = "mc" | "short" | "essay" | "ox";
type ExamMode = "fill" | "text" | "document";

interface ExamGenRes {
  success: boolean;
  mode: ExamMode;
  questions?: Array<unknown>;
  fields?: Array<{ label: string; value: string }>;
  output_path?: string;
  error?: string;
}

const EXAM_TYPES: { key: ExamType; label: string }[] = [
  { key: "mc", label: "객관식" },
  { key: "short", label: "단답형" },
  { key: "essay", label: "서술형" },
  { key: "ox", label: "O/X" },
];
const DIFFICULTIES: { key: "easy" | "medium" | "hard"; label: string }[] = [
  { key: "easy", label: "쉬움" },
  { key: "medium", label: "보통" },
  { key: "hard", label: "어려움" },
];
const EXAM_MODES: { key: ExamMode; label: string; hint: string }[] = [
  { key: "fill", label: "채우기", hint: "양식 필드에 문항 채우기" },
  { key: "text", label: "텍스트", hint: ".md 파일로 저장" },
  { key: "document", label: "문서", hint: ".hwpx 파일 생성" },
];

export function AiPanel({ form, onApplied }: { form: FillForm; onApplied?: () => void }) {
  const { sidecarCall, showToast, outputDir, file } = useDocumentSession();
  const [refText, setRefText] = useState("");
  const [refFile, setRefFile] = useState("");
  const [busy, setBusy] = useState(false);

  // 시험지 생성 옵션
  const [subject, setSubject] = useState("");
  const [scope, setScope] = useState("");
  const [difficulty, setDifficulty] = useState<"easy" | "medium" | "hard">("medium");
  const [count, setCount] = useState(5);
  const [types, setTypes] = useState<Set<ExamType>>(new Set<ExamType>(["mc"]));
  const [examMode, setExamMode] = useState<ExamMode>("text");
  const [examBusy, setExamBusy] = useState(false);

  const pickFile = async () => {
    try {
      const sel = await open({ multiple: false, filters: [{ name: "참고자료", extensions: ["hwp", "hwpx", "pdf", "xlsx", "docx", "txt", "md"] }] });
      if (!sel) return;
      setRefFile(Array.isArray(sel) ? sel[0] : sel);
    } catch { /* 취소 */ }
  };

  const refParams = () =>
    refFile ? { reference_path: refFile } : refText.trim() ? { reference_text: refText } : {};

  const infer = async () => {
    if (form.labels.length === 0) { showToast("먼저 채우기 탭에서 양식 필드가 인식돼야 합니다", "info"); return; }
    if (!refText.trim() && !refFile) { showToast("참고자료 텍스트를 입력하거나 파일을 선택하세요", "info"); return; }
    setBusy(true);
    try {
      const res = await sidecarCall("form_infer", { labels: form.labels, ...refParams() }) as FormInferRes;
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

  const toggleType = (t: ExamType) => setTypes((prev) => {
    const next = new Set(prev);
    if (next.has(t)) { if (next.size > 1) next.delete(t); } else next.add(t);
    return next;
  });

  const genExam = async () => {
    if (!refText.trim() && !refFile && !subject.trim() && !scope.trim()) {
      showToast("참고자료 또는 과목·범위를 입력하세요", "info"); return;
    }
    if (examMode === "fill" && form.labels.length === 0) {
      showToast("채우기 모드는 양식 필드가 인식돼야 합니다", "info"); return;
    }
    setExamBusy(true);
    try {
      const dir = outputDir || file.path.replace(/[\\/][^\\/]+$/, "");
      const stem = (subject.trim() || "시험지").replace(/[\\/:*?"<>|]/g, "_");
      const params: Record<string, unknown> = {
        mode: examMode,
        ...refParams(),
        ...(subject.trim() ? { subject } : {}),
        ...(scope.trim() ? { scope } : {}),
        difficulty,
        count,
        types: [...types],
      };
      if (examMode === "fill") params.labels = form.labels;
      else params.output_path = `${dir}\\${stem}.${examMode === "document" ? "hwpx" : "md"}`;

      const res = await sidecarCall("exam_generate", params) as ExamGenRes;
      if (!res.success) { showToast(res.error || "생성 실패", "error"); return; }

      if (examMode === "fill") {
        const n = form.applySuggestions(res.fields ?? [], "시험지 생성");
        if (n > 0) onApplied?.();
        showToast(n > 0 ? `${n}개 문항 자리에 생성 반영 — 채우기 탭 확인` : "생성된 문항이 없습니다", n > 0 ? "success" : "info");
      } else {
        showToast(`시험지 생성 완료 (${res.questions?.length ?? 0}문항): ${res.output_path}`, "success");
      }
    } catch (e) {
      showToast(`생성 실패: ${e}`, "error");
    } finally {
      setExamBusy(false);
    }
  };

  const fileName = refFile.split(/[/\\]/).pop();

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2.5 shrink-0" style={{ borderBottom: "1px solid var(--color-border)" }}>
        <span className="ts-2xs font-semibold flex items-center gap-1.5" style={{ color: "var(--color-text-primary)" }}>
          <Sparkles size={12} style={{ color: "var(--color-accent)" }} /> AI 도구
        </span>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2.5">
        {/* 참고자료 텍스트 */}
        <div>
          <label className="ts-2xs font-semibold mb-1 block" style={{ color: "var(--color-text-secondary)" }}>참고자료 붙여넣기</label>
          <textarea
            value={refText}
            onChange={(e) => setRefText(e.target.value)}
            rows={5}
            placeholder="지문·교과 내용, 공문 본문, 명단 등 — 필드값·문항의 근거"
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
            참고자료·생성 결과가 Gemini API로 전송됩니다. 민감 정보는 주의하세요.
          </p>
        </div>

        {/* 섹션 1 — AI 필드 추론 */}
        <div className="pt-1.5 space-y-2" style={{ borderTop: "1px solid var(--color-border)" }}>
          <p className="ts-2xs font-semibold flex items-center gap-1.5" style={{ color: "var(--color-text-primary)" }}>
            <Wand2 size={12} style={{ color: "var(--color-accent)" }} /> 필드값 추론
          </p>
          <p className="ts-2xs" style={{ color: "var(--color-text-muted)", lineHeight: 1.5 }}>
            참고자료를 분석해 양식 필드값을 <span style={{ color: "var(--color-text-secondary)" }}>채우기 탭</span>에 제안합니다.
          </p>
          <Button size="sm" onClick={() => void infer()} disabled={busy} className="w-full">
            <span className="flex items-center justify-center gap-1.5">
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />} 필드값 추론
            </span>
          </Button>
        </div>

        {/* 섹션 2 — 시험지 문항 생성 */}
        <div className="pt-2 space-y-2" style={{ borderTop: "1px solid var(--color-border)" }}>
          <p className="ts-2xs font-semibold flex items-center gap-1.5" style={{ color: "var(--color-text-primary)" }}>
            <GraduationCap size={13} style={{ color: "var(--color-accent)" }} /> 시험지 문항 생성
          </p>

          {/* 과목 / 범위 */}
          <div className="grid grid-cols-2 gap-1.5">
            <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="과목/주제"
              className="px-2 py-1.5 rounded-md ts-2xs" style={{ backgroundColor: "var(--color-bg-tertiary)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)", outline: "none" }} />
            <input value={scope} onChange={(e) => setScope(e.target.value)} placeholder="출제 범위"
              className="px-2 py-1.5 rounded-md ts-2xs" style={{ backgroundColor: "var(--color-bg-tertiary)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)", outline: "none" }} />
          </div>

          {/* 난이도 + 문항 수 */}
          <div className="flex items-center gap-1.5">
            <div className="flex gap-0.5 flex-1">
              {DIFFICULTIES.map((d) => (
                <button key={d.key} onClick={() => setDifficulty(d.key)}
                  className="flex-1 py-1.5 rounded-md ts-2xs font-medium transition-all"
                  style={{ backgroundColor: difficulty === d.key ? "var(--color-accent-subtle)" : "var(--color-bg-tertiary)", color: difficulty === d.key ? "var(--color-accent)" : "var(--color-text-muted)" }}>
                  {d.label}
                </button>
              ))}
            </div>
            <input type="number" min={1} max={30} value={count} onChange={(e) => setCount(Math.max(1, Math.min(30, Number(e.target.value) || 1)))}
              className="w-14 px-2 py-1.5 rounded-md ts-2xs tabular-nums text-center" style={{ backgroundColor: "var(--color-bg-tertiary)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)", outline: "none" }}
              title="문항 수" />
          </div>

          {/* 문항 유형 */}
          <div className="flex flex-wrap gap-1">
            {EXAM_TYPES.map((t) => (
              <button key={t.key} onClick={() => toggleType(t.key)}
                className="px-2 py-1 rounded-md ts-2xs font-medium transition-all"
                style={{ backgroundColor: types.has(t.key) ? "var(--color-accent-subtle)" : "var(--color-bg-tertiary)", color: types.has(t.key) ? "var(--color-accent)" : "var(--color-text-muted)" }}>
                {t.label}
              </button>
            ))}
          </div>

          {/* 출력 모드 */}
          <div className="flex gap-0.5">
            {EXAM_MODES.map((m) => (
              <button key={m.key} onClick={() => setExamMode(m.key)} title={m.hint}
                className="flex-1 py-1.5 rounded-md ts-2xs font-medium transition-all"
                style={{ backgroundColor: examMode === m.key ? "var(--color-accent-subtle)" : "var(--color-bg-tertiary)", color: examMode === m.key ? "var(--color-accent)" : "var(--color-text-muted)" }}>
                {m.label}
              </button>
            ))}
          </div>
          <p className="ts-2xs" style={{ color: "var(--color-text-muted)", lineHeight: 1.4 }}>
            {EXAM_MODES.find((m) => m.key === examMode)?.hint}
            {examMode === "fill" && " — 열린 양식의 필드 자리에 문항을 채웁니다."}
          </p>

          <Button size="sm" onClick={() => void genExam()} disabled={examBusy} className="w-full">
            <span className="flex items-center justify-center gap-1.5">
              {examBusy ? <Loader2 size={13} className="animate-spin" /> : <GraduationCap size={13} />} 문항 생성
            </span>
          </Button>
        </div>
      </div>
    </div>
  );
}
