import { memo, useCallback } from "react";
import { FileText, Settings, HelpCircle, Wifi, WifiOff, ChevronsLeft, ChevronsRight } from "lucide-react";
import { Tooltip } from "../ui/Tooltip";
import type { NavItem } from "../../types/nav";

interface SidebarProps {
  active: NavItem;
  onNavigate: (item: NavItem) => void;
  sidecarStatus: string;
  sidecarError?: string;
  apiKeySet?: boolean;
  aiMode?: string;
  onToggleMode?: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

const navItems: { id: NavItem; label: string; icon: React.ReactNode; description: string }[] = [
  { id: "pipeline", label: "문서 작업", icon: <FileText size={18} />, description: "변환 · 추출 · 비교 · AI 분석" },
];

const bottomItems: { id: NavItem; label: string; icon: React.ReactNode }[] = [
  { id: "settings", label: "설정", icon: <Settings size={18} /> },
  { id: "help", label: "도움말", icon: <HelpCircle size={18} /> },
];

const ALL_NAV_IDS: NavItem[] = [...navItems.map((i) => i.id), ...bottomItems.map((i) => i.id)];

export const Sidebar = memo(function Sidebar({ active, onNavigate, sidecarStatus, sidecarError, apiKeySet, aiMode, onToggleMode, collapsed, onToggleCollapse }: SidebarProps) {
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
      className={`h-full flex flex-col shrink-0 select-none sidebar-root${collapsed ? " sidebar-collapsed" : ""}`}
      style={{ backgroundColor: "var(--color-sidebar-bg)", borderRight: "1px solid var(--color-border)", transition: "width 0.2s ease" }}
    >
      {/* Logo */}
      <div className={`sidebar-header flex items-center gap-2${collapsed ? " justify-center px-2" : " px-4"}`} style={{ borderBottom: "1px solid var(--color-sidebar-border)" }}>
        <img src="/logo.png" alt="KorDoc AI" className="w-8 h-8 rounded-lg shrink-0 object-cover" />
        {!collapsed && (
          <div style={{ lineHeight: 1.2 }} className="min-w-0">
            <h1 className="font-bold text-display truncate" style={{ color: "var(--color-sidebar-text)", letterSpacing: "-0.02em", fontSize: "1.0625rem", margin: 0 }}>
              KorDoc AI
            </h1>
            <span className="truncate" style={{ color: "var(--color-sidebar-muted)", fontSize: "0.75rem", display: "block", marginTop: "1px" }}>다 파싱해버리겠다.</span>
          </div>
        )}
      </div>

      {/* Nav — 도구 + AI 모드 */}
      <nav className={`flex-1 pt-4 space-y-0.5${collapsed ? " px-1.5" : " px-4"}`} onKeyDown={handleKeyDown}>
        {!collapsed && (
          <div className="ts-2xs font-semibold uppercase tracking-wider pb-2" style={{ color: "var(--color-sidebar-section)" }}>
            도구
          </div>
        )}
        {navItems.map((item) => (
          <Tooltip key={item.id} content={item.label} position="right" disabled={!collapsed}>
          <button
            onClick={() => onNavigate(item.id)}
            aria-current={active === item.id ? "page" : undefined}
            className={`w-full flex items-center gap-3 py-2 rounded-md transition-colors ${active !== item.id ? "hover-sidebar-item" : ""}${collapsed ? " justify-center px-0" : " px-3 text-left"}`}
            style={{
              backgroundColor: active === item.id ? "var(--color-sidebar-active)" : "transparent",
              color: active === item.id ? "var(--color-accent)" : "var(--color-sidebar-text)",
            }}
          >
            {item.icon}
            {!collapsed && (
              <div className="min-w-0">
                <div className="ts-sm font-medium truncate">{item.label}</div>
                <div className="ts-2xs truncate" style={{ color: "var(--color-sidebar-muted)" }}>{item.description}</div>
              </div>
            )}
          </button>
          </Tooltip>
        ))}

        {/* AI 모드 토글 */}
        {onToggleMode && (
          <>
            {!collapsed && (
              <div className="ts-2xs font-semibold uppercase tracking-wider pt-5 pb-2" style={{ color: "var(--color-sidebar-section)" }}>
                AI 모드
              </div>
            )}
            <Tooltip content={isOnline ? "오프라인(로컬 전용)으로 전환" : "온라인(Gemini API)으로 전환"} position="right">
            <button
              onClick={onToggleMode}
              className={`w-full flex items-center gap-3 py-2 rounded-md transition-colors hover-sidebar-item${collapsed ? " justify-center px-0 mt-3" : " px-3 text-left"}`}
              style={{ color: "var(--color-sidebar-text)" }}
            >
              {isOnline
                ? <Wifi size={18} style={{ color: "var(--color-success)" }} />
                : <WifiOff size={18} style={{ color: "var(--color-text-muted)" }} />
              }
              {!collapsed && (
                <>
                  <div className="flex-1 min-w-0">
                    <div className="ts-sm font-medium">{isOnline ? "온라인" : "오프라인"}</div>
                    <div className="ts-2xs truncate" style={{ color: "var(--color-sidebar-muted)" }}>
                      {isOnline ? "Gemini API 사용" : "로컬 변환만"}
                    </div>
                  </div>
                  <div
                    className="w-8 h-[18px] rounded-full relative shrink-0 transition-colors"
                    style={{ backgroundColor: isOnline ? "var(--color-success)" : "var(--color-bg-subtle)" }}
                  >
                    <div
                      className="absolute top-[2px] w-[14px] h-[14px] rounded-full transition-all"
                      style={{ backgroundColor: "white", left: isOnline ? "calc(100% - 16px)" : "2px", boxShadow: "0 1px 2px rgba(0,0,0,0.2)" }}
                    />
                  </div>
                </>
              )}
            </button>
            </Tooltip>
          </>
        )}
      </nav>

      {/* Collapse toggle */}
      {onToggleCollapse && (
        <div className={`py-1 border-t${collapsed ? " px-1.5" : " px-4"}`} style={{ borderColor: "var(--color-sidebar-border)" }}>
          <button
            onClick={onToggleCollapse}
            className={`w-full flex items-center gap-3 py-1.5 rounded-md transition-colors hover-sidebar-item${collapsed ? " justify-center px-0" : " px-3"}`}
            style={{ color: "var(--color-sidebar-muted)" }}
            title={collapsed ? "사이드바 펼치기" : "사이드바 접기"}
          >
            {collapsed ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
            {!collapsed && <span className="ts-2xs">접기</span>}
          </button>
        </div>
      )}

      {/* Bottom — 설정, 도움말 */}
      <div className={`py-2 space-y-0.5 border-t${collapsed ? " px-1.5" : " px-4"}`} style={{ borderColor: "var(--color-sidebar-border)" }} onKeyDown={handleKeyDown}>
        {bottomItems.map((item) => (
          <Tooltip key={item.id} content={item.label} position="right" disabled={!collapsed}>
          <button
            onClick={() => onNavigate(item.id)}
            className={`w-full flex items-center gap-3 py-1.5 rounded-md transition-colors ${active !== item.id ? "hover-sidebar-item" : ""}${collapsed ? " justify-center px-0" : " px-3 text-left"}`}
            style={{
              backgroundColor: active === item.id ? "var(--color-sidebar-active)" : "transparent",
              color: active === item.id ? "var(--color-accent)" : "var(--color-sidebar-muted)",
            }}
          >
            {item.icon}
            {!collapsed && <span className="ts-sm">{item.label}</span>}
          </button>
          </Tooltip>
        ))}
      </div>

      {/* Status Footer */}
      <div className={`py-3 border-t${collapsed ? " px-1.5" : " px-4"}`} style={{ borderColor: "var(--color-sidebar-border)" }}>
        {collapsed ? (
          <Tooltip content={`엔진: ${sidecarStatus === "ready" ? "정상" : sidecarStatus} · API: ${apiKeySet ? "설정됨" : "미설정"}`} position="right">
            <div className="flex flex-col items-center gap-1.5">
              <span
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: sidecarStatus === "ready" ? "var(--color-success)" : sidecarStatus === "error" ? "var(--color-error)" : "var(--color-warning)" }}
              />
              <span
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: apiKeySet ? "var(--color-success)" : "var(--color-warning)" }}
              />
            </div>
          </Tooltip>
        ) : (
          <>
            <div className="flex items-center gap-2.5 ts-2xs" style={{ color: "var(--color-sidebar-muted)" }}>
              <Tooltip content={sidecarError || (sidecarStatus === "ready" ? "Node.js 문서 처리 엔진 정상" : "엔진 초기화 중...")} position="top">
              <span className="flex items-center gap-1.5">
                <span
                  className="w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ backgroundColor: sidecarStatus === "ready" ? "var(--color-success)" : sidecarStatus === "error" ? "var(--color-error)" : "var(--color-warning)" }}
                />
                {sidecarStatus === "ready" ? "엔진" : sidecarStatus === "error" ? "오류" : "시작중"}
              </span>
              </Tooltip>
              <span style={{ color: "var(--color-sidebar-border)" }}>·</span>
              <span className="flex items-center gap-1.5">
                <span
                  className="w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ backgroundColor: apiKeySet ? "var(--color-success)" : "var(--color-warning)" }}
                />
                API {apiKeySet ? "설정됨" : "미설정"}
              </span>
            </div>
            <Tooltip content="Chris Ryu" position="top">
            <div
              className="ts-2xs mt-1.5"
              style={{ color: "var(--color-sidebar-muted)", cursor: "default", fontSize: "0.65rem", letterSpacing: "0.03em", opacity: 0.5 }}
            >
              2026 © Chris Ryu.
            </div>
            </Tooltip>
          </>
        )}
      </div>
    </aside>
  );
});
