/**
 * ConvertPanel — 워크벤치 변환 탭 (KorDoc Studio Phase R / W3).
 *
 * 현재 문서를 다른 포맷으로 내보낸다(기존 convert/extract_tables 액션 패리티).
 * 결과는 우측 좁은 패널에 본문을 펴지 않고 파일로 저장 후 "저장 위치 열기"로 잇는다.
 *
 * 편집 세션의 현재 바이트(getDocB64)로 변환하므로 클릭-편집·채우기 결과가 그대로
 * 반영된다(미저장 변경 포함). 바이트가 없으면(대용량 등) 원본 파일로 폴백한다.
 */

import { useState } from "react";
import { FileText, Table, FolderOpen, Loader2, Info } from "lucide-react";
import { useDocumentSession } from "../../contexts/DocumentSession";

interface ExportDef {
  key: "md" | "tables";
  label: string;
  desc: string;
  icon: React.ReactNode;
  ext: string;
}

const EXPORTS: ExportDef[] = [
  { key: "md", label: "마크다운으로 내보내기", desc: "문서 전체 → .md", icon: <FileText size={15} />, ext: "md" },
  { key: "tables", label: "표만 추출", desc: "문서의 표 → 마크다운", icon: <Table size={15} />, ext: "md" },
];

export function ConvertPanel() {
  const { file, outputDir, sidecarCall, showToast, dirty, getDocB64 } = useDocumentSession();
  const [busy, setBusy] = useState<"" | "md" | "tables">("");
  const [lastPath, setLastPath] = useState("");

  const exportDir = outputDir || file.path.replace(/[\\/][^\\/]+$/, "");
  const stem = file.name.replace(/\.[^.]+$/, "");

  const run = async (def: ExportDef) => {
    setBusy(def.key);
    try {
      // 편집 세션 현재 바이트로 변환 — 클릭-편집·채우기 결과 반영. 없으면 원본 파일 폴백
      const docB64 = getDocB64();
      const src = docB64 ? { doc_b64: docB64 } : { input_path: file.path };
      if (def.key === "md") {
        const out = `${exportDir}\\${stem}.md`;
        const res = await sidecarCall("convert", { ...src, output_path: out }) as { success: boolean; output_path?: string; error?: string };
        if (!res.success) { showToast(res.error || "변환 실패", "error"); return; }
        const saved = res.output_path || out;
        setLastPath(saved);
        showToast(`마크다운 저장: ${saved.split(/[/\\]/).pop()}`, "success");
      } else {
        const res = await sidecarCall("extract_tables", { ...src, source_name: file.name, as_markdown: true, output_dir: exportDir }) as
          { success: boolean; output_path?: string; tables?: unknown[]; error?: string };
        if (!res.success) { showToast(res.error || "표 추출 실패", "error"); return; }
        const count = res.tables?.length ?? 0;
        if (count === 0) { showToast("문서에서 표를 찾지 못했습니다", "info"); return; }
        if (res.output_path) setLastPath(res.output_path);
        showToast(`표 ${count}개 추출${res.output_path ? ` → ${res.output_path.split(/[/\\]/).pop()}` : ""}`, "success");
      }
    } catch (e) {
      showToast(`내보내기 실패: ${e}`, "error");
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2.5 shrink-0" style={{ borderBottom: "1px solid var(--color-border)" }}>
        <span className="ts-2xs font-semibold" style={{ color: "var(--color-text-primary)" }}>내보내기</span>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1">
        {EXPORTS.map((def) => {
          const running = busy === def.key;
          return (
            <button
              key={def.key}
              onClick={() => void run(def)}
              disabled={busy !== ""}
              className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-left transition-all disabled:opacity-50"
              style={{ backgroundColor: "var(--color-bg-secondary)", border: "1px solid var(--color-border)" }}
              onMouseEnter={(e) => { if (busy === "") e.currentTarget.style.borderColor = "var(--color-accent)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--color-border)"; }}
            >
              <span className="w-7 h-7 rounded-md flex items-center justify-center shrink-0" style={{ backgroundColor: "var(--color-bg-tertiary)", color: "var(--color-accent)" }}>
                {running ? <Loader2 size={14} className="animate-spin" /> : def.icon}
              </span>
              <div className="flex-1 min-w-0">
                <p className="ts-2xs font-semibold" style={{ color: "var(--color-text-primary)" }}>{def.label}</p>
                <p className="ts-2xs mt-0.5" style={{ color: "var(--color-text-muted)" }}>{def.desc}</p>
              </div>
            </button>
          );
        })}

        {lastPath && (
          <button
            className="w-full flex items-center gap-1.5 px-2.5 py-1.5 mt-1 ts-2xs"
            style={{ color: "var(--color-accent)" }}
            onClick={() => { void sidecarCall("open_folder", { path: lastPath.replace(/[\\/][^\\/]+$/, "") }).catch(() => showToast(`저장 경로: ${lastPath}`, "info")); }}
          >
            <FolderOpen size={12} /> 저장 위치 열기
          </button>
        )}
      </div>

      {dirty && (
        <div className="flex items-start gap-1.5 px-3 py-2 shrink-0" style={{ borderTop: "1px solid var(--color-border)" }}>
          <Info size={12} className="mt-0.5 shrink-0" style={{ color: "var(--color-accent)" }} />
          <p className="ts-2xs" style={{ color: "var(--color-text-muted)", lineHeight: 1.4 }}>
            <span style={{ color: "var(--color-text-secondary)" }}>미저장 변경을 포함</span>해 현재 편집 상태로 변환됩니다.
          </p>
        </div>
      )}
    </div>
  );
}
