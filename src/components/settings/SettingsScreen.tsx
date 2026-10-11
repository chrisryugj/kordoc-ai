/** 설정 — 내 기관 정보 · AI 연결 · 보안 · 엔진과 모델 · 저장과 연결 · 화면과 정보 */

import { useEffect, useRef, useState } from "react";
import { useApp } from "../../state/app";
import { ScreenHeader } from "../shell/ScreenHeader";
import { Button } from "../ui/Button";
import { Note } from "../common/Status";
import { OrgSection } from "./OrgSection";
import { AiSection } from "./AiSection";
import { SecuritySection } from "./SecuritySection";
import { EngineSection, StorageSection, AboutSection } from "./SystemSections";
import { LawSection } from "./LawSection";

const INDEX = [
  { id: "set-org", mark: "가.", title: "내 기관 정보" },
  { id: "set-ai", mark: "나.", title: "AI 연결" },
  { id: "set-sec", mark: "다.", title: "보안" },
  { id: "set-engine", mark: "라.", title: "엔진과 모델" },
  { id: "set-store", mark: "마.", title: "저장과 연결" },
  { id: "set-about", mark: "바.", title: "화면과 정보" },
  { id: "set-law", mark: "사.", title: "법령 확인" },
];

export function SettingsScreen({ active }: { active: boolean }) {
  const { settings, ready, engine } = useApp();
  const [current, setCurrent] = useState(INDEX[0].id);
  const scrollRef = useRef<HTMLDivElement>(null);
  // 목차로 옮겨 가는 동안은 누른 구획 표시를 지킨다 (지나가는 구획으로 바뀌지 않게)
  const jumping = useRef(false);

  // 지금 보고 있는 구획 표시
  useEffect(() => {
    const root = scrollRef.current;
    if (!root || !active) return;
    const onScroll = () => {
      if (jumping.current) return;
      const top = root.getBoundingClientRect().top + 90;
      let cur = INDEX[0].id;
      for (const s of INDEX) {
        const el = document.getElementById(s.id);
        if (el && el.getBoundingClientRect().top <= top) cur = s.id;
      }
      setCurrent(cur);
    };
    root.addEventListener("scroll", onScroll, { passive: true });
    return () => root.removeEventListener("scroll", onScroll);
  }, [active, settings]);

  const goTo = (id: string) => {
    const el = document.getElementById(id);
    const root = scrollRef.current;
    if (!el || !root) return;
    setCurrent(id);
    jumping.current = true;
    const gap = () => el.getBoundingClientRect().top - root.getBoundingClientRect().top - 12;
    root.scrollTo({ top: root.scrollTop + gap(), behavior: "smooth" });
    // 움직이는 사이 위 구획 높이가 바뀌었으면(불러오기 등) 끝난 뒤 한 번 더 맞춘다
    let ended = false;
    const end = () => {
      if (ended) return;
      ended = true;
      if (Math.abs(gap()) > 4) root.scrollTo({ top: root.scrollTop + gap() });
      requestAnimationFrame(() => { jumping.current = false; });
    };
    root.addEventListener("scrollend", end, { once: true });
    setTimeout(end, 1000);
  };

  return (
    <div className="kd-screen" hidden={!active}>
      <ScreenHeader title="설정" sub="AI를 어디서 돌릴지, 내 기관 정보, 보안 상태를 한곳에서 정합니다." />
      <div className="kd-settings">
        <nav className="kd-settings-index" aria-label="설정 목차">
          {INDEX.map((s) => (
            <button key={s.id} type="button" className="kd-index-item" aria-current={current === s.id ? "true" : undefined} onClick={() => goTo(s.id)}>
              <span className="kd-section-mark">{s.mark}</span> {s.title}
            </button>
          ))}
        </nav>
        <div className="kd-settings-scroll" ref={scrollRef}>
          <div className="kd-settings-body">
            {!ready && (engine.status === "error" ? (
              <Note tone="err">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  {/* 엔진 오류 문장이 이미 "문서 엔진…"으로 시작하면 앞머리를 또 붙이지 않는다 */}
                  <span>{engine.error.startsWith("문서 엔진") ? engine.error : `문서 엔진이 멈췄습니다${engine.error ? `: ${engine.error}` : "."}`}</span>
                  <Button size="sm" variant="secondary" onClick={engine.restart}>다시 켜기</Button>
                </div>
              </Note>
            ) : <Note tone="info">문서 엔진을 켜는 중입니다. 잠시 뒤 설정을 읽어 옵니다.</Note>)}
            {settings?.policy && (
              <Note tone={settings.policy.error ? "warn" : "info"}>
                {settings.policy.error
                  ? `기관 배포 설정 파일을 읽지 못했습니다: ${settings.policy.error}.`
                  : `기관 배포 설정이 적용됐습니다${settings.policy.notice ? `: ${settings.policy.notice}` : "."}`}
                <span className="kd-path block">{settings.policy.source}</span>
              </Note>
            )}
            {settings && (
              <>
                <OrgSection />
                <AiSection />
                <SecuritySection active={active} />
                <EngineSection />
                <StorageSection />
                <AboutSection />
                <LawSection />
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
