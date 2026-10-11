/** 도장 — "(인)" 같은 자리를 찾아 관인·서명 그림을 겹쳐 찍는다 (HWPX) */

import { useState } from "react";
import { ImagePlus, Stamp } from "lucide-react";
import type { ToolProps } from "../ToolPanel";
import { useApp } from "../../../state/app";
import { rpc } from "../../../lib/rpc";
import { FILTERS, pickFiles } from "../../../lib/native";
import { baseName } from "../../../lib/format";
import { useTask } from "../../../hooks/useTask";
import { Button } from "../../ui/Button";
import { Field } from "../../common/Field";
import { ErrorLine, Note, SavedFile, Working } from "../../common/Status";

export function SealTool({ doc }: ToolProps) {
  const { settings, go } = useApp();
  const [image, setImage] = useState(settings?.org.seal_image ?? "");
  const [anchor, setAnchor] = useState("(인)");
  const task = useTask<{ output_path: string; placed: number }>();

  return (
    <div className="flex flex-col gap-4">
      <p className="kd-small kd-muted">문서에서 도장 자리 글자를 찾아 그 위에 그림을 얹습니다. 원본은 두고 사본을 만듭니다.</p>
      <Field label="도장 그림 (PNG)" hint={settings?.org.seal_image ? "내 기관 정보에 등록한 그림입니다" : undefined}>
        <div className="kd-inset flex items-center gap-2 px-3 py-2">
          <span className="kd-path flex-1">{image ? baseName(image) : "아직 고르지 않았습니다"}</span>
          <button type="button" className="kd-link kd-small flex-none" onClick={() => void pickFiles({ multiple: false, filters: FILTERS.image }).then((p) => p[0] && setImage(p[0]))}>
            <ImagePlus size={13} className="inline -mt-0.5" /> 고르기
          </button>
        </div>
      </Field>
      {!settings?.org.seal_image && (
        <p className="kd-small kd-muted">자주 쓰면 <button type="button" className="kd-link" onClick={() => go("settings")}>내 기관 정보</button>에 등록해 두세요.</p>
      )}
      <Field label="찍을 자리 글자" hint="예: (인), 서명 또는 인, 직인">
        <input className="kd-input" value={anchor} onChange={(e) => setAnchor(e.target.value)} aria-label="찍을 자리 글자" />
      </Field>
      {task.busy ? <Working label="도장을 찍는 중" /> : (
        <Button size="lg" disabled={!image || !anchor.trim()} onClick={() => void task.run(() => rpc("seal", { path: doc.path, image_path: image, anchor: anchor.trim() }))}>
          <Stamp size={15} /> 도장 찍기
        </Button>
      )}
      <ErrorLine message={task.error} />
      {task.result && (task.result.placed > 0
        ? <SavedFile path={task.result.output_path} label={`${task.result.placed}곳에 찍은 사본을 저장했습니다`} />
        : <Note tone="warn">“{anchor}” 글자를 찾지 못했습니다. 문서에 쓰인 글자 그대로 넣어 보세요.</Note>)}
    </div>
  );
}
