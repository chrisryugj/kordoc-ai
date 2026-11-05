/** AI 연결 › 외부 AI › 구독 계정 — PC에 설치해 로그인한 Claude Code(Anthropic)·Codex(OpenAI)·Antigravity CLI(Google) 프로그램을 쓴다. 회사는 AI 연결에서 고른다
 *  설치·로그인 상태를 프로그램에 물어 보여 주고, 안 됐으면 터미널에서 칠 명령을 알려 준다. 앱은 로그인 정보를 읽거나 만들지 않는다.
 *  문서 보내기를 허용하고 저장하기 전에는 프로그램을 띄우지 않고 설치 위치만 본다. 프로그램 위치는 기관 배포 설정으로만 바꾼다. */

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUpCircle, RefreshCw } from "lucide-react";
import type { Settings, SubscriptionStatus } from "../../lib/contract";
import { rpc } from "../../lib/rpc";
import { useApp } from "../../state/app";
import { useTask } from "../../hooks/useTask";
import { Button } from "../ui/Button";
import { Field, Switch } from "../common/Field";
import { ErrorLine, Note, StatusLine, Working } from "../common/Status";
import { lockProps, useLocked } from "./PolicyLock";
import { Advanced } from "./dirty";

export type SubProvider = "claude-code" | "codex" | "gemini-cli";
type Ai = Settings["ai"];
const SLOT = { "claude-code": "claude_code", codex: "codex", "gemini-cli": "gemini_cli" } as const;
/** 설정의 프로그램 칸 (ai.claude_code · ai.codex · ai.gemini_cli) */
export const subSlot = (p: SubProvider) => SLOT[p];
const COMPANY: Record<SubProvider, string> = { "claude-code": "Anthropic", codex: "OpenAI", "gemini-cli": "Google" };
/** 회사 이름 + 주격 조사 */
const COMPANY_SUBJ: Record<SubProvider, string> = { "claude-code": "Anthropic이", codex: "OpenAI가", "gemini-cli": "Google이" };
const PROGRAM: Record<SubProvider, string> = { "claude-code": "Claude Code", codex: "Codex", "gemini-cli": "Antigravity CLI" };
const INTRO: Record<SubProvider, string> = {
  "claude-code": "Claude Pro·Max 구독으로 로그인한 Claude Code 프로그램을 씁니다.",
  codex: "ChatGPT Plus·Pro 구독으로 로그인한 Codex 프로그램을 씁니다.",
  "gemini-cli": "Google 계정으로 로그인한 Antigravity CLI(agy) 프로그램을 씁니다.",
};

function StatusView({ st }: { st: SubscriptionStatus }) {
  const ver = st.version ? ` · 버전 ${st.version}` : "";
  if (st.state === "ready") return <StatusLine tone="ok">로그인됨 ({st.provider === "gemini-cli" ? "Google 계정" : "구독"}{st.plan ? ` ${st.plan}` : ""}{ver})</StatusLine>;
  const tone = st.state === "unknown-login" || st.state === "installed" ? "warn" : "err";
  const title = { "unknown-login": "로그인됨 (구독인지 확인 못 함)", metered: "구독이 아닌 로그인", installed: "설치됨 (로그인은 허용한 뒤 확인)", "signed-out": "로그인 안 됨", "not-installed": "프로그램 없음",
    "needs-update": "버전이 낮음", error: "확인하지 못함", offline: "폐쇄망 모드", disabled: "기관에서 막음" }[st.state];
  const showCmd = ["signed-out", "metered", "unknown-login", "not-installed"].includes(st.state);
  return (
    <div className="flex flex-col gap-1">
      <StatusLine tone={tone}>{title}{ver}</StatusLine>
      {st.message && <p className="kd-small">{st.message}</p>}
      {showCmd && <p className="kd-small kd-muted">해결: 명령 프롬프트나 PowerShell에서 <code className="font-mono" style={{ color: "var(--color-text-primary)" }}>{st.login_command}</code>를 실행해 로그인한 뒤 다시 확인을 누르세요.</p>}
    </div>
  );
}

export function SubscriptionPanel({ provider, draft, onChange }: {
  provider: SubProvider; draft: Ai; onChange: (patch: Partial<Ai>) => void;
}) {
  const { settings, toast } = useApp();
  const savedAllow = !!settings?.ai.allow_subscription;
  const lk = useLocked();
  const lp = (label: string, path: string) => lockProps(label, lk(path));
  const key = subSlot(provider);
  const cfg = draft[key];
  const check = useTask<SubscriptionStatus>();
  const list = useTask<Array<{ id: string; label: string }>>();
  const upd = useTask<{ ok: boolean; message: string }>();
  // 프로그램의 공식 업데이트 명령(claude update · codex update · agy update)을 앱이 대신 실행한다. 끝나면 상태를 다시 묻는다
  const update = () => void upd.run(async ({ signal }) => {
    const r = await rpc("ai_subscription_update", { provider }, { signal });
    toast(r.message, r.ok ? "success" : "error");
    // 업데이트하는 사이 회사를 바꿨으면 지금 보이는 프로그램을 다시 묻는다 (옛 프로그램 상태로 덮지 않게)
    recheckRef.current();
    return r;
  });
  const [models, setModels] = useState<{ provider: SubProvider; items: Array<{ id: string; label: string }> } | null>(null);

  // 프로그램을 바꾸거나 허용을 저장하면 다시 묻는다 (허용 전에는 엔진이 띄우지 않고 설치 위치만 본다)
  const recheck = useCallback(() => void check.run(async ({ signal }) => (await rpc("ai_subscription_status", { provider }, { signal })).statuses[0]), [provider, savedAllow]); // eslint-disable-line react-hooks/exhaustive-deps
  const recheckRef = useRef(recheck);
  recheckRef.current = recheck;
  useEffect(() => { recheck(); }, [recheck]);

  const loadModels = () => void list.run(async ({ signal }) => {
    const items = (await rpc("ai_subscription_models", { provider }, { signal })).models;
    setModels({ provider, items });
    return items;
  });
  // 다른 프로그램의 목록은 보이지 않게
  const shown = models?.provider === provider ? models.items : [];
  const set = (p: Partial<Ai[typeof key]>) => onChange({ [key]: { ...cfg, ...p } } as Partial<Ai>);
  const st = check.result?.provider === provider ? check.result : null;
  const canList = savedAllow && (st?.state === "ready" || st?.state === "unknown-login");

  return (
    <>
      <p className="kd-small kd-muted">
        {INTRO[provider]} API 키는 필요 없습니다.
      </p>
      {provider === "gemini-cli" && (
        <Note tone="warn">Antigravity CLI는 도구 목록을 끌 수 없습니다. 파일·명령·웹 주소 열기·MCP 도구는 거절하는 설정으로 띄우고, 도구를 쓰려 하면 그 자리에서 멈춥니다. 웹 검색은 막을 수 없어 검색어가 Google로 갈 수 있습니다. Claude Code·Codex보다 보호가 한 겹 약합니다.</Note>
      )}

      <div className="kd-panel flex items-start gap-3 p-3">
        <div className="min-w-0 flex-1">
          {check.busy ? <Working label="프로그램 상태를 확인하는 중" /> : st ? <StatusView st={st} /> : null}
          <ErrorLine message={check.error} />
          <ErrorLine message={upd.error} />
        </div>
        <Button variant="secondary" size="sm" onClick={recheck} disabled={check.busy}
          data-tip={savedAllow ? `이 PC의 ${PROGRAM[provider]} 프로그램을 잠깐 띄워 설치·로그인 상태를 묻습니다` : `허용 전에는 프로그램을 띄우지 않고 ${PROGRAM[provider]} 설치 위치만 봅니다`}><RefreshCw size={13} /> 다시 확인</Button>
        {savedAllow && st && !["not-installed", "offline", "disabled"].includes(st.state) && (
          <Button variant={st.state === "needs-update" ? "primary" : "secondary"} size="sm" onClick={update} disabled={upd.busy || check.busy}
            data-tip={`${PROGRAM[provider]}의 공식 업데이트 명령으로 최신 판을 받습니다. 몇 분 걸릴 수 있습니다`}>
            <ArrowUpCircle size={13} /> {upd.busy ? "업데이트하는 중" : "업데이트"}
          </Button>
        )}
      </div>

      <Switch {...lp("구독 계정으로 문서 보내기 허용", "ai.allow_subscription")}
        desc={`문서 내용이 인터넷의 ${COMPANY[provider]} 서버로 갑니다. 켜고 저장해야 이 연결로 보내고 로그인 상태도 확인합니다. 폐쇄망 모드에서는 쓸 수 없습니다.`}
        checked={draft.allow_subscription} onChange={(v) => onChange({ allow_subscription: v })} />

      <Field label={lp("모델", `ai.${key}.model`).label} hint="비워 두면 프로그램의 기본 모델을 씁니다">
        <div className="flex gap-2">
          {shown.length ? (
            <select className="kd-select" disabled={lk(`ai.${key}.model`)} value={cfg.model} onChange={(e) => set({ model: e.target.value })} aria-label="모델">
              {!shown.some((m) => m.id === cfg.model) && <option value={cfg.model}>{cfg.model || "기본 모델"}</option>}
              {shown.map((m) => <option key={m.id} value={m.id}>{m.id ? m.label : `${m.label} (기본)`}</option>)}
            </select>
          ) : (
            <input className="kd-input" disabled={lk(`ai.${key}.model`)} value={cfg.model} onChange={(e) => set({ model: e.target.value })} placeholder="기본 모델" aria-label="모델" />
          )}
          <Button variant="secondary" onClick={loadModels} disabled={list.busy || lk(`ai.${key}.model`) || !canList}
            data-tip={canList ? `${PROGRAM[provider]} 프로그램에 쓸 수 있는 모델을 묻습니다` : "문서 보내기를 허용해 저장하고 로그인돼 있으면 불러올 수 있습니다"}><RefreshCw size={13} /> 불러오기</Button>
        </div>
      </Field>
      <ErrorLine message={list.error} />

      <Switch {...lp("보내기 전에 개인정보 자동으로 가리기", "ai.redact_before_cloud")} desc="주민등록번호·전화번호·계좌번호 같은 것을 가린 뒤 보냅니다. 끄지 않기를 권합니다."
        checked={draft.redact_before_cloud} onChange={(v) => onChange({ redact_before_cloud: v })} />

      <Advanced>
        <dl className="kd-dl">
          <div><dt>프로그램 위치</dt><dd className="kd-path" style={{ wordBreak: "break-all" }}>{st?.path ?? "찾지 못함"}</dd></div>
        </dl>
        <p className="kd-small kd-muted">PATH와 흔한 설치 폴더에서 자동으로 찾습니다. 다른 위치는 정보통신 담당자가 기관 배포 설정(ai.{key}.cli_path)으로만 정할 수 있습니다. 프로그램은 파일·명령 도구를 끄거나 모두 거절한 채 답만 하도록 띄웁니다.</p>
      </Advanced>
      <Note tone="warn">구독은 개인이 대화로 쓰는 것을 전제로 합니다. 많은 문서를 한꺼번에 보내면 {COMPANY_SUBJ[provider]} 계정 사용을 제한할 수 있습니다. 이용 약관을 확인하고 쓰세요.</Note>
    </>
  );
}
