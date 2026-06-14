/**
 * DocumentWorkbench — 문서 워크벤치 셸 (KorDoc Studio Phase R / W1).
 *
 * 한 문서를 놓고 미리보기·편집·(예정)채우기·AI·변환을 번갈아 쓰는 3-pane 작업대.
 * 모달마다 rhwp 문서를 재파싱하던 구조를 DocumentSession 한 인스턴스로 수렴시킨다.
 *
 * 레이아웃(Figma 3-pane / Linear 정제미):
 *   툴바(파일명·undo/redo·저장상태·닫기)
 *   ├ FileRail(좌)  ─ PreviewPanel(중앙 캔버스)  ─ ToolTabs(우 도구)
 *
 * 채우기/편집/AI/변환 탭이 한 DocumentSession(편집 세션 바이트)을 공유한다 —
 * 채움·클릭편집 결과가 미리보기·블록·변환에 일관되게 반영된다. 구 DocEditor/
 * FillWizard 모달은 이 작업대로 완전 흡수돼 제거됨(KorDoc Studio Phase R 통합).
 */

import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Undo2, Redo2, Save, FolderOpen, Loader2, AlertTriangle, SquarePen } from "lucide-react";
import { Button } from "../ui/Button";
import { DocumentSessionProvider, useDocumentSession } from "../../contexts/DocumentSession";
import { useFillForm } from "./useFillForm";
import { FileRail } from "./FileRail";
import { StudioEditor } from "./StudioEditor";
import { ToolTabs, type TabKey } from "./ToolTabs";
import type { ImportedFile } from "../../types/pipeline";

interface DocumentWorkbenchProps {
  /** 워크벤치에 놓을 문서들(HWPX). 좌측 레일에서 전환한다. */
  files: ImportedFile[];
  initialIndex?: number;
  /** 진입 시 활성 탭 — 양식 채우기로 들어오면 "fill", 그 외 "edit" */
  initialTab?: TabKey;
  sidecarCall: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
  outputDir: string;
  showToast: (msg: string, type: "success" | "error" | "info" | "loading") => void;
  onClose: () => void;
  onOpenFolder: (path: string) => void;
}

export function DocumentWorkbench({ files, initialIndex = 0, initialTab = "edit", sidecarCall, outputDir, showToast, onClose, onOpenFolder }: DocumentWorkbenchProps) {
  const [activeIndex, setActiveIndex] = useState(initialIndex);
  const activeFile = files[activeIndex] ?? files[0];
  if (!activeFile) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col" style={{ backgroundColor: "var(--color-bg-primary)" }}>
      {/* key=경로 → 파일 전환 시 Provider 재마운트(edit_open 재실행, 미리보기 재구성) */}
      <DocumentSessionProvider key={activeFile.path} file={activeFile} sidecarCall={sidecarCall} outputDir={outputDir} showToast={showToast}>
        <WorkbenchShell
          files={files}
          activeIndex={activeIndex}
          initialTab={initialTab}
          onSelectFile={setActiveIndex}
          onClose={onClose}
          onOpenFolder={onOpenFolder}
        />
      </DocumentSessionProvider>
    </div>
  );
}

interface ShellProps {
  files: ImportedFile[];
  activeIndex: number;
  initialTab: TabKey;
  onSelectFile: (i: number) => void;
  onClose: () => void;
  onOpenFolder: (path: string) => void;
}

function WorkbenchShell({ files, activeIndex, initialTab, onSelectFile, onClose, onOpenFolder }: ShellProps) {
  const {
    file, loading, loadError, sessionId, canUndo, canRedo, busy, dirty, savedAt, savePath,
    wasmOk, undo, redo, save, showToast, getDocB64,
  } = useDocumentSession();

  // 도구 탭 + 채우기 폼 + 필드↔라벨 포커스 — 셸에서 보유해 미리보기/도구 패널이 공유
  const [tab, setTab] = useState<TabKey>(initialTab);
  const [focusedLabel, setFocusedLabel] = useState("");
  // 채우기/AI 탭이 한 번이라도 열렸을 때만 form_schema 로드(편집 전용 흐름의 양식 분석 비용 제거)
  const [fillActivated, setFillActivated] = useState(initialTab === "fill" || initialTab === "ai");
  useEffect(() => {
    if (tab === "fill" || tab === "ai") setFillActivated(true);
  }, [tab]);
  const fillForm = useFillForm(fillActivated);

  // 파일 전환 — 미저장 변경은 먼저 저장(전환 시 세션이 언마운트되므로)
  const handleSelectFile = useCallback(async (i: number) => {
    if (i === activeIndex) return;
    if (dirty && sessionId) {
      await save(true);
      showToast(`변경사항 저장됨: ${savePath}`, "info");
    }
    onSelectFile(i);
  }, [activeIndex, dirty, sessionId, save, savePath, showToast, onSelectFile]);

  // 닫기: 미저장 변경은 저장 후 종료
  const handleClose = useCallback(async () => {
    if (dirty && sessionId) {
      await save(true);
      showToast(`변경사항 저장됨: ${savePath}`, "info");
    }
    onClose();
  }, [dirty, sessionId, save, savePath, showToast, onClose]);

  // 전역 단축키: Ctrl+Z / Ctrl+Y / Ctrl+S
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || busy !== "") return;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey && canUndo) { e.preventDefault(); void undo(); }
      else if ((k === "y" || (k === "z" && e.shiftKey)) && canRedo) { e.preventDefault(); void redo(); }
      else if (k === "s") { e.preventDefault(); void save(false); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, canUndo, canRedo, undo, redo, save]);

  return (
    <>
      {/* 툴바 */}
      <div className="flex items-center gap-3 px-4 py-2.5 shrink-0" style={{ borderBottom: "1px solid var(--color-border)" }}>
        <button onClick={() => void handleClose()} className="flex items-center gap-1.5 px-2 py-1 rounded-md hover-bg-tertiary ts-2xs font-medium" style={{ color: "var(--color-text-secondary)" }} aria-label="작업대 닫기">
          <ArrowLeft size={14} /> 닫기
        </button>
        <div className="w-px h-5" style={{ backgroundColor: "var(--color-border)" }} />

        <div className="w-7 h-7 rounded-md flex items-center justify-center shrink-0" style={{ backgroundColor: "color-mix(in srgb, #9333EA 12%, transparent)", color: "#9333EA" }}>
          <SquarePen size={14} />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="ts-xs font-bold truncate" style={{ color: "var(--color-text-primary)" }}>{file.name}</h2>
          <p className="ts-2xs" style={{ color: "var(--color-text-muted)" }}>
            문서 작업대 · 원본 서식 그대로
            {wasmOk === false && " · 미리보기: 엔진 렌더(WASM 폴백)"}
          </p>
        </div>

        {/* 저장 상태 */}
        <span className="ts-2xs shrink-0 tabular-nums" style={{ color: dirty ? "var(--color-warning)" : "var(--color-text-muted)" }}>
          {busy === "save" ? "저장 중..." : dirty ? "● 저장 안 됨 (30초 후 자동저장)" : savedAt ? `저장됨 ${savedAt.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}` : ""}
        </span>

        <div className="flex items-center gap-1 shrink-0">
          <button onClick={() => void undo()} disabled={!canUndo || busy !== ""} className="p-1.5 rounded-md hover-bg-tertiary disabled:opacity-30" aria-label="되돌리기 (Ctrl+Z)" title="되돌리기 (Ctrl+Z)">
            <Undo2 size={15} style={{ color: "var(--color-text-secondary)" }} />
          </button>
          <button onClick={() => void redo()} disabled={!canRedo || busy !== ""} className="p-1.5 rounded-md hover-bg-tertiary disabled:opacity-30" aria-label="다시 실행 (Ctrl+Y)" title="다시 실행 (Ctrl+Y)">
            <Redo2 size={15} style={{ color: "var(--color-text-secondary)" }} />
          </button>
          <Button size="sm" onClick={() => void save(false)} disabled={busy !== "" || !sessionId}>
            <span className="flex items-center gap-1.5">
              {busy === "save" ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} 저장
            </span>
          </Button>
          {savedAt && (
            <button onClick={() => onOpenFolder(savePath)} className="p-1.5 rounded-md hover-bg-tertiary" aria-label="저장 위치 열기" title="저장 위치 열기">
              <FolderOpen size={15} style={{ color: "var(--color-text-secondary)" }} />
            </button>
          )}
        </div>
      </div>

      {/* 본문 */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center gap-2" style={{ color: "var(--color-text-muted)" }}>
          <Loader2 size={18} className="animate-spin" /> <span className="ts-sm">문서 분석 중...</span>
        </div>
      ) : loadError ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 px-8 text-center">
          <AlertTriangle size={28} style={{ color: "var(--color-warning)" }} />
          <p className="ts-sm" style={{ color: "var(--color-text-secondary)" }}>{loadError}</p>
          <Button variant="secondary" size="sm" onClick={onClose}>닫기</Button>
        </div>
      ) : (
        <div className="flex-1 flex overflow-hidden">
          <FileRail files={files} activeIndex={activeIndex} onSelectFile={(i) => void handleSelectFile(i)} />
          <StudioEditor docB64={loading ? null : getDocB64()} fileName={file.name} />
          <ToolTabs
            tab={tab}
            setTab={setTab}
            fillForm={fillForm}
            focusedLabel={focusedLabel}
            setFocusedLabel={setFocusedLabel}
          />
        </div>
      )}
    </>
  );
}
