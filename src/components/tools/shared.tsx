import { useState } from "react";
import { ChevronRight, ExternalLink } from "lucide-react";

// ─── Shared UI Components ───

export function SectionCard({ title, subtitle, children }: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="p-4 rounded-lg" style={{ backgroundColor: "var(--color-bg-tertiary)" }}>
      <div className="flex items-baseline justify-between mb-3">
        <h4 className="ts-sm font-semibold" style={{ color: "var(--color-text-primary)" }}>{title}</h4>
        {subtitle && (
          <span className="ts-2xs" style={{ color: "var(--color-text-muted)" }}>{subtitle}</span>
        )}
      </div>
      {children}
    </div>
  );
}

export function CollapsibleSection({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg overflow-hidden" style={{ backgroundColor: "var(--color-bg-tertiary)" }}>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between p-3 text-left"
      >
        <span className="ts-2xs font-semibold" style={{ color: "var(--color-text-secondary)" }}>{title}</span>
        <ChevronRight
          size={12}
          style={{ color: "var(--color-text-muted)", transform: open ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}
        />
      </button>
      {open && <div className="px-3 pb-3">{children}</div>}
    </div>
  );
}

export function KVRow({ label, value }: { label: string; value: unknown }) {
  const strVal = typeof value === "object" ? JSON.stringify(value, null, 2) : String(value ?? "");
  const isUrl = typeof value === "string" && value.startsWith("http");

  return (
    <div className="flex gap-3 py-1">
      <span className="ts-2xs font-semibold shrink-0 min-w-[100px]" style={{ color: "var(--color-text-muted)" }}>
        {LABEL_MAP[label] || label.replace(/_/g, " ")}
      </span>
      <span className="ts-2xs flex-1 break-all" style={{ color: "var(--color-text-primary)" }}>
        {isUrl ? (
          <a href={strVal} target="_blank" rel="noopener noreferrer"
            className="underline flex items-center gap-1" style={{ color: "var(--color-accent)" }}>
            {strVal} <ExternalLink size={10} />
          </a>
        ) : (
          strVal
        )}
      </span>
    </div>
  );
}

// ─── Flatten utility ───

export function flattenForDisplay(
  obj: Record<string, unknown>,
  prefix = "",
): { label: string; value: string | number }[] {
  const result: { label: string; value: string | number }[] = [];
  for (const [key, val] of Object.entries(obj)) {
    if (key.startsWith("_")) continue;
    const label = prefix ? `${prefix}.${key}` : key;
    if (val === null || val === undefined || val === "") continue;
    if (Array.isArray(val)) {
      if (val.length === 0) continue;
      if (typeof val[0] === "object") {
        val.forEach((item, idx) => {
          if (typeof item === "object" && item !== null) {
            result.push(...flattenForDisplay(item as Record<string, unknown>, `${label}[${idx}]`));
          } else {
            result.push({ label: `${label}[${idx}]`, value: String(item) });
          }
        });
      } else {
        result.push({ label, value: val.join(", ") });
      }
    } else if (typeof val === "object") {
      result.push(...flattenForDisplay(val as Record<string, unknown>, label));
    } else {
      result.push({ label, value: val as string | number });
    }
  }
  return result;
}

export const LABEL_MAP: Record<string, string> = {
  school_name: "학교명", address: "주소", student_count: "학생수",
  class_count: "학급수", teacher_count: "교원수", phone: "전화번호",
  homepage: "홈페이지", principal: "교장", established: "설립일",
  building_name: "건물명", area: "면적", floors: "층수",
  structure: "구조", use: "용도", approval_date: "사용승인일",
  land_area: "대지면적", zoning: "용도지역", usage: "이용현황",
  total_population: "총인구", age_group: "연령대", count: "인구수",
  heritage_name: "유산명", designation: "지정종목", location: "소재지",
  total_fee: "설계대가", basic_fee: "기본설계비",
  result: "결과", status: "상태", message: "메시지",
  region: "지역", population: "인구", name: "이름", value: "값",
  error: "오류", data: "데이터", type: "유형", grade: "등급",
};
