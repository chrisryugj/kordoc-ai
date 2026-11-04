/** 첫 실행 — 내 기관 정보(+ 선택: 우리 기관 문서 폴더)와 AI 연결을 한 번 받는다 (나중에 설정에서 바꿀 수 있음) */

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ChevronRight, Cloud, Cpu, FlaskConical, FolderPlus, Server, Sparkles } from "lucide-react";
import type { AiProviderId, Settings } from "../../lib/contract";
import { useApp } from "../../state/app";
import { writePref } from "../../lib/recent";
import { useGongmunMeta } from "../../hooks/useGongmunMeta";
import { Button } from "../ui/Button";
import { useDialogKeys } from "../ui/useDialogKeys";
import { Note, StatusLine } from "../common/Status";
import { Seg, SelectField, Switch, TextField } from "../common/Field";
import { RouteTile, groupOf, routeOf, type Group, type Route } from "../settings/AiSection";
import { firstChatModel } from "../settings/LocalServerPanel";
import { lockProps, useLocked } from "../settings/PolicyLock";
import { errorText, invokeCmd, rpc } from "../../lib/rpc";
import { pickFolder } from "../../lib/native";
import { addSummary, orgCorpusChanged } from "../../hooks/useOrgCorpus";
import { useStartSample } from "../home/HomeSamples";
import "./FirstRunWizard.css";

export function FirstRunWizard() {
  const { settings, saveSettings, setFirstRun, openSettings, ready, uiMode, setUiMode } = useApp();
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
  // 우클릭 메뉴: 아직 없으면 넣기를 켜 둔다 (끝낼 때 넣는다. 설정에서 뺄 수 있다)
  const [menu, setMenu] = useState<{ supported: boolean; installed: boolean; kind: string } | null>(null);
  const [addMenu, setAddMenu] = useState(true);
  useEffect(() => { invokeCmd<{ supported: boolean; installed: boolean; kind: string } | null>("shell_menu_status").then(setMenu).catch(() => setMenu(null)); }, []);
  const offerMenu = !!menu?.supported && !menu.installed;
  const [baseUrl, setBaseUrl] = useState(settings!.ai.openai.base_url);
  const [model, setModel] = useState(settings!.ai.openai.model);
  const [localUrl, setLocalUrl] = useState(settings!.ai.local.base_url);
  const [localModel, setLocalModel] = useState(settings!.ai.local.model);
  /** 이 PC 에서 켜져 있는 모델 서버(Ollama·LM Studio 등) — 2단계에 들어갈 때 한 번 찾는다 */
  const [found, setFound] = useState<{ base_url: string; model: string } | null>(null);
  const [cloud, setCloud] = useState<"gemini" | "anthropic">(saved === "anthropic" ? "anthropic" : "gemini");
  const [key, setKey] = useState("");
  const [saving, setSaving] = useState(false);
  /** 우리 기관 문서 모음에 넣은 것 (선택) — "보고서 3건 · 기안문 2건" */
  const [orgDocs, setOrgDocs] = useState("");
  const [orgBusy, setOrgBusy] = useState(false);
  const [orgError, setOrgError] = useState("");
  const putOrgDocs = async () => {
    const dir = await pickFolder();
    if (!dir) return;
    setOrgBusy(true);
    setOrgError("");
    try {
      const r = await rpc("org_corpus_add", { paths: [dir] });
      setOrgDocs(r.corpus.kinds.map((k) => `${k.label} ${k.count}건`).join(" · "));
      if (!r.added) setOrgError(r.skipped.length ? addSummary(r) : "그 폴더에 한글 문서(HWP·HWPX)가 없습니다.");
      orgCorpusChanged();
    } catch (e) {
      setOrgError(errorText(e));
    }
    setOrgBusy(false);
  };
  /** 저장이 실패했다 — 저장하지 않고 닫을 길을 연다 (앱이 마법사에 갇히지 않게) */
  const [saveFailed, setSaveFailed] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const startRef = useRef<HTMLButtonElement>(null);
  const lk = useLocked();
  const lp = (label: string, path: string) => lockProps(label, lk(path));
  const pinned = lk("ai.provider");
  const group = groupOf(route);
  const tileLock = (g: Group) => (pinned && group !== g ? "기관에서 정함" : undefined);
  /** 사람이 갈래를 한 번이라도 골랐나 (켜진 AI 를 찾아도 고른 것을 덮지 않게) */
  const picked = useRef(false);
  const pick = (r: Route) => { picked.current = true; setRoute(r); };
  const pickGroup = (g: Group) => {
    if (g === "pc") return pickPc();
    if (g !== group) pick(g === "ext" ? "cloud" : g);
  };
  const set = <K extends keyof Settings["org"]>(k: K, v: Settings["org"][K]) => setOrg((o) => ({ ...o, [k]: v }));

  useEffect(() => {
    if (step === 2) startRef.current?.focus();
    else boxRef.current?.querySelector<HTMLElement>(".kd-wizard-body input:not(:disabled), .kd-wizard-body button:not(:disabled)")?.focus();
  }, [step]);
  useEffect(() => { if (offline && (route === "cloud" || route === "subscription")) setRoute("embedded"); }, [offline, route]);

  // 이 PC에서 켜진 로컬 모델 서버 중 첫 번째 (127.0.0.1 만 본다). 찾으면 "이 PC에서"가 그 서버를 쓴다
  const usesFound = (f: { base_url: string; model: string }) => { setLocalUrl(f.base_url); setLocalModel(f.model); setRoute("local"); };
  useEffect(() => {
    if (step !== 1 || found || !ready) return;
    void rpc("ai_local_servers", {}).then((r) => {
      const sv = r.servers.find((x) => x.models.length);
      if (!sv) return;
      const f = { base_url: sv.base_url, model: sv.models.includes(localModel) ? localModel : firstChatModel(sv.models) };
      setFound(f);
      // 아직 고르지 않았고 AI 없이가 기본이면, 찾은 AI 를 추천 기본값으로
      if (!picked.current && startRoute === "none" && !pinned && !lk("ai.local.base_url")) usesFound(f);
    }, () => undefined);
  }, [step, found, ready, localModel]); // eslint-disable-line react-hooks/exhaustive-deps
  const pickPc = () => {
    picked.current = true;
    if (group === "pc") return;
    if (found && !lk("ai.local.base_url")) usesFound(found);
    else setRoute("embedded");
  };
  const pickPcSub = (r: Route) => {
    picked.current = true;
    if (r === "local" && found && !lk("ai.local.base_url")) usesFound(found);
    else setRoute(r);
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
    if (offerMenu && addMenu) await invokeCmd("shell_menu_install").catch(() => undefined);
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
  const aiWhere = route === "embedded" ? "이 PC에서 · 내장 AI" : route === "openai" ? `기관 AI 서버 ${baseUrl} · 모델 ${model}`
    : route === "local" ? `이 PC에서 · 켜 둔 AI 프로그램 (${localModel})`
    : route === "subscription" ? (saved === "codex" ? "외부 AI · OpenAI 구독 계정 (Codex)" : saved === "gemini-cli" ? "외부 AI · Google 구독 계정 (Gemini CLI)" : "외부 AI · Anthropic 구독 계정 (Claude Code)")
    : cloud === "gemini" ? "외부 AI · Google Gemini" : "외부 AI · Anthropic Claude";
  const aiTodo = route === "embedded" ? "저장하면 설정 › AI 연결로 가서 내장 AI를 받습니다."
    : route === "openai" ? "저장하면 설정 › AI 연결로 가서 서버 주소와 모델 이름을 넣습니다."
    : route === "local" ? "AI 프로그램(Ollama 등)을 켜 두면, 저장한 뒤 설정 › AI 연결에서 찾습니다."
    : route === "subscription" ? "저장하면 설정 › AI 연결로 가서 구독 계정 로그인과 문서 보내기 허용을 확인합니다."
    : route === "cloud" ? "저장하면 설정 › AI 연결로 가서 API 키를 넣습니다."
    : "나중에 왼쪽 아래 'AI 꺼짐 · 켜기'로 켤 수 있습니다.";

  const steps = ["기관 정보", "AI 연결", "화면 고르기"];

  return (
    <div className="kd-wizard-back" role="dialog" aria-modal="true" aria-labelledby="wiz-t">
      <div className="kd-wizard kd-wiz-fixed kd-float" ref={boxRef} onKeyDown={onEnter}>
        <div className="kd-wizard-head">
          <img src="/logo.png" alt="" width={28} height={28} />
          <div className="min-w-0 flex-1">
            <h1 id="wiz-t" className="kd-head-title">시작 준비</h1>
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
              <div className="kd-inset mt-4 flex items-center gap-3 px-3 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="kd-row-title block">우리 기관 문서 (선택)</span>
                  <span className="kd-row-desc block" style={{ textWrap: "balance" }}>{orgDocs ? `모음: ${orgDocs}` : "결재가 끝난 보고서·기안문이 든 폴더를 넣으면 AI 초안과 새 문서가 우리 기관 서식을 따릅니다."}</span>
                  {orgError && <span className="block mt-1"><StatusLine tone="warn">{orgError}</StatusLine></span>}
                </span>
                <Button variant="secondary" size="sm" disabled={orgBusy} onClick={() => void putOrgDocs()} data-tip="폴더 안 문서를 이 PC의 앱 데이터에 사본으로 둡니다. 원본은 그대로입니다"><FolderPlus size={13} /> {orgBusy ? "읽는 중" : "폴더 넣기"}</Button>
              </div>
              <p className="kd-small kd-muted mt-3">이 PC에만 저장합니다.</p>
            </>
          )}
          {step === 1 && (
            <>
              <p className="kd-text">AI를 꺼 두어도 점검·한글로 바꾸기·개인정보 가리기·수합은 됩니다.</p>
              <div className="kd-ai-tiles kd-wiz-tiles mt-4" role="radiogroup" aria-label="AI 연결">
                <RouteTile id="none" route={group} onPick={() => pick("none")} icon={<Sparkles size={20} />} title="AI 없이 시작"
                  desc="필요할 때 켭니다" badge={found ? undefined : "처음이면 이걸로"} locked={tileLock("none")}
                  tip="나중에 왼쪽 아래 'AI 꺼짐 · 켜기'로 켤 수 있습니다" />
                <RouteTile id="pc" route={group} onPick={pickGroup} icon={<Cpu size={20} />} title="이 PC에서"
                  desc={found ? `켜 둔 AI 프로그램을 찾았습니다 (${found.model})` : "문서가 PC 밖으로 나가지 않습니다"}
                  badge={found ? "추천" : "인터넷 없이 됨"} locked={tileLock("pc")}
                  tip="내장 AI를 받거나 이 PC에 켜 둔 AI 프로그램(Ollama 등)에 연결합니다. 인터넷 없이 됩니다." />
                <RouteTile id="openai" route={group} onPick={pickGroup} icon={<Server size={20} />} title="기관 AI 서버" desc="기관이 알려 준 주소로 연결" locked={tileLock("openai")}
                  tip="기관 전산 담당자에게 AI 서버 주소를 받았을 때" />
                <RouteTile id="ext" route={group} onPick={pickGroup} icon={<Cloud size={20} />} title="외부 AI"
                  desc="문서 내용이 그 회사로 갑니다" locked={offline ? "인터넷이 막힌 PC로 정해 두어 쓸 수 없습니다" : tileLock("ext")}
                  tip="Gemini·Claude 키나 Claude·ChatGPT 유료 구독이 있을 때. 개인정보는 가려서 보냅니다." />
              </div>
              {group === "pc" && (found ? (
                <div className="mt-4">
                  <Seg label="이 PC에서 쓰는 방법" value={route} onChange={pickPcSub} disabled={!!pinned}
                    options={[{ value: "local", label: "켜 둔 AI 프로그램" }, { value: "embedded", label: "내장 AI 받기" }]} />
                </div>
              ) : <p className="kd-small kd-muted mt-3">켜 둔 AI 프로그램이 없어 내장 AI를 씁니다.</p>)}
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
                    <SelectField label="회사" disabled={pinned} value={cloud} onChange={setCloud} options={[{ value: "anthropic", label: "Anthropic (Claude)" }, { value: "gemini", label: "Google (Gemini)" }]} />
                    <TextField {...lp("API 키", `ai.${cloud}.api_key`)} type="password" value={key} onChange={setKey} hint="키가 없으면 비워 두고, 설정 › AI 연결에서 만드는 곳을 안내받으세요." />
                  </div>
                  <p className="kd-small kd-muted mt-2">유료 구독 계정은 설정 › AI 연결 › 외부 AI에서 연결합니다.</p>
                </>
              )}
              <div className="mt-4">
                <Switch {...lp("인터넷이 막힌 PC입니다", "privacy.offline")} desc="켜면 인터넷으로 나가는 연결을 모두 막습니다(폐쇄망 모드)." checked={offline} onChange={setOffline} />
              </div>
            </>
          )}
          {step === 2 && (
            <div className="flex flex-col gap-2">
              <p className="kd-text">준비됐습니다. 처음이면 예제로 한 번 해 보세요.</p>
              <div className="kd-modepick" role="radiogroup" aria-label="화면 방식">
                <button type="button" role="radio" aria-checked={uiMode === "easy"} onClick={() => setUiMode("easy")}>
                  <b>쉬운 화면</b><span>자주 하는 일을 큰 단추로 보이고 세부 설정은 접어 둡니다. 처음 쓰면 이쪽을 고르세요.</span>
                </button>
                <button type="button" role="radio" aria-checked={uiMode === "full"} onClick={() => setUiMode("full")}>
                  <b>전체 화면</b><span>모든 기능과 세부 설정을 메뉴에 묶어 보입니다. 나중에 왼쪽 메뉴 아래에서 바꿀 수 있습니다.</span>
                </button>
              </div>
              <dl className="kd-dl kd-dl-wide mt-2">
                <div><dt>기관</dt><dd>{[org.name, org.dept, org.person].filter(Boolean).join(" · ") || "나중에 넣기"}</dd></div>
                {orgDocs && <div><dt>우리 기관 문서</dt><dd>{orgDocs}</dd></div>}
                <div><dt>AI</dt><dd>
                  <StatusLine tone={aiReady ? "ok" : route === "none" ? "muted" : "warn"}>{aiReady ? "AI 바로 쓸 수 있음" : route === "none" ? "AI 없이 시작" : "AI는 아직 준비 안 됨"}</StatusLine>
                  <span className="kd-small kd-muted block">{aiReady ? aiWhere : aiTodo}</span>
                </dd></div>
                <div><dt>폐쇄망 모드</dt><dd>{offline ? "켜짐" : "꺼짐"}</dd></div>
              </dl>
              {offerMenu && (
                <div className="mt-2">
                  <Switch label={menu?.kind === "quick-action" ? "Finder 빠른 동작 넣기" : "탐색기 우클릭 메뉴 넣기"} checked={addMenu} onChange={setAddMenu}
                    desc={menu?.kind === "quick-action"
                      ? "파일을 우클릭해 하나로 합치기·용량 줄이기, 한글 문서로 바꾸기 같은 일을 앱을 열지 않고 바로 합니다. 설정에서 뺄 수 있습니다."
                      : "파일을 우클릭해 하나로 합치기, 나누기, 쪽 번호 넣기, 받은 공문 접수 같은 일을 앱을 열지 않고 바로 합니다. 설정에서 뺄 수 있습니다."} />
                </div>
              )}
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
          {step < 2 && <Button variant="ghost" onClick={() => void later()} disabled={saving} data-tip="넣은 것만 저장하고 닫습니다. 나머지는 설정에서 바꿀 수 있습니다">나중에 하기</Button>}
          <span className="flex-1" />
          {step > 0 && <Button variant="secondary" onClick={() => setStep(step - 1)}>이전</Button>}
          {step === 2 && <Button variant="secondary" size="lg" onClick={() => void finish(true)} disabled={saving} data-tip="저장한 뒤 예제 문서로 한 번 해 봅니다. 예제 원본은 그대로입니다"><FlaskConical size={15} /> 예제로 연습하기</Button>}
          {step < 2 ? <Button size="lg" onClick={() => setStep(step + 1)}>다음</Button>
            : <Button ref={startRef} size="lg" onClick={() => void finish()} disabled={saving}>{saving ? "저장하는 중" : "저장하고 시작"}</Button>}
        </div>
      </div>
    </div>
  );
}
