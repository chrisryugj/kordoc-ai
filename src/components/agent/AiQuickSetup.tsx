/**
 * AI 켜기 한 패널 — 일 시키기 자리에서 바로 (설정 화면까지 가지 않게).
 * ① 이 PC 에서 켜진 AI(Ollama 등)가 있으면 그것 ② 앱에 넣을 내장 AI(추천 모델, 한 번 받기) ③ 인터넷 AI 키는 설정으로.
 */

import { useEffect, useState } from "react";
import { Cloud, Cpu, HardDrive } from "lucide-react";
import { useApp } from "../../state/app";
import { errorText, rpc, type Progress } from "../../lib/rpc";
import type { LlmCatalogItem, LocalModelServer } from "../../lib/contract";
import { firstChatModel } from "../settings/LocalServerPanel";
import { ErrorLine } from "../common/Status";
import "./agent.css";

export function AiQuickSetup() {
  const { settings, saveSettings, openSettings, ready } = useApp();
  const [server, setServer] = useState<LocalModelServer | null>(null);
  const [model, setModel] = useState<LlmCatalogItem | null>(null);
  const [have, setHave] = useState<string>("");
  const [down, setDown] = useState<Progress | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const offline = !!settings?.privacy.offline;

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
      if (!path) path = (await rpc("llm_download", { id: model.id }, { onProgress: setDown })).path;
      await saveSettings({ ai: { provider: "embedded", embedded: { ...settings.ai.embedded, model_path: path } } });
    } catch (e) { setError(errorText(e)); }
    setDown(null);
    setBusy(false);
  };

  const pct = down && down.total ? Math.round((down.current / down.total) * 100) : 0;

  return (
    <div className="kd-aion" role="region" aria-label="AI 켜기">
      <div className="kd-aion-title">AI 를 켜면 말로 일을 시킬 수 있습니다</div>
      <div className="kd-aion-opts">
        {server && (
          <button type="button" className="kd-aion-opt" disabled={busy} onClick={() => void useServer()}>
            <HardDrive size={18} />
            <b>이 PC 의 AI 쓰기</b>
            <span>{firstChatModel(server.models)} · 문서가 PC 밖으로 나가지 않습니다. 바로 켜집니다.</span>
          </button>
        )}
        {model && (
          <button type="button" className="kd-aion-opt" disabled={busy} onClick={() => void useEmbedded()}>
            <Cpu size={18} />
            <b>{have ? `내장 AI 켜기 (${model.name})` : `내장 AI 받기 (${model.name})`}</b>
            <span>{have ? "이미 받아 둔 모델로 바로 켭니다." : `${model.size_gb}GB 를 한 번만 받습니다. 메모리 ${model.ram_gb}GB 이상 PC. 받은 뒤엔 인터넷 없이 됩니다.`}</span>
            {down && <span className="kd-aion-bar" aria-label={`받는 중 ${pct}%`}><i style={{ width: `${pct}%` }} /></span>}
            {down && <span>받는 중 {pct}%</span>}
          </button>
        )}
        {!offline && (
          <button type="button" className="kd-aion-opt" disabled={busy} onClick={() => openSettings("set-ai")}>
            <Cloud size={18} />
            <b>인터넷 AI 키 넣기</b>
            <span>Gemini·Claude 키나 기관 AI 서버 주소를 설정에서 넣습니다. 개인정보는 가려서 보냅니다.</span>
          </button>
        )}
      </div>
      <ErrorLine message={error} />
    </div>
  );
}
