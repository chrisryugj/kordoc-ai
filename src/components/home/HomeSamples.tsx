/** 예제로 해 보기 — 서무 업무 시연 흐름을 예제 문서 묶음(samples_list)으로 한 번에 */

import { useEffect, useState } from "react";
import { FlaskConical } from "lucide-react";
import { useApp } from "../../state/app";
import { rpc } from "../../lib/rpc";
import type { RpcResult } from "../../lib/contract";
import { Button } from "../ui/Button";

type Samples = RpcResult<"samples_list">;
type Scenario = Samples["scenarios"][number];

const MARK: Record<Scenario["id"], string> = { reply: "①", collect: "②", redact: "③", summary: "④" };

export function HomeSamples() {
  const { ready, startCreate, startBatch, openDocs, toast } = useApp();
  const [samples, setSamples] = useState<Samples | null>(null);

  useEffect(() => {
    if (!ready) return;
    rpc("samples_list", {}).then(setSamples).catch(() => setSamples(null));
  }, [ready]);

  const start = (s: Scenario) => {
    if (!s.files.length) { toast("예제 파일을 찾지 못했습니다. 앱을 다시 설치해 보세요.", "error"); return; }
    if (s.id === "reply") startCreate({ route: "ai", kind: "reply", references: [s.files[0]] });
    else if (s.id === "collect") startBatch({ paths: s.files, task: "collect" });
    else if (s.id === "redact") openDocs([s.files[0]], { tool: "redact", run: "redact" });
    else openDocs([s.files[0]], { tool: "ai", run: "summarize" });
  };

  return (
    <section className="kd-home-block" aria-labelledby="samples-t">
      <div className="kd-block-head">
        <h2 id="samples-t" className="kd-h2 flex items-center gap-2"><FlaskConical size={16} className="kd-muted" /> 예제로 해 보기</h2>
      </div>
      {!samples ? (
        <p className="kd-text kd-muted py-3">{ready ? "예제 문서 묶음을 찾지 못했습니다." : "문서 엔진을 켜는 중입니다."}</p>
      ) : (
        <>
          <div className="kd-rows">
            {samples.scenarios.map((s) => (
              <div key={s.id} className="kd-row">
                <span className="kd-sample-n" aria-hidden="true">{MARK[s.id]}</span>
                <span className="kd-row-main">
                  <span className="kd-row-title block">{s.title}</span>
                  <span className="kd-row-desc block">{s.description}</span>
                </span>
                <span className="kd-row-aside">
                  <Button variant="secondary" size="sm" onClick={() => start(s)}>해 보기</Button>
                </span>
              </div>
            ))}
          </div>
          {samples.note && <p className="kd-small kd-muted mt-2">{samples.note}</p>}
        </>
      )}
    </section>
  );
}
