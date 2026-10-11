/** 문서 하나의 작업 자리 — 정보 읽기(암호 문서는 암호 받기) + 미리보기 + 도구 패널 */

import { useEffect, useState } from "react";
import { KeyRound, Loader2 } from "lucide-react";
import { useApp, type OpenDoc, type ToolId } from "../../state/app";
import { rpc, errorText } from "../../lib/rpc";
import { Button } from "../ui/Button";
import { Empty, Note } from "../common/Status";
import { DocViewer } from "./DocViewer";
import { ToolPanel } from "./ToolPanel";

/** 확장자는 알아도 엔진이 읽지 못하는 형식 */
const UNSUPPORTED = "이 형식은 열 수 없습니다. 한글(HWP·HWPX), PDF, 워드(DOCX), 엑셀(XLSX·XLS), 파워포인트(PPTX), 그림(PNG·JPG·WEBP), 글(TXT·MD·CSV) 파일을 여세요.";

/** live: 쪽 그림 일꾼·쪽 그림을 들고 있을 문서인가 (지금 문서와 바로 전 문서만) */
export function DocWorkspace({ doc, active, hidden, live }: { doc: OpenDoc; active: boolean; hidden: boolean; live: boolean }) {
  const { updateDoc, focus } = useApp();
  const [error, setError] = useState("");
  const [askPassword, setAskPassword] = useState(false);
  /** 넣은 암호가 틀렸을 때 엔진이 준 안내 */
  const [pwError, setPwError] = useState("");
  const [password, setPassword] = useState("");
  const [tool, setTool] = useState<ToolId>("info");
  const [scrollTo, setScrollTo] = useState<{ page: number; nonce: number } | null>(null);
  const [autoRun, setAutoRun] = useState<{ kind: "summarize" | "redact"; nonce: number } | null>(null);

  // 처음 보일 때 문서 정보 읽기
  useEffect(() => {
    if (!active || doc.info || askPassword || error) return;
    let cancelled = false;
    const tried = doc.password;
    // 암호를 (다시) 묻는다. 틀렸으면 엔진 안내를 같이 보이고 틀린 암호는 버린다
    const reask = (msg: string) => {
      setPwError(tried ? msg : "");
      setPassword("");
      setAskPassword(true);
      if (tried) updateDoc(doc.path, { password: undefined });
    };
    rpc("doc_info", { path: doc.path, ...(tried ? { password: tried } : {}) })
      .then((info) => {
        if (cancelled) return;
        // 틀린 암호도 doc_info 는 성공한다: 경고에 암호 안내가 있거나 쪽 수를 못 셌으면 틀린 것
        const pwWarn = info.warnings.find((w) => /암호|password/i.test(w));
        if (info.format === "unknown") setError(UNSUPPORTED);
        else if (info.encrypted && info.warnings.some((w) => /DRM|문서보안/.test(w))) setError("한컴 문서보안(DRM)이 걸린 문서라 열 수 없습니다. 문서를 보낸 곳에 보안을 푼 사본을 달라고 하세요.");
        else if (info.encrypted && (!tried || pwWarn || (info.has_layout && !info.page_count))) reask(pwWarn ?? "암호가 맞지 않습니다. 다시 확인하세요.");
        else updateDoc(doc.path, { info, format: info.format });
      })
      .catch((e) => {
        if (cancelled) return;
        const msg = errorText(e);
        if (/암호|password/i.test(msg)) reask(msg);
        else setError(msg);
      });
    return () => { cancelled = true; };
  }, [active, doc.info, doc.path, doc.password, askPassword, error, updateDoc]);

  // 다른 화면에서 넘어온 요청 (근거 쪽으로 가기·도구 열기·요약 바로 시작)
  useEffect(() => {
    if (!focus || focus.value.path !== doc.path) return;
    if (focus.value.tool) setTool(focus.value.tool);
    if (focus.value.page) setScrollTo({ page: focus.value.page, nonce: focus.nonce });
    if (focus.value.run) { setTool(focus.value.run === "summarize" ? "ai" : "redact"); setAutoRun({ kind: focus.value.run, nonce: focus.nonce }); }
  }, [focus, doc.path]);

  const submitPassword = () => {
    setAskPassword(false);
    setError("");
    setPwError("");
    updateDoc(doc.path, { password, info: undefined });
  };

  let body;
  if (askPassword) {
    body = (
      <Empty icon={<KeyRound size={28} />} title="암호가 걸린 문서입니다"
        action={(
          <form className="flex flex-col items-center gap-2" onSubmit={(e) => { e.preventDefault(); submitPassword(); }}>
            {pwError && <span className="kd-small" role="alert" style={{ color: "var(--color-error)" }}>{pwError}</span>}
            <span className="flex gap-2">
              <input className="kd-input" style={{ width: 220 }} type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="문서 암호" aria-label="문서 암호" autoFocus />
              <Button type="submit" disabled={!password}>열기</Button>
            </span>
          </form>
        )}>
        문서를 만든 사람에게 받은 암호를 넣으세요. 암호는 저장하지 않습니다.
      </Empty>
    );
  } else if (error) {
    body = <div className="p-6"><Note tone="err">{error}</Note></div>;
  } else if (!doc.info) {
    body = <Empty icon={<Loader2 size={24} className="kd-spin" />} title="문서를 읽는 중" />;
  }

  return (
    <div className="kd-docws" hidden={hidden}>
      {body ?? (
        <>
          <DocViewer doc={doc} info={doc.info!} scrollTo={scrollTo} live={live} />
          <ToolPanel doc={doc} info={doc.info!} tool={tool} onTool={setTool} autoRun={autoRun}
            onGoPage={(page) => setScrollTo({ page, nonce: Date.now() })} />
        </>
      )}
    </div>
  );
}
