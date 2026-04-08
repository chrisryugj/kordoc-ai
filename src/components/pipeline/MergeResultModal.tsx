import type { PipelineResult } from "../../types/pipeline";

interface Props {
  result: PipelineResult | null;
  onClose: () => void;
  onOpenFolder: () => void;
}

function getSummary(d: Record<string, unknown>): { title: string; detail?: string } {
  // merge_files: file_count
  if (d.file_count != null) {
    const fileName = typeof d.output_path === "string" ? d.output_path.split(/[/\\]/).pop() : null;
    return { title: `${Number(d.file_count)}개 파일 수합 완료`, detail: fileName ?? undefined };
  }
  // split_pdf: output_files
  if (Array.isArray(d.output_files)) {
    return { title: `${d.output_files.length}개 파일로 분할 완료`, detail: `전체 ${d.total_pages ?? "?"}페이지` };
  }
  // pdf_extract_pages: extracted_pages
  if (d.extracted_pages != null) {
    const fileName = typeof d.output_path === "string" ? d.output_path.split(/[/\\]/).pop() : null;
    return { title: `${d.extracted_pages}/${d.total_pages ?? "?"}페이지 추출 완료`, detail: fileName ?? undefined };
  }
  return { title: "처리 완료" };
}

export function MergeResultModal({ result, onClose, onOpenFolder }: Props) {
  const d = result?.data as Record<string, unknown> | undefined;
  if (!d) return null;
  // merge/split/extract 결과 판별
  if (d.file_count == null && !Array.isArray(d.output_files) && d.extracted_pages == null) return null;

  const { title, detail } = getSummary(d);
  const failed = Array.isArray(d.failed_files) ? d.failed_files as string[] : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: "var(--color-backdrop)" }}>
      <div className="card p-6 max-w-sm mx-4 animate-fade-in">
        <div className="flex flex-col items-center text-center gap-4">
          <div className="w-14 h-14 rounded-full flex items-center justify-center" style={{ backgroundColor: "var(--color-success-subtle)" }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--color-success)" }}>
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <div>
            <p className="ts-sm font-bold" style={{ color: "var(--color-text-primary)" }}>{title}</p>
            {detail && (
              <p className="ts-2xs mt-1" style={{ color: "var(--color-text-muted)" }}>{detail}</p>
            )}
          </div>
          {failed.length > 0 && (
            <div className="rounded-md p-3 ts-2xs w-full" style={{ backgroundColor: "var(--color-warning-subtle)", color: "var(--color-warning)" }}>
              실패: {failed.map(f => f.split(/[/\\]/).pop()).join(", ")}
            </div>
          )}
          <div className="flex gap-2 w-full">
            <button className="btn btn-ghost flex-1 ts-xs" onClick={onClose}>닫기</button>
            <button className="btn btn-primary flex-1 ts-xs" onClick={onOpenFolder}>폴더 열기</button>
          </div>
        </div>
      </div>
    </div>
  );
}
