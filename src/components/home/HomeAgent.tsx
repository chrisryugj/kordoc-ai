/**
 * 홈 맨 위 — "무엇을 할까요?" 에 바로 답하는 자리. 문서를 홈 어디에 놓아도 여기 붙고, 말로 시키면 이 자리에서 진행·결과가 보인다.
 * 예제 문장은 앱에 든 합성 예제(가상의 가온시)를 함께 붙여 처음 쓰는 사람도 한 번 눌러 해 볼 수 있다.
 */

import { useEffect, useRef, useState } from "react";
import { BookOpenText, MessageSquarePlus } from "lucide-react";
import { useApp } from "../../state/app";
import { rpc } from "../../lib/rpc";
import type { RpcResult } from "../../lib/contract";
import { useWorkAgent } from "../../hooks/useWorkAgent";
import { AgentComposer, type Suggestion } from "../agent/AgentComposer";
import { AgentRun } from "../agent/AgentRun";
import { Button } from "../ui/Button";

type Samples = RpcResult<"samples_list">;

/** 예제 시나리오 → 시켜 볼 문장 (예제 파일을 함께 붙인다) */
function sampleSuggestions(s: Samples | null): Suggestion[] {
  if (!s) return [];
  const by = (id: string) => s.scenarios.find((x) => x.id === id)?.files ?? [];
  const hwpx = (f: string[]) => f.filter((p) => /\.hwpx$/i.test(p));
  const out: Suggestion[] = [];
  if (by("reply").length) out.push({ label: "받은 공문에 회신 쓰기", text: "붙인 받은 공문에 회신하는 기안문을 만들어 줘. 우리 기관은 선수 20명이 참가해.", files: hwpx(by("reply")).slice(0, 1) });
  if (by("collect").length) out.push({ label: "부서 제출물 모으기", text: "붙인 부서 제출물을 엑셀 한 장으로 모으고, 안 낸 부서가 있으면 독촉 글도 써 줘. 부서 명단은 총무과, 기획예산과, 민원봉사과, 복지정책과, 도시계획과, 감사과야.", files: by("collect") });
  if (by("versions").length) out.push({ label: "진짜 최종본 찾기", text: "붙인 교육계획 문서의 진짜 최종본을 찾고, 바로 앞 판과 무엇이 바뀌었는지 알려 줘", files: by("versions").slice(0, 1) });
  if (by("redact").length) out.push({ label: "개인정보 가리고 PDF 로", text: "붙인 문서의 개인정보를 가리고 PDF 로도 만들어 줘", files: by("redact").slice(0, 1) });
  if (by("summary").length) out.push({ label: "결재 전 점검", text: "붙인 보고서를 결재 전 점검하고, 고칠 수 있는 건 고쳐 줘", files: hwpx(by("summary")).slice(0, 1) });
  return out;
}

export function HomeAgent() {
  const { ready, openDocs, workIntent } = useApp();
  const [paths, setPaths] = useState<string[]>([]);
  const [samples, setSamples] = useState<Samples | null>(null);
  const agent = useWorkAgent(paths);
  const handled = useRef(0);

  // 문서 화면의 "AI 에게 시키기": 그 문서를 붙여 두고 입력창으로
  useEffect(() => {
    if (!workIntent || workIntent.nonce === handled.current) return;
    handled.current = workIntent.nonce;
    setPaths((cur) => [...new Set([...cur, ...workIntent.value.paths])]);
    requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>(".kd-home-ask .kd-ask-input")?.focus());
  }, [workIntent]);

  useEffect(() => {
    if (ready) void rpc("samples_list", {}).then(setSamples, () => setSamples(null));
  }, [ready]);

  return (
    <section className="kd-home-ask" aria-labelledby="home-ask-t">
      <div className="kd-home-top">
        <h1 id="home-ask-t" className="kd-home-title">무엇을 할까요?</h1>
        <p className="kd-head-sub">문서를 놓고 하고 싶은 일을 적으면 KorDoc AI 가 알아서 읽고, 만들고, 점검합니다. 원본은 건드리지 않습니다.</p>
      </div>
      <AgentComposer
        paths={paths}
        onPaths={setPaths}
        onSend={(t) => void agent.send(t)}
        onStop={agent.stop}
        busy={agent.busy}
        dropName="home"
        suggestions={agent.turns.length ? [] : sampleSuggestions(samples)}
        extra={<Button size="sm" variant="ghost" onClick={() => openDocs(paths)}><BookOpenText size={14} /> 문서 화면에서 보기</Button>}
      />
      {agent.turns.length > 0 && (
        <div className="flex flex-col gap-3">
          <AgentRun turns={agent.turns} onSend={(t) => void agent.send(t)} busy={agent.busy} />
          {!agent.busy && <div><Button size="sm" variant="ghost" onClick={() => { agent.reset(); setPaths([]); }}><MessageSquarePlus size={13} /> 새로 시키기</Button></div>}
        </div>
      )}
    </section>
  );
}
