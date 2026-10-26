/** 설정 — 내 기관 정보 · 우리 기관 문서 모음 · AI 연결 · 보안 · 엔진과 모델 · 저장과 연결 · 화면과 정보 · 법령 확인.
 *  저장 버튼이 있는 구획은 고친 채 두면 목차와 제목에 "저장 안 함"을 띄우고, 설정을 떠날 때 묻는다 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useApp, type Screen } from "../../state/app";
import { ScreenHeader } from "../shell/ScreenHeader";
import { Button } from "../ui/Button";
import { Note } from "../common/Status";
import { OrgSection } from "./OrgSection";
import { OrgDocsSection } from "./OrgDocsSection";
import { AiSection } from "./AiSection";
import { SecuritySection } from "./SecuritySection";
import { EngineSection, StorageSection, AboutSection } from "./SystemSections";
import { LawSection } from "./LawSection";
import { Modal } from "../ui/Modal";
import { DirtyContext, type DirtyEntry } from "./dirty";

const INDEX = [
  { id: "set-org", mark: "가.", title: "내 기관 정보" },
  { id: "set-orgdocs", mark: "나.", title: "우리 기관 문서 모음" },
  { id: "set-ai", mark: "다.", title: "AI 연결" },
  { id: "set-sec", mark: "라.", title: "보안" },
  { id: "set-engine", mark: "마.", title: "엔진과 모델" },
  { id: "set-store", mark: "바.", title: "저장과 연결" },
  { id: "set-about", mark: "사.", title: "화면과 정보" },
  { id: "set-law", mark: "아.", title: "법령 확인" },
];

export function SettingsScreen({ active }: { active: boolean }) {
  const { settings, ready, engine, go, setLeaveGuard, settingsIntent } = useApp();
  const [current, setCurrent] = useState(INDEX[0].id);
  // 저장 안 한 구획 (구획 id → 이름·저장·되돌리기)
  const [dirty, setDirty] = useState<Record<string, DirtyEntry>>({});
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const [leaving, setLeaving] = useState<Screen | null>(null);
  const [savingAll, setSavingAll] = useState(false);
  const markDirty = useCallback((id: string, e: DirtyEntry | null) => {
    setDirty((prev) => {
      if (!e && !(id in prev)) return prev;
      const next = { ...prev };
      if (e) next[id] = e; else delete next[id];
      return next;
    });
  }, []);

  // 설정을 떠나려는데 저장 안 한 구획이 있으면 멈추고 묻는다
  useEffect(() => {
    if (!active) return;
    setLeaveGuard((next) => {
      if (next === "settings" || !Object.keys(dirtyRef.current).length) return true;
      setLeaving(next);
      return false;
    });
    return () => setLeaveGuard(null);
  }, [active, setLeaveGuard]);

  const leave = async (save: boolean) => {
    const target = leaving;
    if (!target) return;
    const entries = Object.values(dirtyRef.current);
    if (save) {
      setSavingAll(true);
      const ok = (await Promise.all(entries.map((e) => e.save()))).every(Boolean);
      setSavingAll(false);
      if (!ok) { setLeaving(null); return; } // 저장 실패 안내는 구획이 띄운다. 머물러 고치게
    } else entries.forEach((e) => e.reset());
    setLeaving(null);
    setLeaveGuard(null);
    go(target);
  };
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

  // 다른 곳(첫 실행 마법사·AI 안내)에서 구획을 집어 들어오면 그리로
  useEffect(() => {
    if (!settingsIntent || !active || !settings) return;
    requestAnimationFrame(() => goTo(settingsIntent.value));
    // 요청마다 한 번
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsIntent, active, !!settings]);

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
              {dirty[s.id] && <span className="kd-index-dirty" role="img" aria-label="저장 안 함" title="저장하지 않은 변경이 있습니다" />}
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
              <DirtyContext.Provider value={markDirty}>
                <OrgSection />
                <OrgDocsSection />
                <AiSection />
                <SecuritySection active={active} />
                <EngineSection />
                <StorageSection />
                <AboutSection />
                <LawSection />
              </DirtyContext.Provider>
            )}
          </div>
        </div>
      </div>
      <Modal isOpen={!!leaving} onClose={() => setLeaving(null)} title="저장하지 않은 설정이 있습니다" size="sm" closable={!savingAll}
        footer={(
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={() => setLeaving(null)} disabled={savingAll}>계속 고치기</Button>
            <Button variant="secondary" onClick={() => void leave(false)} disabled={savingAll}>저장하지 않고 나가기</Button>
            <Button onClick={() => void leave(true)} disabled={savingAll}>{savingAll ? "저장하는 중" : "저장하고 나가기"}</Button>
          </div>
        )}>
        <p className="kd-text">고친 내용을 아직 저장하지 않았습니다.</p>
        <ul className="kd-small kd-muted mt-2 list-disc pl-5">
          {Object.values(dirty).map((e) => <li key={e.title}>{e.title}</li>)}
        </ul>
      </Modal>
    </div>
  );
}
