import type { DocFormat } from "../../lib/contract";
import { FORMAT_KIND, FORMAT_LABEL, formatFamily } from "../../lib/format";

/** 형식 표시 — 글자로 쓰고(HWPX·PDF), 색은 거들 뿐 */
export function FormatBadge({ format }: { format: DocFormat }) {
  return (
    <span className="kd-format" data-family={formatFamily(format)} title={FORMAT_KIND[format]}>
      {FORMAT_LABEL[format]}
    </span>
  );
}
