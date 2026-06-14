/**
 * FillPanel — 워크벤치 채우기 탭 (KorDoc Studio Phase R / W2).
 *
 * FillWizard 좌측 폼을 우측 도구 패널 폭(300px)에 맞춰 이식. 미리보기는
 * DocumentSession 공유 인스턴스에 반영된다(자체 SVG 보유 안 함). 폼 상태는
 * ToolTabs가 보유한 useFillForm 인스턴스를 받아 AI 탭과 공유한다.
 */

import {
  Table2, CalendarDays, Phone, Mail, Banknote, CheckSquare, Type, IdCard,
  ShieldCheck, FolderOpen, Check, Save, Loader2, AlertTriangle,
} from "lucide-react";
import { Button } from "../ui/Button";
import { useDocumentSession } from "../../contexts/DocumentSession";
import { isoToKoreanDate, norm, type FieldType, type FillForm } from "./useFillForm";

const TYPE_META: Record<FieldType, { icon: React.ReactNode; hint: string }> = {
  text: { icon: <Type size={12} />, hint: "텍스트" },
  date: { icon: <CalendarDays size={12} />, hint: "날짜" },
  phone: { icon: <Phone size={12} />, hint: "전화번호" },
  email: { icon: <Mail size={12} />, hint: "이메일" },
  amount: { icon: <Banknote size={12} />, hint: "금액/수량" },
  checkbox: { icon: <CheckSquare size={12} />, hint: "체크" },
  idnum: { icon: <IdCard size={12} />, hint: "주민등록번호" },
};

export function FillPanel({ form, focusedLabel, setFocusedLabel }: {
  form: FillForm;
  focusedLabel: string;
  setFocusedLabel: (l: string) => void;
}) {
  const { sidecarCall, showToast } = useDocumentSession();
  const { loading, loadError, fields, values, sources, fillResult, busy, filledSet, setValue, importRoster, doFill } = form;

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 h-full" style={{ color: "var(--color-text-muted)" }}>
        <Loader2 size={16} className="animate-spin" /> <span className="ts-2xs">양식 분석 중...</span>
      </div>
    );
  }
  if (loadError) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 px-5 text-center">
        <AlertTriangle size={22} style={{ color: "var(--color-warning)" }} />
        <p className="ts-2xs" style={{ color: "var(--color-text-secondary)", lineHeight: 1.5 }}>{loadError}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* 헤더 + 명부 */}
      <div className="flex items-center justify-between px-3 py-2.5 shrink-0" style={{ borderBottom: "1px solid var(--color-border)" }}>
        <span className="ts-2xs font-semibold" style={{ color: "var(--color-text-primary)" }}>입력 항목 ({fields.length})</span>
        <button onClick={() => void importRoster()} className="flex items-center gap-1 px-2 py-1 rounded-md ts-2xs font-medium hover-bg-tertiary" style={{ color: "var(--color-text-secondary)" }} title="명부(xlsx)에서 자동 매핑">
          <Table2 size={12} /> 명부
        </button>
      </div>

      {/* 필드 폼 */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2.5">
        {fields.length === 0 && (
          <p className="ts-2xs px-2.5 py-2 rounded-md" style={{ backgroundColor: "var(--color-warning-subtle)", color: "var(--color-warning)", lineHeight: 1.5 }}>
            인식된 양식 필드가 없습니다. 라벨-값 구조(표 또는 "라벨:")가 있는 양식인지 확인하세요.
          </p>
        )}
        {fields.map((f) => {
          const meta = TYPE_META[f.type];
          const src = sources[f.label];
          const wasFilled = filledSet.has(norm(f.label));
          const focused = focusedLabel === f.label;
          return (
            <div key={`${f.label}-${f.type}`}>
              <label className="flex items-center gap-1 ts-2xs font-semibold mb-1" style={{ color: focused ? "var(--color-accent)" : "var(--color-text-secondary)" }}>
                <span style={{ color: focused ? "var(--color-accent)" : "var(--color-text-muted)" }}>{meta.icon}</span>
                <span className="truncate">{f.label}</span>
                {f.required && <span style={{ color: "var(--color-error)" }}>*</span>}
                {f.empty && !values[f.label]?.trim() && (
                  <span className="px-1 rounded ts-2xs font-normal shrink-0" style={{ backgroundColor: "var(--color-warning-subtle)", color: "var(--color-warning)" }}>빈칸</span>
                )}
                {wasFilled && (
                  <span className="px-1 rounded ts-2xs font-normal shrink-0" style={{ backgroundColor: "var(--color-success-subtle)", color: "var(--color-success)" }}>채움</span>
                )}
              </label>

              {f.type === "checkbox" ? (
                <label className="flex items-center gap-2 ts-2xs px-2.5 py-1.5 rounded-md cursor-pointer" style={{ backgroundColor: "var(--color-bg-tertiary)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }}>
                  <input type="checkbox" checked={values[f.label] === "☑"} onFocus={() => setFocusedLabel(f.label)} onChange={(e) => setValue(f.label, e.target.checked ? "☑" : "")} />
                  체크 표시
                </label>
              ) : f.type === "date" ? (
                <input
                  type="date"
                  className="w-full px-2.5 py-1.5 rounded-md ts-2xs"
                  style={{ backgroundColor: "var(--color-bg-tertiary)", border: `1px solid ${focused ? "var(--color-accent)" : "var(--color-border)"}`, color: "var(--color-text-primary)", outline: "none" }}
                  onFocus={() => setFocusedLabel(f.label)}
                  onChange={(e) => setValue(f.label, e.target.value ? isoToKoreanDate(e.target.value) : "")}
                />
              ) : (
                <input
                  type="text"
                  placeholder={f.value.trim() || meta.hint}
                  value={values[f.label] ?? ""}
                  className="w-full px-2.5 py-1.5 rounded-md ts-2xs"
                  style={{ backgroundColor: "var(--color-bg-tertiary)", border: `1px solid ${focused ? "var(--color-accent)" : "var(--color-border)"}`, color: "var(--color-text-primary)", outline: "none" }}
                  onFocus={() => setFocusedLabel(f.label)}
                  onChange={(e) => setValue(f.label, e.target.value)}
                />
              )}

              {src && values[f.label]?.trim() && (
                <p className="ts-2xs mt-0.5 truncate" style={{ color: src.kind === "ai" ? "var(--color-accent)" : "var(--color-text-muted)" }}>
                  {src.kind === "roster" && `← ${src.detail}`}
                  {src.kind === "existing" && "← 양식 기존 값"}
                  {src.kind === "manual" && "← 직접 입력"}
                  {src.kind === "ai" && `← ${src.detail ?? "AI 추론"}`}
                </p>
              )}
            </div>
          );
        })}

        {/* 채움 결과 리포트 */}
        {fillResult && (
          <div className="rounded-md px-2.5 py-2 space-y-1" style={{ backgroundColor: "var(--color-bg-secondary)", border: "1px solid var(--color-border)" }}>
            <div className="flex items-center gap-1.5 ts-2xs font-semibold" style={{ color: fillResult.verification.reparse_ok ? "var(--color-success)" : "var(--color-warning)" }}>
              <ShieldCheck size={12} />
              {fillResult.verification.reparse_ok
                ? `검증 통과 · ${fillResult.filled.length}개 채움 · 변경 ${fillResult.verification.changed_blocks}블록`
                : "검증 경고 — 결과 확인"}
            </div>
            {fillResult.unmatched.length > 0 && (
              <p className="ts-2xs" style={{ color: "var(--color-warning)" }}>매칭 실패: {fillResult.unmatched.join(", ")}</p>
            )}
            {fillResult.output_path && (
              <button
                className="flex items-center gap-1 ts-2xs"
                style={{ color: "var(--color-accent)" }}
                onClick={() => { void sidecarCall("open_folder", { path: fillResult.output_path.replace(/[\\/][^\\/]+$/, "") }).catch(() => showToast(`저장 경로: ${fillResult.output_path}`, "info")); }}
              >
                <FolderOpen size={11} /> {fillResult.output_path.split(/[/\\]/).pop()}
              </button>
            )}
          </div>
        )}
      </div>

      {/* 푸터 — 문서에 적용(미저장) / HWPX 저장 */}
      <div className="flex gap-1.5 px-3 py-2.5 shrink-0" style={{ borderTop: "1px solid var(--color-border)" }}>
        <Button variant="secondary" size="sm" onClick={() => doFill(true)} disabled={busy !== ""} title="채운 값을 문서에 반영(미저장) — 이어서 클릭-편집·변환 가능">
          <span className="flex items-center gap-1">
            {busy === "preview" ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} 문서에 적용
          </span>
        </Button>
        <Button size="sm" onClick={() => doFill(false)} disabled={busy !== ""} className="flex-1">
          <span className="flex items-center justify-center gap-1">
            {busy === "save" ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />} HWPX 저장
          </span>
        </Button>
      </div>
    </div>
  );
}
