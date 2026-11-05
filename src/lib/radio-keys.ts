/**
 * 고르기 묶음(role=radiogroup)의 화살표 키 — 앱 전체에 한 번 건다.
 * 단추로 만든 고르기(AI 연결 칸·저장한 서식·화면 방식 등)도 표준 라디오처럼 ←→↑↓ 로 옆 칸에 초점을 옮기고 고른다.
 */
export function installRadioKeys(): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (!["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"].includes(e.key) || e.altKey || e.ctrlKey || e.metaKey) return;
    const cur = (e.target as HTMLElement | null)?.closest?.<HTMLElement>("[role=radio]");
    const group = cur?.closest<HTMLElement>("[role=radiogroup]");
    if (!cur || !group) return;
    const radios = [...group.querySelectorAll<HTMLElement>("[role=radio]")].filter((r) => r.closest("[role=radiogroup]") === group && !(r as HTMLButtonElement).disabled && r.getAttribute("aria-disabled") !== "true");
    const i = radios.indexOf(cur);
    if (i < 0 || radios.length < 2) return;
    e.preventDefault();
    const next = radios[(i + (e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : -1) + radios.length) % radios.length];
    next.focus();
    next.click();
  };
  document.addEventListener("keydown", onKey);
  return () => document.removeEventListener("keydown", onKey);
}
