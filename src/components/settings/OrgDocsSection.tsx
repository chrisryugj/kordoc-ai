/** 나. 우리 기관 문서 모음 — 기관 문서를 넣어 두면 AI 초안이 그 구성·표현을 따르고, 새 문서를 그 서식으로 만든다 (org_corpus_*) */

import { useCallback, useEffect, useRef, useState } from "react";
import { FilePlus2, FolderPlus, Star, Trash2 } from "lucide-react";
import type { OrgCorpusView } from "../../lib/contract";
import { useApp } from "../../state/app";
import { rpc, errorText } from "../../lib/rpc";
import { FILTERS, pickFiles, pickFolder } from "../../lib/native";
import { useTask } from "../../hooks/useTask";
import { useGongmunMeta } from "../../hooks/useGongmunMeta";
import { addSummary, orgCorpusChanged } from "../../hooks/useOrgCorpus";
import { Button } from "../ui/Button";
import { Section } from "../common/Field";
import { ErrorLine, Note, Working } from "../common/Status";

type Doc = OrgCorpusView["docs"][number];

export function OrgDocsSection() {
  const { ready, toast, registerDrop, dragTarget } = useApp();
  const meta = useGongmunMeta();
  const [corpus, setCorpus] = useState<OrgCorpusView | null>(null);
  const [error, setError] = useState("");
  const add = useTask<void>();
  const runAdd = add.run;
  /** 넣는 중에 또 넣으면(끌어 놓기) 앞 작업을 멈추지 않고 알린다 */
  const busy = useRef(false);
  busy.current = add.busy;

  const show = useCallback((v: OrgCorpusView) => { setCorpus(v); setError(""); orgCorpusChanged(); }, []);
  useEffect(() => {
    if (!ready) return;
    rpc("org_corpus_list", {}).then(setCorpus).catch((e) => setError(errorText(e)));
  }, [ready]);

  const put = useCallback((paths: string[]) => {
    if (!paths.length) return;
    if (busy.current) { toast("문서를 읽는 중입니다. 끝난 뒤 다시 넣으세요.", "info"); return; }
    void runAdd(async ({ signal, onProgress }) => {
      try {
        const r = await rpc("org_corpus_add", { paths }, { signal, onProgress });
        show(r.corpus);
        toast(addSummary(r), r.added ? "success" : "info");
      } catch (e) {
        // 멈추거나 실패해도 그때까지 넣은 것은 목록에 있다
        const v = await rpc("org_corpus_list", { settle: true }).catch(() => null);
        if (v) show(v);
        throw e;
      }
    });
  }, [runAdd, show, toast]);
  useEffect(() => registerDrop("orgdocs", put), [registerDrop, put]);

  const change = async (fn: () => Promise<OrgCorpusView>) => {
    try { show(await fn()); } catch (e) { toast(errorText(e), "error"); }
  };

  const kindOptions = (meta?.presets ?? []).map((p) => ({ value: p.id, label: p.label }));
  const docs = corpus?.docs ?? [];

  return (
    <Section id="set-orgdocs" mark="나." title="우리 기관 문서 모음"
      sub="결재가 끝난 우리 기관 한글 문서(HWP·HWPX)를 넣어 두면 AI 초안이 그 구성과 자주 쓰는 표현을 따르고, 새 문서를 그 서식으로 만듭니다. 한글 편집기의 AI 대화도 이 구성을 참고합니다. 이 PC에만 둡니다."
      aside={<>
        <Button variant="secondary" size="sm" disabled={add.busy} onClick={() => void pickFiles({ filters: FILTERS.hangul }).then(put)}><FilePlus2 size={13} /> 문서 넣기</Button>
        <Button variant="secondary" size="sm" disabled={add.busy} onClick={() => void pickFolder().then((d) => d && put([d]))}><FolderPlus size={13} /> 폴더째 넣기</Button>
      </>}>
      <div className="kd-orgdocs" data-drop="orgdocs" data-over={dragTarget === "orgdocs"}>
        {add.busy && <Working label="문서를 읽는 중" progress={add.progress} onCancel={add.cancel} />}
        <ErrorLine message={error || add.error} />
        {corpus?.notice && <Note tone="warn">{corpus.notice}</Note>}
        {corpus && !docs.length && !add.busy && (
          <p className="kd-small kd-muted" style={{ textWrap: "balance" }}>아직 넣은 문서가 없습니다. 보고서·기안문을 갈래마다 몇 건씩 넣거나 여기에 끌어다 놓으세요. 갈래는 문서 모양을 보고 정하고, 갈래마다 처음 넣은 문서가 대표 견본이 됩니다.</p>
        )}
        {corpus?.kinds.map((k) => (
          <div key={k.kind} className="kd-orgdocs-kind">
            <h3 className="kd-label">{k.label} <span className="kd-muted">{k.count}건</span></h3>
            <ul className="kd-orgdocs-list">
              {docs.filter((d) => d.kind === k.kind).map((d) => (
                <DocRow key={d.id} doc={d} kindOptions={kindOptions} disabled={add.busy}
                  onKind={(kind) => void change(() => rpc("org_corpus_set", { id: d.id, kind }))}
                  onExemplar={() => void change(() => rpc("org_corpus_set", { id: d.id, exemplar: true }))}
                  onRemove={() => void change(() => rpc("org_corpus_remove", { id: d.id }))} />
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Section>
  );
}

function DocRow({ doc, kindOptions, disabled, onKind, onExemplar, onRemove }: {
  doc: Doc; kindOptions: Array<{ value: string; label: string }>; disabled?: boolean; onKind: (kind: string) => void; onExemplar: () => void; onRemove: () => void;
}) {
  return (
    <li className="kd-orgdocs-row" data-exemplar={doc.exemplar || undefined}>
      <span className="kd-row-main min-w-0">
        <span className="kd-row-title block">
          {doc.exemplar && <span className="kd-badge kd-orgdocs-star" data-tone="info"><Star size={11} /> 대표 견본</span>}
          {doc.missing && <span className="kd-badge kd-orgdocs-star" data-tone="warn">사본 없음</span>} {doc.title}
        </span>
        <span className="kd-row-desc block" title={doc.path}>{doc.missing ? "앱에 둔 사본이 지워져 견본으로 쓰지 않습니다. 빼고 다시 넣으세요. · " : ""}{doc.name}{doc.summary ? ` · ${doc.summary}` : ""}</span>
      </span>
      <span className="kd-row-aside">
        <select className="kd-select kd-select-sm" value={doc.kind} disabled={disabled} onChange={(e) => onKind(e.target.value)} aria-label={`${doc.title} 갈래`}>
          {kindOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {!doc.exemplar && !doc.missing && <Button variant="ghost" size="sm" disabled={disabled} onClick={onExemplar}>대표로</Button>}
        <button type="button" className="kd-icon-btn" disabled={disabled} onClick={onRemove} aria-label={`${doc.title} 빼기`}><Trash2 size={14} /></button>
      </span>
    </li>
  );
}
