/**
 * 서식대로 새로 쓰기 — 서식함의 견본·표 빈칸 서식에서, 지시 한 줄과 참고 문서로 AI 가 내용을 채운 문서를 만든다.
 * 서식(표·상자·글꼴·항목 부호)은 견본 그대로, 내용만 새로 (ai_template_write). 공문서 게이트 지적은 열기 전에 보여 준다.
 */

import { useState } from "react";
import { FileUp, Sparkles, X } from "lucide-react";
import type { RpcResult } from "../../lib/contract";
import { useApp } from "../../state/app";
import { rpc } from "../../lib/rpc";
import { pickFiles } from "../../lib/native";
import { baseName, stem } from "../../lib/format";
import { useTask } from "../../hooks/useTask";
import { Button } from "../ui/Button";
import { ErrorLine, Note, Working } from "../common/Status";
import { useCreate, workingFile } from "./session";

const AXIS_HINT: Record<string, string> = {
  구성: "장 사이 논리(왜 → 무엇을 → 어떻게)",
  윤문: "AI 문체·상투어",
  표기법: "공문서 표기",
  문체: "개조식 끝맺음",
};

export function TemplateWrite({ path, name }: { path: string; name: string }) {
  const { ai } = useApp();
  const { openInEditor } = useCreate();
  const [instruction, setInstruction] = useState("");
  const [refs, setRefs] = useState<string[]>([]);
  const write = useTask<RpcResult<"ai_template_write">>();
  const open = useTask<void>();

  if (!ai?.configured) return <Note tone="info">AI 연결을 고르면 이 서식대로 내용을 채운 문서를 AI 가 써 줍니다. 설정의 AI 연결에서 고르세요.</Note>;

  const run = () => void write.run(async ({ signal, onProgress }) => rpc("ai_template_write", {
    path,
    instruction: instruction.trim(),
    references: refs,
    output_path: await workingFile(`${stem(name)}_새로쓰기.hwpx`),
  }, { signal, onProgress }));
  const r = write.result;
  const title = instruction.trim().split("\n")[0].slice(0, 40) || name;

  return (
    <div className="kd-inset flex flex-col gap-2.5 p-3">
      <span className="kd-label">AI로 이 서식대로 쓰기</span>
      <p className="kd-small kd-muted">표·상자·글꼴·항목 부호는 이 서식 그대로 두고, 내용만 지시와 참고 문서대로 새로 씁니다. 모르는 숫자·이름은 ○○로 남깁니다. 로고 같은 그림은 견본 그대로 남으니 편집기에서 바꾸세요.</p>
      <textarea className="kd-textarea" rows={3} value={instruction} onChange={(e) => setInstruction(e.target.value)}
        placeholder="무슨 문서인가요? 예: 경로당 냉방기 교체 계획 보고, 민원 14건·예산은 참고 문서대로" aria-label="쓸 문서 지시" />
      {refs.length > 0 && (
        <ul className="flex flex-col gap-1">
          {refs.map((x) => (
            <li key={x} className="flex items-center gap-2 kd-small">
              <span className="kd-path flex-1">{baseName(x)}</span>
              <button type="button" className="kd-icon-btn" style={{ width: 24, height: 24 }} onClick={() => setRefs(refs.filter((y) => y !== x))} aria-label={`${baseName(x)} 빼기`}><X size={12} /></button>
            </li>
          ))}
        </ul>
      )}
      {write.busy ? <Working label="서식대로 쓰는 중" progress={write.progress} onCancel={write.cancel} /> : (
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" size="sm" onClick={() => void pickFiles().then((p) => setRefs([...new Set([...refs, ...p])]))}><FileUp size={13} /> 참고 문서 붙이기</Button>
          <Button size="sm" onClick={run} disabled={!instruction.trim() && !refs.length}><Sparkles size={13} /> 이 서식대로 쓰기</Button>
        </div>
      )}
      <ErrorLine message={write.error} />

      {r && !write.busy && (
        <div className="flex flex-col gap-2">
          <Note tone={r.findings.length || r.skipped.length ? "warn" : "ok"}>
            {r.applied}곳을 새로 썼습니다{r.converted ? " (HWP 서식이라 HWPX 로 만들었습니다)" : ""}.
            {r.findings.length ? ` 결재 전에 살필 것 ${r.findings.length}건이 있습니다.` : " 공문서 게이트를 통과했습니다."}
            {r.redacted ? ` 인터넷 AI 로 보내기 전 개인정보 ${r.redacted}건을 가렸습니다.` : ""}
          </Note>
          {r.findings.length > 0 && (
            <ul className="flex flex-col gap-1.5" aria-label="살필 것">
              {r.findings.map((f, i) => (
                <li key={`${f.rule}-${f.line}-${i}`} className="kd-small">
                  <span className="kd-badge" data-tone={f.severity === "error" ? "warn" : "info"}>{f.axis}</span>{" "}
                  {f.message}{f.suggest ? ` (${f.suggest})` : ""}
                  {f.match ? <span className="kd-muted"> · "{f.match.slice(0, 40)}"</span> : null}
                  <span className="kd-muted"> · {AXIS_HINT[f.axis] ?? ""}</span>
                </li>
              ))}
            </ul>
          )}
          {r.skipped.length > 0 && (
            <details className="kd-small">
              <summary>서식에 넣지 못한 곳 {r.skipped.length}건 (편집기에서 직접 고치세요)</summary>
              <ul className="flex flex-col gap-1 mt-1">{r.skipped.map((s, i) => <li key={i} className="kd-muted">{s}</li>)}</ul>
            </details>
          )}
          <div>
            <Button size="lg" disabled={open.busy} onClick={() => void open.run(() => openInEditor(r.output_path, { title, working: true }))}>편집기에서 열기</Button>
          </div>
          <ErrorLine message={open.error} />
        </div>
      )}
    </div>
  );
}
