/** 왼쪽 탐색 — 제목 + 흐린 한 줄 + 배지. 좁은 창(노트북)에서는 아이콘 + 짧은 이름 */

import { useCallback, type KeyboardEvent } from "react";
import {
  House, Inbox, BookOpenText, FilePen, Layers, MessageSquareText, Settings2,
  PanelLeftClose, PanelLeftOpen, Cpu, Server, Cloud, CircleAlert, Sparkles, Loader2, CheckCircle2, ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import { useApp, type Screen } from "../../state/app";
import { Tooltip } from "../ui/Tooltip";

interface NavDef { id: Screen; title: string; short?: string; desc: string; icon: LucideIcon }

/** 화면 id(data-screen)는 그대로 두고 이름만 업무 말로. 비교는 서무 도구 안의 한 가지 일이라 메뉴에서 빼고 서무 도구 자리에 불을 켠다 */
const MAIN: NavDef[] = [
  { id: "home", title: "오늘", desc: "급한 공문, 최근 문서", icon: House },
  { id: "inbox", title: "접수함", desc: "받은 공문 기한·요청", icon: Inbox },
  { id: "workbench", title: "문서", desc: "연 문서 읽고 고치기", icon: BookOpenText },
  { id: "create", title: "새로 쓰기", desc: "서식·초안·한글로 바꾸기", icon: FilePen },
  { id: "batch", title: "서무 도구", desc: "수합·합본·비교·찾기", icon: Layers },
  { id: "assistant", title: "물어보기", desc: "여러 문서에 묻고 다듬기", icon: MessageSquareText },
];
const LIT: Partial<Record<Screen, Screen>> = { impact: "home", compare: "batch" };
const SETTINGS: NavDef = { id: "settings", title: "설정", desc: "AI 연결, 내 기관 정보", icon: Settings2 };

export function NavRail({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const { screen, go, badges, engine, ai, settings, openSettings } = useApp();

  const onKey = useCallback((e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>("[data-nav]"));
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    e.preventDefault();
    items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
  }, []);

  const item = (m: NavDef) => {
    const Icon = m.icon;
    const badge = badges[m.id];
    const btn = (
      <button key={m.id} type="button" data-nav data-screen={m.id} className="kd-nav-item" aria-current={(LIT[screen] ?? screen) === m.id ? "page" : undefined}
        onClick={() => go(m.id)} aria-label={collapsed ? `${m.title}${badge ? `, ${badge}` : ""}` : undefined}>
        <span className="kd-nav-icon"><Icon size={19} strokeWidth={1.7} /></span>
        {collapsed && <span className="kd-nav-short" aria-hidden="true">{m.short ?? m.title}</span>}
        <span className="kd-nav-text">
          <span className="kd-nav-title">{m.title}</span>
          <span className="kd-nav-desc">{m.desc}</span>
        </span>
        {badge && <span className="kd-nav-badge">{badge}</span>}
      </button>
    );
    return collapsed ? <Tooltip key={m.id} content={`${m.title}: ${m.desc}`} position="right">{btn}</Tooltip> : btn;
  };

  const engineLine = engine.status === "ready"
    ? { tone: "ok", icon: <CheckCircle2 size={13} />, text: "문서 엔진 준비됨", short: "엔진" }
    : engine.status === "error"
      ? { tone: "err", icon: <CircleAlert size={13} />, text: "문서 엔진 멈춤", short: "멈춤" }
      : { tone: "busy", icon: <Loader2 size={13} className="kd-spin" />, text: "문서 엔진 켜는 중", short: "켜는 중" };
  const aiLine = !ai?.configured
    ? { icon: <Sparkles size={13} />, text: "AI 꺼짐 · 켜기", tone: "idle", short: "AI 꺼짐" }
    : ai.is_cloud ? { icon: <Cloud size={13} />, text: ai.provider === "claude-code" || ai.provider === "codex" ? "구독 계정 AI" : "인터넷 AI", tone: "warn", short: "AI" }
    : ai.provider === "embedded" ? { icon: <Cpu size={13} />, text: "내장 AI", tone: "ok", short: "AI" }
    : ai.provider === "local" ? { icon: <Server size={13} />, text: "이 PC의 모델 서버", tone: "ok", short: "AI" }
    : { icon: <Server size={13} />, text: "기관 AI 서버", tone: "ok", short: "AI" };

  return (
    <nav className="kd-nav" data-collapsed={collapsed} aria-label="주 메뉴" onKeyDown={onKey}>
      <div className="kd-nav-brand">
        <img src="/logo.png" alt="" />
        {!collapsed && <strong>KorDoc AI</strong>}
      </div>
      <div className="kd-nav-list">
        {MAIN.map(item)}
        <div className="kd-nav-sep" role="separator" />
        {item(SETTINGS)}
      </div>
      <div className="kd-nav-foot">
        {collapsed ? (
          <>
            <div className="kd-nav-stats">
              <Tooltip content={engine.status === "error" ? `${engineLine.text}: 눌러서 다시 켜기` : engineLine.text} position="right">
                <button type="button" className="kd-nav-stat" data-tone={engineLine.tone} aria-label={engine.status === "error" ? `${engineLine.text}, 눌러서 다시 켜기` : engineLine.text}
                  onClick={engine.status === "error" ? engine.restart : undefined} style={{ cursor: engine.status === "error" ? "pointer" : "default" }}>{engineLine.icon}<span aria-hidden="true">{engineLine.short}</span></button>
              </Tooltip>
              <Tooltip content={`${aiLine.text}: 눌러서 설정 열기`} position="right">
                <button type="button" className="kd-nav-stat" data-tone={aiLine.tone} aria-label={`${aiLine.text}, 설정 열기`} onClick={() => openSettings("set-ai")}>{aiLine.icon}<span aria-hidden="true">{aiLine.short}</span></button>
              </Tooltip>
            </div>
            {settings?.privacy.offline && (
              <Tooltip content="폐쇄망 모드 켜짐: 인터넷으로 나가는 연결을 모두 막습니다" position="right">
                <span className="kd-nav-offline" role="img" aria-label="폐쇄망 모드 켜짐" tabIndex={0}><ShieldCheck size={16} /><span aria-hidden="true">폐쇄망</span></span>
              </Tooltip>
            )}
          </>
        ) : (
          <>
            <button type="button" className="kd-status text-left" data-tone={engineLine.tone} title={engine.error || undefined}
              onClick={engine.status === "error" ? engine.restart : undefined} style={{ cursor: engine.status === "error" ? "pointer" : "default" }}>
              {engineLine.icon}<span>{engineLine.text}{engine.status === "error" ? ": 눌러서 다시 켜기" : ""}</span>
            </button>
            <button type="button" className="kd-status text-left" data-tone={aiLine.tone} onClick={() => openSettings("set-ai")}>
              {aiLine.icon}<span>{aiLine.text}</span>
            </button>
            {settings?.privacy.offline && <span className="kd-status" data-tone="ok"><ShieldCheck size={13} /><span>폐쇄망 모드 켜짐</span></span>}
          </>
        )}
        <Tooltip content={collapsed ? "메뉴 펼치기" : "메뉴 접기"} position="right">
          <button type="button" className="kd-icon-btn mt-1" onClick={onToggle} aria-label={collapsed ? "메뉴 펼치기" : "메뉴 접기"}>
            {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          </button>
        </Tooltip>
      </div>
    </nav>
  );
}
