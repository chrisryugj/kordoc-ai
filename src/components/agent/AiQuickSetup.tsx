/**
 * AI 켜기 판 — 일 시키기 자리에서 바로 (설정 화면까지 가지 않게).
 * 갈래는 설정·첫 실행 마법사와 같은 셋: 이 PC에서(켜 둔 AI 프로그램 · 내장 AI 받기) · 기관 AI 서버 · 외부 AI.
 * 모델 이름·용량은 작은 글 한 줄로만.
 */

import { useEffect, useState } from "react";
import { Cloud, Cpu, Server } from "lucide-react";
import { useApp } from "../../state/app";
import { errorText, isAbort, rpc } from "../../lib/rpc";
import { downloadModel, stopModelDownload, useModelDownload } from "../../lib/model-download";
import type { LlmCatalogItem, LocalModelServer } from "../../lib/contract";
import { firstChatModel } from "../settings/LocalServerPanel";
import { Button } from "../ui/Button";
import { ErrorLine } from "../common/Status";
import "./agent.css";
import "./AiQuickSetup.css";

/** onSettings: 설정의 AI 연결로 가는 길 (카드 창처럼 설정 화면이 없는 곳에서 바꾼다) */
export function AiQuickSetup({ onSettings }: { onSettings?: () => void } = {}) {
  const { settings, saveSettings, openSettings, ready } = useApp();
  const [server, setServer] = useState<LocalModelServer | null>(null);
  const [model, setModel] = useState<LlmCatalogItem | null>(null);
  const [have, setHave] = useState<string>("");
  // 받는 중인 것은 화면 밖에 둔다: 설정을 다녀와도 진행이 보이고, 또 눌러도 같은 받기를 기다린다
  const dl = useModelDownload();
  const down = dl && dl.id === model?.id ? dl : null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const offline = !!settings?.privacy.offline;
  const toSettings = onSettings ?? (() => openSettings("set-ai"));

  useEffect(() => {
    if (!ready) return;
    void rpc("ai_local_servers", {}).then((r) => setServer(r.servers.find((s) => s.models.length) ?? null), () => undefined);
    void Promise.all([rpc("llm_catalog", {}), rpc("llm_list", {})]).then(([c, l]) => {
      const pick = c.find((x) => x.recommended) ?? c[0] ?? null;
      setModel(pick);
      setHave(pick ? l.find((f) => f.name === pick.file)?.path ?? "" : "");
    }, () => undefined);
  }, [ready]);

  const useServer = async () => {
    if (!server || !settings) return;
    setBusy(true);
    await saveSettings({ ai: { provider: "local", local: { ...settings.ai.local, base_url: server.base_url, model: firstChatModel(server.models) } } });
    setBusy(false);
  };

  const useEmbedded = async () => {
    if (!model || !settings) return;
    setBusy(true);
    setError("");
    try {
      let path = have;
      if (!path) path = (await downloadModel(model.id)).path;
      await saveSettings({ ai: { provider: "embedded", embedded: { ...settings.ai.embedded, model_path: path } } });
    } catch (e) { if (!isAbort(e)) setError(errorText(e)); }
    setBusy(false);
  };

  const pct = down?.p && down.p.total ? Math.round((down.p.current / down.p.total) * 100) : 0;
  // 세부는 작은 글 한 줄: 찾은 프로그램의 모델, 없으면 내장 AI 크기
  const detail = server ? `이 PC에서 · ${firstChatModel(server.models)}`
    : model ? `이 PC에서 · ${model.name}${have ? "" : ` (${model.size_gb}GB, 메모리 ${model.ram_gb}GB 이상)`}` : "";

  return (
    <div className="kd-aion" role="region" aria-label="AI 켜기">
      <div className="kd-aion-title">AI 켜기</div>
      <div className="kd-aiq">
        <div className="kd-aiq-card">
          <span className="kd-aiq-head"><Cpu size={16} /> 이 PC에서</span>
          <span className="kd-aiq-desc">문서가 PC 밖으로 나가지 않습니다</span>
          <span className="kd-aiq-acts">
            {server && (
              <Button size="sm" disabled={busy} onClick={() => void useServer()} data-tip="이 PC에 켜 둔 AI 프로그램(Ollama 등)을 바로 씁니다">
                켜 둔 AI 프로그램 쓰기
              </Button>
            )}
            {model && (
              <Button size="sm" variant={server ? "secondary" : "primary"} disabled={busy || (offline && !have)} onClick={() => void useEmbedded()}
                data-tip={have ? "받아 둔 내장 AI로 바로 켭니다" : offline ? "인터넷이 막힌 PC라 받을 수 없습니다. 설정에서 모델 파일을 가져오세요" : "한 번 받으면 인터넷 없이 됩니다"}>
                {have ? "내장 AI 켜기" : "내장 AI 받기"}
              </Button>
            )}
          </span>
          {down ? (
            <>
              <span className="kd-aion-bar" aria-label={`받는 중 ${pct}%`}><i style={{ width: `${pct}%` }} /></span>
              <span className="kd-aiq-detail">받는 중 {pct}% <button type="button" className="kd-link" onClick={stopModelDownload} data-tip="받은 데까지 남겨 두고 멈춥니다. 다시 받으면 이어서 받습니다">멈추기</button></span>
            </>
          ) : detail && <span className="kd-aiq-detail">{detail}</span>}
        </div>
        <div className="kd-aiq-card">
          <span className="kd-aiq-head"><Server size={16} /> 기관 AI 서버</span>
          <span className="kd-aiq-desc">기관이 알려 준 주소로 연결</span>
          <span className="kd-aiq-acts">
            <Button size="sm" variant="secondary" disabled={busy} onClick={toSettings} data-tip="설정 › AI 연결에서 주소와 모델 이름을 넣습니다">주소 넣기</Button>
          </span>
        </div>
        {!offline && (
          <div className="kd-aiq-card">
            <span className="kd-aiq-head"><Cloud size={16} /> 외부 AI</span>
            <span className="kd-aiq-desc">Anthropic·OpenAI·Google</span>
            <span className="kd-aiq-acts">
              <Button size="sm" variant="secondary" disabled={busy} onClick={toSettings} data-tip="설정 › AI 연결에서 회사와 연결 방식(구독 계정·API 키)을 고릅니다. 문서 내용이 그 회사로 가고, 개인정보는 가려서 보냅니다">고르기</Button>
            </span>
          </div>
        )}
      </div>
      <ErrorLine message={error} />
    </div>
  );
}
