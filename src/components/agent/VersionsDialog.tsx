/** 최종본 찾기 창 (본창) — AI 없이 된다. 홈 예제·문서 화면에서 연다. 앞 판과 비교는 비교 화면으로 */

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useApp } from "../../state/app";
import { errorText, rpc } from "../../lib/rpc";
import { baseName } from "../../lib/format";
import type { VersionsResult } from "../../lib/contract";
import { Modal } from "../ui/Modal";
import { ErrorLine } from "../common/Status";
import { VersionsPanel } from "./VersionsPanel";

export function VersionsDialog({ path, onClose }: { path: string | null; onClose: () => void }) {
  const { startCompare } = useApp();
  const [r, setR] = useState<VersionsResult | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setR(null);
    setError("");
    if (path) void rpc("find_versions", { path }).then(setR, (e) => setError(errorText(e)));
  }, [path]);

  const others = r ? r.versions.length - 1 : 0;
  return (
    <Modal isOpen={!!path} onClose={onClose} title={path ? `최종본 찾기 · ${baseName(path)}` : "최종본 찾기"} size="lg">
      {!r && !error && <p className="kd-text kd-muted flex items-center gap-2"><Loader2 size={15} className="kd-spin" /> 같은 폴더와 위·아래 폴더에서 같은 문서의 다른 판을 찾는 중입니다</p>}
      <ErrorLine message={error} />
      {r && others === 0 && <p className="kd-text">같은 문서의 다른 판을 찾지 못했습니다. 이 문서가 하나뿐입니다.</p>}
      {r && others > 0 && (
        <div className="flex flex-col gap-3">
          <p className="kd-text">다른 판 <b>{others}개</b>를 찾았습니다. 최종으로 보이는 것은 <b>{r.latest === path ? "고른 이 문서" : baseName(r.latest)}</b> 입니다.</p>
          <VersionsPanel result={r} onCompare={(a, b) => { onClose(); startCompare(a, b); }} />
        </div>
      )}
    </Modal>
  );
}
