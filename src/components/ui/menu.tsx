/**
 * 우클릭 메뉴 한 곳에서 띄우기 — 화면 어디서든 showMenu(e, 항목)만 부르면 된다. 메뉴는 창에 하나만 뜬다.
 * guardNativeMenu 는 웹뷰 기본 메뉴(새로 고침·뒤로·인쇄)를 막는다: 새로 고침을 누르면 열어 둔 문서와 하던 일이 날아간다.
 * 글을 쓰는 칸은 기본 메뉴(잘라내기·붙여넣기·맞춤법)를 그대로 두고, 그 밖에서 글을 골라 놓았으면 복사 메뉴를 띄운다.
 */

import { useSyncExternalStore } from "react";
import { Copy } from "lucide-react";
import { ContextMenu, type ContextMenuEntry } from "./ContextMenu";

interface Open { x: number; y: number; items: ContextMenuEntry[]; label?: string; header?: string; keyboard: boolean }

let current: Open | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };

interface MenuEvent { clientX: number; clientY: number; button?: number; preventDefault(): void; stopPropagation(): void }

/** 앞뒤·겹친 구분선을 걷어 낸다 (조건에 따라 항목이 빠지면 구분선만 남는다) */
export function tidyMenu(items: ContextMenuEntry[]): ContextMenuEntry[] {
  const clean: ContextMenuEntry[] = [];
  for (const it of items) {
    if ("type" in it && (!clean.length || "type" in clean[clean.length - 1])) continue;
    clean.push(it);
  }
  while (clean.length && "type" in clean[clean.length - 1]) clean.pop();
  return clean;
}

/** 우클릭(또는 메뉴 키) 자리에 메뉴를 띄운다. 쓸 항목이 없으면 띄우지 않되 기본 메뉴는 막는다 */
export function showMenu(e: MenuEvent, items: ContextMenuEntry[], opts: { label?: string; header?: string } = {}) {
  e.preventDefault();
  e.stopPropagation();
  const clean = tidyMenu(items);
  current = clean.length ? { x: e.clientX, y: e.clientY, items: clean, keyboard: e.button !== 2, ...opts } : null;
  emit();
}

export function closeMenu() {
  if (!current) return;
  current = null;
  emit();
}

/** 창마다 한 번 그린다 (본창·문서 카드 창) */
export function MenuHost() {
  const m = useSyncExternalStore(subscribe, () => current);
  if (!m) return null;
  // 새 메뉴가 뜬 뒤에 앞 메뉴의 닫기가 늦게 불려도 새 메뉴를 닫지 않는다
  return <ContextMenu key={`${m.x}:${m.y}:${m.items.length}`} items={m.items} position={m} label={m.label} header={m.header} keyboard={m.keyboard}
    onClose={() => { if (current === m) closeMenu(); }} />;
}

const TEXT_INPUTS = new Set(["text", "search", "url", "tel", "email", "password", "number"]);

/** 글을 쓸 수 있는 칸인가 — 여기서만 웹뷰 기본 메뉴(잘라내기·붙여넣기)를 둔다.
 *  읽기 전용·잠긴 칸, 체크·날짜 같은 칸은 웹뷰가 글 쓰는 칸으로 보지 않아 "새로 고침·뒤로"가 든 쪽 메뉴를 띄운다 */
function isTypingField(t: Element | null): boolean {
  if (!t) return false;
  if (t instanceof HTMLTextAreaElement) return !t.readOnly && !t.disabled;
  if (t instanceof HTMLInputElement) return !t.readOnly && !t.disabled && TEXT_INPUTS.has(t.type);
  return !!t.closest('[contenteditable=""], [contenteditable="true"]');
}

/** 웹뷰의 새로 고침 키(F5·Ctrl+R) 막기 — 앱을 띄울 때 한 번. 새로 고침이 되면 연 문서·PDF 책상·작업 결과·쓰던 글·도는 요청이 한꺼번에 사라진다 */
export function guardReloadKeys() {
  window.addEventListener("keydown", (e) => {
    const reload = e.key === "F5" || ((e.ctrlKey || e.metaKey) && !e.altKey && e.code === "KeyR");
    // 개발 중에는 Ctrl+Shift+R 로 새로 고친다
    if (reload && !(import.meta.env.DEV && e.shiftKey)) e.preventDefault();
  }, true);
}

/** 웹뷰 기본 메뉴 막기 — 앱을 띄울 때 한 번 */
export function guardNativeMenu() {
  window.addEventListener("contextmenu", (e) => {
    // 화면이 제 메뉴를 띄웠다
    if (e.defaultPrevented) return;
    const t = e.target instanceof Element ? e.target : null;
    if (isTypingField(t)) return;
    // 개발 중에는 Shift+우클릭으로 기본 메뉴(검사)를 쓴다
    if (import.meta.env.DEV && e.shiftKey) return;
    const copy = (s: string) => () => void navigator.clipboard.writeText(s).catch(() => undefined);
    // 읽기만 하는 글 칸(만들어 준 독촉 글 등)은 칸 안에서 고른 글을, 고른 것이 없으면 칸 전체를 복사하게 한다
    const box = t instanceof HTMLTextAreaElement || (t instanceof HTMLInputElement && TEXT_INPUTS.has(t.type)) ? t : null;
    const text = (box ? box.value.slice(box.selectionStart ?? 0, box.selectionEnd ?? 0) : "") || (window.getSelection()?.toString() ?? "");
    if (text.trim()) {
      showMenu(e, [{ label: "복사", icon: <Copy size={14} />, shortcut: "Ctrl+C", onClick: copy(text) }], { label: "고른 글 메뉴" });
    } else if (box?.readOnly && box.value.trim()) {
      showMenu(e, [{ label: "모두 복사", icon: <Copy size={14} />, onClick: copy(box.value) }], { label: "글 칸 메뉴" });
    } else {
      e.preventDefault();
    }
  });
}
