/** AI 연결 › 이 PC의 로컬 모델 서버 — 켜진 Ollama·LM Studio·llama.cpp 서버 등을 찾아 고르거나 주소를 직접 넣는다 */

import { useEffect, useState } from "react";
import { RefreshCw, Search } from "lucide-react";
import type { LocalModelServer, Settings } from "../../lib/contract";
import { rpc } from "../../lib/rpc";
import { useTask } from "../../hooks/useTask";
import { Button } from "../ui/Button";
import { Field, TextField } from "../common/Field";
import { ErrorLine, Note, Working } from "../common/Status";
import { lockProps, useLocked } from "./PolicyLock";
import { Advanced } from "./dirty";

type Local = Settings["ai"]["local"];

export function LocalServerPanel({ value, onChange, keyInput, onKey, masked }: {
  value: Local; onChange: (p: Partial<Local>) => void; keyInput: string; onKey: (v: string) => void; masked: string;
}) {
  const lk = useLocked();
  const lp = (label: string, path: string) => lockProps(label, lk(path));
  const find = useTask<LocalModelServer[]>();
  const list = useTask<void>();
  const [models, setModels] = useState<string[]>([]);
  const urlLocked = lk("ai.local.base_url");

  const scan = () => void find.run(async () => (await rpc("ai_local_servers", {})).servers);
  // 처음 열면 한 번 찾아 본다 (127.0.0.1 만, 1초 남짓)
  useEffect(() => { if (!urlLocked) scan(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (s: LocalModelServer) => {
    setModels(s.models);
    onChange({ base_url: s.base_url, model: s.models.includes(value.model) ? value.model : (s.models[0] ?? "") });
  };

  const loadModels = () => void list.run(async () => {
    const r = await rpc("ai_list_models", { base_url: value.base_url, slot: "local", ...(keyInput ? { api_key: keyInput } : {}) });
    setModels(r.models);
    if (!value.model && r.models[0]) onChange({ model: r.models[0] });
  });

  const found = find.result ?? [];
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {find.busy ? <Working label="이 PC에서 켜진 서버를 찾는 중" /> : (
          <Button variant="secondary" onClick={scan} disabled={urlLocked}><Search size={13} /> 이 PC에서 찾기</Button>
        )}
        <span className="kd-small kd-muted">Ollama(11434)·LM Studio(1234)·llama.cpp 서버(8080)·vLLM(8000) 등 자주 쓰는 자리를 봅니다.</span>
      </div>
      {find.result && (found.length ? (
        <div className="flex flex-col gap-2" role="radiogroup" aria-label="찾은 로컬 모델 서버">
          {found.map((s) => (
            <button key={s.base_url} type="button" role="radio" aria-checked={value.base_url === s.base_url} className="kd-ai-tile" disabled={urlLocked} onClick={() => pick(s)}>
              <span className="kd-row-title block">{s.name}</span>
              <span className="kd-row-desc block">{s.base_url} · 모델 {s.models.length}개{s.models.length ? ` (${s.models.slice(0, 3).join(", ")}${s.models.length > 3 ? " 외" : ""})` : ""}</span>
            </button>
          ))}
        </div>
      ) : (
        <Note tone="info">켜진 로컬 모델 서버를 찾지 못했습니다. Ollama나 LM Studio를 켜고(LM Studio는 개발자 탭에서 서버 시작) 다시 찾거나, 아래에 주소를 직접 넣으세요.</Note>
      ))}
      <ErrorLine message={find.error} />

      <div className="kd-fieldgrid">
        <div className="kd-span2"><TextField {...lp("주소", "ai.local.base_url")} hint="찾은 서버를 고르면 채워집니다. 직접 넣을 때는 보통 http://127.0.0.1:포트/v1" value={value.base_url} onChange={(v) => onChange({ base_url: v })} /></div>
        <Field label={lp("모델", "ai.local.model").label}>
          <div className="flex gap-2">
            {models.length ? (
              <select className="kd-select" disabled={lk("ai.local.model")} value={value.model} onChange={(e) => onChange({ model: e.target.value })} aria-label="모델">
                {!models.includes(value.model) && <option value={value.model}>{value.model || "고르세요"}</option>}
                {models.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            ) : (
              <input className="kd-input" disabled={lk("ai.local.model")} value={value.model} onChange={(e) => onChange({ model: e.target.value })} placeholder="예: gemma4" aria-label="모델" />
            )}
            <Button variant="secondary" onClick={loadModels} disabled={list.busy || !value.base_url || lk("ai.local.model")}><RefreshCw size={13} /> 불러오기</Button>
          </div>
        </Field>
      </div>
      <ErrorLine message={list.error} />
      <Advanced>
        <div className="kd-fieldgrid">
          <TextField {...lp("키(선택)", "ai.local.api_key")} type="password" hint="키를 요구하는 서버만 넣습니다" value={keyInput} placeholder={masked} onChange={onKey} />
        </div>
      </Advanced>
      <Note tone="ok">이 PC 안(127.0.0.1)으로만 묻고 답해 문서가 PC 밖으로 나가지 않습니다. 폐쇄망 모드에서도 됩니다.</Note>
    </>
  );
}
