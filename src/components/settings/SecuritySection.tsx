/**
 * 다. 보안 — 폐쇄망 모드, AI 처리 위치, 자동 마스킹, 이번 실행에서 인터넷으로 나간 요청 수,
 * 최근 통신 기록, 사용 통계 전송 없음, 데이터 위치. 직접 눌러 확인하는 화면이라 있는 그대로 보여 준다.
 */

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, FolderOpen, RefreshCw, ShieldAlert, ShieldCheck } from "lucide-react";
import type { SecurityStatus } from "../../lib/contract";
import { useApp } from "../../state/app";
import { rpc, errorText } from "../../lib/rpc";
import { num } from "../../lib/format";
import { Button } from "../ui/Button";
import { Section, Switch } from "../common/Field";
import { ErrorLine } from "../common/Status";
import { lockProps, useLocked } from "./PolicyLock";

const WHERE: Record<string, string> = {
  embedded: "이 PC 안 (내장 모델)", local: "이 PC의 로컬 모델 서버", openai: "기관 AI 서버", gemini: "인터넷 서비스 (Google Gemini)", anthropic: "인터넷 서비스 (Anthropic Claude)",
  "claude-code": "구독 계정 (Claude Code 프로그램, Anthropic 서버)", codex: "구독 계정 (Codex 프로그램, OpenAI 서버)", none: "AI를 쓰지 않음",
};

function clock(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function SecuritySection({ active }: { active: boolean }) {
  const { settings, saveSettings } = useApp();
  const [st, setSt] = useState<SecurityStatus | null>(null);
  const [error, setError] = useState("");
  const [checkedAt, setCheckedAt] = useState(0);
  const lk = useLocked();

  const refresh = useCallback(async () => {
    try { setSt(await rpc("security_status", {})); setError(""); setCheckedAt(Date.now()); }
    catch (e) { setError(errorText(e)); }
  }, []);
  useEffect(() => { if (active) void refresh(); }, [active, refresh, settings?.privacy.offline, settings?.ai.provider]);

  const zero = st?.external_sent === 0;

  return (
    <Section id="set-sec" mark="다." title="보안" sub="이 앱이 문서를 어디로 보내는지 지금 상태 그대로 보여 줍니다."
      aside={<Button variant="secondary" size="sm" onClick={() => void refresh()}><RefreshCw size={13} /> 다시 확인</Button>}>
      <ErrorLine message={error} />
      {st && (
        <div className="flex flex-col gap-5">
          <div className="kd-sec-hero" data-ok={zero}>
            {zero ? <CheckCircle2 size={28} /> : <ShieldAlert size={28} />}
            <div className="min-w-0">
              <p className="kd-sec-big">이번 실행에서 인터넷으로 나간 요청: <b className="kd-num">{num(st.external_sent)}건</b></p>
              <p className="kd-small kd-muted">{zero ? "이 PC와 기관 안 주소 밖으로 나간 요청이 하나도 없습니다." : "아래 통신 기록에서 어디로 나갔는지 확인하세요."} 확인한 때: {checkedAt ? new Date(checkedAt).toLocaleTimeString("ko-KR") : ""}</p>
            </div>
          </div>

          <dl className="kd-dl kd-dl-wide">
            <div><dt>폐쇄망 모드</dt><dd>{st.offline ? <span className="kd-status" data-tone="ok"><ShieldCheck size={14} /> 켜짐: 인터넷으로 나가는 연결을 모두 막습니다</span> : "꺼짐: 인터넷 AI·법령 확인·모델 받기를 허용합니다"}</dd></div>
            <div><dt>AI 처리 위치</dt><dd>{WHERE[st.ai_provider] ?? st.ai_provider}{st.ai_is_cloud ? " · 문서 내용이 인터넷으로 나갑니다" : ""}</dd></div>
            <div><dt>보내기 전 자동 가림</dt><dd>{st.ai_is_cloud ? (st.redact_before_cloud ? "켜짐: 개인정보를 가린 뒤 보냅니다" : "꺼짐: 원문이 그대로 나갑니다") : `${st.redact_before_cloud ? "켜짐" : "꺼짐"} (지금은 인터넷 AI를 쓰지 않아 해당 없음)`}</dd></div>
            <div><dt>사용 통계 전송</dt><dd>없음: 사용 기록·통계를 어디에도 보내지 않습니다</dd></div>
            <div><dt>데이터 위치</dt><dd className="flex flex-wrap items-center gap-2"><span className="kd-path">{st.data_dir}</span><button type="button" className="kd-link kd-small" onClick={() => void rpc("open_folder", { path: st.data_dir }).catch(() => undefined)}><FolderOpen size={12} className="inline -mt-0.5" /> 열기</button></dd></div>
          </dl>

          <Switch {...lockProps("폐쇄망 모드", lk("privacy.offline"))} desc="켜면 인터넷 AI·법령 확인·모델 받기를 막고 기관 안 주소와 이 PC로만 연결합니다."
            checked={settings?.privacy.offline ?? false} onChange={(v) => void saveSettings({ privacy: { offline: v } })} />

          <div>
            <h3 className="kd-label mb-2">최근 통신 기록</h3>
            {st.recent.length === 0 ? <p className="kd-small kd-muted">이번 실행에서 통신한 곳이 없습니다.</p> : (
              <table className="kd-table">
                <thead><tr><th>시각</th><th>주소</th><th>이 PC 밖</th><th>결과</th></tr></thead>
                <tbody>
                  {st.recent.map((r, i) => (
                    <tr key={i}>
                      <td className="kd-num kd-small">{clock(r.at)}</td>
                      <td className="kd-small" style={{ wordBreak: "break-all" }}>{r.host}</td>
                      <td className="kd-small">{r.external ? "예 (인터넷)" : "아니요"}</td>
                      <td>{r.allowed ? <span className="kd-badge" data-tone={r.external ? "warn" : "ok"}>허용</span> : <span className="kd-badge" data-tone="err">막음</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </Section>
  );
}
