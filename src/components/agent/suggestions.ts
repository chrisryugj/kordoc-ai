/** 처음 쓰는 사람이 한 번 눌러 해 볼 문장 — 앱에 든 합성 예제(가상의 가온시)를 함께 붙인다 */

import type { RpcResult } from "../../lib/contract";
import type { Suggestion } from "./AgentComposer";

export type Samples = RpcResult<"samples_list">;

export function sampleSuggestions(s: Samples | null): Suggestion[] {
  if (!s) return [];
  const by = (id: string) => s.scenarios.find((x) => x.id === id)?.files ?? [];
  const hwpx = (f: string[]) => f.filter((p) => /\.hwpx$/i.test(p));
  const out: Suggestion[] = [];
  if (by("reply").length) out.push({ label: "받은 공문에 회신 쓰기", text: "붙인 받은 공문에 회신하는 기안문을 만들어 줘. 우리 기관은 선수 20명이 참가해.", files: hwpx(by("reply")).slice(0, 1) });
  if (by("collect").length) out.push({ label: "부서 제출물 모으기", text: "붙인 부서 제출물을 엑셀 한 장으로 모으고, 안 낸 부서가 있으면 독촉 글도 써 줘. 부서 명단은 총무과, 기획예산과, 민원봉사과, 복지정책과, 도시계획과, 감사과야.", files: by("collect") });
  if (by("versions").length) out.push({ label: "진짜 최종본 찾기", text: "붙인 교육계획 문서의 진짜 최종본을 찾고, 바로 앞 판과 무엇이 바뀌었는지 알려 줘", files: by("versions").slice(0, 1) });
  if (by("redact").length) out.push({ label: "개인정보 가리고 PDF로", text: "붙인 문서의 개인정보를 가리고 PDF로도 만들어 줘", files: by("redact").slice(0, 1) });
  if (by("summary").length) out.push({ label: "결재 전 점검", text: "붙인 보고서를 결재 전 점검하고, 고칠 수 있는 건 고쳐 줘", files: hwpx(by("summary")).slice(0, 1) });
  return out;
}
