/**
 * 다. AI 연결 — 큰 갈래 셋: 이 PC에서(내장 AI · 켜 둔 AI 프로그램) · 기관 AI 서버 · 외부 AI, 그리고 AI 쓰지 않기.
 * 외부 AI 는 회사(Anthropic·OpenAI·Google)를 고르고 연결 방식(구독 계정·API 키)은 그 아래에서. 고른 것은 "회사 · 모델" 한 줄로 보인다.
 * 홈 AI 켜기 판(agent/AiQuickSetup)·첫 실행 마법사와 같은 이름을 쓴다.
 */

import { useEffect, useState, type ReactNode } from "react";
import { Cloud, Cpu, Lock, PlugZap, RefreshCw, Save, Server } from "lucide-react";
import type { AiProviderId, LlmCatalogItem, RpcResult, Settings } from "../../lib/contract";
import { useApp } from "../../state/app";
import { rpc } from "../../lib/rpc";
import { baseName } from "../../lib/format";
import { useTask } from "../../hooks/useTask";
import { Button } from "../ui/Button";
import { Field, Section, Seg, Switch, TextField } from "../common/Field";
import { ErrorLine, Note, Working } from "../common/Status";
import { EmbeddedModels } from "./EmbeddedModels";
import { LocalServerPanel } from "./LocalServerPanel";
import { SubscriptionPanel, subSlot, type SubProvider } from "./SubscriptionPanel";
import { lockProps, PolicyLock, useLocked } from "./PolicyLock";
import { Advanced, UnsavedBadge, useDirtyMark } from "./dirty";
import "./AiSection.css";

export type Route = "embedded" | "local" | "openai" | "cloud" | "subscription" | "none";
export const routeOf = (p: AiProviderId): Route => (p === "gemini" || p === "anthropic" ? "cloud" : p === "claude-code" || p === "codex" || p === "gemini-cli" ? "subscription" : p);
/** 큰 갈래: 이 PC에서 · 기관 AI 서버 · 외부 AI */
export type Group = "pc" | "openai" | "ext" | "none";
export const groupOf = (r: Route): Group => (r === "embedded" || r === "local" ? "pc" : r === "cloud" || r === "subscription" ? "ext" : r);
/** 갈래를 처음 고를 때 들어갈 세부 */
const FIRST: Record<Group, Route> = { pc: "embedded", openai: "openai", ext: "cloud", none: "none" };
/** 고른 세부를 한 줄로 */
const SUB_DESC: Partial<Record<Route, string>> = {
  embedded: "모델 파일을 한 번 받으면 인터넷 없이 됩니다.",
  local: "켜 둔 Ollama·LM Studio 같은 프로그램을 찾아 연결합니다.",
};
/** 외부 AI 회사. 연결 방식: Anthropic 은 구독 계정(Claude Code)·API 키, OpenAI 는 구독 계정(Codex), Google 은 구독 계정(Gemini CLI)·API 키 */
export type Company = "anthropic" | "openai" | "google";
export const COMPANY_NAME: Record<Company, string> = { anthropic: "Anthropic", openai: "OpenAI", google: "Google" };
export const companyOf = (p: AiProviderId): Company => (p === "codex" ? "openai" : p === "gemini" || p === "gemini-cli" ? "google" : "anthropic");
/** 구독 계정·API 키를 고를 수 있는 회사의 두 공급자 */
const WAYS: Partial<Record<Company, { subscription: AiProviderId; cloud: AiProviderId; label: string }>> = {
  anthropic: { subscription: "claude-code", cloud: "anthropic", label: "구독 계정" },
  google: { subscription: "gemini-cli", cloud: "gemini", label: "구독 계정 (Gemini CLI)" },
};
/** 화면에 보일 "지금" 이름 (회사 · 연결 방식) */
export const PROVIDER_LABEL: Record<AiProviderId, string> = {
  none: "연결 안 됨", embedded: "이 PC · 내장 AI", local: "이 PC · 켜 둔 AI 프로그램", openai: "기관 AI 서버", gemini: "Google · API 키", anthropic: "Anthropic · API 키",
  "claude-code": "Anthropic · 구독 계정", codex: "OpenAI · 구독 계정", "gemini-cli": "Google · 구독 계정",
};
const NO_KEYS = { openai: "", gemini: "", anthropic: "", local: "" };

export function RouteTile<T extends string>({ id, route, onPick, icon, title, desc, badge, locked, tip }: {
  id: T; route: T; onPick: (r: T) => void; icon: ReactNode; title: string; desc: string; badge?: string; locked?: string; tip?: string;
}) {
  return (
    <button type="button" role="radio" aria-checked={route === id} className="kd-ai-tile" disabled={!!locked} onClick={() => onPick(id)} data-tip={locked ? undefined : tip}>
      <span className="kd-ai-tile-icon">{locked ? <Lock size={20} /> : icon}</span>
      <span className="kd-row-title block">{title}</span>
      <span className="kd-row-desc block">{locked ?? desc}</span>
      {badge && !locked && <span className="kd-badge mt-2" data-tone="accent">{badge}</span>}
    </button>
  );
}

/** 큰 갈래 안의 세부 고르기 + 고른 것 한 줄 설명 */
function SubPick({ label, route, onPick, options, disabled }: {
  label: string; route: Route; onPick: (r: Route) => void; disabled: boolean;
  options: Array<{ value: Route; label: string; disabled?: boolean }>;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Seg label={label} value={route} onChange={onPick} disabled={disabled} options={options} />
      {SUB_DESC[route] && <p className="kd-small kd-muted">{SUB_DESC[route]}</p>}
    </div>
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
  const group = groupOf(route);
  const groupLock = (g: Group) => (pinned && group !== g ? "기관에서 정함" : undefined);
  const pickGroup = (g: Group) => { if (g !== group) setRoute(FIRST[g]); };
  const subBlocked = lk("ai.allow_subscription") && !s.ai.allow_subscription;

  // 저장된 AI 설정이 바뀔 때만 입력을 맞춘다 (다른 구획을 저장해도 여기 고치던 것은 남는다)
  const savedAi = JSON.stringify(s.ai);
  useEffect(() => {
    const a = JSON.parse(savedAi) as Settings["ai"];
    setDraft(a);
    setRoute(routeOf(a.provider));
  }, [savedAi]);

  const cloud = draft.provider === "anthropic" ? "anthropic" : "gemini";
  const sub: SubProvider = draft.provider === "codex" || draft.provider === "gemini-cli" ? draft.provider : "claude-code";
  const provider: AiProviderId = route === "cloud" ? cloud : route === "subscription" ? sub : route;
  const company = companyOf(provider);
  // 회사를 고르면 그 회사가 되는 연결 방식으로 (Anthropic·Google 은 지금 방식을 이어서)
  const setProvider = (r: Route, p: AiProviderId) => { setRoute(r); setDraft((d) => ({ ...d, provider: p })); };
  const pickCompany = (c: Company) => {
    if (c === company) return;
    const ways = WAYS[c];
    if (!ways) setProvider("subscription", "codex");
    else setProvider(route === "subscription" && !subBlocked ? "subscription" : "cloud", route === "subscription" && !subBlocked ? ways.subscription : ways.cloud);
  };

  // 고른 AI 를 "회사 · 모델" 한 줄로. 모델 이름은 설정 값·엔진 목록에서만 (지어내지 않는다)
  const [catalog, setCatalog] = useState<LlmCatalogItem[]>([]);
  useEffect(() => { if (route === "embedded" && !catalog.length) void rpc("llm_catalog", {}).then(setCatalog, () => undefined); }, [route, catalog.length]);
  const embName = draft.embedded.model_path
    ? catalog.find((c) => baseName(draft.embedded.model_path) === c.file)?.name ?? baseName(draft.embedded.model_path) : "";
  const slotModel = route === "subscription" ? draft[subSlot(sub)].model : "";
  const pickLine = route === "embedded" ? `이 PC · ${embName || "모델을 받거나 고르세요"}`
    : route === "local" ? `이 PC · ${draft.local.model || "모델을 고르세요"}`
    : route === "openai" ? `기관 AI 서버 · ${draft.openai.model || "모델 이름을 넣으세요"}`
    : route === "cloud" ? `${COMPANY_NAME[company]} · ${draft[cloud].model || "모델 이름을 넣으세요"}`
    : route === "subscription" ? `${COMPANY_NAME[company]} · ${slotModel || "프로그램 기본 모델"}` : "";

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
  // 저장된 키 지우기: 칸을 비워 저장하면 가린 값이 다시 가서 엔진이 버리므로, 빈 값을 따로 보낸다
  type KeySlot = "openai" | "gemini" | "anthropic" | "local";
  const clearKey = (k: KeySlot) => (draft[k].api_key && !lk(`ai.${k}.api_key`) ? (
    <button type="button" className="kd-link kd-small" data-tip="저장을 누르면 이 PC에 저장된 키를 지웁니다"
      onClick={() => { setKeys((x) => ({ ...x, [k]: "" })); setDraft((d) => ({ ...d, [k]: { ...d[k], api_key: "" } })); }}>저장된 키 지우기</button>
  ) : null);

  // 고친 채 저장하지 않았나 (갈래·주소·모델·새로 넣은 키)
  const dirty = JSON.stringify({ ...draft, provider }) !== savedAi || !!(keys.openai || keys.gemini || keys.anthropic || keys.local);
  useDirtyMark("set-ai", "AI 연결", dirty, save, () => {
    const a = JSON.parse(savedAi) as Settings["ai"];
    setDraft(a);
    setRoute(routeOf(a.provider));
    setKeys(NO_KEYS);
  });

  return (
    <Section id="set-ai" mark="다." title="AI 연결" sub="요약·초안·검토에 쓸 AI"
      aside={dirty ? <UnsavedBadge /> : undefined}>
      <div className="kd-ai-tiles" role="radiogroup" aria-label="AI를 돌릴 곳">
        <RouteTile id="pc" route={group} onPick={pickGroup} icon={<Cpu size={20} />} title="이 PC에서" desc="문서가 PC 밖으로 나가지 않습니다" badge="인터넷 없이 됨" locked={groupLock("pc")}
          tip="인터넷이 막힌 PC이거나 문서를 밖으로 보내면 안 될 때. 내장 AI를 받거나 이 PC에 켜 둔 AI 프로그램(Ollama 등)에 연결합니다." />
        <RouteTile id="openai" route={group} onPick={pickGroup} icon={<Server size={20} />} title="기관 AI 서버" desc="기관이 알려 준 주소로 연결" locked={groupLock("openai")}
          tip="기관 전산 담당자에게 AI 서버 주소를 받았을 때" />
        <RouteTile id="ext" route={group} onPick={pickGroup} icon={<Cloud size={20} />} title="외부 AI" desc="문서 내용이 그 회사로 갑니다"
          tip="Gemini·Claude 키나 Claude·ChatGPT 유료 구독, Gemini CLI에 로그인한 Google 계정이 있을 때. 개인정보는 가려서 보냅니다."
          locked={offline ? "인터넷이 막힌 PC로 정해 두어 쓸 수 없습니다" : groupLock("ext")} />
      </div>
      <div className="mt-2 flex items-center gap-2">
        {!pinned && <button type="button" className="kd-link kd-small" aria-pressed={route === "none"} onClick={() => setRoute("none")}>AI 쓰지 않기</button>}
        {route === "none" && <span className="kd-small kd-muted">문서 읽기·바꾸기·검사는 AI 없이도 됩니다.</span>}
      </div>

      <div className="kd-panel mt-4 flex flex-col gap-4 p-4">
        {group === "pc" && (
          <SubPick label="이 PC에서 쓰는 방법" route={route} onPick={setRoute} disabled={!!pinned}
            options={[{ value: "embedded", label: "내장 AI 받아 쓰기" }, { value: "local", label: "이 PC에 켜 둔 AI 프로그램" }]} />
        )}
        {group === "ext" && (
          <div className="kd-fieldgrid">
            <Field label="회사">
              <Seg label="외부 AI 회사" value={company} onChange={pickCompany} disabled={!!pinned}
                options={[{ value: "anthropic", label: "Anthropic" }, { value: "openai", label: subBlocked ? "OpenAI (기관에서 막음)" : "OpenAI", disabled: subBlocked }, { value: "google", label: "Google" }]} />
            </Field>
            <Field label="연결 방식">
              {WAYS[company] ? (
                <Seg label="연결 방식" value={route} onChange={(r) => setProvider(r, r === "subscription" ? WAYS[company]!.subscription : WAYS[company]!.cloud)} disabled={!!pinned}
                  options={[{ value: "subscription", label: subBlocked ? `${WAYS[company]!.label} (기관에서 막음)` : WAYS[company]!.label, disabled: subBlocked }, { value: "cloud", label: "API 키" }]} />
              ) : <span className="kd-aipick-way">구독 계정 (ChatGPT·Codex)</span>}
            </Field>
          </div>
        )}
        {pickLine && (
          <div className="kd-aipick" aria-live="polite">
            <span className="kd-aipick-label">고른 AI</span>
            <b>{pickLine}</b>
          </div>
        )}
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
              <div className="flex flex-col">
                <TextField {...lp("키", "ai.openai.api_key")} type="password" hint="키가 없는 서버면 비워 두세요" value={keys.openai} placeholder={masked(draft.openai.api_key)} onChange={(v) => setKeys((k) => ({ ...k, openai: v }))} />
                {clearKey("openai")}
              </div>
              <Field label={lp("모델", "ai.openai.model").label}>
                <div className="flex gap-2">
                  {models.length ? (
                    <select className="kd-select" disabled={lk("ai.openai.model")} value={draft.openai.model} onChange={(e) => setDraft((d) => ({ ...d, openai: { ...d.openai, model: e.target.value } }))} aria-label="모델">
                      {models.map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                  ) : (
                    <input className="kd-input" disabled={lk("ai.openai.model")} value={draft.openai.model} onChange={(e) => setDraft((d) => ({ ...d, openai: { ...d.openai, model: e.target.value } }))} placeholder="예: gemma4" aria-label="모델" />
                  )}
                  <Button variant="secondary" onClick={loadModels} disabled={list.busy || !draft.openai.base_url || lk("ai.openai.model")} data-tip="이 주소의 서버에 있는 모델 이름을 가져옵니다"><RefreshCw size={13} /> 불러오기</Button>
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
            keyInput={keys.local} onKey={(v) => setKeys((k) => ({ ...k, local: v }))} masked={masked(draft.local.api_key)} keyAction={clearKey("local")} />
        )}
        {route === "subscription" && (
          <SubscriptionPanel provider={sub} draft={draft} onChange={(p) => setDraft((d) => ({ ...d, ...p }))} />
        )}
        {route === "cloud" && (
          <>
            <div className="kd-fieldgrid">
              <div className="flex flex-col">
                <TextField {...lp("API 키", `ai.${cloud}.api_key`)} type="password" value={keys[cloud]} placeholder={masked(draft[cloud].api_key) || (cloud === "gemini" ? "Google AI Studio에서 받은 키" : "Anthropic 콘솔에서 받은 키")} onChange={(v) => setKeys((k) => ({ ...k, [cloud]: v }))} />
                {clearKey(cloud)}
              </div>
              <TextField {...lp("모델", `ai.${cloud}.model`)} value={draft[cloud].model} onChange={(v) => setDraft((d) => ({ ...d, [cloud]: { ...d[cloud], model: v } }))} />
            </div>
            <Switch {...lp("보내기 전에 개인정보 자동으로 가리기", "ai.redact_before_cloud")} desc="주민등록번호·전화번호·계좌번호 같은 것을 가린 뒤 보냅니다. 끄지 않기를 권합니다."
              checked={draft.redact_before_cloud} onChange={(v) => setDraft((d) => ({ ...d, redact_before_cloud: v }))} />
          </>
        )}
        {route === "none" && <p className="kd-text">AI 기능(요약·초안·다듬기·K팀장 검토)을 끕니다. 나머지 기능은 그대로 씁니다.</p>}

        <div className="flex flex-wrap items-center gap-2 border-t pt-4" style={{ borderColor: "var(--color-border-subtle)" }}>
          <Button onClick={() => void save()} disabled={saving}><Save size={14} /> {saving ? "저장하는 중" : "저장"}</Button>
          {route !== "none" && (test.busy ? <Working label="연결을 시험하는 중" /> : <Button variant="secondary" onClick={runTest} data-tip="저장한 뒤 AI에 짧은 질문을 보내 답이 오는지 봅니다"><PlugZap size={14} /> 저장하고 연결 시험</Button>)}
          <span className="kd-small kd-muted ml-auto">지금: {ai?.configured ? `${PROVIDER_LABEL[ai.provider]}${ai.model ? ` · ${ai.model}` : ""}` : "연결 안 됨"}</span>
        </div>
        <ErrorLine message={test.error} />
        {test.result && (test.result.ok
          ? <Note tone="ok">연결됐습니다. 답이 {(test.result.latency_ms / 1000).toFixed(1)}초 만에 왔습니다.{test.result.sample ? ` 받은 답: “${test.result.sample}”` : ""}</Note>
          : <Note tone="err">연결하지 못했습니다. {test.result.error}</Note>)}
      </div>
    </Section>
  );
}
