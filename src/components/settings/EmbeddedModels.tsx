/** 이 PC 안 AI — 추천 모델 받기·가진 파일 가져오기·고르기·미리 올려 두기 */

import { useCallback, useEffect, useState } from "react";
import { Download, FileUp, Flame, Trash2 } from "lucide-react";
import type { LlmCatalogItem } from "../../lib/contract";
import { useApp } from "../../state/app";
import { rpc, errorText, type Progress } from "../../lib/rpc";
import { FILTERS, pickFiles } from "../../lib/native";
import { baseName, fileSize, num } from "../../lib/format";
import { useTask } from "../../hooks/useTask";
import { Button } from "../ui/Button";
import { Field, Seg, SelectField } from "../common/Field";
import { ErrorLine, Note, StatusLine } from "../common/Status";
import { Advanced } from "./dirty";

interface Props {
  modelPath: string;
  contextSize: number;
  gpu: "auto" | "off";
  onChange: (p: { model_path?: string; context_size?: number; gpu?: "auto" | "off" }) => void;
}

export function EmbeddedModels({ modelPath, contextSize, gpu, onChange }: Props) {
  const { settings, toast } = useApp();
  const offline = settings?.privacy.offline;
  const [catalog, setCatalog] = useState<LlmCatalogItem[]>([]);
  const [files, setFiles] = useState<Array<{ path: string; name: string; size: number }>>([]);
  const [down, setDown] = useState<{ id: string; p: Progress | null } | null>(null);
  const [error, setError] = useState("");
  const warm = useTask<{ gpu: string | false; context_size: number }>();

  const refresh = useCallback(async () => {
    try {
      const [c, l] = await Promise.all([rpc("llm_catalog", {}), rpc("llm_list", {})]);
      setCatalog(c);
      setFiles(l);
    } catch (e) { setError(errorText(e)); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const pathOf = (item: LlmCatalogItem) => files.find((f) => f.name === item.file)?.path;

  const download = async (item: LlmCatalogItem) => {
    setDown({ id: item.id, p: null });
    setError("");
    try {
      const r = await rpc("llm_download", { id: item.id }, { onProgress: (p) => setDown({ id: item.id, p }) });
      onChange({ model_path: r.path });
      toast(`${item.name} 모델을 받았습니다. 저장을 누르면 이 모델을 씁니다.`, "success");
      void refresh();
    } catch (e) { setError(errorText(e)); }
    setDown(null);
  };

  const importFile = async () => {
    const [p] = await pickFiles({ multiple: false, filters: FILTERS.gguf });
    if (!p) return;
    try {
      const r = await rpc("llm_import", { path: p });
      onChange({ model_path: r.path });
      void refresh();
    } catch (e) { setError(errorText(e)); }
  };

  const remove = async (path: string) => {
    try { await rpc("llm_delete", { path }); if (path === modelPath) onChange({ model_path: "" }); void refresh(); }
    catch (e) { setError(errorText(e)); }
  };

  const extra = files.filter((f) => !catalog.some((c) => c.file === f.name));

  return (
    <div className="flex flex-col gap-4">
      <div className="kd-rows">
        {catalog.map((item) => {
          const have = pathOf(item);
          const using = !!have && have === modelPath;
          const busy = down?.id === item.id;
          return (
            <div key={item.id} className="kd-row items-start">
              <span className="kd-row-main">
                <span className="kd-row-title flex flex-wrap items-center gap-1.5">
                  {item.name}
                  {item.recommended && <span className="kd-badge" data-tone="accent">추천</span>}
                  {using && <span className="kd-badge" data-tone="ok">쓰는 중</span>}
                </span>
                <span className="kd-row-desc block kd-num">{item.size_gb}GB · 메모리 {item.ram_gb}GB 이상 · {item.license}</span>
                <span className="kd-small block mt-0.5" style={{ color: "var(--color-text-secondary)" }}>{item.description}</span>
                {busy && <span className="block mt-1.5"><StatusLine tone="busy">{down?.p?.message || "받는 중"}</StatusLine></span>}
              </span>
              <span className="kd-row-aside">
                {have ? (
                  using ? null : <Button size="sm" variant="secondary" onClick={() => onChange({ model_path: have })}>이 모델 쓰기</Button>
                ) : (
                  <Button size="sm" variant="secondary" disabled={!!down || offline} title={offline ? "폐쇄망 모드에서는 받지 않습니다" : undefined} onClick={() => void download(item)}>
                    <Download size={13} /> 받기
                  </Button>
                )}
              </span>
            </div>
          );
        })}
        {extra.map((f) => (
          <div key={f.path} className="kd-row">
            <span className="kd-row-main">
              <span className="kd-row-title flex items-center gap-1.5">{f.name}{f.path === modelPath && <span className="kd-badge" data-tone="ok">쓰는 중</span>}</span>
              <span className="kd-row-desc block">가져온 모델 · {fileSize(f.size)}</span>
            </span>
            <span className="kd-row-aside">
              {f.path !== modelPath && <Button size="sm" variant="secondary" onClick={() => onChange({ model_path: f.path })}>이 모델 쓰기</Button>}
              <button type="button" className="kd-icon-btn" onClick={() => void remove(f.path)} aria-label={`${f.name} 지우기`}><Trash2 size={14} /></button>
            </span>
          </div>
        ))}
      </div>
      {offline && <Note tone="info">폐쇄망 모드라 인터넷에서 받지 않습니다. 인터넷이 되는 PC에서 받은 모델 파일을 USB로 옮겨 가져오세요.</Note>}
      <div><Button variant="secondary" onClick={() => void importFile()}><FileUp size={14} /> 가진 모델 파일 가져오기</Button></div>
      {modelPath && <p className="kd-small kd-muted">고른 모델: {baseName(modelPath)}</p>}
      <ErrorLine message={error} />

      <Advanced>
        <div className="flex flex-wrap items-start gap-4">
          <div style={{ width: 220 }}>
            <SelectField label="한 번에 읽는 글 양" hint="길게 할수록 긴 문서를 한 번에 보지만 메모리를 더 씁니다." value={String(contextSize)} onChange={(v) => onChange({ context_size: Number(v) })}
              options={([[4096, "보통"], [8192, "길게"], [16384, "더 길게"], [32768, "아주 길게"]] as const).map(([n, l]) => ({ value: String(n), label: `${l} (${num(n)})` }))} />
          </div>
          <Field label="그래픽 칩"><Seg label="그래픽 칩" value={gpu} onChange={(v) => onChange({ gpu: v })} options={[{ value: "auto", label: "있으면 쓰기" }, { value: "off", label: "쓰지 않기" }]} /></Field>
        </div>
        <p className="kd-small kd-muted">괄호 안 숫자는 AI가 글을 나눠 세는 조각(토큰) 수입니다. 그래픽 칩(GPU)이 없으면 저절로 CPU로 돌립니다. 가져올 모델 파일은 .gguf 형식입니다.</p>
      </Advanced>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" disabled={warm.busy || !modelPath} onClick={() => void warm.run(() => rpc("ai_warmup", {}))}><Flame size={14} /> {warm.busy ? "올리는 중" : "미리 올려 두기"}</Button>
        <span className="kd-small kd-muted">처음 쓸 때 기다리지 않도록 모델을 메모리에 올립니다</span>
      </div>
      {warm.result && <Note tone="ok">준비됐습니다. {warm.result.gpu ? "그래픽 칩으로 돌립니다." : "그래픽 칩 없이 돌립니다."}</Note>}
      <ErrorLine message={warm.error} />
    </div>
  );
}
