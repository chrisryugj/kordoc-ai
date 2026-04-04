import { useCallback } from "react";
import { FileText, Settings, HelpCircle } from "lucide-react";
import type { NavItem } from "../../types/nav";

interface SidebarProps {
  active: NavItem;
  onNavigate: (item: NavItem) => void;
  sidecarStatus: string;
  sidecarError?: string;
  apiKeySet?: boolean;
}

const navItems: { id: NavItem; label: string; icon: React.ReactNode; description: string }[] = [
  { id: "pipeline", label: "문서 변환", icon: <FileText size={18} />, description: "HWP · HWPX · PDF → 마크다운" },
];

const bottomItems: { id: NavItem; label: string; icon: React.ReactNode }[] = [
  { id: "settings", label: "설정", icon: <Settings size={18} /> },
  { id: "help", label: "도움말", icon: <HelpCircle size={18} /> },
];

const ALL_NAV_IDS: NavItem[] = [
  ...navItems.map((i) => i.id),
  ...bottomItems.map((i) => i.id),
];

export function Sidebar({ active, onNavigate, sidecarStatus, sidecarError, apiKeySet }: SidebarProps) {
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      e.preventDefault();
      const idx = ALL_NAV_IDS.indexOf(active);
      if (idx === -1) return;
      const next =
        e.key === "ArrowDown"
          ? (idx + 1) % ALL_NAV_IDS.length
          : (idx - 1 + ALL_NAV_IDS.length) % ALL_NAV_IDS.length;
      onNavigate(ALL_NAV_IDS[next]);
    },
    [active, onNavigate],
  );
  return (
    <aside
      role="navigation"
      aria-label="주 메뉴"
      className="h-full flex flex-col shrink-0 select-none"
      style={{
        width: "var(--sidebar-width)",
        backgroundColor: "var(--color-sidebar-bg)",
        borderRight: "1px solid var(--color-sidebar-border)",
      }}
    >
      {/* Logo */}
      <div className="px-5 py-4 flex items-center gap-3">
        <img
          src="/logo.png"
          alt="KorDoc AI"
          className="w-8 h-8 rounded-lg shrink-0 object-cover"
        />
        <div className="sidebar-logo-text">
          <h1 className="text-sm font-bold text-display" style={{ color: "var(--color-sidebar-text)", letterSpacing: "-0.02em" }}>
            KorDoc AI
          </h1>
          <span className="ts-2xs" style={{ color: "var(--color-sidebar-muted)" }}>한국 문서 변환 도구</span>
        </div>
      </div>

      {/* Main Nav */}
      <nav className="flex-1 px-3 py-2 space-y-1" onKeyDown={handleKeyDown}>
        <div className="px-2 py-1.5 ts-2xs font-semibold uppercase tracking-wider sidebar-section-title" style={{ color: "var(--color-sidebar-section)" }}>
          도구
        </div>
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => onNavigate(item.id)}
            aria-current={active === item.id ? "page" : undefined}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-left transition-colors ${active !== item.id ? "hover-sidebar-item" : ""}`}
            style={{
              backgroundColor: active === item.id ? "var(--color-sidebar-active)" : "transparent",
              color: active === item.id ? "var(--color-accent)" : "var(--color-sidebar-text)",
            }}
          >
            {item.icon}
            <div className="sidebar-label">
              <div className="ts-sm font-medium">{item.label}</div>
              <div className="ts-2xs sidebar-desc" style={{ color: "var(--color-sidebar-muted)" }}>{item.description}</div>
            </div>
          </button>
        ))}
      </nav>

      {/* Bottom Nav */}
      <div className="px-3 py-2 space-y-1 border-t" style={{ borderColor: "var(--color-sidebar-border)" }} onKeyDown={handleKeyDown}>
        {bottomItems.map((item) => (
          <button
            key={item.id}
            onClick={() => onNavigate(item.id)}
            className={`w-full flex items-center gap-3 px-3 py-1.5 rounded-md text-left transition-colors ${active !== item.id ? "hover-sidebar-item" : ""}`}
            style={{
              backgroundColor: active === item.id ? "var(--color-sidebar-active)" : "transparent",
              color: active === item.id ? "var(--color-accent)" : "var(--color-sidebar-muted)",
            }}
          >
            {item.icon}
            <span className="ts-sm sidebar-label">{item.label}</span>
          </button>
        ))}
      </div>

      {/* Footer */}
      <div className="px-5 py-3 border-t" style={{ borderColor: "var(--color-sidebar-border)" }}>
        <div className="flex items-center gap-2.5 ts-2xs sidebar-label" style={{ color: "var(--color-sidebar-muted)" }}>
          <span className="flex items-center gap-1" title={sidecarError || undefined}>
            <span
              className="w-1.5 h-1.5 rounded-full shrink-0 inline-block"
              style={{ backgroundColor: sidecarStatus === "ready" ? "var(--color-success)" : sidecarStatus === "error" ? "var(--color-error)" : "var(--color-warning)" }}
            />
            {sidecarStatus === "ready" ? "엔진" : sidecarStatus === "error" ? "오류" : "시작중"}
          </span>
          <span style={{ color: "var(--color-sidebar-border)" }}>·</span>
          <span className="flex items-center gap-1">
            <span
              className="w-1.5 h-1.5 rounded-full shrink-0 inline-block"
              style={{ backgroundColor: apiKeySet ? "var(--color-success)" : "var(--color-warning)" }}
            />
            API {apiKeySet ? "설정됨" : "미설정"}
          </span>
        </div>
        <div
          className="ts-2xs mt-1 sidebar-credit"
          style={{ color: "var(--color-sidebar-muted)", cursor: "default", fontSize: "0.65rem", letterSpacing: "0.03em", opacity: 0.6 }}
          title="광진구청 류주임"
        >
          2026 © Chris Ryu.
        </div>
      </div>
    </aside>
  );
}
