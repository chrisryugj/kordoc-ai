/** 첫 실행 — 내 기관 정보와 AI 연결을 한 번 받는다 (나중에 설정에서 바꿀 수 있음) */

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ChevronRight, Cloud, Cpu, FlaskConical, Server, Sparkles } from "lucide-react";
import type { AiProviderId, Settings } from "../../lib/contract";
import { useApp } from "../../state/app";
import { writePref } from "../../lib/recent";
import { useGongmunMeta } from "../../hooks/useGongmunMeta";
import { Button } from "../ui/Button";
import { useDialogKeys } from "../ui/useDialogKeys";
import { Note, StatusLine } from "../common/Status";
import { SelectField, Switch, TextField } from "../common/Field";
import { RouteTile, routeOf, type Route } from "../settings/AiSection";
import { firstChatModel } from "../settings/LocalServerPanel";
import { lockProps, useLocked } from "../settings/PolicyLock";
import { rpc } from "../../lib/rpc";
import { useStartSample } from "../home/HomeSamples";

export function FirstRunWizard() {
  const { settings, saveSettings, setFirstRun, openSettings, ready } = useApp();
  const startSample = useStartSample();
  const meta = useGongmunMeta();
  const [step, setStep] = useState(0);
  const [org, setOrg] = useState<Settings["org"]>(settings!.org);
  // 기관 배포 설정 등으로 이미 정해진 AI 갈래가 있으면 그것부터 (기본 "이 PC 안"으로 덮어쓰지 않게)
  const saved = settings!.ai.provider;
  // 구독 계정(기관 배포 설정으로 정해 둔 경우)은 이 마법사에 칸이 없다: 고른 그대로 두고 설정에서 확인하게 한다
  const [startRoute] = useState<Route>(routeOf(saved));
  const [route, setRoute] = useState<Route>(startRoute);
  const [offline, setOffline] = useState(settings!.privacy.offline);
  const [baseUrl, setBaseUrl] = useState(settings!.ai.openai.base_url);
  const [model, setModel] = useState(settings!.ai.openai.model);
  const [localUrl, setLocalUrl] = useState(settings!.ai.local.base_url);
  const [localModel, setLocalModel] = useState(settings!.ai.local.model);
  /** 이 PC 에서 켜져 있는 모델 서버(Ollama·LM Studio 등) — 2단계에 들어갈 때 한 번 찾는다 */
  const [found, setFound] = useState<{ base_url: string; model: string } | null>(null);
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

  // 이 PC에서 켜진 로컬 모델 서버 중 첫 번째 (127.0.0.1 만 본다). 찾으면 "이 PC 안에서만"이 그 서버를 쓴다
  useEffect(() => {
    if (step !== 1 || found || !ready) return;
    void rpc("ai_local_servers", {}).then((r) => {
      const sv = r.servers.find((x) => x.models.length);
      if (sv) setFound({ base_url: sv.base_url, model: sv.models.includes(localModel) ? localModel : firstChatModel(sv.models) });
    }, () => undefined);
  }, [step, found, ready, localModel]);
  const pickPc = () => {
    if (found && !lk("ai.local.base_url")) { setLocalUrl(found.base_url); setLocalModel(found.model); setRoute("local"); }
    else setRoute("embedded");
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

  const finish = async (practice = false) => {
    if (!(await save(true))) return;
    done();
    if (practice) {
      // AI 없이도 되는 예제(개인정보 가리기)로, AI 가 준비됐으면 받은 공문 회신 예제로
      const r = await rpc("samples_list", {}).catch(() => null);
      const sc = r?.scenarios.find((x) => x.id === (aiReady ? "reply" : "redact"));
      if (sc) { startSample(sc); return; }
    }
    // AI 를 골랐는데 아직 덜 됐으면(모델·주소·키 없음) 설정의 AI 연결 구획으로 바로. AI 없이 시작이면 홈 그대로
    if (route !== "none" && !aiReady) openSettings("set-ai");
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
    : "AI 없이 시작합니다. 나중에 왼쪽 아래 AI 켜기나 설정 › AI 연결에서 켤 수 있습니다.";

  const steps = ["내 기관 정보", "AI 쓸지 정하기", "준비 끝"];

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
              <p className="kd-text">공문 머리·결재란·서식의 기관 칸에 자동으로 들어갑니다. 비워 두고 나중에 넣어도 됩니다.</p>
              <div className="kd-fieldgrid mt-4">
                <TextField {...lp("기관명", "org.name")} value={org.name} onChange={(v) => set("name", v)} placeholder="예: 가온시" />
                <TextField {...lp("부서", "org.dept")} value={org.dept} onChange={(v) => set("dept", v)} placeholder="예: 총무과" />
              </div>
              <details className="kd-more mt-4">
                <summary><ChevronRight size={14} aria-hidden="true" /> 더 넣기 (선택): 직위·이름·전화·기관 서식</summary>
                <div className="kd-fieldgrid mt-3">
                  <TextField {...lp("직위", "org.position")} value={org.position} onChange={(v) => set("position", v)} placeholder="예: 주무관" />
                  <TextField {...lp("이름", "org.person")} value={org.person} onChange={(v) => set("person", v)} />
                  <TextField {...lp("전화", "org.phone")} value={org.phone} onChange={(v) => set("phone", v)} placeholder="02-000-0000" />
                  <SelectField {...lp("기관 서식", "org.agency")} value={org.agency} onChange={(v) => set("agency", v)}
                    options={[{ value: "", label: "공통 서식" }, ...(meta?.agencies ?? []).filter((a) => a !== "공통").map((a) => ({ value: a, label: a }))]} />
                </div>
                <p className="kd-small kd-muted mt-3">팩스·주소·결재선·관인 그림은 설정의 내 기관 정보에서 넣습니다.</p>
              </details>
              <p className="kd-small kd-muted mt-3">이 PC에만 저장합니다.</p>
            </>
          )}
          {step === 1 && (
            <>
              <p className="kd-text">AI 기능을 켤까요? 꺼 두어도 표기법 점검·한글로 바꾸기·개인정보 가리기·문서 수합은 그대로 됩니다.</p>
              <div className="kd-ai-tiles mt-4" role="radiogroup" aria-label="AI 쓸지 정하기">
                <RouteTile id="none" route={route} onPick={setRoute} icon={<Sparkles size={20} />} title="AI 없이 시작"
                  desc="지금은 AI를 쓰지 않습니다. 필요할 때 왼쪽 아래 AI 켜기를 누르면 됩니다." badge="처음이면 이걸로" locked={tileLock("none")} />
                <RouteTile id={route === "local" ? "local" : "embedded"} route={route} onPick={pickPc} icon={<Cpu size={20} />} title="이 PC 안에서만"
                  desc={found && route !== "embedded" ? `이 PC에서 켜진 AI를 찾았습니다 (${found.model}). 문서가 PC 밖으로 나가지 않습니다.` : "문서가 PC 밖으로 나가지 않습니다. AI 모델 파일을 한 번 받아야 하고, 다음 화면에서 안내합니다."}
                  badge="인터넷 없이 됨" locked={tileLock(route === "local" ? "local" : "embedded")} />
                <RouteTile id="cloud" route={route} onPick={setRoute} icon={<Cloud size={20} />} title="인터넷 AI"
                  desc="Gemini·Claude 키를 넣어 씁니다. 더 똑똑하지만 문서 내용이 그 회사로 갑니다." locked={offline ? "인터넷이 막힌 PC로 정해 두어 쓸 수 없습니다" : tileLock("cloud")} />
                {(startRoute === "openai" || route === "openai") && (
                  <RouteTile id="openai" route={route} onPick={setRoute} icon={<Server size={20} />} title="기관 AI 서버" desc="기관이 정해 준 서버를 씁니다" locked={tileLock("openai")} />
                )}
              </div>
              {route === "openai" && (
                <div className="kd-fieldgrid mt-4">
                  <TextField {...lp("주소", "ai.openai.base_url")} value={baseUrl} onChange={setBaseUrl} />
                  <TextField {...lp("모델", "ai.openai.model")} value={model} onChange={setModel} />
                </div>
              )}
              {route === "subscription" && <Note tone="info">기관에서 구독 계정으로 정해 두었습니다. 로그인 상태와 문서 보내기 허용은 설정 › AI 연결에서 확인하세요.</Note>}
              {route === "cloud" && (
                <>
                  <div className="kd-fieldgrid mt-4">
                    <SelectField label="서비스" disabled={pinned} value={cloud} onChange={setCloud} options={[{ value: "gemini", label: "Google Gemini" }, { value: "anthropic", label: "Anthropic Claude" }]} />
                    <TextField {...lp("API 키", `ai.${cloud}.api_key`)} type="password" value={key} onChange={setKey} hint="키가 없으면 비워 두고, 설정 › AI 연결에서 만드는 곳을 안내받으세요." />
                  </div>
                  <p className="kd-small kd-muted mt-2">Claude·ChatGPT 유료 구독을 이미 쓰고 있다면 설정 › AI 연결 › 구독 계정에서 키 없이 연결할 수 있습니다.</p>
                </>
              )}
              <div className="mt-4">
                <Switch {...lp("인터넷이 막힌 PC입니다", "privacy.offline")} desc="켜면 인터넷으로 나가는 연결을 모두 막습니다(폐쇄망 모드)." checked={offline} onChange={setOffline} />
              </div>
            </>
          )}
          {step === 2 && (
            <div className="flex flex-col gap-2">
              <p className="kd-text">준비됐습니다. 홈에서 문서를 넣거나 자주 하는 일을 누르면 됩니다. 처음이면 예제 문서로 한 번 해 보세요.</p>
              <dl className="kd-dl kd-dl-wide mt-2">
                <div><dt>기관</dt><dd>{[org.name, org.dept, org.person].filter(Boolean).join(" · ") || "나중에 넣기"}</dd></div>
                <div><dt>AI</dt><dd>
                  <StatusLine tone={aiReady ? "ok" : route === "none" ? "muted" : "warn"}>{aiReady ? "AI 바로 쓸 수 있음" : route === "none" ? "AI 없이 시작" : "AI는 아직 준비 안 됨"}</StatusLine>
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
          <span className="flex-1" />
          {step > 0 && <Button variant="secondary" onClick={() => setStep(step - 1)}>이전</Button>}
          {step === 2 && <Button variant="secondary" size="lg" onClick={() => void finish(true)} disabled={saving}><FlaskConical size={15} /> 예제로 연습하기</Button>}
          {step < 2 ? <Button size="lg" onClick={() => setStep(step + 1)}>다음</Button>
            : <Button ref={startRef} size="lg" onClick={() => void finish()} disabled={saving}>{saving ? "저장하는 중" : "저장하고 시작"}</Button>}
        </div>
      </div>
    </div>
  );
}
