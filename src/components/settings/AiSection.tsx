/** 다. AI 연결 — 갈래: 이 PC 안(내장) · 이 PC의 로컬 모델 서버 · 기관 AI 서버 · 인터넷 AI 서비스(키) · 구독 계정(Claude Code·Codex) */

import { useEffect, useState, type ReactNode } from "react";
import { BadgeCheck, Cloud, Cpu, HardDrive, Lock, PlugZap, RefreshCw, Save, Server } from "lucide-react";
import type { AiProviderId, RpcResult, Settings } from "../../lib/contract";
import { useApp } from "../../state/app";
import { rpc } from "../../lib/rpc";
import { useTask } from "../../hooks/useTask";
import { Button } from "../ui/Button";
import { Field, Section, Seg, Switch, TextField } from "../common/Field";
import { ErrorLine, Note, Working } from "../common/Status";
import { EmbeddedModels } from "./EmbeddedModels";
import { LocalServerPanel } from "./LocalServerPanel";
import { SubscriptionPanel, type SubProvider } from "./SubscriptionPanel";
import { lockProps, PolicyLock, useLocked } from "./PolicyLock";
import { Advanced, UnsavedBadge, useDirtyMark } from "./dirty";

export type Route = "embedded" | "local" | "openai" | "cloud" | "subscription" | "none";
export const routeOf = (p: AiProviderId): Route => (p === "gemini" || p === "anthropic" ? "cloud" : p === "claude-code" || p === "codex" ? "subscription" : p);
/** 화면에 보일 "지금" 이름 */
export const PROVIDER_LABEL: Record<AiProviderId, string> = {
  none: "연결 안 됨", embedded: "이 PC 안", local: "이 PC의 로컬 모델 서버", openai: "기관 서버", gemini: "인터넷 서비스", anthropic: "인터넷 서비스",
  "claude-code": "구독 계정(Claude Code)", codex: "구독 계정(ChatGPT/Codex)",
};
const NO_KEYS = { openai: "", gemini: "", anthropic: "", local: "" };

export function RouteTile({ id, route, onPick, icon, title, desc, badge, locked }: {
  id: Route; route: Route; onPick: (r: Route) => void; icon: ReactNode; title: string; desc: string; badge?: string; locked?: string;
}) {
  return (
    <button type="button" role="radio" aria-checked={route === id} className="kd-ai-tile" disabled={!!locked} onClick={() => onPick(id)}>
      <span className="kd-ai-tile-icon">{locked ? <Lock size={20} /> : icon}</span>
      <span className="kd-row-title block">{title}</span>
      <span className="kd-row-desc block">{locked ?? desc}</span>
      {badge && !locked && <span className="kd-badge mt-2" data-tone="accent">{badge}</span>}
    </button>
  );
}

export function AiSection() {
  const { settings, saveSettings, ai, toast } = useApp();
  const s = settings!;
  const offline = s.privacy.offline;
  const [draft, setDraft] = useState<Settings["ai"]>(s.ai);
  const [route, setRoute] = useState<Route>(routeOf(s.ai.provider));
  const [keys, setKeys] = useState(NO_KEYS);
  const [models, setModels] = useState<string[]>([]);
  const list = useTask<void>();
  const test = useTask<RpcResult<"ai_test">>();
  const [saving, setSaving] = useState(false);
  const lk = useLocked();
  const lp = (label: string, path: string) => lockProps(label, lk(path));
  // AI를 돌릴 곳을 기관에서 정했으면 다른 갈래는 고를 수 없다
  const pinned = lk("ai.provider");
  const tileLock = (id: Route) => (pinned && route !== id ? "기관에서 정함" : undefined);
  const subBlocked = lk("ai.allow_subscription") && !s.ai.allow_subscription;

  // 저장된 AI 설정이 바뀔 때만 입력을 맞춘다 (다른 구획을 저장해도 여기 고치던 것은 남는다)
  const savedAi = JSON.stringify(s.ai);
  useEffect(() => {
    const a = JSON.parse(savedAi) as Settings["ai"];
    setDraft(a);
    setRoute(routeOf(a.provider));
  }, [savedAi]);

  const cloud = draft.provider === "anthropic" ? "anthropic" : "gemini";
  const sub: SubProvider = draft.provider === "codex" ? "codex" : "claude-code";
  const provider: AiProviderId = route === "cloud" ? cloud : route === "subscription" ? sub : route;

  const save = async () => {
    setSaving(true);
    const patch = {
      ...draft, provider,
      openai: { ...draft.openai, api_key: keys.openai || draft.openai.api_key },
      gemini: { ...draft.gemini, api_key: keys.gemini || draft.gemini.api_key },
      anthropic: { ...draft.anthropic, api_key: keys.anthropic || draft.anthropic.api_key },
      local: { ...draft.local, api_key: keys.local || draft.local.api_key },
    };
    const next = await saveSettings({ ai: patch });
    if (next) { toast("AI 연결을 저장했습니다", "success"); setKeys(NO_KEYS); }
    setSaving(false);
    return !!next;
  };

  const runTest = () => void test.run(async () => {
    if (!(await save())) throw new Error("저장하지 못해 시험하지 않았습니다");
    return rpc("ai_test", {});
  });

  const loadModels = () => void list.run(async () => {
    const r = await rpc("ai_list_models", { base_url: draft.openai.base_url, ...(keys.openai ? { api_key: keys.openai } : {}) });
    setModels(r.models);
    if (!draft.openai.model && r.models[0]) setDraft((d) => ({ ...d, openai: { ...d.openai, model: r.models[0] } }));
  });

  const masked = (k: string) => (k ? `저장됨 (${k})` : "");

  // 고친 채 저장하지 않았나 (갈래·주소·모델·새로 넣은 키)
  const dirty = JSON.stringify({ ...draft, provider }) !== savedAi || !!(keys.openai || keys.gemini || keys.anthropic || keys.local);
  useDirtyMark("set-ai", "AI 연결", dirty, save, () => {
    const a = JSON.parse(savedAi) as Settings["ai"];
    setDraft(a);
    setRoute(routeOf(a.provider));
    setKeys(NO_KEYS);
  });

  return (
    <Section id="set-ai" mark="다." title="AI 연결" sub="요약·초안·검토에 쓸 AI를 고르세요. 무엇을 고를지 모르겠으면 아래 고르는 법대로 하면 됩니다."
      aside={dirty ? <UnsavedBadge /> : undefined}>
      <ul className="kd-pickhow" aria-label="고르는 법">
        <li><b>인터넷이 막힌 PC</b>라면 이 PC 안에서</li>
        <li><b>Claude·ChatGPT 유료 구독</b>을 쓰고 있다면 구독 계정</li>
        <li><b>Gemini·Claude 키</b>가 있다면 인터넷 AI 키</li>
        <li><b>기관에서 AI 서버 주소</b>를 받았다면 기관 AI 서버</li>
      </ul>
      <div className="kd-ai-tiles mt-3" role="radiogroup" aria-label="AI를 돌릴 곳">
        <RouteTile id="embedded" route={route} onPick={setRoute} icon={<Cpu size={20} />} title="이 PC 안에서" desc="AI 모델 파일을 이 PC에 받아 씁니다. 인터넷 없이 되고 문서가 밖으로 나가지 않습니다." badge="인터넷 없이 됨" locked={tileLock("embedded")} />
        <RouteTile id="subscription" route={route} onPick={setRoute} icon={<BadgeCheck size={20} />} title="구독 계정" desc="Claude나 ChatGPT 유료 구독이 있으면 키 없이 씁니다. 문서 내용이 그 회사로 갑니다."
          locked={offline ? "인터넷이 막힌 PC로 정해 두어 쓸 수 없습니다" : subBlocked ? "기관에서 막음" : tileLock("subscription")} />
        <RouteTile id="cloud" route={route} onPick={setRoute} icon={<Cloud size={20} />} title="인터넷 AI 키" desc="Gemini나 Claude에서 받은 키를 넣어 씁니다. 문서 내용이 그 회사로 갑니다."
          locked={offline ? "인터넷이 막힌 PC로 정해 두어 쓸 수 없습니다" : tileLock("cloud")} />
        <RouteTile id="local" route={route} onPick={setRoute} icon={<HardDrive size={20} />} title="이 PC에 켜 둔 AI 프로그램" desc="Ollama·LM Studio 같은 프로그램을 켜 두었다면 찾아서 연결합니다. 문서가 밖으로 나가지 않습니다." badge="인터넷 없이 됨" locked={tileLock("local")} />
        <RouteTile id="openai" route={route} onPick={setRoute} icon={<Server size={20} />} title="기관 AI 서버" desc="기관 전산 담당자가 알려 준 주소로 연결합니다." locked={tileLock("openai")} />
      </div>
      <div className="mt-2 flex items-center gap-2">
        {!pinned && <button type="button" className="kd-link kd-small" aria-pressed={route === "none"} onClick={() => setRoute("none")}>AI를 쓰지 않기</button>}
        {route === "none" && <span className="kd-small kd-muted">문서 읽기·바꾸기·검사는 AI 없이도 됩니다.</span>}
      </div>

      <div className="kd-panel mt-4 flex flex-col gap-4 p-4">
        {route === "embedded" && (
          <>
            {lk("ai.embedded") && <p className="kd-small kd-muted">내장 모델 설정 일부는 기관에서 정해 바꿔도 적용되지 않습니다.<PolicyLock /></p>}
            <EmbeddedModels modelPath={draft.embedded.model_path} contextSize={draft.embedded.context_size} gpu={draft.embedded.gpu}
              onChange={(p) => setDraft((d) => ({ ...d, embedded: { ...d.embedded, ...Object.fromEntries(Object.entries(p).filter(([k]) => !lk(`ai.embedded.${k}`))) } }))} />
          </>
        )}
        {route === "openai" && (
          <>
            <div className="kd-fieldgrid">
              <div className="kd-span2"><TextField {...lp("주소", "ai.openai.base_url")} hint="Ollama는 보통 http://127.0.0.1:11434/v1" value={draft.openai.base_url} onChange={(v) => setDraft((d) => ({ ...d, openai: { ...d.openai, base_url: v } }))} /></div>
              <TextField {...lp("키", "ai.openai.api_key")} type="password" hint="키가 없는 서버면 비워 두세요" value={keys.openai} placeholder={masked(draft.openai.api_key)} onChange={(v) => setKeys((k) => ({ ...k, openai: v }))} />
              <Field label={lp("모델", "ai.openai.model").label}>
                <div className="flex gap-2">
                  {models.length ? (
                    <select className="kd-select" disabled={lk("ai.openai.model")} value={draft.openai.model} onChange={(e) => setDraft((d) => ({ ...d, openai: { ...d.openai, model: e.target.value } }))} aria-label="모델">
                      {models.map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                  ) : (
                    <input className="kd-input" disabled={lk("ai.openai.model")} value={draft.openai.model} onChange={(e) => setDraft((d) => ({ ...d, openai: { ...d.openai, model: e.target.value } }))} placeholder="예: gemma4" aria-label="모델" />
                  )}
                  <Button variant="secondary" onClick={loadModels} disabled={list.busy || !draft.openai.base_url || lk("ai.openai.model")}><RefreshCw size={13} /> 불러오기</Button>
                </div>
              </Field>
            </div>
            <Advanced>
              <div className="kd-fieldgrid">
                <TextField {...lp("그림 읽기 모델(선택)", "ai.openai.vision_model")} hint="스캔 글자 읽기를 이 서버에 맡길 때만 넣습니다" value={draft.openai.vision_model} onChange={(v) => setDraft((d) => ({ ...d, openai: { ...d.openai, vision_model: v } }))} />
              </div>
              <p className="kd-small kd-muted">이 서버는 OpenAI 방식(주소 끝이 보통 /v1)으로 묻고 답합니다.</p>
            </Advanced>
            <ErrorLine message={list.error} />
            {offline && <Note tone="info">폐쇄망 모드에서는 기관 안 주소(사설 IP)와 이 PC(127.0.0.1)만 연결됩니다.</Note>}
          </>
        )}
        {route === "local" && (
          <LocalServerPanel value={draft.local} onChange={(p) => setDraft((d) => ({ ...d, local: { ...d.local, ...p } }))}
            keyInput={keys.local} onKey={(v) => setKeys((k) => ({ ...k, local: v }))} masked={masked(draft.local.api_key)} />
        )}
        {route === "subscription" && (
          <SubscriptionPanel provider={sub} pinned={pinned} draft={draft}
            onProvider={(v) => setDraft((d) => ({ ...d, provider: v }))}
            onChange={(p) => setDraft((d) => ({ ...d, ...p }))} />
        )}
        {route === "cloud" && (
          <>
            <Field label="서비스"><Seg label="인터넷 AI 서비스" disabled={pinned} value={cloud} onChange={(v) => setDraft((d) => ({ ...d, provider: v }))} options={[{ value: "gemini", label: "Google Gemini" }, { value: "anthropic", label: "Anthropic Claude" }]} /></Field>
            <div className="kd-fieldgrid">
              <TextField {...lp("API 키", `ai.${cloud}.api_key`)} type="password" value={keys[cloud]} placeholder={masked(draft[cloud].api_key) || "서비스 누리집에서 받은 키"} onChange={(v) => setKeys((k) => ({ ...k, [cloud]: v }))} />
              <TextField {...lp("모델", `ai.${cloud}.model`)} value={draft[cloud].model} onChange={(v) => setDraft((d) => ({ ...d, [cloud]: { ...d[cloud], model: v } }))} />
            </div>
            <Switch {...lp("보내기 전에 개인정보 자동으로 가리기", "ai.redact_before_cloud")} desc="주민등록번호·전화번호·계좌번호 같은 것을 가린 뒤 보냅니다. 끄지 않기를 권합니다."
              checked={draft.redact_before_cloud} onChange={(v) => setDraft((d) => ({ ...d, redact_before_cloud: v }))} />
          </>
        )}
        {route === "none" && <p className="kd-text">AI 기능(요약·초안·다듬기·K팀장 검토)을 끕니다. 나머지 기능은 그대로 씁니다.</p>}

        <div className="flex flex-wrap items-center gap-2 border-t pt-4" style={{ borderColor: "var(--color-border-subtle)" }}>
          <Button onClick={() => void save()} disabled={saving}><Save size={14} /> {saving ? "저장하는 중" : "저장"}</Button>
          {route !== "none" && (test.busy ? <Working label="연결을 시험하는 중" /> : <Button variant="secondary" onClick={runTest}><PlugZap size={14} /> 저장하고 연결 시험</Button>)}
          <span className="kd-small kd-muted ml-auto">지금: {ai?.configured ? PROVIDER_LABEL[ai.provider] : "연결 안 됨"}</span>
        </div>
        <ErrorLine message={test.error} />
        {test.result && (test.result.ok
          ? <Note tone="ok">연결됐습니다. 답이 {(test.result.latency_ms / 1000).toFixed(1)}초 만에 왔습니다.{test.result.sample ? ` 받은 답: “${test.result.sample}”` : ""}</Note>
          : <Note tone="err">연결하지 못했습니다. {test.result.error}</Note>)}
      </div>
    </Section>
  );
}
