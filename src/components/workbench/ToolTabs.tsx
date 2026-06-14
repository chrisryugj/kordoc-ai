/**
 * ToolTabs — 워크벤치 우측 도구 패널 (KorDoc Studio Phase R).
 *
 * Figma 속성 패널 자리: 한 문서를 놓고 도구를 번갈아 쓰는 흐름을 탭으로 모은다.
 *  - 채우기: 양식 자동 폼 (W2 — FillPanel)
 *  - 편집:   클릭-편집 보조 뷰 — 블록 목록 + capability 사유 (W1)
 *  - AI:     참고자료 → 필드값 추론 → 채우기 제안 (W4 — AiPanel)
 *  - 변환:   마크다운·표 내보내기 (W3 — ConvertPanel)
 *
 * 채우기/AI 탭은 useFillForm 한 인스턴스를 공유한다(AI 제안이 채우기 폼에 반영).
 */

import { ClipboardList, SquarePen, Sparkles, FileOutput, Lock, Unlock, Table2, Hash } from "lucide-react";
import { useDocumentSession, type EditBlockView, type BlockCapabilityInfo } from "../../contexts/DocumentSession";
import type { FillForm } from "./useFillForm";
import { FillPanel } from "./FillPanel";
import { AiPanel } from "./AiPanel";
import { ConvertPanel } from "./ConvertPanel";

export type TabKey = "fill" | "edit" | "ai" | "convert";

const TABS: { key: TabKey; label: string; icon: React.ReactNode }[] = [
  { key: "fill", label: "채우기", icon: <ClipboardList size={14} /> },
  { key: "edit", label: "편집", icon: <SquarePen size={14} /> },
  { key: "ai", label: "AI", icon: <Sparkles size={14} /> },
  { key: "convert", label: "변환", icon: <FileOutput size={14} /> },
];

interface ToolTabsProps {
  /** 활성 탭 — 워크벤치 셸이 보유(미리보기 어노테이션 전환과 공유) */
  tab: TabKey;
  setTab: (t: TabKey) => void;
  /** 채우기/AI 탭이 공유하는 폼 상태 — 셸에서 1회 생성해 내려줌 */
  fillForm: FillForm;
  /** 채우기 필드 ↔ 미리보기 라벨 하이라이트 연동 */
  focusedLabel: string;
  setFocusedLabel: (l: string) => void;
}

export function ToolTabs({ tab, setTab, fillForm, focusedLabel, setFocusedLabel }: ToolTabsProps) {
  return (
    <div
      className="flex flex-col overflow-hidden shrink-0"
      style={{ width: 300, borderLeft: "1px solid var(--color-border)", backgroundColor: "var(--color-bg-primary)" }}
    >
      {/* 탭 헤더 — Linear 세그먼트 컨트롤 */}
      <div className="flex items-center gap-0.5 p-1.5 shrink-0" style={{ borderBottom: "1px solid var(--color-border)" }}>
        {TABS.map((t) => {
          const active = t.key === tab;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md ts-2xs font-semibold transition-all"
              style={{
                backgroundColor: active ? "var(--color-bg-tertiary)" : "transparent",
                color: active ? "var(--color-text-primary)" : "var(--color-text-muted)",
                boxShadow: active ? "var(--shadow-sm)" : "none",
              }}
            >
              {t.icon}
              <span>{t.label}</span>
            </button>
          );
        })}
      </div>

      <div className="flex-1 overflow-hidden">
        {/* 채우기/AI는 항상 마운트 유지(폼 상태·입력 보존), 표시만 토글 */}
        <div className="h-full" style={{ display: tab === "fill" ? "block" : "none" }}>
          <FillPanel form={fillForm} focusedLabel={focusedLabel} setFocusedLabel={setFocusedLabel} />
        </div>
        <div className="h-full" style={{ display: tab === "ai" ? "block" : "none" }}>
          <AiPanel form={fillForm} onApplied={() => setTab("fill")} />
        </div>
        {tab === "edit" && <EditPanel />}
        {tab === "convert" && <ConvertPanel />}
      </div>
    </div>
  );
}

// ── 편집 탭: 블록 목록 + capability 사유 ──

function blockLabel(b: EditBlockView): { icon: React.ReactNode; text: string } {
  if (b.type === "table" && b.table) return { icon: <Table2 size={13} />, text: `표 ${b.table.rows}×${b.table.cols}` };
  if (b.type === "heading") return { icon: <Hash size={13} />, text: b.text?.trim() || `제목 ${b.level ?? ""}`.trim() };
  return { icon: <SquarePen size={13} />, text: b.text?.trim() || "(빈 문단)" };
}

function capState(cap?: BlockCapabilityInfo): { editable: boolean; reason: string } {
  if (!cap) return { editable: false, reason: "분석되지 않음" };
  if (cap.capability === "locked") return { editable: false, reason: cap.reason || "지원하지 않는 영역" };
  return { editable: true, reason: cap.capability === "cell-text" ? "표 셀 편집 가능" : "문단 편집 가능" };
}

function EditPanel() {
  const { blocks, caps, editableCount, showLocks, setShowLocks } = useDocumentSession();
  const textBlocks = blocks.filter((b) => b.type === "paragraph" || b.type === "heading" || b.type === "table");

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="flex items-center justify-between px-3 py-2.5 shrink-0" style={{ borderBottom: "1px solid var(--color-border)" }}>
        <div className="ts-2xs" style={{ color: "var(--color-text-secondary)" }}>
          편집 가능 <span className="font-bold" style={{ color: "var(--color-accent)" }}>{editableCount}</span>곳 · 블록 {textBlocks.length}
        </div>
        <button
          onClick={() => setShowLocks((v) => !v)}
          className="flex items-center gap-1 px-2 py-1 rounded-md ts-2xs font-medium transition-all hover-bg-tertiary"
          style={{ color: showLocks ? "var(--color-accent)" : "var(--color-text-muted)", backgroundColor: showLocks ? "var(--color-accent-subtle)" : "transparent" }}
          title="미리보기에서 편집 가능(밑줄)/잠금(흐림) 표시"
        >
          {showLocks ? <Unlock size={12} /> : <Lock size={12} />} 잠금 표시
        </button>
      </div>

      <div className="px-2 py-2 space-y-0.5">
        {textBlocks.length === 0 ? (
          <p className="ts-2xs px-2 py-3 text-center" style={{ color: "var(--color-text-muted)" }}>편집할 블록이 없습니다.</p>
        ) : textBlocks.map((b) => {
          const { icon, text } = blockLabel(b);
          const { editable, reason } = capState(caps[b.index]);
          return (
            <div key={b.index} className="flex items-start gap-2 px-2 py-1.5 rounded-md" style={{ opacity: editable ? 1 : 0.55 }} title={reason}>
              <span className="mt-0.5 shrink-0" style={{ color: editable ? "var(--color-text-secondary)" : "var(--color-text-disabled)" }}>{icon}</span>
              <div className="flex-1 min-w-0">
                <p className="ts-2xs truncate" style={{ color: "var(--color-text-primary)" }}>{text}</p>
                <p className="ts-2xs mt-0.5 flex items-center gap-1" style={{ color: editable ? "var(--color-success)" : "var(--color-text-muted)" }}>
                  {!editable && <Lock size={9} />}{reason}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      <p className="ts-2xs px-3 py-2 mt-auto shrink-0" style={{ color: "var(--color-text-muted)", borderTop: "1px solid var(--color-border)" }}>
        미리보기에서 문단·셀을 클릭해 바로 수정하세요.
      </p>
    </div>
  );
}
