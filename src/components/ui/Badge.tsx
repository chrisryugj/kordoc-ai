import { memo, ReactNode, CSSProperties } from "react";

export type BadgeVariant =
  | "default" | "primary" | "secondary" | "success" | "warning" | "danger"
  | "hwp" | "pdf" | "xlsx" | "txt";

interface BadgeProps {
  variant?: BadgeVariant;
  children: ReactNode;
  className?: string;
}

const getVariantStyle = (variant: BadgeVariant): CSSProperties => {
  switch (variant) {
    case "hwp": return { backgroundColor: "var(--color-file-hwp-bg)", color: "var(--color-file-hwp)" };
    case "pdf": return { backgroundColor: "var(--color-file-pdf-bg)", color: "var(--color-file-pdf)" };
    case "xlsx": return { backgroundColor: "var(--color-file-xlsx-bg)", color: "var(--color-file-xlsx)" };
    case "txt": return { backgroundColor: "var(--color-file-txt-bg)", color: "var(--color-file-txt)" };
    case "primary": return { backgroundColor: "var(--color-accent-light)", color: "var(--color-accent)" };
    case "success": return { backgroundColor: "var(--color-success-bg)", color: "var(--color-success)" };
    case "warning": return { backgroundColor: "var(--color-warning-bg)", color: "var(--color-warning)" };
    case "danger": return { backgroundColor: "var(--color-danger-bg)", color: "var(--color-error)" };
    case "secondary": return { backgroundColor: "var(--color-bg-tertiary)", color: "var(--color-text-secondary)" };
    default: return { backgroundColor: "var(--color-bg-tertiary)", color: "var(--color-text-muted)" };
  }
};

export const Badge = memo(function Badge({ variant = "default", children, className = "" }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-semibold tracking-wide ${className}`}
      style={getVariantStyle(variant)}
    >
      {children}
    </span>
  );
});

export function getFileTypeBadgeVariant(fileName: string): BadgeVariant {
  const ext = fileName.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "hwp": case "hwpx": return "hwp";
    case "pdf": return "pdf";
    case "xlsx": case "xls": return "xlsx";
    case "txt": case "md": return "txt";
    default: return "default";
  }
}
