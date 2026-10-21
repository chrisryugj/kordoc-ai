/** 첫 실행 — 내 기관 정보와 AI 연결을 한 번 받는다 (나중에 설정에서 바꿀 수 있음) */

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Cloud, Cpu, HardDrive, Search, Server } from "lucide-react";
import type { AiProviderId, Settings } from "../../lib/contract";
import { useApp } from "../../state/app";
import { writePref } from "../../lib/recent";
import { useGongmunMeta } from "../../hooks/useGongmunMeta";
import { Button } from "../ui/Button";
import { useDialogKeys } from "../ui/useDialogKeys";
import { Note, StatusLine } from "../common/Status";
import { SelectField, Switch, TextField } from "../common/Field";
import { RouteTile, routeOf, type Route } from "../settings/AiSection";
import { lockProps, useLocked } from "../settings/PolicyLock";
import { rpc } from "../../lib/rpc";

export function FirstRunWizard() {
  const { settings, saveSettings, setFirstRun, openSettings } = useApp();
  const meta = useGongmunMeta();
  const [step, setStep] = useState(0);
  const [org, setOrg] = useState<Settings["org"]>(settings!.org);
  // 기관 배포 설정 등으로 이미 정해진 AI 갈래가 있으면 그것부터 (기본 "이 PC 안"으로 덮어쓰지 않게)
  const saved = settings!.ai.provider;
  // 구독 계정(기관 배포 설정으로 정해 둔 경우)은 이 마법사에 칸이 없다: 고른 그대로 두고 설정에서 확인하게 한다
  const [startRoute] = useState<Route>(saved === "none" && !settings!.policy?.locked.includes("ai.provider") ? "embedded" : routeOf(saved));
  const [route, setRoute] = useState<Route>(startRoute);
  const [offline, setOffline] = useState(settings!.privacy.offline);
  const [baseUrl, setBaseUrl] = useState(settings!.ai.openai.base_url);
  const [model, setModel] = useState(settings!.ai.openai.model);
  const [localUrl, setLocalUrl] = useState(settings!.ai.local.base_url);
  const [localModel, setLocalModel] = useState(settings!.ai.local.model);
  const [finding, setFinding] = useState<"" | "busy" | "none">("");
  const [cloud, setCloud] = useState<"gemini" | "anthropic">(saved === "anthropic" ? "anthropic" : "gemini");
  const [key, setKey] = useState("");
  const [saving, setSaving] = useState(false);
  /** 저장이 실패했다 — 저장하지 않고 닫을 길을 연다 (앱이 마법사에 갇히지 않게) */
  const [saveFailed, setSaveFailed] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const startRef = useRef<HTMLButtonElement>(null);
  const lk = useLocked();
  const lp = (label: string, path: string) => lockProps(label, lk(path));
  const pinned = lk("ai.provider");
  const tileLock = (id: Route) => (pinned && route !== id ? "기관에서 정함" : undefined);
  const set = <K extends keyof Settings["org"]>(k: K, v: Settings["org"][K]) => setOrg((o) => ({ ...o, [k]: v }));

  useEffect(() => {
    if (step === 2) startRef.current?.focus();
    else boxRef.current?.querySelector<HTMLElement>(".kd-wizard-body input:not(:disabled), .kd-wizard-body button:not(:disabled)")?.focus();
  }, [step]);
  useEffect(() => { if (offline && (route === "cloud" || route === "subscription")) setRoute("embedded"); }, [offline, route]);

  // 이 PC에서 켜진 로컬 모델 서버 중 첫 번째로 채운다 (127.0.0.1 만 본다)
  const findLocal = async () => {
    setFinding("busy");
    const s = (await rpc("ai_local_servers", {}).catch(() => ({ servers: [] }))).servers[0];
    if (s) { setLocalUrl(s.base_url); setLocalModel(s.models.includes(localModel) ? localModel : (s.models[0] ?? "")); }
    setFinding(s ? "" : "none");
  };

  const done = () => { writePref("kordoc-first-run-done", true); setFirstRun(false); };

  // 바꾼 AI 설정만 저장한다 (안 건드렸으면 원래 설정 그대로)
  const aiChanged = route !== startRoute || baseUrl !== settings!.ai.openai.base_url || model !== settings!.ai.openai.model || !!key
    || localUrl !== settings!.ai.local.base_url || localModel !== settings!.ai.local.model;
  const save = async (withAi: boolean) => {
    setSaving(true);
    const provider: AiProviderId = route === "cloud" ? cloud : route === "subscription" ? saved : route;
    const ai: Partial<Settings["ai"]> = { provider };
    if (route === "openai") ai.openai = { ...settings!.ai.openai, base_url: baseUrl, model };
    if (route === "local") ai.local = { ...settings!.ai.local, base_url: localUrl, model: localModel };
    if (route === "cloud" && key) ai[cloud] = { ...settings!.ai[cloud], api_key: key };
    const ok = await saveSettings({ org, privacy: { offline }, ...(withAi ? { ai } : {}) });
    setSaving(false);
    setSaveFailed(!ok);
    return !!ok;
  };

  // 저장 못 한 채 닫기: 처음 실행 표시는 남기지 않아 다음에 켤 때 다시 묻는다
  const closeUnsaved = () => setFirstRun(false);

  const finish = async () => {
    if (!(await save(true))) return;
    done();
    // AI 를 나중에 정하기로 했거나 아직 덜 됐으면(모델·주소·키 없음) 설정의 AI 연결 구획으로 바로
    if (!aiReady) openSettings("set-ai");
  };

  // 중간에 닫아도(Esc 포함) 넣은 것은 저장한다. 저장에 실패하면 안내를 띄우고, 그다음 Esc 는 저장하지 않고 닫는다
  const later = async () => {
    if (saving) return;
    if (await save(aiChanged)) done();
  };
  useDialogKeys(boxRef, true, () => (saveFailed ? closeUnsaved() : void later()));

  const onEnter = (e: KeyboardEvent<HTMLDivElement>) => {
    const t = e.target as HTMLInputElement;
    if (e.key !== "Enter" || e.nativeEvent.isComposing || e.keyCode === 229 || t.tagName !== "INPUT" || t.type === "checkbox") return;
    e.preventDefault();
    if (step < 2) setStep(step + 1);
  };

  const aiReady = route === "embedded" ? !!settings!.ai.embedded.model_path
    : route === "openai" ? !!(baseUrl.trim() && model.trim())
    : route === "local" ? !!(localUrl.trim() && localModel.trim())
    : route === "subscription" ? settings!.ai.allow_subscription
    : route === "cloud" ? !!(key || settings!.ai[cloud].api_key) : false;
  const aiWhere = route === "embedded" ? "이 PC 안 내장 모델" : route === "openai" ? `기관 서버 ${baseUrl} · 모델 ${model}`
    : route === "local" ? `이 PC의 로컬 모델 서버 ${localUrl} · 모델 ${localModel}`
    : route === "subscription" ? (saved === "codex" ? "구독 계정(ChatGPT/Codex)" : "구독 계정(Claude Code)")
    : cloud === "gemini" ? "Google Gemini" : "Anthropic Claude";
  const aiTodo = route === "embedded" ? "설정 › AI 연결에서 내장 모델을 받거나 가져오세요. 저장하면 그 화면으로 갑니다."
    : route === "openai" ? "설정 › AI 연결에서 서버 주소와 모델 이름을 넣으세요. 저장하면 그 화면으로 갑니다."
    : route === "local" ? "Ollama나 LM Studio를 켜고 설정 › AI 연결에서 이 PC에서 찾기를 누르세요. 저장하면 그 화면으로 갑니다."
    : route === "subscription" ? "설정 › AI 연결의 구독 계정에서 로그인 상태를 확인하고 문서 보내기를 허용하세요. 저장하면 그 화면으로 갑니다."
    : route === "cloud" ? "설정 › AI 연결에서 API 키를 넣으세요. 저장하면 그 화면으로 갑니다."
    : "저장하면 설정 › AI 연결로 갑니다. 문서 읽기·바꾸기·검사는 AI 없이도 됩니다.";

  const steps = ["내 기관 정보", "AI 연결", "준비 끝"];

  return (
    <div className="kd-wizard-back" role="dialog" aria-modal="true" aria-labelledby="wiz-t">
      <div className="kd-wizard kd-float" ref={boxRef} onKeyDown={onEnter}>
        <div className="kd-wizard-head">
          <img src="/logo.png" alt="" width={28} height={28} />
          <div className="min-w-0 flex-1">
            <h1 id="wiz-t" className="kd-head-title">처음 오셨네요. 두 가지만 정하고 시작합니다</h1>
            <ol className="kd-wizard-steps">
              {steps.map((s, i) => <li key={s} data-state={i === step ? "now" : i < step ? "done" : "later"}>{i + 1}. {s}</li>)}
            </ol>
          </div>
        </div>

        <div className="kd-wizard-body">
          {step === 0 && (
            <>
              <p className="kd-text">서식의 기관명·부서·담당자·전화 칸, 공문 머리와 끝, 결재란에 자동으로 들어갑니다. 이 PC에만 저장합니다.</p>
              <div className="kd-fieldgrid mt-4">
                <TextField {...lp("기관명", "org.name")} value={org.name} onChange={(v) => set("name", v)} placeholder="예: 가온시" />
                <TextField {...lp("부서", "org.dept")} value={org.dept} onChange={(v) => set("dept", v)} placeholder="예: 총무과" />
                <TextField {...lp("직위", "org.position")} value={org.position} onChange={(v) => set("position", v)} placeholder="예: 주무관" />
                <TextField {...lp("이름", "org.person")} value={org.person} onChange={(v) => set("person", v)} />
                <TextField {...lp("전화", "org.phone")} value={org.phone} onChange={(v) => set("phone", v)} placeholder="02-000-0000" />
                <SelectField {...lp("기관 서식", "org.agency")} value={org.agency} onChange={(v) => set("agency", v)}
                  options={[{ value: "", label: "공통 서식" }, ...(meta?.agencies ?? []).filter((a) => a !== "공통").map((a) => ({ value: a, label: a }))]} />
              </div>
              <p className="kd-small kd-muted mt-3">팩스·주소·결재선·관인 그림은 설정의 내 기관 정보에서 넣으세요.</p>
            </>
          )}
          {step === 1 && (
            <>
              <p className="kd-text">요약·초안·검토에 쓸 AI를 어디서 돌릴까요? 문서 내용이 어디까지 가는지가 달라집니다.</p>
              <div className="kd-ai-tiles mt-4" role="radiogroup" aria-label="AI를 돌릴 곳">
                <RouteTile id="embedded" route={route} onPick={setRoute} icon={<Cpu size={20} />} title="이 PC 안에서" desc="인터넷 없이 내장 모델로. 모델은 설정에서 받거나 가져옵니다." badge="폐쇄망에서 됨" locked={tileLock("embedded")} />
                <RouteTile id="local" route={route} onPick={setRoute} icon={<HardDrive size={20} />} title="이 PC의 로컬 모델 서버" desc="이 PC에서 켠 Ollama·LM Studio 등에 연결합니다" badge="폐쇄망에서 됨" locked={tileLock("local")} />
                <RouteTile id="openai" route={route} onPick={setRoute} icon={<Server size={20} />} title="기관 AI 서버" desc="기관 안 서버 주소를 넣습니다" locked={tileLock("openai")} />
                <RouteTile id="cloud" route={route} onPick={setRoute} icon={<Cloud size={20} />} title="인터넷 AI 서비스" desc="Gemini나 Claude 키가 있을 때" locked={offline ? "폐쇄망 모드에서는 쓸 수 없습니다" : tileLock("cloud")} />
              </div>
              {route === "openai" && (
                <div className="kd-fieldgrid mt-4">
                  <TextField {...lp("주소", "ai.openai.base_url")} value={baseUrl} onChange={setBaseUrl} hint="Ollama는 보통 http://127.0.0.1:11434/v1" />
                  <TextField {...lp("모델", "ai.openai.model")} value={model} onChange={setModel} placeholder="예: gemma4" />
                </div>
              )}
              {route === "local" && (
                <>
                  <div className="kd-fieldgrid mt-4">
                    <TextField {...lp("주소", "ai.local.base_url")} value={localUrl} onChange={setLocalUrl} hint="Ollama는 보통 http://127.0.0.1:11434/v1" />
                    <TextField {...lp("모델", "ai.local.model")} value={localModel} onChange={setLocalModel} placeholder="예: gemma4" />
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <Button variant="secondary" size="sm" onClick={() => void findLocal()} disabled={finding === "busy" || lk("ai.local.base_url")}><Search size={13} /> {finding === "busy" ? "찾는 중" : "이 PC에서 찾기"}</Button>
                    {finding === "none" && <span className="kd-small kd-muted">켜진 서버를 찾지 못했습니다. Ollama나 LM Studio를 켜고 다시 찾거나 주소를 넣으세요.</span>}
                  </div>
                </>
              )}
              {route === "subscription" && <Note tone="info">구독 계정으로 정해져 있습니다. 로그인 상태와 문서 보내기 허용은 설정 › AI 연결에서 확인하세요.</Note>}
              {route === "cloud" && (
                <div className="kd-fieldgrid mt-4">
                  <SelectField label="서비스" disabled={pinned} value={cloud} onChange={setCloud} options={[{ value: "gemini", label: "Google Gemini" }, { value: "anthropic", label: "Anthropic Claude" }]} />
                  <TextField {...lp("API 키", `ai.${cloud}.api_key`)} type="password" value={key} onChange={setKey} />
                </div>
              )}
              <div className="mt-3">
                <Switch {...lp("폐쇄망 모드", "privacy.offline")} desc="인터넷이 막힌 PC라면 켜세요. 인터넷으로 나가는 연결을 모두 막습니다." checked={offline} onChange={setOffline} />
              </div>
            </>
          )}
          {step === 2 && (
            <div className="flex flex-col gap-2">
              <p className="kd-text">준비됐습니다. 홈에서 문서를 끌어다 놓거나 하려는 일을 고르세요.</p>
              <dl className="kd-dl kd-dl-wide mt-2">
                <div><dt>기관</dt><dd>{[org.name, org.dept, org.person].filter(Boolean).join(" · ") || "나중에 넣기"}</dd></div>
                <div><dt>AI</dt><dd>
                  <StatusLine tone={aiReady ? "ok" : "warn"}>{aiReady ? "AI 바로 쓸 수 있음" : "AI는 아직 준비 안 됨"}</StatusLine>
                  <span className="kd-small kd-muted block">{aiReady ? aiWhere : aiTodo}</span>
                </dd></div>
                <div><dt>폐쇄망 모드</dt><dd>{offline ? "켜짐" : "꺼짐"}</dd></div>
              </dl>
            </div>
          )}
        </div>

        {saveFailed && (
          <div className="px-6 pb-2">
            <Note tone="err">넣은 내용을 저장하지 못했습니다. 저장하지 않고 닫은 뒤 설정 › 내 기관 정보에서 다시 넣어 저장하세요.</Note>
          </div>
        )}
        <div className="kd-wizard-foot">
          {saveFailed && <Button variant="ghost" onClick={closeUnsaved} disabled={saving}>저장하지 않고 닫기</Button>}
          {step === 0 && <Button variant="ghost" onClick={() => void later()} disabled={saving}>여기까지 저장하고 닫기</Button>}
          {step === 1 && !pinned && <Button variant="ghost" onClick={() => { setRoute("none"); setStep(2); }}>AI는 나중에 정하기</Button>}
          <span className="flex-1" />
          {step > 0 && <Button variant="secondary" onClick={() => setStep(step - 1)}>이전</Button>}
          {step < 2 ? <Button size="lg" onClick={() => setStep(step + 1)}>다음</Button>
            : <Button ref={startRef} size="lg" onClick={() => void finish()} disabled={saving}>{saving ? "저장하는 중" : "저장하고 시작"}</Button>}
        </div>
      </div>
    </div>
  );
}
