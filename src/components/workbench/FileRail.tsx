/**
 * FileRail — 워크벤치 좌측 레일 (KorDoc Studio Phase R).
 *
 * Figma 레이어 패널 자리: 워크벤치에 놓인 문서 목록(전환) + 활성 문서의 페이지 목록.
 * 문서 목록은 워크벤치 레벨(props), 페이지는 활성 세션(context)에서 온다.
 */

import { FileText } from "lucide-react";
import { Badge, getFileTypeBadgeVariant } from "../ui/Badge";
import { useDocumentSession } from "../../contexts/DocumentSession";
import type { ImportedFile } from "../../types/pipeline";

interface FileRailProps {
  files: ImportedFile[];
  activeIndex: number;
  onSelectFile: (i: number) => void;
}

export function FileRail({ files, activeIndex, onSelectFile }: FileRailProps) {
  const { pageCount, page, setPage, loading } = useDocumentSession();

  return (
    <div
      className="flex flex-col overflow-hidden shrink-0"
      style={{ width: 200, borderRight: "1px solid var(--color-border)", backgroundColor: "var(--color-bg-primary)" }}
    >
      {/* 문서 목록 */}
      <div className="px-3 py-2.5 shrink-0" style={{ borderBottom: "1px solid var(--color-border)" }}>
        <div className="flex items-center gap-1.5 mb-1.5">
          <FileText size={12} style={{ color: "var(--color-text-muted)" }} />
          <span className="ts-2xs font-semibold uppercase" style={{ color: "var(--color-text-muted)", letterSpacing: "0.04em" }}>
            문서 {files.length > 1 ? `(${files.length})` : ""}
          </span>
        </div>
        <div className="space-y-0.5 max-h-[160px] overflow-y-auto">
          {files.map((f, i) => {
            const active = i === activeIndex;
            return (
              <button
                key={f.path}
                onClick={() => onSelectFile(i)}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left transition-all"
                style={{ backgroundColor: active ? "var(--color-bg-tertiary)" : "transparent" }}
                onMouseEnter={(e) => { if (!active) e.currentTarget.style.backgroundColor = "var(--color-bg-secondary)"; }}
                onMouseLeave={(e) => { if (!active) e.currentTarget.style.backgroundColor = "transparent"; }}
                title={f.name}
              >
                <Badge variant={getFileTypeBadgeVariant(f.name)}>{f.type.toUpperCase()}</Badge>
                <span className="ts-2xs flex-1 truncate" style={{ color: active ? "var(--color-text-primary)" : "var(--color-text-secondary)" }}>{f.name}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 활성 문서 페이지 목록 */}
      <div className="px-2 py-2 shrink-0">
        <span className="ts-2xs font-semibold uppercase px-1" style={{ color: "var(--color-text-muted)", letterSpacing: "0.04em" }}>페이지</span>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-0.5">
        {loading || pageCount === 0 ? (
          <p className="ts-2xs px-2 py-2" style={{ color: "var(--color-text-muted)" }}>—</p>
        ) : (
          Array.from({ length: pageCount }, (_, i) => {
            const active = i === page;
            return (
              <button
                key={i}
                onClick={() => setPage(() => i)}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md transition-all"
                style={{ backgroundColor: active ? "var(--color-bg-tertiary)" : "transparent", color: active ? "var(--color-text-primary)" : "var(--color-text-secondary)" }}
                onMouseEnter={(e) => { if (!active) e.currentTarget.style.backgroundColor = "var(--color-bg-tertiary)"; }}
                onMouseLeave={(e) => { if (!active) e.currentTarget.style.backgroundColor = "transparent"; }}
              >
                <span
                  className="w-6 h-7 rounded flex items-center justify-center ts-2xs font-semibold tabular-nums shrink-0"
                  style={{ backgroundColor: active ? "var(--color-text-secondary)" : "var(--color-bg-tertiary)", color: active ? "white" : "var(--color-text-muted)" }}
                >
                  {i + 1}
                </span>
                <span className="ts-2xs">페이지 {i + 1}</span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
