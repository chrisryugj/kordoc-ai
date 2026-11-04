/** 설정 목차와 구획 머리의 번호 — 쉬운 화면은 숨긴 구획(adv)을 빼고 보이는 것만 가·나·다로 다시 매긴다 */

import { useApp } from "../../state/app";

export const INDEX = [
  { id: "set-org", title: "내 기관 정보" },
  { id: "set-orgdocs", title: "우리 기관 문서 모음", adv: true },
  { id: "set-ai", title: "AI 연결" },
  { id: "set-sec", title: "보안" },
  { id: "set-engine", title: "엔진과 모델", adv: true },
  { id: "set-store", title: "저장과 연결", adv: true },
  { id: "set-about", title: "화면과 정보" },
  { id: "set-law", title: "법령 확인", adv: true },
];

const LETTERS = ["가", "나", "다", "라", "마", "바", "사", "아"];

export function sectionMark(id: string, easy: boolean): string {
  const i = (easy ? INDEX.filter((s) => !s.adv) : INDEX).findIndex((s) => s.id === id);
  return i < 0 ? "" : `${LETTERS[i]}.`;
}

export function useSectionMark(id: string): string {
  return sectionMark(id, useApp().uiMode === "easy");
}
