/**
 * 문서 카드: 탐색기 우클릭 "영수증으로 지출조서 만들기" (그림·PDF, 여러 장이면 한 카드에 줄 여러 개).
 * 이 PC 안에서 글자를 읽고(OCR) 값을 뽑아 고칠 수 있는 표로 → 지출조서 미리보기 → 끝나면 표를 클립보드에 넣는다.
 * 이 PC·기관 AI 서버가 켜져 있으면 적요 한 줄만 AI 로, 외부 AI 는 사용자가 누를 때만 (ReceiptEditor).
 */

import { useEffect, useState } from "react";
import { LayoutGrid, ReceiptText } from "lucide-react";
import type { RpcResult } from "../lib/contract";
import { useApp } from "../state/app";
import { useTask } from "../hooks/useTask";
import { rpc, invokeCmd, errorText } from "../lib/rpc";
import { baseName } from "../lib/format";
import { Button } from "../components/ui/Button";
import { ErrorLine, Working } from "../components/common/Status";
import { ReceiptEditor } from "../components/receipt/ReceiptEditor";

export function ReceiptCard({ paths }: { paths: string[] }) {
  const { ready, ai, settings, toast } = useApp();
  const read = useTask<RpcResult<"receipt_read">>();
  const [started, setStarted] = useState(false);
  // AI 상태를 읽을 틈을 조금 준다 (못 읽어도 AI 없이 읽는다)
  const [waited, setWaited] = useState(false);
  useEffect(() => { const t = setTimeout(() => setWaited(true), 1500); return () => clearTimeout(t); }, []);

  useEffect(() => {
    if (!ready || started || (!ai && !waited)) return;
    setStarted(true);
    const useAi = !!ai?.configured && !ai.is_cloud;
    void read.run(({ signal, onProgress }) => rpc("receipt_read", { paths, ai: useAi }, { signal, onProgress }));
  }, [ready, started, ai, waited, paths, read]);

  const toMain = () => invokeCmd("card_handoff", { action: "receipt", paths }).catch((e) => toast(errorText(e), "error"));
  const template = settings?.receipt?.template_name;
  const title = paths.length === 1 ? baseName(paths[0]) : `영수증 ${paths.length}장`;

  return (
    <div className="kd-card kd-card-receipt">
      <header className="kd-card-head">
        <span className="kd-card-multi-icon" aria-hidden="true"><ReceiptText size={18} /></span>
        <div className="min-w-0 flex-1">
          <div className="kd-card-title">{title} → 지출조서</div>
          <div className="kd-card-facts">{template ? `기관 서식: ${template}` : "기본 서식"} · 글자는 이 PC에서 읽습니다</div>
        </div>
      </header>
      <main className="kd-card-body">
        {(!started || read.busy) && <Working label="영수증을 읽는 중" progress={read.progress} onCancel={read.busy ? read.cancel : undefined} />}
        <ErrorLine message={read.error} />
        {read.result && (
          <ReceiptEditor receipts={read.result.receipts} aiUsed={read.result.ai_used} warnings={read.result.warnings} autoCopy />
        )}
      </main>
      <footer className="kd-card-foot">
        <Button size="sm" variant="secondary" onClick={() => void toMain()} data-tip="본창의 여러 파일 한꺼번에에서 이 영수증들로 다시 읽어 이어서 합니다">
          <LayoutGrid size={13} /> 본창에서 열기
        </Button>
      </footer>
    </div>
  );
}
