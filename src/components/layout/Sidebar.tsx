import { memo, useCallback } from "react";
import { FileText, Settings, HelpCircle, Wifi, WifiOff } from "lucide-react";
import type { NavItem } from "../../types/nav";

interface SidebarProps {
  active: NavItem;
  onNavigate: (item: NavItem) => void;
  sidecarStatus: string;
  sidecarError?: string;
  apiKeySet?: boolean;
  aiMode?: string;
  onToggleMode?: () => void;
}

const navItems: { id: NavItem; label: string; icon: React.ReactNode; description: string }[] = [
  { id: "pipeline", label: "문서 작업", icon: <FileText size={18} />, description: "변환 · 추출 · 비교 · AI 분석" },
];

const bottomItems: { id: NavItem; label: string; icon: React.ReactNode }[] = [
  { id: "settings", label: "설정", icon: <Settings size={18} /> },
  { id: "help", label: "도움말", icon: <HelpCircle size={18} /> },
];

const ALL_NAV_IDS: NavItem[] = [...navItems.map((i) => i.id), ...bottomItems.map((i) => i.id)];

export const Sidebar = memo(function Sidebar({ active, onNavigate, sidecarStatus, sidecarError, apiKeySet, aiMode, onToggleMode }: SidebarProps) {
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      e.preventDefault();
      const idx = ALL_NAV_IDS.indexOf(active);
      if (idx === -1) return;
      const next = e.key === "ArrowDown" ? (idx + 1) % ALL_NAV_IDS.length : (idx - 1 + ALL_NAV_IDS.length) % ALL_NAV_IDS.length;
      onNavigate(ALL_NAV_IDS[next]);
    },
    [active, onNavigate],
  );

  const isOnline = aiMode === "online";

  return (
    <aside
      role="navigation"
      aria-label="주 메뉴"
      className="h-full flex flex-col shrink-0 select-none"
      style={{ width: "var(--sidebar-width)", backgroundColor: "var(--color-sidebar-bg)", borderRight: "1px solid var(--color-border)" }}
    >
      {/* Logo */}
      <div className="sidebar-header px-4 flex items-center gap-2" style={{ borderBottom: "1px solid var(--color-sidebar-border)" }}>
        <img src="/logo.png" alt="KorDoc AI" className="w-10 h-10 rounded-lg shrink-0 object-cover" style={{ marginTop: "-2px" }} />
        <div style={{ lineHeight: 1.2 }}>
          <h1 className="font-bold text-display" style={{ color: "var(--color-sidebar-text)", letterSpacing: "-0.02em", fontSize: "1.0625rem", margin: 0 }}>
            KorDoc AI
          </h1>
          <span style={{ color: "var(--color-sidebar-muted)", fontSize: "0.75rem", display: "block", marginTop: "1px" }}>다 파싱해버리겠다.</span>
        </div>
      </div>

      {/* Nav — 도구 + AI 모드 */}
      <nav className="flex-1 px-4 pt-4 space-y-0.5" onKeyDown={handleKeyDown}>
        <div className="ts-2xs font-semibold uppercase tracking-wider pb-2" style={{ color: "var(--color-sidebar-section)" }}>
          <span className="sidebar-section-title">도구</span>
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

        {/* AI 모드 토글 */}
        {onToggleMode && (
          <>
            <div className="ts-2xs font-semibold uppercase tracking-wider pt-5 pb-2" style={{ color: "var(--color-sidebar-section)" }}>
              <span className="sidebar-section-title">AI 모드</span>
            </div>
            <button
              onClick={onToggleMode}
              className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-left transition-colors hover-sidebar-item"
              style={{ color: "var(--color-sidebar-text)" }}
              title={isOnline ? "클릭하면 오프라인(로컬 전용)으로 전환" : "클릭하면 온라인(Gemini API)으로 전환"}
            >
              {isOnline
                ? <Wifi size={18} style={{ color: "var(--color-success)" }} />
                : <WifiOff size={18} style={{ color: "var(--color-text-muted)" }} />
              }
              <div className="sidebar-label flex-1 min-w-0">
                <div className="ts-sm font-medium">{isOnline ? "온라인" : "오프라인"}</div>
                <div className="ts-2xs sidebar-desc" style={{ color: "var(--color-sidebar-muted)" }}>
                  {isOnline ? "Gemini API 사용" : "로컬 변환만"}
                </div>
              </div>
              <div
                className="w-8 h-[18px] rounded-full relative shrink-0 transition-colors sidebar-label"
                style={{ backgroundColor: isOnline ? "var(--color-success)" : "var(--color-bg-subtle)" }}
              >
                <div
                  className="absolute top-[2px] w-[14px] h-[14px] rounded-full transition-all"
                  style={{ backgroundColor: "white", left: isOnline ? "calc(100% - 16px)" : "2px", boxShadow: "0 1px 2px rgba(0,0,0,0.2)" }}
                />
              </div>
            </button>
          </>
        )}
      </nav>

      {/* Bottom — 설정, 도움말 */}
      <div className="px-4 py-2 space-y-0.5 border-t" style={{ borderColor: "var(--color-sidebar-border)" }} onKeyDown={handleKeyDown}>
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

      {/* Status Footer */}
      <div className="px-4 py-3 border-t" style={{ borderColor: "var(--color-sidebar-border)" }}>
        <div className="flex items-center gap-2.5 ts-2xs sidebar-label" style={{ color: "var(--color-sidebar-muted)" }}>
          <span className="flex items-center gap-1.5" title={sidecarError || undefined}>
            <span
              className="w-1.5 h-1.5 rounded-full shrink-0"
              style={{ backgroundColor: sidecarStatus === "ready" ? "var(--color-success)" : sidecarStatus === "error" ? "var(--color-error)" : "var(--color-warning)" }}
            />
            {sidecarStatus === "ready" ? "엔진" : sidecarStatus === "error" ? "오류" : "시작중"}
          </span>
          <span style={{ color: "var(--color-sidebar-border)" }}>·</span>
          <span className="flex items-center gap-1.5">
            <span
              className="w-1.5 h-1.5 rounded-full shrink-0"
              style={{ backgroundColor: apiKeySet ? "var(--color-success)" : "var(--color-warning)" }}
            />
            API {apiKeySet ? "설정됨" : "미설정"}
          </span>
        </div>
        <div
          className="ts-2xs mt-1.5 sidebar-credit"
          style={{ color: "var(--color-sidebar-muted)", cursor: "default", fontSize: "0.65rem", letterSpacing: "0.03em", opacity: 0.5 }}
          title="광진구청 류주임"
        >
          2026 © Chris Ryu.
        </div>
      </div>
    </aside>
  );
});
