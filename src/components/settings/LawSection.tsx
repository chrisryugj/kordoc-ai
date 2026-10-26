/** 아. 법령 확인 — 법제처 Open API 아이디(OC) 넣기·연결 확인. 인터넷 PC에서만 대조하고, 폐쇄망 모드면 인용 찾기만 */

import { useEffect, useState } from "react";
import { PlugZap, Save } from "lucide-react";
import type { RpcResult } from "../../lib/contract";
import { useApp } from "../../state/app";
import { rpc } from "../../lib/rpc";
import { useTask } from "../../hooks/useTask";
import { Button } from "../ui/Button";
import { Section, TextField } from "../common/Field";
import { ErrorLine, Note, Working } from "../common/Status";
import { Advanced, UnsavedBadge, useDirtyMark } from "./dirty";

export function LawSection() {
  const { settings, saveSettings, toast } = useApp();
  const saved = settings?.law?.oc ?? "";
  const offline = settings?.privacy.offline ?? false;
  const [oc, setOc] = useState(saved);
  const [saving, setSaving] = useState(false);
  const test = useTask<RpcResult<"law_test">>();

  useEffect(() => setOc(saved), [saved]);

  const changed = oc.trim() !== saved;
  const save = async () => {
    setSaving(true);
    const next = await saveSettings({ law: { oc: oc.trim() } });
    setSaving(false);
    if (next) toast("법령 확인 아이디를 저장했습니다", "success");
    return !!next;
  };
  useDirtyMark("set-law", "법령 확인", changed, save, () => setOc(saved));
  const runTest = () => void test.run(async () => {
    if (changed && !(await save())) throw new Error("저장하지 못해 연결을 확인하지 않았습니다. 다시 저장해 보세요.");
    return rpc("law_test", {});
  });

  return (
    <Section id="set-law" mark="아." title="법령 확인" sub="문서 속 「법령명」 제N조 인용을 법제처 현행 법령과 대조합니다."
      aside={changed ? <UnsavedBadge /> : undefined}>
      <div className="flex flex-col gap-4">
        {offline && <Note tone="info">폐쇄망 모드라 법제처에 묻지 않습니다. 문서 속 법령 인용을 찾는 것까지만 합니다.</Note>}
        <div className="kd-fieldgrid">
          <TextField label="법제처 아이디" hint="법제처 공동활용 누리집에 가입한 이메일의 @ 앞부분" value={oc} onChange={setOc} placeholder="예: hong" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => void save()} disabled={saving || !changed}><Save size={14} /> {saving ? "저장하는 중" : "저장"}</Button>
          {test.busy ? <Working label="법제처에 연결하는 중" /> : (
            <Button variant="secondary" onClick={runTest} disabled={offline || !oc.trim()}><PlugZap size={14} /> 연결 확인</Button>
          )}
        </div>
        <ErrorLine message={test.error} />
        {test.result && (test.result.ok
          ? <Note tone="ok">연결됐습니다. 법제처에서 현행 법령을 받아 왔습니다.</Note>
          : <Note tone="err">{test.result.error}</Note>)}
        <div className="kd-inset flex flex-col gap-1.5 p-3">
          <span className="kd-label">아이디 받는 법</span>
          <ol className="kd-small kd-muted flex list-decimal flex-col gap-1 pl-5">
            <li>법제처 국가법령정보 공동활용(open.law.go.kr)에 가입하고 Open API 활용을 신청합니다. 무료입니다.</li>
            <li>가입한 이메일의 @ 앞부분이 아이디입니다. 예를 들어 hong@korea.kr이면 hong입니다.</li>
            <li>위 칸에 넣고 저장한 뒤 연결 확인을 누르세요.</li>
          </ol>
          <p className="kd-small kd-muted">인터넷이 되는 PC에서만 대조합니다. 폐쇄망 모드를 켜면 법제처에 묻지 않습니다.</p>
        </div>
        <Advanced>
          <p className="kd-small kd-muted">이 아이디를 법제처 누리집에서는 Open API 인증값(OC)이라고 부릅니다.</p>
        </Advanced>
      </div>
    </Section>
  );
}
